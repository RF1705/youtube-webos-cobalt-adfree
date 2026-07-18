/* eslint no-redeclare: 0 */
/* global fetch:writable */
import { configRead } from './config';

export function userScriptStartAdBlock() {}

const AD_KEYS = [
  'adBreakHeartbeatParams',
  'adBreakParams',
  'adPlacements',
  'adSlots',
  'adSignalsInfo',
  'adVideoId',
  'playerAds'
];

function stripYouTubeAds(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return false;

  let changed = false;
  AD_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      value[key] = Array.isArray(value[key]) ? [] : null;
      changed = true;
    }
  });

  Object.keys(value).forEach((key) => {
    const child = value[key];
    if (key === 'tvMastheadRenderer') {
      delete value[key];
      changed = true;
      return;
    }
    if (child && typeof child === 'object') {
      changed = stripYouTubeAds(child, depth + 1) || changed;
    }
  });

  return changed;
}

function isAdditionalAdEntry(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (Object.prototype.hasOwnProperty.call(value, 'adSlotRenderer') ||
        value.command?.reelWatchEndpoint?.adClientParams?.isAd)
  );
}

// YouTube changes the nesting of browse and Shorts responses frequently. Remove
// the matching renderer wherever it occurs instead of relying on one response path.
function stripAdditionalYouTubeAds(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 32) return false;

  let changed = false;

  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      if (isAdditionalAdEntry(value[index])) {
        value.splice(index, 1);
        changed = true;
      } else {
        changed = stripAdditionalYouTubeAds(value[index], depth + 1) || changed;
      }
    }
    return changed;
  }

  Object.keys(value).forEach((key) => {
    if (key === 'adSlotRenderer') {
      delete value[key];
      changed = true;
      return;
    }

    changed = stripAdditionalYouTubeAds(value[key], depth + 1) || changed;
  });

  return changed;
}

/**
 * This is a minimal reimplementation of the following uBlock Origin rule:
 * https://github.com/uBlockOrigin/uAssets/blob/3497eebd440f4871830b9b45af0afc406c6eb593/filters/filters.txt#L116
 *
 * This in turn calls the following snippet:
 * https://github.com/gorhill/uBlock/blob/bfdc81e9e400f7b78b2abc97576c3d7bf3a11a0b/assets/resources/scriptlets.js#L365-L470
 *
 * Seems like for now dropping just the adPlacements is enough for YouTube TV
 */
const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);

  if (!configRead('enableAdBlock')) {
    return r;
  }

  if (stripYouTubeAds(r)) {
    console.log('Adblock Removed !');
  }

  if (stripAdditionalYouTubeAds(r)) {
    console.log('Adblock Removed additional renderers !');
  }

  return r;
};
