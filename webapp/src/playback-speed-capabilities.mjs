const SOURCE_FRAME_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];

// YouTube's fast-playback probes multiply both frame rate and bitrate by the
// requested speed. Keep the bitrate/codec checks, but distinguish the effective
// HD frame rate from the source frame rate sent to Starfish's rate-controlled
// decoder. UHD and AVC probes retain their native limits.
export function normalizeSpeedCapabilityMime(mime, rate) {
  if (
    typeof mime !== 'string' ||
    !Number.isFinite(rate) ||
    rate <= 1 ||
    rate > 2
  ) {
    return mime;
  }
  if (
    !/^video\/(?:mp4|webm)\s*;/i.test(mime) ||
    !/\bcodecs\s*=\s*"?(?:av01\.|vp09\.|vp9\b)/i.test(mime)
  ) {
    return mime;
  }
  const width = /\bwidth\s*=\s*(\d+)\s*(?:;|$)/i.exec(mime);
  const height = /\bheight\s*=\s*(\d+)\s*(?:;|$)/i.exec(mime);
  if (
    !width ||
    !height ||
    Number(width[1]) <= 0 ||
    Number(height[1]) <= 0 ||
    Number(width[1]) > 1920 ||
    Number(height[1]) > 1080
  ) {
    return mime;
  }
  const match = /\bframerate\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*(?:;|$)/i.exec(mime);
  if (!match || Number(match[1]) <= 60) return mime;
  const sourceRate = Number(match[1]) / rate;
  if (
    sourceRate > 60.01 ||
    !SOURCE_FRAME_RATES.some((known) => Math.abs(known - sourceRate) < 0.02)
  ) {
    return mime;
  }
  return mime.replace(
    /(\bframerate\s*=\s*)([0-9]+(?:\.[0-9]+)?)/i,
    (_, prefix) => prefix + Math.min(60, sourceRate)
  );
}

// Client speed values can briefly disagree during a change. Correct only when
// the probe identifies one unambiguous source rate; never choose the larger
// client value merely because it is larger.
export function normalizeSpeedCapabilityProbe(mime, rates) {
  const candidates = new Set(
    rates
      .map((rate) => normalizeSpeedCapabilityMime(mime, rate))
      .filter((candidate) => candidate !== mime)
  );
  return candidates.size === 1 ? candidates.values().next().value : mime;
}

export function installPlaybackSpeedCapabilities(win) {
  if (
    !win ||
    win.__ytafSpeedCapabilitiesInstalled ||
    !/\bCobalt\//i.test(win.navigator?.userAgent || '') ||
    !/^(?:www\.)?youtube\.com$/i.test(win.location?.hostname || '') ||
    !/^\/tv(?:\/|$)/.test(win.location?.pathname || '') ||
    typeof win.MediaSource?.isTypeSupported !== 'function'
  ) {
    return false;
  }
  const original = win.MediaSource.isTypeSupported;
  function isTypeSupported(mime) {
    const nativeResult = original.apply(this, arguments);
    if (nativeResult) return nativeResult;
    let rates = [];
    try {
      const video = win.document.querySelector('video');
      const player = win.document.getElementById(
        'ytlr-player__player-container-player'
      );
      rates = [video?.playbackRate, player?.getPlaybackRate?.()];
    } catch (_) {
      return nativeResult;
    }
    const normalized = normalizeSpeedCapabilityProbe(mime, rates);
    return normalized === mime ? nativeResult : original.call(this, normalized);
  }
  try {
    win.MediaSource.isTypeSupported = isTypeSupported;
    if (win.MediaSource.isTypeSupported !== isTypeSupported) return false;
    win.__ytafSpeedCapabilitiesInstalled = true;
    return true;
  } catch (_) {
    return false;
  }
}
