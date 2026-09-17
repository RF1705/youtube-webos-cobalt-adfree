import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/utils.js', import.meta.url),
  'utf8'
);

test('startup-page retries cover a two-minute cold-boot window', () => {
  const interval = Number(
    source.match(/STARTUP_PAGE_RETRY_INTERVAL_MS\s*=\s*(\d+)/)?.[1]
  );
  const attempts = Number(
    source.match(/STARTUP_PAGE_MAX_ATTEMPTS\s*=\s*(\d+)/)?.[1]
  );

  assert.equal(interval, 250);
  assert.ok(attempts * interval >= 120_000);
});

test('an empty webOS relaunch reapplies a non-home startup page', () => {
  const relaunchBody = source.slice(
    source.indexOf('export function handleRelaunch'),
    source.indexOf('\nexport function handleInitialLaunch')
  );

  assert.match(relaunchBody, /startupPageApplied\s*=\s*false/);
  assert.match(relaunchBody, /handleInitialLaunch\(params\)/);
  assert.match(
    relaunchBody,
    /params\.target\s*!==\s*undefined[\s\S]*params\.contentTarget\s*!==\s*undefined[\s\S]*handleLaunch\(params\)/
  );
});
