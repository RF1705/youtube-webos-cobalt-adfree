import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSpeedCapabilityMime,
  installPlaybackSpeedCapabilities
} from '../src/playback-speed-capabilities.mjs';

const hd =
  'video/mp4; codecs="av01.0.09M.08"; width=1920; height=1080; framerate=105; bitrate=9026934; eotf=bt709';

test('YouTube 1.75x HD probe retains the native source rate and bitrate', () => {
  assert.equal(
    normalizeSpeedCapabilityMime(hd, 1.75),
    hd.replace('framerate=105', 'framerate=60')
  );
  assert.equal(
    normalizeSpeedCapabilityMime(hd.replace('105', '120'), 2),
    hd.replace('105', '60')
  );
  for (const [rate, effective] of [
    [1.25, 75],
    [1.5, 90]
  ]) {
    assert.equal(
      normalizeSpeedCapabilityMime(hd.replace('105', String(effective)), rate),
      hd.replace('105', '60')
    );
  }
});

test('ordinary, UHD, unknown-rate and unsupported codec probes stay unchanged', () => {
  for (const [mime, rate] of [
    [hd, 1],
    [hd, 0.5],
    [hd, NaN],
    [hd, 2.5],
    [hd.replace('1920', '3840').replace('1080', '2160'), 1.75],
    [hd.replace('105', '119'), 1.75],
    [hd.replace('av01.0.09M.08', 'avc1.640028'), 1.75],
    [hd.replace(' width=1920;', ''), 1.75],
    [hd.replace('105', '210'), 1.75],
    [hd.replace('105', '60'), 1.75],
    [null, 1.75]
  ])
    assert.equal(normalizeSpeedCapabilityMime(mime, rate), mime);
});

test('VP9 HD uses the same bounded correction', () => {
  const mime = hd
    .replace('mp4', 'webm')
    .replace('av01.0.09M.08', 'vp09.00.41.08');
  assert.equal(
    normalizeSpeedCapabilityMime(mime, 1.75),
    mime.replace('105', '60')
  );
});

function windowFixture() {
  const calls = [];
  const win = {
    navigator: { userAgent: 'Mozilla/5.0 Cobalt/23.lts.6' },
    location: { hostname: 'www.youtube.com', pathname: '/tv' },
    document: {
      querySelector: () => ({ playbackRate: 1 }),
      getElementById: () => ({ getPlaybackRate: () => 1.75 })
    },
    MediaSource: {
      isTypeSupported(mime) {
        calls.push({ receiver: this, mime });
        return mime.includes('framerate=60');
      }
    }
  };
  return { win, calls };
}

test('hook uses pending player speed, preserves the receiver and installs once', () => {
  const { win, calls } = windowFixture();
  assert.equal(installPlaybackSpeedCapabilities(win), true);
  assert.equal(installPlaybackSpeedCapabilities(win), false);
  assert.equal(win.MediaSource.isTypeSupported(hd), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].receiver, win.MediaSource);
  assert.equal(calls[0].mime, hd.replace('105', '60'));
});

test('other browsers/sites and read-only native methods are untouched', () => {
  for (const mutate of [
    (w) => {
      w.navigator.userAgent = 'Chrome/120';
    },
    (w) => {
      w.location.hostname = 'example.com';
    },
    (w) => {
      w.location.pathname = '/watch';
    },
    (w) => {
      Object.defineProperty(w.MediaSource, 'isTypeSupported', {
        writable: false
      });
    }
  ]) {
    const { win } = windowFixture();
    mutate(win);
    const original = win.MediaSource.isTypeSupported;
    assert.equal(installPlaybackSpeedCapabilities(win), false);
    assert.equal(win.MediaSource.isTypeSupported, original);
  }
});
