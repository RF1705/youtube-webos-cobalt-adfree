/* eslint no-redeclare: 0 */
/* global fetch:writable */
import { configRead } from './config';
import './adblock.css';

const AD_RENDERER_SELECTOR = [
  'ytlr-ad-slot-renderer',
  'ytd-ad-slot-renderer',
  '.ytlr-ad-slot-renderer',
  '.ytd-ad-slot-renderer',
  '[class*="ad-slot-renderer"]'
].join(',');
const AD_TILE_SELECTOR = [
  'ytlr-rich-item-renderer',
  'ytd-rich-item-renderer',
  'ytlr-grid-item-renderer',
  'ytlr-tile-renderer',
  '[role="listitem"]',
  '[role="gridcell"]'
].join(',');

let adSlotObserver = null;

function findAdTile(adRenderer) {
  const semanticTile = adRenderer.closest(AD_TILE_SELECTOR);
  if (semanticTile) return semanticTile;

  /*
   * Older YouTube TV builds use obfuscated wrapper names. Find the direct
   * child of the nearest multi-item flex/grid container without relying on
   * those names.
   */
  let candidate = adRenderer;
  for (let depth = 0; depth < 8; depth += 1) {
    const parent = candidate.parentElement;
    if (!parent || parent === document.body) break;

    const display = window.getComputedStyle(parent).display;
    if (
      candidate !== adRenderer &&
      parent.children.length > 1 &&
      (display === 'flex' ||
        display === 'inline-flex' ||
        display === 'grid' ||
        display === 'inline-grid')
    ) {
      return candidate;
    }

    candidate = parent;
  }

  return adRenderer;
}

function hideAdRenderer(adRenderer) {
  if (!adRenderer || adRenderer.nodeType !== 1) return;
  findAdTile(adRenderer).classList.add('ytaf-hidden-ad-tile');
}

function processAddedNode(node) {
  if (!node || node.nodeType !== 1) return;

  if (node.matches(AD_RENDERER_SELECTOR)) {
    hideAdRenderer(node);
  }

  node.querySelectorAll(AD_RENDERER_SELECTOR).forEach(hideAdRenderer);
}

function startAdSlotObserver() {
  if (adSlotObserver || !document.body) return;

  document
    .querySelectorAll(AD_RENDERER_SELECTOR)
    .forEach(hideAdRenderer);

  adSlotObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach(processAddedNode);
    });
  });
  adSlotObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function stopAdSlotObserver() {
  if (adSlotObserver) {
    adSlotObserver.disconnect();
    adSlotObserver = null;
  }

  document.querySelectorAll('.ytaf-hidden-ad-tile').forEach((tile) => {
    tile.classList.remove('ytaf-hidden-ad-tile');
  });
}

function syncAdblockStyles() {
  const enabled = Boolean(configRead('enableAdBlock'));
  document.documentElement.classList.toggle(
    'ytaf-adblock-enabled',
    enabled
  );

  if (enabled) {
    startAdSlotObserver();
  } else {
    stopAdSlotObserver();
  }
}

export function userScriptStartAdBlock() {
  syncAdblockStyles();
}

document.addEventListener(
  'ytaf-config-changed',
  (event) => {
    if (event.detail && event.detail.key === 'enableAdBlock') {
      syncAdblockStyles();
    }
  },
  true
);

const AD_KEYS = [
  'adBreakHeartbeatParams',
  'adBreakParams',
  'adPlacements',
  'adSlots',
  'adSignalsInfo',
  'adVideoId',
  'playerAds'
];

const REEL_AD_VIDEO_TYPE = 'REEL_VIDEO_TYPE_AD';

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
  if (!value || typeof value !== 'object') return false;

  if (Object.prototype.hasOwnProperty.call(value, 'adSlotRenderer')) {
    return true;
  }

  const reelEndpoints = [
    value.command?.reelWatchEndpoint,
    value.onSelectCommand?.reelWatchEndpoint,
    value.navigationEndpoint?.reelWatchEndpoint,
    value.reelItemRenderer?.navigationEndpoint?.reelWatchEndpoint,
    value.tileRenderer?.onSelectCommand?.reelWatchEndpoint
  ];

  return reelEndpoints.some((endpoint) => {
    const isAd = endpoint?.adClientParams?.isAd;

    return (
      isAd === true ||
      isAd === 'true' ||
      endpoint?.videoType === REEL_AD_VIDEO_TYPE
    );
  });
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
