import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentVideoId,
  installQualityPreference,
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
  setters = true
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
    currentTime: 0,
    duration: 100,
    paused: false,
    error: null
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
