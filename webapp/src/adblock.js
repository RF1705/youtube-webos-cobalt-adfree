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

// Drop `adSlotRenderer`
// `adSlotRenderer` can occur as,
// - sectionListRenderer.contents[*].adSlotRenderer
// - sectionListRenderer.contents[*].shelfRenderer.content.horizontalListRenderer.items[*].adSlotRenderer
function removeAdSlotRenderer(sectionListRenderer) {
  if (!Array.isArray(sectionListRenderer?.contents)) return false;

  let changed = false;

  const beforeLength = sectionListRenderer.contents.length;
  sectionListRenderer.contents = sectionListRenderer.contents.filter(
    (elm) => !elm.adSlotRenderer
  );
  changed = changed || sectionListRenderer.contents.length !== beforeLength;

  sectionListRenderer.contents
    .filter((elm) => elm.shelfRenderer)
    .forEach((content) => {
      const horizontalRenderer =
        content.shelfRenderer.content?.horizontalListRenderer;
      if (!Array.isArray(horizontalRenderer?.items)) return;

      const beforeItemsLength = horizontalRenderer.items.length;
      horizontalRenderer.items = horizontalRenderer.items.filter(
        (elm) => !elm.adSlotRenderer
      );
      changed = changed || horizontalRenderer.items.length !== beforeItemsLength;
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

  // Drop "masthead" ad and ad tile from the horizontal shelf on the home screen
  const homeSectionListRenderer =
    r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
      ?.sectionListRenderer;
  if (homeSectionListRenderer?.contents) {
    const beforeLength = homeSectionListRenderer.contents.length;
    homeSectionListRenderer.contents = homeSectionListRenderer.contents.filter(
      (elm) => !elm.tvMastheadRenderer
    );
    if (homeSectionListRenderer.contents.length !== beforeLength) {
      console.log('Adblock Removed (2) !');
    }

    if (removeAdSlotRenderer(homeSectionListRenderer)) {
      console.log('Adblock Removed (3) !');
    }
  }

  // Drop ad tile from search results
  const searchSectionListRenderer = r?.contents?.sectionListRenderer;
  if (searchSectionListRenderer?.contents && removeAdSlotRenderer(searchSectionListRenderer)) {
    console.log('Adblock Removed (4) !');
  }

  // Drop ads from the Shorts/reel feed
  if (Array.isArray(r?.entries)) {
    const beforeLength = r.entries.length;
    r.entries = r.entries.filter(
      (elm) => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd
    );
    if (r.entries.length !== beforeLength) {
      console.log('Adblock Removed (5) !');
    }
  }

  return r;
};
