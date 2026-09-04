import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isBrowseResponse,
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
