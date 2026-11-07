import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentVideoId,
  installQualityPreference,
  isCadenceOk,
  pickSpeedAwareQualityLevel,
  speedCapHeight,
  pickQualityLevel,
  qualityHeight
} from '../src/quality-preference.mjs';

// The controller logs through the page console; keep test output readable.
console.info = () => {};
console.warn = () => {};

test('maps TV quality labels to heights', () => {
  assert.equal(qualityHeight('hd2160'), 2160);
  assert.equal(qualityHeight('HD1440'), 1440);
  assert.equal(qualityHeight('hd1080'), 1080);
  assert.equal(qualityHeight('hd720'), 720);
  assert.equal(qualityHeight('large'), 480);
  assert.equal(qualityHeight('highres'), 4320);
  assert.equal(qualityHeight('hd1440p'), 0);
  for (const value of ['auto', 'default', '', '  ', null, undefined, 1080]) {
    assert.equal(qualityHeight(value), 0);
  }
});

test('picks the highest offered level at or below the cap', () => {
  const levels = ['hd1080', 'hd2160', 'hd1440', 'medium'];
  assert.equal(pickQualityLevel(levels, 'max'), 'hd2160');
  assert.equal(pickQualityLevel(levels, '2160'), 'hd2160');
  assert.equal(pickQualityLevel(levels, '1440'), 'hd1440');
  assert.equal(pickQualityLevel(levels, '1080'), 'hd1080');
  assert.equal(pickQualityLevel(levels, '480'), 'medium');
  assert.equal(pickQualityLevel([...levels].reverse(), 'max'), 'hd2160');
  assert.equal(pickQualityLevel(['hd2160', 'highres'], 'max'), 'highres');
});

test('leaves Auto alone and ignores unusable input', () => {
  assert.equal(pickQualityLevel(['hd2160'], 'auto'), null);
  assert.equal(pickQualityLevel(['hd2160'], undefined), null);
  assert.equal(pickQualityLevel([], 'max'), null);
  assert.equal(pickQualityLevel(null, 'max'), null);
  assert.equal(pickQualityLevel(['hd2160'], 'nonsense'), null);
  assert.equal(pickQualityLevel(['hd2160'], '0'), null);
});

test('returns null when no offered level fits below the cap', () => {
  assert.equal(pickQualityLevel(['hd2160', 'hd1440'], '1080'), null);
  assert.equal(pickQualityLevel(['auto', 'unknown'], 'max'), null);
});

test('reads the current video id from the page', () => {
  assert.equal(
    currentVideoId({ location: { href: 'https://www.youtube.com/tv#/watch?v=abc123' } }),
    'abc123'
  );
  assert.equal(
    currentVideoId({ location: { href: 'https://www.youtube.com/tv', hash: '#/watch?v=x-y_z' } }),
    'x-y_z'
  );
  assert.equal(
    currentVideoId({
      location: { href: 'https://www.youtube.com/tv' },
      ytInitialPlayerResponse: { videoDetails: { videoId: 'fromResponse' } }
    }),
    'fromResponse'
  );
  assert.equal(currentVideoId({ location: { href: 'https://www.youtube.com/tv' } }), null);
});

function createTimers() {
  let now = 0;
  let nextId = 1;
  const jobs = new Map();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      jobs.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      jobs.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let dueId = null;
        let due = null;
        for (const [id, job] of jobs) {
          if (job.at <= end && (!due || job.at < due.at)) {
            dueId = id;
            due = job;
          }
        }
        if (!due) break;
        jobs.delete(dueId);
        now = due.at;
        due.fn();
      }
      now = end;
    }
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    dispatch(type, event = {}) {
      for (const fn of [...(listeners.get(type) || [])]) fn(event);
    }
  };
}

