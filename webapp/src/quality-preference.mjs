// Quality preference controller for the YouTube TV player.
//
// The player already exposes a sticky manual quality choice; this module applies
// a configured cap once per video and then leaves the choice alone. It never
// mutates manifests or capability probes: if YouTube did not offer a level, a
// preference cannot create it.

const QUALITY_HEIGHTS = Object.freeze({
  highres: 4320,
  hd2880: 2880,
  hd2160: 2160,
  hd1440: 1440,
  hd1080: 1080,
  hd720: 720,
  large: 480,
  medium: 360,
  small: 240,
  tiny: 144
});

const RETRY_INTERVAL_MS = 250;
const MAX_RETRIES = 24;
const CONFIG_APPLY_DELAY_MS = 300;
const STALL_CHECK_MS = 4000;
const STALL_PROGRESS_MS = 750;

export function qualityHeight(level) {
  if (typeof level !== 'string') return 0;
  const key = level.trim().toLowerCase();
  if (!key || key === 'auto' || key === 'default') return 0;
  if (Object.prototype.hasOwnProperty.call(QUALITY_HEIGHTS, key)) {
    return QUALITY_HEIGHTS[key];
  }
  const match = /^hd(\d{3,4})$/.exec(key);
  return match ? Number(match[1]) : 0;
}

// `preference` is 'auto', 'max' or a height cap such as '1080'/'2160'.
// Returns the highest offered level at or below the cap, or null to leave Auto.
export function pickQualityLevel(levels, preference) {
  if (preference === 'auto' || preference === undefined || preference === null) {
    return null;
  }
  if (!Array.isArray(levels) || levels.length === 0) return null;

  const cap = preference === 'max' ? Infinity : Number(preference);
  if (!(cap === Infinity || (Number.isFinite(cap) && cap > 0))) return null;

  let best = null;
  let bestHeight = 0;
  for (const level of levels) {
    const height = qualityHeight(level);
    if (height <= 0 || height > cap) continue;
    if (height > bestHeight) {
      best = level;
      bestHeight = height;
    }
  }
  return best;
}

