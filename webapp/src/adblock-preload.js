import { configRead } from './config.js';
import {
  isBrowseResponse,
  isGuideResponse,
  stripShortsFromBrowseResponse
} from './shorts-response-filter.mjs';

if (!window.__ytafPreloadExecuted) {
  window.__ytafPreloadExecuted = true;

  let shortsEnabled = Boolean(configRead('enableShorts'));

  if (!window.__ytafShortsResponseFilterInstalled) {
    window.__ytafShortsResponseFilterInstalled = true;

    const descriptor = Object.getOwnPropertyDescriptor(JSON, 'parse');
    const nativeParse = JSON.parse;
    const nativeStringify = JSON.stringify;
    let downstreamParse = nativeParse;
    let parsing = false;
    let originalGuideResponseJson = null;

    function captureGuideResponse(value) {
      try {
        originalGuideResponseJson = nativeStringify.call(JSON, value);
      } catch (error) {
        console.warn('[ytaf preload] Failed to preserve guide response', error);
      }
    }

    function applyGuideShortsState() {
      if (!originalGuideResponseJson) return false;

      const appElement = document.querySelector('ytlr-app');
      const app = appElement && appElement.__instance;
      if (!app || typeof app.K !== 'function') return false;

      let guideResponse;
      try {
        guideResponse = nativeParse.call(JSON, originalGuideResponseJson);
      } catch (error) {
        console.warn('[ytaf preload] Failed to restore guide response', error);
        return false;
      }

      if (!shortsEnabled) {
        stripShortsFromBrowseResponse(guideResponse);
      }

      app.K({ guideResponse });
      return true;
    }

    document.addEventListener('ytaf-config-changed', (event) => {
      if (event && event.detail && event.detail.key === 'enableShorts') {
        shortsEnabled = Boolean(event.detail.value);
        applyGuideShortsState();
      }
    });

    function ytafParse() {
      if (parsing) {
        return nativeParse.apply(this, arguments);
      }

      parsing = true;

      try {
        const value = downstreamParse.apply(this, arguments);
        const guideResponse = isGuideResponse(value);

        if (guideResponse) {
          captureGuideResponse(value);
        }

        if (
          !shortsEnabled &&
          (isBrowseResponse(value) || guideResponse) &&
          stripShortsFromBrowseResponse(value)
        ) {
          console.log('[ytaf preload] Shorts blocker removed response entries');
        }

        return value;
      } finally {
        parsing = false;
      }
    }

    if (!descriptor || descriptor.configurable) {
      Object.defineProperty(JSON, 'parse', {
        configurable: true,
        enumerable: descriptor ? descriptor.enumerable : false,
        get() {
          return ytafParse;
        },
        set(parser) {
          if (typeof parser === 'function' && parser !== ytafParse) {
            downstreamParse = parser;
          }
        }
      });
    } else {
      JSON.parse = ytafParse;
    }
  }

  console.info('[ytaf preload] Early hooks installed');
}