function createPlayer({
  levels = ['hd2160', 'hd1440', 'hd1080'],
  videoId = 'abc',
  live = false,
  setters = true,
  fpsByHeight = null
} = {}) {
  const player = {
    levels,
    videoId,
    live,
    throwData: false,
    calls: [],
    current: 'hd720',
    getVideoData() {
      if (this.throwData) {
        this.throwData = false;
        throw new Error('transient player teardown');
      }
      return { video_id: this.videoId, isLive: this.live };
    },
    getAvailableQualityLevels() {
      return this.levels;
    },
    getPlaybackQuality() {
      return this.current;
    },
    getPlayerResponse() {
      if (!fpsByHeight) return null;
      return {
        streamingData: {
          adaptiveFormats: Object.entries(fpsByHeight).map(([height, fps]) => ({
            qualityLabel: `${height}p`,
            fps,
            mimeType: 'video/mp4; codecs="av01.0.08M.08"'
          }))
        }
      };
    }
  };
  if (setters) {
    player.setPlaybackQualityRange = (min, max) => {
      player.calls.push(['range', min, max]);
      player.current = min;
    };
    player.setPlaybackQuality = (level) => {
      player.calls.push(['single', level]);
      player.current = level;
    };
  }
  return player;
}

function createHarness(options = {}) {
  const timers = createTimers();
  const player = createPlayer(options);
  const video = {
    readyState: 4,
    playbackRate: options.rate ?? 1,
    currentTime: 0,
    duration: 100,
    paused: false,
    error: null,
    totalFrames: 0,
    droppedFrames: 0,
    getVideoPlaybackQuality() {
      return {
        totalVideoFrames: this.totalFrames,
        droppedVideoFrames: this.droppedFrames
      };
    }
  };
  const doc = {
    ...eventTarget(),
    getElementById(id) {
      return id === 'ytlr-player__player-container-player' ? player : null;
    },
    querySelector(selector) {
      return selector === 'video' ? video : null;
    }
  };
  let preference = options.preference ?? 'max';
  const win = {
    document: doc,
    location: {
      hostname: 'www.youtube.com',
      pathname: '/tv',
      href: 'https://www.youtube.com/tv#/watch?v=abc',
      hash: '#/watch?v=abc',
      search: ''
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    ...eventTarget()
  };
  assert.equal(installQualityPreference(win, () => preference), true);
  return {
    win,
    doc,
    player,
    video,
    timers,
    setPreference(value) {
      preference = value;
    },
    configChanged() {
      doc.dispatch('ytaf-config-changed', {
        detail: { key: 'qualityPreference' }
      });
    },
    state() {
      return win.__ytafQualityPreference.debugState();
    }
  };
}

test('cadence fit requires the effective frame rate to divide the refresh', () => {
  assert.equal(isCadenceOk(2160, 1.25, { 2160: 24 }), true);
  assert.equal(isCadenceOk(2160, 1.75, { 2160: 24 }), false);
  assert.equal(isCadenceOk(2160, 1.75, { 2160: 60 }), false);
  assert.equal(isCadenceOk(2160, 1, { 2160: 60 }), true);
  assert.equal(isCadenceOk(2160, 1.75, null), false);
});

test('cadence selection picks the highest level that fits, else the ceiling', () => {
  const levels = ['hd2160', 'hd1440', 'hd1080'];
  assert.equal(
    pickSpeedAwareQualityLevel(levels, 'max', 1.25, { 2160: 24, 1440: 24, 1080: 24 }),
    'hd2160'
  );
  assert.equal(
    pickSpeedAwareQualityLevel(levels, 'max', 1.75, { 2160: 60, 1440: 60, 1080: 60 }),
    'hd1440'
  );
  assert.equal(
    pickSpeedAwareQualityLevel(levels, 'max', 2, { 2160: 60, 1440: 30, 1080: 30 }),
    'hd1440'
  );
  assert.equal(pickSpeedAwareQualityLevel(levels, 'max', 1.75, null), 'hd1440');
  assert.equal(
    pickSpeedAwareQualityLevel(levels, '1080', 1, { 2160: 60, 1440: 60, 1080: 60 }),
    'hd1080'
  );
});

test('speed cap only applies to Highest from 1.5x', () => {
  assert.equal(speedCapHeight(1), Infinity);
  assert.equal(speedCapHeight(1.25), Infinity);
  assert.equal(speedCapHeight(1.5), 1440);
  assert.equal(speedCapHeight(1.75), 1440);
  assert.equal(speedCapHeight(2), 1440);
  const levels = ['hd2160', 'hd1440', 'hd1080'];
  assert.equal(pickSpeedAwareQualityLevel(levels, '2160', 1.75, null), 'hd2160');
});

test('explicit preferences are not speed-capped or cadence-substituted', () => {
  const levels = ['hd2160', 'hd1440', 'hd1080'];
  assert.equal(
    pickSpeedAwareQualityLevel(levels, '2160', 2, { 2160: 60, 1440: 30, 1080: 30 }),
    'hd2160'
  );
  assert.equal(
    pickSpeedAwareQualityLevel(levels, '1440', 2, { 2160: 60, 1440: 60, 1080: 30 }),
    'hd1440'
  );
});

test('controller picks a lower-fps rung that fits the speed cadence', () => {
  const h = createHarness({
    fpsByHeight: { 2160: 60, 1440: 30, 1080: 30 },
    rate: 2
  });
  h.timers.advance(500);
  assert.deepEqual(h.player.calls, [['range', 'hd1440', 'hd1440']]);
  assert.equal(h.state().appliedTarget, 'hd1440');
});

test('applies the highest level once per video', () => {
  const h = createHarness();
  h.timers.advance(500);
  assert.deepEqual(h.player.calls, [['range', 'hd2160', 'hd2160']]);
  assert.equal(h.state().appliedTarget, 'hd2160');
  h.doc.dispatch('durationchange');
  h.timers.advance(1000);
  assert.equal(h.player.calls.length, 1);
});

test('debounces cap changes and picks the highest level at or below the cap', () => {
  const h = createHarness();
  h.timers.advance(500);
  h.setPreference('1080');
  h.configChanged();
  assert.equal(h.player.calls.length, 1);
  h.timers.advance(299);
  assert.equal(h.player.calls.length, 1);
  h.timers.advance(1);
  assert.deepEqual(h.player.calls.at(-1), ['range', 'hd1080', 'hd1080']);
});

test('releases the manual choice when set back to Auto', () => {
  const h = createHarness();
  h.timers.advance(500);
  h.setPreference('auto');
  h.configChanged();
  assert.deepEqual(h.player.calls.at(-1), ['range', 'auto', 'auto']);
  assert.equal(h.state().appliedFor, null);
});

test('retries until quality levels are available', () => {
  const h = createHarness({ levels: [] });
  h.timers.advance(500);
  assert.equal(h.player.calls.length, 0);
  h.player.levels = ['hd1080', 'hd720'];
  h.timers.advance(250);
  assert.deepEqual(h.player.calls, [['range', 'hd1080', 'hd1080']]);
});

test('survives a transient player getter failure', () => {
  const h = createHarness();
  h.player.throwData = true;
  h.timers.advance(500);
  assert.equal(h.player.calls.length, 0);
  h.timers.advance(250);
  assert.deepEqual(h.player.calls, [['range', 'hd2160', 'hd2160']]);
});

test('waits out an ad and skips live content', () => {
  const ad = createHarness();
  ad.player.videoId = 'ad-video';
  ad.timers.advance(500);
  assert.equal(ad.player.calls.length, 0);
  ad.player.videoId = 'abc';
  ad.doc.dispatch('durationchange');
  assert.equal(ad.player.calls.length, 1);

  const live = createHarness({ live: true });
  live.timers.advance(2000);
  assert.equal(live.player.calls.length, 0);
  assert.equal(live.state().appliedFor, null);
});

test('stops trying when the player exposes no quality setter', () => {
  const h = createHarness({ setters: false });
  h.timers.advance(500);
  assert.equal(h.state().apiMissing, true);
  h.doc.dispatch('durationchange');
  h.timers.advance(1000);
  assert.equal(h.state().apiMissing, true);
});

test('re-pins the preferred level after a speed change drops it', () => {
  const h = createHarness();
  h.timers.advance(500);
  assert.equal(h.player.calls.length, 1);
  h.player.current = 'hd1080';
  h.doc.dispatch('ratechange');
  h.timers.advance(700);
  assert.deepEqual(h.player.calls.at(-1), ['range', 'hd2160', 'hd2160']);
});

test('does not re-apply after a speed change when the level already matches', () => {
  const h = createHarness();
  h.timers.advance(500);
  h.doc.dispatch('ratechange');
  h.timers.advance(700);
  assert.equal(h.player.calls.length, 1);
});

test('ignores speed changes while the preference is Auto', () => {
  const h = createHarness({ preference: 'auto' });
  h.timers.advance(500);
  h.doc.dispatch('ratechange');
  h.timers.advance(700);
  assert.equal(h.player.calls.length, 0);
});

test('debounces rapid speed events into one re-pin', () => {
  const h = createHarness();
  h.timers.advance(500);
  h.player.current = 'hd1080';
  h.doc.dispatch('ratechange');
  h.timers.advance(100);
  h.doc.dispatch('ratechange');
  h.timers.advance(700);
  assert.equal(h.player.calls.length, 2);
});

test('never downgrades on a speed-change re-assert', () => {
  const h = createHarness();
  h.timers.advance(500);
  assert.equal(h.player.calls.length, 1);
  // The offered ladder briefly omits the rung that is still playing.
  h.player.levels = ['hd1440', 'hd1080'];
  h.doc.dispatch('ratechange');
  h.timers.advance(3000);
  assert.equal(h.player.calls.length, 1);
  assert.equal(h.state().appliedTarget, 'hd2160');
});

test('catches a quality drop that lands after the first speed check', () => {
  const h = createHarness();
  h.timers.advance(500);
  h.doc.dispatch('ratechange');
  h.timers.advance(700);
  assert.equal(h.player.calls.length, 1);
  h.player.current = 'hd1080';
  h.timers.advance(1500);
  assert.deepEqual(h.player.calls.at(-1), ['range', 'hd2160', 'hd2160']);
});

test('does not re-pin a video that already fell back after a stall', () => {
  const h = createHarness();
  h.timers.advance(500);
  h.video.currentTime = 10;
  h.timers.advance(4000);
  h.timers.advance(750);
  assert.equal(h.state().failed, 1);
  const calls = h.player.calls.length;
  h.player.current = 'hd1080';
  h.doc.dispatch('ratechange');
  h.timers.advance(3000);
  assert.equal(h.player.calls.length, calls);
});

test('steps down one level when dropped frames exceed the threshold', () => {
  const h = createHarness();
  h.timers.advance(500);
  h.video.currentTime = 100;
  h.timers.advance(4000);
  h.video.currentTime = 101;
  h.timers.advance(1000);
  assert.equal(h.state().appliedTarget, 'hd2160');
  h.video.totalFrames = 300;
  h.video.droppedFrames = 30;
  h.timers.advance(4000);
  assert.deepEqual(h.player.calls.at(-1), ['range', 'hd1440', 'hd1440']);
  assert.equal(h.state().appliedTarget, 'hd1440');
});

test('keeps the pinned level when dropped frames stay below the threshold', () => {
  const h = createHarness();
  h.timers.advance(500);
  h.video.currentTime = 100;
  h.timers.advance(4000);
  h.video.currentTime = 101;
  h.timers.advance(1000);
  h.video.totalFrames = 300;
  h.video.droppedFrames = 3;
  h.timers.advance(4000);
  assert.equal(h.player.calls.length, 1);
  assert.equal(h.state().appliedTarget, 'hd2160');
});

test('reverts to Auto when a pinned level cannot present', () => {
  const h = createHarness();
  h.timers.advance(500);
  h.video.currentTime = 10;
  h.timers.advance(4000);
  h.timers.advance(750);
  assert.deepEqual(h.player.calls.at(-1), ['range', 'auto', 'auto']);
  assert.equal(h.state().appliedFor, null);
  assert.equal(h.state().failed, 1);
});

test('stall check measures progress, not absolute position', () => {
  const h = createHarness();
  h.timers.advance(500);
  h.video.currentTime = 10;
  h.timers.advance(4000);
  h.video.currentTime = 4;
  h.timers.advance(400);
  h.video.currentTime = 4.5;
  h.timers.advance(350);
  assert.equal(h.player.calls.length, 1);
  assert.equal(h.state().appliedFor, 'abc');
});