export function currentVideoId(win) {
  const candidates = [
    win?.location?.href,
    win?.location?.hash,
    win?.location?.search
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = String(candidate).match(/[?&#]v=([^&#]+)/);
    if (match && match[1]) return decodeURIComponent(match[1]).replace(/^v=/, '');
  }

  const responseId = win?.ytInitialPlayerResponse?.videoDetails?.videoId;
  return responseId ? String(responseId) : null;
}

function applyQuality(player, level) {
  try {
    if (typeof player.setPlaybackQualityRange === 'function') {
      player.setPlaybackQualityRange(level, level);
      return true;
    }
  } catch (_) {
    // Fall through to the single-value method below.
  }
  try {
    if (typeof player.setPlaybackQuality === 'function') {
      player.setPlaybackQuality(level);
      return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

// Installs the controller. `getPreference` returns the persisted preference.
// Returns false when the page or player surface does not match this TV client.
export function installQualityPreference(win, getPreference) {
  const doc = win?.document;
  if (!doc || typeof getPreference !== 'function') return false;
  if (win.__ytafQualityPreferenceInstalled) return false;
  if (!/^(?:www\.)?youtube\.com$/i.test(win.location?.hostname || '')) {
    return false;
  }
  if (!/^\/tv(?:\/|$)/.test(win.location?.pathname || '')) return false;

  const state = {
    videoId: null,
    appliedFor: null,
    appliedTarget: null,
    failedFor: new Set(),
    retries: 0,
    retryTimer: null,
    stallTimer: null,
    apiMissing: false
  };

  const playerElement = () =>
    doc.getElementById('ytlr-player__player-container-player');
  function safeCall(fn) {
    try {
      return fn();
    } catch (_) {
      return null;
    }
  }
  function playerData(player) {
    return player && typeof player.getVideoData === 'function'
      ? safeCall(() => player.getVideoData())
      : null;
  }
  function playerLevels(player) {
    return player && typeof player.getAvailableQualityLevels === 'function'
      ? safeCall(() => player.getAvailableQualityLevels())
      : null;
  }
  function playerCurrent(player) {
    return player && typeof player.getPlaybackQuality === 'function'
      ? safeCall(() => player.getPlaybackQuality())
      : null;
  }

  function clearTimers() {
    if (state.retryTimer !== null) {
      win.clearTimeout(state.retryTimer);
      state.retryTimer = null;
    }
    if (state.stallTimer !== null) {
      win.clearTimeout(state.stallTimer);
      state.stallTimer = null;
    }
  }

  function release(player) {
    if (player) applyQuality(player, 'auto');
  }

  function retryLater() {
    clearTimers();
    if (state.retries >= MAX_RETRIES) return;
    state.retries += 1;
    state.retryTimer = win.setTimeout(() => {
      state.retryTimer = null;
      attempt();
    }, RETRY_INTERVAL_MS);
  }

  function watchForStall(videoId) {
    if (state.stallTimer !== null) win.clearTimeout(state.stallTimer);
    state.stallTimer = win.setTimeout(() => {
      state.stallTimer = null;
      if (state.videoId !== videoId || state.appliedFor !== videoId) return;
      const video = doc.querySelector('video');
      if (!video || video.error || video.paused) return;
      const firstTime = Number(video.currentTime) || 0;
      state.stallTimer = win.setTimeout(() => {
        state.stallTimer = null;
        if (state.videoId !== videoId || state.appliedFor !== videoId) return;
        const laterVideo = doc.querySelector('video');
        if (!laterVideo || laterVideo.error || laterVideo.paused) return;
        // A seek also moves the position; only a frozen clock is a stall.
        if (Math.abs((Number(laterVideo.currentTime) || 0) - firstTime) > 0.05) return;
        // A pinned level that cannot present is worse than Auto. Revert once.
        release(playerElement());
        state.appliedFor = null;
        state.appliedTarget = null;
        state.failedFor.add(videoId);
        console.info('[ytaf quality] reverted to Auto for', videoId);
      }, STALL_PROGRESS_MS);
    }, STALL_CHECK_MS);
  }

  function attempt() {
    const videoId = currentVideoId(win);
    if (!videoId) {
      state.videoId = null;
      return;
    }

    if (videoId !== state.videoId) {
      clearTimers();
      state.videoId = videoId;
      state.retries = 0;
      state.appliedFor = null;
      state.appliedTarget = null;
    }

    const preference = getPreference();
    if (preference === 'auto') {
      const player = playerElement();
      if (state.appliedFor === videoId) {
        release(player);
        console.info('[ytaf quality] released manual choice for', videoId);
      }
      state.appliedFor = null;
      state.appliedTarget = null;
      return;
    }

    if (state.apiMissing) return;
    if (state.appliedFor === videoId || state.failedFor.has(videoId)) return;

    const video = doc.querySelector('video');
    const player = playerElement();
    if (!video || !player || video.readyState < 1) {
      retryLater();
      return;
    }

    const data = playerData(player);
    if (!data || !data.video_id || String(data.video_id) !== videoId) {
      retryLater();
      return;
    }
    if (
      data.isLive === true ||
      data.is_live === true ||
      data.live === true ||
      video.duration === Infinity
    ) {
      // Live edges have their own latency behaviour; leave them on Auto.
      return;
    }

    const levels = playerLevels(player);
    if (!Array.isArray(levels) || levels.length === 0) {
      retryLater();
      return;
    }

    const target = pickQualityLevel(levels, preference);
    if (!target) {
      // The video does not offer a level at or below the cap.
      if (state.failedFor.size > 50) state.failedFor.clear();
      state.failedFor.add(videoId);
      return;
    }

    if (!applyQuality(player, target)) {
      // No quality setter on this client: stop trying rather than polling.
      state.apiMissing = true;
      console.warn('[ytaf quality] player exposes no quality setter');
      return;
    }
    state.appliedFor = videoId;
    state.appliedTarget = target;
    state.retries = 0;
    console.info('[ytaf quality] pinned', target, 'for', videoId);
    watchForStall(videoId);
  }

  function onConfigChanged(event) {
    if (event?.detail?.key !== 'qualityPreference') return;
    state.failedFor.clear();
    state.retries = 0;
    clearTimers();
    if (getPreference() === 'auto') {
      // Release the sticky manual choice we applied earlier.
      if (state.appliedTarget) release(playerElement());
      state.appliedFor = null;
      state.appliedTarget = null;
      attempt();
      return;
    }
    // A changed cap may re-apply on the same video. Debounce rapid cycling so
    // intermediate choices do not each trigger a pipeline reload.
    state.appliedFor = null;
    state.appliedTarget = null;
    state.retryTimer = win.setTimeout(() => {
      state.retryTimer = null;
      attempt();
    }, CONFIG_APPLY_DELAY_MS);
  }

  function onPlaybackEvent() {
    attempt();
  }

  doc.addEventListener('durationchange', onPlaybackEvent, true);
  doc.addEventListener('yt-navigate-finish', onPlaybackEvent, true);
  doc.addEventListener('ytaf-config-changed', onConfigChanged, true);
  win.addEventListener('hashchange', onPlaybackEvent, true);

  function diagnostics() {
    const player = playerElement();
    const video = doc.querySelector('video');
    const data = playerData(player);
    return {
      preference: getPreference(),
      videoId: state.videoId,
      appliedFor: state.appliedFor,
      appliedTarget: state.appliedTarget,
      failed: state.failedFor.size,
      apiMissing: state.apiMissing,
      retries: state.retries,
      duration: video ? video.duration : null,
      api: player
        ? {
            range: typeof player.setPlaybackQualityRange,
            single: typeof player.setPlaybackQuality,
            levels: typeof player.getAvailableQualityLevels,
            current: typeof player.getPlaybackQuality
          }
        : null,
      levels: playerLevels(player),
      current: playerCurrent(player),
      playerVideoId: data?.video_id ? String(data.video_id) : null
    };
  }

  state.retryTimer = win.setTimeout(attempt, 500);
  win.__ytafQualityPreferenceInstalled = true;
  win.__ytafQualityPreference = {
    sync: attempt,
    debugState: diagnostics,
    destroy() {
      clearTimers();
      doc.removeEventListener('durationchange', onPlaybackEvent, true);
      doc.removeEventListener('yt-navigate-finish', onPlaybackEvent, true);
      doc.removeEventListener('ytaf-config-changed', onConfigChanged, true);
      win.removeEventListener('hashchange', onPlaybackEvent, true);
      win.__ytafQualityPreferenceInstalled = false;
    }
  };
  return true;
}
