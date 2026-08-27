import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DECAY_WINDOW_MIN,
  LIVE_WINDOW_MIN,
  checkinWeight,
  computeVibeScore,
  vibeBucket,
  vibeColor,
  vibeLabel,
  VIBE,
} from '../src/lib/vibe';

const now = Date.now();
const minAgo = (m: number) => now - m * 60_000;

test('checkinWeight slides quadratically to zero', () => {
  assert.equal(checkinWeight(0), 1);
  assert.ok(Math.abs(checkinWeight(DECAY_WINDOW_MIN / 2) - 0.25) < 1e-9);
  assert.equal(checkinWeight(DECAY_WINDOW_MIN), 0);
  assert.equal(checkinWeight(DECAY_WINDOW_MIN * 2), 0);
});

test('a single check-in never publishes a score', () => {
  const s = computeVibeScore([{ vibeValue: 90, createdAt: minAgo(1) }], now);
  assert.equal(s.value, null);
  assert.equal(s.confidence, 'thin');
  assert.equal(s.activeCheckins, 1);
});

test('two check-ins publish a weighted average', () => {
  const s = computeVibeScore(
    [
      { vibeValue: 80, createdAt: minAgo(0) },
      { vibeValue: 80, createdAt: minAgo(1) },
    ],
    now,
  );
  assert.equal(s.value, 80);
  assert.equal(s.confidence, 'ok');
});

test('recency dominates: fresh hot outweighs old chill', () => {
  const s = computeVibeScore(
    [
      { vibeValue: 95, createdAt: minAgo(0) }, // weight ~1
      { vibeValue: 10, createdAt: minAgo(40) }, // weight ~ (1-40/45)^2 ≈ 0.012
    ],
    now,
  );
  assert.ok(s.value! > 90, `expected >90, got ${s.value}`);
});

test('fully decayed check-ins drop out', () => {
  const s = computeVibeScore(
    [
      { vibeValue: 90, createdAt: minAgo(120) },
      { vibeValue: 80, createdAt: minAgo(200) },
    ],
    now,
  );
  assert.equal(s.value, null);
  assert.equal(s.activeCheckins, 0);
  assert.equal(s.confidence, 'none');
});

test('isLive only within the live window', () => {
  const live = computeVibeScore(
    [
      { vibeValue: 50, createdAt: minAgo(2) },
      { vibeValue: 50, createdAt: minAgo(3) },
    ],
    now,
  );
  assert.equal(live.isLive, true);

  const cold = computeVibeScore(
    [
      { vibeValue: 50, createdAt: minAgo(LIVE_WINDOW_MIN + 5) },
      { vibeValue: 50, createdAt: minAgo(LIVE_WINDOW_MIN + 6) },
    ],
    now,
  );
  assert.equal(cold.isLive, false);
  assert.notEqual(cold.value, null);
});

test('labels track the spectrum', () => {
  assert.equal(vibeLabel(0), 'Dead');
  assert.equal(vibeLabel(50), 'Mellow');
  assert.equal(vibeLabel(100), 'Heaving');
  assert.equal(vibeLabel(null), 'No recent vibe check');
});

test('buckets split chill/moderate/hot', () => {
  assert.equal(vibeBucket(10), 'chill');
  assert.equal(vibeBucket(50), 'moderate');
  assert.equal(vibeBucket(90), 'hot');
  assert.equal(vibeBucket(null), null);
});

test('colours hit the brand stops', () => {
  assert.equal(vibeColor(0, 'dark').toLowerCase(), VIBE.teal.toLowerCase());
  assert.equal(vibeColor(100, 'dark').toLowerCase(), VIBE.red.toLowerCase());
  assert.equal(vibeColor(50, 'dark').toLowerCase(), VIBE.amber.toLowerCase());
});
