import assert from 'node:assert/strict';
import test from 'node:test';

import { getSponsorBlockSkipTarget } from '../src/sponsorblock-skip-target.mjs';

test('a terminal SponsorBlock segment leaves a short tail for natural ended', () => {
  assert.equal(getSponsorBlockSkipTarget(120, 120, 90), 119.75);
  assert.equal(getSponsorBlockSkipTarget(119.8, 120, 90), 119.75);
});

test('a terminal skip never seeks backwards while already in the end tail', () => {
  assert.equal(getSponsorBlockSkipTarget(120, 120, 119.9), null);
});

test('ordinary and unknown-duration skips retain their endpoint', () => {
  assert.equal(getSponsorBlockSkipTarget(45, 120, 20), 45);
  assert.equal(getSponsorBlockSkipTarget(45, Number.NaN, 20), 45);
});
