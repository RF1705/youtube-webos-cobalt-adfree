console.info('[ytaf] adblock-main.js LOADING');

import './text-data-guard';
import 'whatwg-fetch';
import './domrect-polyfill';
import './json-stringify-hook';
import './ui.js';

import { handleLaunch, waitForChildAdd } from './utils';
import { configRead } from './config.js';
import { userScriptStartUI } from './ui.js';
import { userScriptStartAdBlock } from './adblock.js';
import { userScriptStartSponsorBlock } from './sponsorblock.js';
import { userScriptStartReturnYouTubeDislike } from './returnyoutubedislike.js';

console.info('[ytaf] adblock-main.js LOADED, all imports successful');

console.info('[ytaf] adblock-main.js LOADED, imports ready');

document.addEventListener(
  'webOSRelaunch',
  (evt) => {
    console.info('RELAUNCH:', evt, window.launchParams);
    handleLaunch(evt.detail);
  },
  true
);

// This IIFE is to keep the video element fill the entire window so that screensaver doesn't kick in.
(async () => {
  /** @type {HTMLVideoElement} */
  const video = await waitForChildAdd(
    document.body,
    (node) => node instanceof HTMLVideoElement
  );

  const playerCtrlObs = new MutationObserver(() => {
    const style = video.style;

    const targetWidth = `${window.innerWidth}px`;
    const targetHeight = `${window.innerHeight}px`;
    const targetLeft = '0px';
    // YT uses a negative top to hide player when not in use. Don't know why but let's not affect it.
    const targetTop =
      style.top === `-${window.innerHeight}px` ? style.top : '0px';

    /**
     * Check to see if identical before assignment as some webOS versions will trigger a mutation
     * mutation event even if the assignment effectively does nothing, leading to an infinite loop.
     */
    style.width !== targetWidth && (style.width = targetWidth);
    style.height !== targetHeight && (style.height = targetHeight);
    style.left !== targetLeft && (style.left = targetLeft);
    style.top !== targetTop && (style.top = targetTop);
  });

  playerCtrlObs.observe(video, {
    attributes: true,
    attributeFilter: ['style']
  });
})();

function startOptionalHook(configKey, startHook) {
  const enabled = configRead(configKey);
  console.info(`[ytaf] hook-check ${configKey} =>`, enabled);

  if (!enabled) {
    console.info(`[ytaf] hook-skip ${configKey}`);
    return;
  }

  try {
    console.info(`[ytaf] hook-start ${configKey}`);
    startHook();
    console.info(`[ytaf] hook-started ${configKey}`);
  } catch (err) {
    console.warn(`[ytaf] hook-failed ${configKey}:`, err);
  }
}

function startDebugOverlay() {
  if (typeof __YTAF_DEBUG__ === 'undefined' || !__YTAF_DEBUG__) {
    return;
  }

  try {
    require('./debug-overlay.js').userScriptStartDebugOverlay();
    console.info('[ytaf] Debug overlay started');
  } catch (err) {
    console.warn('[ytaf] Failed to start debug overlay:', err);
  }
}

export async function startUserScript() {
  console.info('[ytaf] startUserScript begin');

  try {
    userScriptStartUI();
    startDebugOverlay();
    console.info('[ytaf] UI started');
  } catch (err) {
    console.warn('[ytaf] Failed to start UI:', err);
  }

  try {
    startOptionalHook('enableAdBlock', userScriptStartAdBlock);
    startOptionalHook('enableSponsorBlock', userScriptStartSponsorBlock);
    startOptionalHook('enableReturnYouTubeDislike', userScriptStartReturnYouTubeDislike);
    console.info('[ytaf] All hooks loaded successfully');
  } catch (err) {
    console.warn('[ytaf] Failed loading hooks:', err);
  }
}

// Global error handlers to catch unhandled errors
window.addEventListener('error', (event) => {
  console.error('[ytaf] Global error:', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[ytaf] Unhandled promise rejection:', event.reason);
});

// Start the user script and catch any top-level errors
startUserScript().catch((err) => {
  console.error('[ytaf] startUserScript() error:', err);
});
