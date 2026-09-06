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
    let guideApplyHandler = null;

    function findGuideApplyHandler(app) {
      if (!app) return 'no-instance';
      if (guideApplyHandler) return 'success:' + guideApplyHandler.name;

      const candidates = [];
      const seenFunctions = new Set();
      let owner = app;
      let depth = 0;

      while (owner && owner !== Object.prototype && depth < 4) {
        Object.getOwnPropertyNames(owner).forEach((name) => {
          if (name === 'constructor') return;

          let methodDescriptor;
          try {
            methodDescriptor = Object.getOwnPropertyDescriptor(owner, name);
          } catch (error) {
            return;
          }

          if (!methodDescriptor || typeof methodDescriptor.value !== 'function') {
            return;
          }

          const fn = methodDescriptor.value;
          if (seenFunctions.has(fn)) return;
          seenFunctions.add(fn);

          let source;
          try {
            source = Function.prototype.toString.call(fn);
          } catch (error) {
            return;
          }

          if (!source.includes('guideResponse')) return;

          candidates.push({
            fn,
            name,
            depth,
            sourceLength: source.length
          });
        });

        owner = Object.getPrototypeOf(owner);
        depth += 1;
      }

      if (candidates.length === 0) {
        return 'no-guide-handler';
      }

      // Prefer the most specific method on the instance/prototype and then the
      // smallest implementation. We never modify the YouTube object while
      // discovering candidates.
      candidates.sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        return a.sourceLength - b.sourceLength;
      });

      const best = candidates[0];
      const equallySpecific = candidates.filter(
        (candidate) => candidate.depth === best.depth
      );

      if (equallySpecific.length > 1) {
        return (
          'ambiguous-guide-handler:' +
          equallySpecific
            .slice(0, 6)
            .map((candidate) => candidate.name)
            .join(',')
        );
      }

      guideApplyHandler = {
        fn: best.fn,
        name: best.name
      };

      return 'success:' + best.name;
    }

    function captureGuideResponse(value) {
      try {
        originalGuideResponseJson = nativeStringify.call(JSON, value);
      } catch (error) {
        console.warn('[ytaf preload] Failed to preserve guide response', error);
      }

      const appElement = document.querySelector('ytlr-app');
      const app = appElement && appElement.__instance;
      findGuideApplyHandler(app);
    }

    function applyGuideShortsState() {
      if (!originalGuideResponseJson) {
        return 'no-guide-cache';
      }

      const appElement = document.querySelector('ytlr-app');
      const app = appElement && appElement.__instance;
      if (!app) {
        return 'no-instance';
      }

      const discoveryResult = findGuideApplyHandler(app);
      if (!guideApplyHandler) {
        return discoveryResult;
      }

      let guideResponse;
      try {
        guideResponse = nativeParse.call(JSON, originalGuideResponseJson);
      } catch (error) {
        console.warn('[ytaf preload] Failed to restore guide response', error);
        return 'parse-error';
      }

      if (!Boolean(configRead('enableShorts'))) {
        stripShortsFromBrowseResponse(guideResponse);
      }

      try {
        guideApplyHandler.fn.call(app, { guideResponse });
      } catch (error) {
        console.error('[ytaf shorts] discovered guide apply handler threw', error);
        return 'handler-threw:' + guideApplyHandler.name;
      }

      return 'success:' + guideApplyHandler.name;
    }

    window.__ytafApplyShortsState = applyGuideShortsState;

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
