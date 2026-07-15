function getCurrentVideoId() {
  const candidates = [window.location.href, window.location.hash, window.location.search];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = String(candidate).match(/[?&#]v=([^&#]+)/);
    if (match && match[1]) return decodeURIComponent(match[1]).replace(/^v=/, '');
  }

  return (
    window.ytInitialPlayerResponse?.videoDetails?.videoId ||
    window.sponsorblock?.videoID ||
    window.returnYoutubeDislike?.videoID ||
    'n/a'
  );
}

function compact(value, maxLength = 120) {
  if (value === null || value === undefined || value === '') return 'n/a';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.substring(0, maxLength - 1)}...` : text;
}

function getRemoteKeyCode(evt) {
  return evt.keyCode || evt.which || evt.charCode || 0;
}

function isYellowKey(evt) {
  const keyCode = getRemoteKeyCode(evt);
  return keyCode === 405 || keyCode === 170;
}

function row(label, value) {
  return `${label}: ${compact(value)}`;
}

function getDescriptionDebugText(ryd) {
  if (!ryd?.getDescriptionDebugState) return ['RYD desc: n/a'];

  try {
    const state = ryd.getDescriptionDebugState();
    return [
      row(
        'RYD desc',
        `status=${state.status || 'n/a'} panels=${state.panels} panel=${state.panel} mode=${state.mode || 'n/a'} factoids=${state.factoids || 0} likes=${state.likes || 'n/a'} injected=${state.dislikeElement}`
      ),
      row(
        'RYD desc CSS',
        `ready=${state.readyClass || 'n/a'} text=${state.dislikeText || 'n/a'} compact=${state.compact || 'n/a'} standard=${state.standard || 'n/a'}`
      ),
      row('RYD desc err', state.error || 'n/a'),
      row('RYD desc rects', `container=${state.containerRect || 'n/a'} dislike=${state.dislikeRect || 'n/a'}`)
    ];
  } catch (err) {
    return [row('RYD desc debug error', err?.message || String(err))];
  }
}

function buildDebugText() {
  const sponsorBlock = window.sponsorblock;
  const ryd = window.returnYoutubeDislike;
  const video = document.querySelector('video');

  return [
    'YouTube AdFree Debug',
    row('videoId', getCurrentVideoId()),
    row(
      'video',
      video
        ? `${video.currentTime.toFixed(1)} / ${Number(video.duration || 0).toFixed(1)} paused=${video.paused} ready=${video.readyState}`
        : 'not found'
    ),
    row(
      'SponsorBlock',
      sponsorBlock
        ? `${sponsorBlock.fetchStatus} status=${sponsorBlock.lastStatus} segments=${sponsorBlock.segments?.length || 0}`
        : 'not started'
    ),
    row('SB error', sponsorBlock?.fetchError),
    row('SB body', sponsorBlock?.lastBody, 160),
    row(
      'RYD',
      ryd
        ? `${ryd.fetchStatus} status=${ryd.lastStatus} dislikes=${ryd.dislikes} loaded=${ryd.votesLoaded}`
        : 'not started'
    ),
    row('RYD error', ryd?.fetchError),
    row('RYD body', ryd?.lastBody, 160),
    ...getDescriptionDebugText(ryd),
    row('location', window.location.href, 180)
  ].join('\n');
}

function ensurePanel() {
  let panel = document.getElementById('ytaf-debug-overlay');
  if (panel) return panel;

  panel = document.createElement('pre');
  panel.id = 'ytaf-debug-overlay';
  panel.style.display = 'none';
  panel.style.visibility = 'hidden';
  panel.style.pointerEvents = 'none';
  (document.body || document.documentElement).appendChild(panel);
  return panel;
}

let refreshTimer = null;

function refreshPanel() {
  const panel = ensurePanel();
  if (!isPanelVisible(panel)) return;
  try {
    panel.textContent = buildDebugText();
  } catch (err) {
    panel.textContent = `YouTube AdFree Debug\nerror: ${compact(err?.message || String(err), 220)}`;
  }
}

function applyVisiblePanelStyles(panel) {
  Object.assign(panel.style, {
    position: 'fixed',
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    left: '64px',
    top: '64px',
    right: 'auto',
    bottom: 'auto',
    width: 'calc(100vw - 128px)',
    maxWidth: '1120px',
    maxHeight: '80vh',
    boxSizing: 'border-box',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: '0',
    padding: '24px',
    background: '#05080c',
    border: '6px solid #ffe245',
    color: '#d9ffe3',
    font: '22px/1.28 monospace',
    zIndex: '2147483647',
    pointerEvents: 'none',
    transform: 'none',
    animation: 'none',
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)'
  });
}

function isPanelVisible(panel = ensurePanel()) {
  return panel.style.display !== 'none' && panel.style.visibility !== 'hidden';
}

function showPanel() {
  const panel = ensurePanel();
  applyVisiblePanelStyles(panel);
  console.info('[ytaf] yellow debug overlay show');
  refreshPanel();

  if (!refreshTimer) {
    refreshTimer = window.setInterval(refreshPanel, 500);
  }
}

function hidePanel() {
  const panel = ensurePanel();
  panel.style.display = 'none';
  panel.style.visibility = 'hidden';
  console.info('[ytaf] yellow debug overlay hide');

  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function togglePanel() {
  const panel = ensurePanel();
  if (!isPanelVisible(panel)) {
    showPanel();
  } else {
    hidePanel();
  }
}

export function userScriptStartDebugOverlay() {
  if (window.__ytafDebugOverlayStarted) return;
  window.__ytafDebugOverlayStarted = true;

  document.addEventListener(
    'keydown',
    (evt) => {
      const keyCode = getRemoteKeyCode(evt);
      if ((keyCode === 461 || keyCode === 8 || evt.key === 'Escape') && isPanelVisible()) {
        evt.preventDefault();
        evt.stopPropagation();
        hidePanel();
        return;
      }

      if (!isYellowKey(evt)) return;
      evt.preventDefault();
      evt.stopPropagation();
      console.info(`[ytaf] yellow key ${keyCode} toggle`);
      togglePanel();
    },
    true
  );
}
