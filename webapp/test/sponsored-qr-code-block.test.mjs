import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { stripSponsoredQrCodePopups } from '../src/sponsored-qr-code-block.mjs';

const fixtureUrl = new URL(
  './fixtures/player-overlay-timely-actions.json',
  import.meta.url
);

async function readFixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

test('removes only shopping actions from the player overlay', async () => {
  const payload = await readFixture();

  assert.equal(stripSponsoredQrCodePopups(payload), true);
  assert.deepEqual(
    payload.playerOverlays.playerOverlayRenderer.timelyActionRenderers,
    [
      {
        timelyActionRenderer: {
          type: 'TIMELY_ACTION_TYPE_SURVEY',
          title: 'Unrelated timed action'
        }
      },
      {
        futureTimedActionRenderer: {
          type: 'TIMELY_ACTION_TYPE_FUTURE'
        }
      }
    ]
  );
});

test('leaves a payload without shopping actions unchanged', () => {
  const payload = {
    playerOverlays: {
      playerOverlayRenderer: {
        timelyActionRenderers: [
          { timelyActionRenderer: { type: 'TIMELY_ACTION_TYPE_SURVEY' } }
        ]
      }
    }
  };
  const originalActions =
    payload.playerOverlays.playerOverlayRenderer.timelyActionRenderers;

  assert.equal(stripSponsoredQrCodePopups(payload), false);
  assert.equal(
    payload.playerOverlays.playerOverlayRenderer.timelyActionRenderers,
    originalActions
  );
});

test('does not recursively alter an unrelated nested overlay', () => {
  const payload = {
    nested: {
      playerOverlays: {
        playerOverlayRenderer: {
          timelyActionRenderers: [
            { timelyActionRenderer: { type: 'TIMELY_ACTION_TYPE_SHOPPING' } }
          ]
        }
      }
    }
  };

  assert.equal(stripSponsoredQrCodePopups(payload), false);
  assert.equal(
    payload.nested.playerOverlays.playerOverlayRenderer.timelyActionRenderers
      .length,
    1
  );
});
