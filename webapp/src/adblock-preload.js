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
      if (guideApplyHandler) {
        return (
          'success:' +
          guideApplyHandler.callerName +
          '->' +
          guideApplyHandler.name
        );
      }

      const candidates = [];
      const seenTargets = new Set();
      const seenFunctions = new Set();
      let owner = app;
      let depth = 0;

      while (owner && owner !== Object.prototype && depth < 5) {
        Object.getOwnPropertyNames(owner).forEach((callerName) => {
          if (callerName === 'constructor') return;

          let methodDescriptor;
          try {
            methodDescriptor = Object.getOwnPropertyDescriptor(owner, callerName);
          } catch (error) {
            return;
          }

          if (!methodDescriptor || typeof methodDescriptor.value !== 'function') {
            return;
          }

          const caller = methodDescriptor.value;
          if (seenFunctions.has(caller)) return;
          seenFunctions.add(caller);

          let source;
          try {
            source = Function.prototype.toString.call(caller);
          } catch (error) {
            return;
          }

          const targetNames = [];
          const dotCallPattern =
            /this\.([A-Za-z_$][\w$]*)\s*\(\s*\{\s*guideResponse\s*:/g;
          const bracketCallPattern =
            /this\[['"]([^'"]+)['"]\]\s*\(\s*\{\s*guideResponse\s*:/g;

          let match;
          while ((match = dotCallPattern.exec(source)) !== null) {
            targetNames.push(match[1]);
          }
          while ((match = bracketCallPattern.exec(source)) !== null) {
            targetNames.push(match[1]);
          }

          targetNames.forEach((targetName) => {
            let target;
            try {
              target = app[targetName];
            } catch (error) {
              return;
            }

            if (typeof target !== 'function' || seenTargets.has(target)) return;
            seenTargets.add(target);

            candidates.push({
              fn: target,
              name: targetName,
              callerFn: caller,
              callerName,
              callerArgc: caller.length,
              depth,
              callerSourceLength: source.length
            });
          });
        });

        owner = Object.getPrototypeOf(owner);
        depth += 1;
      }

      if (candidates.length === 0) {
        return 'no-guide-handler';
      }

      candidates.sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        return a.callerSourceLength - b.callerSourceLength;
      });

      const best = candidates[0];
      const equallySpecific = candidates.filter(
        (candidate) =>
          candidate.depth === best.depth &&
          candidate.callerSourceLength === best.callerSourceLength
      );

      if (equallySpecific.length > 1) {
        return (
          'ambiguous-guide-handler:' +
          equallySpecific
            .slice(0, 6)
            .map(
              (candidate) =>
                candidate.callerName + '->' + candidate.name
            )
            .join(',')
        );
      }

      guideApplyHandler = best;

      return 'success:' + best.callerName + '->' + best.name;
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
        if (guideApplyHandler.callerArgc === 1) {
          guideApplyHandler.callerFn.call(app, guideResponse);
        } else {
          guideApplyHandler.fn.call(app, { guideResponse });
        }
      } catch (error) {
        console.error('[ytaf shorts] discovered guide apply path threw', error);
        return (
          'handler-threw:' +
          guideApplyHandler.callerName +
          '->' +
          guideApplyHandler.name
        );
      }

      return (
        'success:' +
        guideApplyHandler.callerName +
        '->' +
        guideApplyHandler.name
      );
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
