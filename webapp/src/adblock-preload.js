import { configRead } from './config.js';
import {
  isBrowseResponse,
  stripShortsFromBrowseResponse
} from './shorts-response-filter.mjs';

if (!window.__ytafPreloadExecuted) {
  window.__ytafPreloadExecuted = true;

  let shortsEnabled = Boolean(configRead('enableShorts'));

  document.addEventListener('ytaf-config-changed', (event) => {
    if (event && event.detail && event.detail.key === 'enableShorts') {
      shortsEnabled = Boolean(event.detail.value);
    }
  });

  if (!window.__ytafShortsResponseFilterInstalled) {
    window.__ytafShortsResponseFilterInstalled = true;

    const previousParse = JSON.parse;
    JSON.parse = function () {
      const value = previousParse.apply(this, arguments);

      if (
        !shortsEnabled &&
        isBrowseResponse(value) &&
        stripShortsFromBrowseResponse(value)
      ) {
        console.log('[ytaf preload] Shorts blocker removed browse renderers');
      }

      return value;
    };
  }

  console.info('[ytaf preload] Early hooks installed');
}
