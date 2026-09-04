import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isBrowseResponse,
  isGuideResponse,
  isShortsPath,
  stripShortsFromBrowseResponse
} from '../src/shorts-response-filter.mjs';

test('recognizes Shorts navigation paths', () => {
  assert.equal(isShortsPath('/shorts/abc'), true);
  assert.equal(isShortsPath('/feed/shorts?bp=123'), true);
  assert.equal(isShortsPath('/watch?v=abc'), false);
});

test('removes Shorts entries from browse responses only', () => {
  const response = {
    contents: {
      items: [
        { videoRenderer: { videoId: 'normal' } },
        { shortsLockupViewModel: { entityId: 'short' } },
        {
          navigationEndpoint: {
            commandMetadata: {
              webCommandMetadata: { url: '/shorts/abc' }
            }
          }
        }
      ]
    }
  };

  assert.equal(isBrowseResponse(response), true);
  assert.equal(stripShortsFromBrowseResponse(response), true);
  assert.deepEqual(response.contents.items, [
    { videoRenderer: { videoId: 'normal' } }
  ]);
});

test('removes YouTube TV Shorts shelves before the virtual list renders', () => {
  const response = {
    contents: {
      tvBrowseRenderer: {
        content: {
          tvSurfaceContentRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    shelfRenderer: {
                      tvhtml5ShelfRendererType: 'TVHTML5_SHELF_RENDERER_TYPE_STANDARD',
                      icon: { iconType: 'VIDEO_LIBRARY_WHITE_24' }
                    }
                  },
                  {
                    shelfRenderer: {
                      tvhtml5ShelfRendererType: 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS',
                      icon: { iconType: 'YOUTUBE_SHORTS_FILL_24' }
                    }
                  }
                ]
              }
            }
          }
        }
      }
    }
  };

  const contents =
    response.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content
      .sectionListRenderer.contents;

  assert.equal(isBrowseResponse(response), true);
  assert.equal(stripShortsFromBrowseResponse(response), true);
  assert.equal(contents.length, 1);
  assert.equal(
    contents[0].shelfRenderer.tvhtml5ShelfRendererType,
    'TVHTML5_SHELF_RENDERER_TYPE_STANDARD'
  );
});

test('recognizes the YouTube TV Shorts icon as a fallback shelf marker', () => {
  const response = {
    contents: {
      items: [
        {
          shelfRenderer: {
            icon: { iconType: 'YOUTUBE_SHORTS_FILL_24' }
          }
        },
        {
          shelfRenderer: {
            icon: { iconType: 'VIDEO_LIBRARY_WHITE_24' }
          }
        }
      ]
    }
  };

  assert.equal(stripShortsFromBrowseResponse(response), true);
  assert.equal(response.contents.items.length, 1);
  assert.equal(
    response.contents.items[0].shelfRenderer.icon.iconType,
    'VIDEO_LIBRARY_WHITE_24'
  );
});

test('does not classify direct player responses as browse responses', () => {
  const playerResponse = {
    videoDetails: { videoId: 'short-video' },
    streamingData: { formats: [] },
    contents: { shortsLockupViewModel: {} }
  };

  assert.equal(isBrowseResponse(playerResponse), false);
  assert.equal(isGuideResponse(playerResponse), false);
});

test('removes FEshorts navigation entries but keeps ordinary browse entries', () => {
  const response = {
    onResponseReceivedActions: [
      {
        navigationEndpoint: {
          browseEndpoint: { browseId: 'FEshorts' }
        }
      },
      {
        navigationEndpoint: {
          browseEndpoint: { browseId: 'FEsubscriptions' }
        }
      }
    ]
  };

  assert.equal(stripShortsFromBrowseResponse(response), true);
  assert.deepEqual(response.onResponseReceivedActions, [
    {
      navigationEndpoint: {
        browseEndpoint: { browseId: 'FEsubscriptions' }
      }
    }
  ]);
});

test('removes Shorts from the YouTube TV guide before navigation renders', () => {
  const response = {
    items: [
      {
        guideSectionRenderer: {
          items: [
            {
              guideEntryRenderer: {
                navigationEndpoint: {
                  browseEndpoint: { browseId: 'FEtopics' }
                },
                icon: { iconType: 'WHAT_TO_WATCH' },
                formattedTitle: { simpleText: 'Startseite' }
              }
            },
            {
              guideEntryRenderer: {
                navigationEndpoint: {
                  reelWatchEndpoint: {
                    overlay: {
                      reelPlayerOverlayRenderer: {
                        style: 'REEL_PLAYER_OVERLAY_STYLE_SHORTS'
                      }
                    },
                    watchEndpointSource:
                      'REEL_WATCH_ENDPOINT_SOURCE_SHORTS_PIVOT_BAR',
                    videoType: 'REEL_VIDEO_TYPE_VIDEO'
                  }
                },
                icon: { iconType: 'YOUTUBE_SHORTS_FILL_24' },
                formattedTitle: { simpleText: 'Shorts' }
              }
            },
            {
              guideEntryRenderer: {
                navigationEndpoint: {
                  browseEndpoint: { browseId: 'FEsubscriptions' }
                },
                icon: { iconType: 'SUBSCRIPTIONS' },
                formattedTitle: { simpleText: 'Abos' }
              }
            }
          ]
        }
      }
    ]
  };

  assert.equal(isBrowseResponse(response), false);
  assert.equal(isGuideResponse(response), true);
  assert.equal(stripShortsFromBrowseResponse(response), true);

  const items = response.items[0].guideSectionRenderer.items;
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((item) => item.guideEntryRenderer.icon.iconType),
    ['WHAT_TO_WATCH', 'SUBSCRIPTIONS']
  );
});
