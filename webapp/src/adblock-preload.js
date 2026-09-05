import { configRead } from './config.js';
import {
  isBrowseResponse,
  isGuideResponse,
  stripShortsFromBrowseResponse
} from './shorts-response-filter.mjs';

if (!window.__ytafPreloadExecuted) {
  window.__ytafPreloadExecuted = true;

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
        console.error('[ytaf shorts] captured guide response');
      } catch (error) {
        console.warn('[ytaf preload] Failed to preserve guide response', error);
      }
    }

    function describeAppMethods(app) {
      const methodNames = new Set();
      let current = app;
      let depth = 0;

      while (current && depth < 4) {
        Object.getOwnPropertyNames(current).forEach((name) => {
          if (name === 'constructor') return;
          try {
            if (typeof app[name] === 'function') {
              methodNames.add(name);
            }
          } catch (error) {
            // Ignore getters that cannot be evaluated safely.
          }
        });
        current = Object.getPrototypeOf(current);
        depth += 1;
      }

      const names = Array.from(methodNames);
      const guideCandidates = names.filter((name) => {
        try {
          return Function.prototype.toString.call(app[name]).includes('guideResponse');
        } catch (error) {
          return false;
        }
      });

      if (guideCandidates.length) {
        return 'guide=' + guideCandidates.slice(0, 8).join(',');
      }

      const compactNames = names
        .filter((name) => name.length <= 2)
        .slice(0, 20);

      return compactNames.length
        ? 'methods=' + compactNames.join(',')
        : 'methods=none';
    }

    function applyGuideShortsState() {
      const enableShorts = Boolean(configRead('enableShorts'));
      console.error(
        '[ytaf shorts] apply begin enableShorts=' +
          enableShorts +
          ' guideCached=' +
          Boolean(originalGuideResponseJson)
      );

      if (!originalGuideResponseJson) {
        console.error('[ytaf shorts] apply abort: no cached guide response');
        return 'no-guide-cache';
      }

      const appElement = document.querySelector('ytlr-app');
      if (!appElement) {
        console.error('[ytaf shorts] apply abort: ytlr-app not found');
        return 'no-ytlr-app';
      }

      const app = appElement.__instance;
      if (!app) {
        console.error('[ytaf shorts] apply abort: ytlr-app.__instance missing');
        return 'no-instance';
      }
      if (typeof app.K !== 'function') {
        const methods = describeAppMethods(app);
        console.error(
          '[ytaf shorts] apply abort: app.K is not a function ' + methods
        );
        return 'no-app-K ' + methods;
      }

      let guideResponse;
      try {
        guideResponse = nativeParse.call(JSON, originalGuideResponseJson);
      } catch (error) {
        console.warn('[ytaf preload] Failed to restore guide response', error);
        return 'parse-error';
      }

      if (!enableShorts) {
        stripShortsFromBrowseResponse(guideResponse);
      }

      try {
        app.K({ guideResponse });
      } catch (error) {
        console.error('[ytaf shorts] apply abort: app.K threw', error);
        return 'app-K-threw';
      }

      console.error('[ytaf shorts] apply success via app.K');
      return 'success';
    }

    window.__ytafApplyShortsState = applyGuideShortsState;

    window.addEventListener('ytaf-config-changed', (event) => {
      if (event && event.detail && event.detail.key === 'enableShorts') {
        console.error(
          '[ytaf shorts] config event enableShorts=' + event.detail.value
        );
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
          !Boolean(configRead('enableShorts')) &&
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
