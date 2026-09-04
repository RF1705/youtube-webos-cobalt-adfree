const SHORTS_RESPONSE_KEYS = [
  'reelShelfRenderer',
  'reelShelfViewModel',
  'shortsShelfRenderer',
  'shortsLockupViewModel'
];

const TV_SHORTS_SHELF_RENDERER_TYPE = 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS';
const TV_SHORTS_ICON_TYPE = 'YOUTUBE_SHORTS_FILL_24';

export function isShortsPath(value) {
  if (!value) return false;

  const path = value.split(/[?#]/, 1)[0];
  return (
    path === '/shorts' ||
    path.startsWith('/shorts/') ||
    path === '/feed/shorts' ||
    path.startsWith('/feed/shorts/') ||
    path === 'https://www.youtube.com/shorts' ||
    path.startsWith('https://www.youtube.com/shorts/') ||
    path === 'https://www.youtube.com/feed/shorts' ||
    path.startsWith('https://www.youtube.com/feed/shorts/')
  );
}

function getShortsLinkNode(value) {
  if (!value || typeof value !== 'object') return null;

  const endpoints = [
    value.navigationEndpoint,
    value.guideEntryRenderer?.navigationEndpoint,
    value.onSelectCommand,
    value.command,
    value.tileRenderer?.onSelectCommand,
    value.richItemRenderer?.content?.shortsLockupViewModel?.onTap
  ];

  return endpoints.find((endpoint) => {
    const path = endpoint?.commandMetadata?.webCommandMetadata?.url;
    const browseId = endpoint?.browseEndpoint?.browseId;
    return isShortsPath(path) || browseId === 'FEshorts';
  });
}

function isTvShortsShelf(value) {
  if (!value || typeof value !== 'object') return false;

  const shelf = value.shelfRenderer;
  if (!shelf || typeof shelf !== 'object') return false;

  return (
    shelf.tvhtml5ShelfRendererType === TV_SHORTS_SHELF_RENDERER_TYPE ||
    shelf.icon?.iconType === TV_SHORTS_ICON_TYPE
  );
}

function hasGuideRenderer(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return false;

  if (Array.isArray(value)) {
    return value.some((entry) => hasGuideRenderer(entry, depth + 1));
  }

  if (
    value.guideRenderer ||
    value.guideSectionRenderer ||
    value.guideSubscriptionsSectionRenderer ||
    value.guideEntryRenderer
  ) {
    return true;
  }

  return Object.keys(value).some((key) =>
    hasGuideRenderer(value[key], depth + 1)
  );
}

export function isShortsResponseEntry(value) {
  if (!value || typeof value !== 'object') return false;

  const content =
    value.richItemRenderer?.content ||
    value.tileRenderer?.content ||
    value.content;

  return Boolean(
    isTvShortsShelf(value) ||
      SHORTS_RESPONSE_KEYS.some((key) =>
        Object.prototype.hasOwnProperty.call(value, key)
      ) ||
      content?.shortsLockupViewModel ||
      content?.reelItemRenderer ||
      getShortsLinkNode(value)
  );
}

export function stripShortsFromBrowseResponse(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 32) return false;

  let changed = false;
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      if (isShortsResponseEntry(value[index])) {
        value.splice(index, 1);
        changed = true;
      } else {
        changed =
          stripShortsFromBrowseResponse(value[index], depth + 1) || changed;
      }
    }
    return changed;
  }

  Object.keys(value).forEach((key) => {
    if (SHORTS_RESPONSE_KEYS.includes(key)) {
      delete value[key];
      changed = true;
      return;
    }

    changed = stripShortsFromBrowseResponse(value[key], depth + 1) || changed;
  });

  return changed;
}

export function isBrowseResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  return Boolean(
    !value.videoDetails &&
      !value.streamingData &&
      (value.contents ||
        value.onResponseReceivedActions ||
        value.onResponseReceivedEndpoints)
  );
}

export function isGuideResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.videoDetails || value.streamingData) return false;

  return hasGuideRenderer(value);
}
