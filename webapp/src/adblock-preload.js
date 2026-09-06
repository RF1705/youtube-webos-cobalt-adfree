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
    let discoveryApp = null;
    let discoveryWrappers = [];
    let discoveryTimer = null;

    function cleanupGuideMethodDiscovery() {
      discoveryWrappers.forEach(({ owner, name, descriptor: originalDescriptor, wrapper }) => {
        try {
          const currentDescriptor = Object.getOwnPropertyDescriptor(owner, name);
          if (currentDescriptor && currentDescriptor.value === wrapper) {
            Object.defineProperty(owner, name, originalDescriptor);
          }
        } catch (error) {
          // A later YouTube update may have replaced the property already.
        }
      });

      discoveryWrappers = [];
      discoveryApp = null;

      if (discoveryTimer !== null) {
        clearInterval(discoveryTimer);
        discoveryTimer = null;
      }
    }

    function findGuidePayloadIndex(args) {
      for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (
          arg &&
          typeof arg === 'object' &&
          Object.prototype.hasOwnProperty.call(arg, 'guideResponse')
        ) {
          return i;
        }
      }

      return -1;
    }

    function installGuideMethodDiscovery() {
      if (guideApplyHandler) return true;

      const appElement = document.querySelector('ytlr-app');
      const app = appElement && appElement.__instance;
      if (!app) return false;

      if (discoveryApp === app && discoveryWrappers.length) {
        return true;
      }

      cleanupGuideMethodDiscovery();
      discoveryApp = app;

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

          if (!methodDescriptor.configurable && !methodDescriptor.writable) {
            return;
          }

          const original = methodDescriptor.value;
          const methodOwner = owner;
          const wrapper = function (...args) {
            if (!guideApplyHandler) {
              const payloadIndex = findGuidePayloadIndex(args);
              if (payloadIndex !== -1) {
                guideApplyHandler = {
                  fn: original,
                  name,
                  thisArg: this,
                  payloadIndex,
                  argsTemplate: args.slice(),
                  payloadTemplate: args[payloadIndex]
                };

                cleanupGuideMethodDiscovery();
              }
            }

            return original.apply(this, args);
          };

          try {
            Object.defineProperty(methodOwner, name, {
              ...methodDescriptor,
              value: wrapper
            });
            discoveryWrappers.push({
              owner: methodOwner,
              name,
              descriptor: methodDescriptor,
              wrapper
            });
          } catch (error) {
            // Some YouTube properties cannot be replaced even when their descriptor suggests it.
          }
        });

        owner = Object.getPrototypeOf(owner);
        depth += 1;
      }

      return discoveryWrappers.length > 0;
    }

    function scheduleGuideMethodDiscovery() {
      if (guideApplyHandler || discoveryTimer !== null) return;

      if (installGuideMethodDiscovery()) return;

      discoveryTimer = setInterval(() => {
        if (guideApplyHandler || installGuideMethodDiscovery()) {
          clearInterval(discoveryTimer);
          discoveryTimer = null;
        }
      }, 50);
    }

    function captureGuideResponse(value) {
      try {
        originalGuideResponseJson = nativeStringify.call(JSON, value);
      } catch (error) {
        console.warn('[ytaf preload] Failed to preserve guide response', error);
      }

      // JSON.parse returns before YouTube applies the parsed guide response. Installing
      // the wrappers here lets us observe that first real application without relying
      // on a minified method name such as app.K().
      installGuideMethodDiscovery();
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

      if (!guideApplyHandler) {
        scheduleGuideMethodDiscovery();
        return 'no-guide-handler';
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

      const args = guideApplyHandler.argsTemplate.slice();
      const payloadTemplate = guideApplyHandler.payloadTemplate;
      const payload =
        payloadTemplate && typeof payloadTemplate === 'object'
          ? { ...payloadTemplate }
          : {};
      payload.guideResponse = guideResponse;
      args[guideApplyHandler.payloadIndex] = payload;

      try {
        guideApplyHandler.fn.apply(app, args);
      } catch (error) {
        console.error('[ytaf shorts] discovered guide apply handler threw', error);
        return 'handler-threw';
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

    scheduleGuideMethodDiscovery();
  }

  console.info('[ytaf preload] Early hooks installed');
}
