import test from 'node:test';
import assert from 'node:assert/strict';

import { applyFilters, filterVenues, sortVenues } from '../src/lib/filters';
import { EMPTY_SCORE, type VibeScore } from '../src/lib/vibe';
import type { VenueWithVibe } from '../src/lib/types';

function mk(id: string, over: Partial<VenueWithVibe> & { value?: number | null }): VenueWithVibe {
  const { value = null, ...rest } = over;
  const score: VibeScore = { ...EMPTY_SCORE, value };
  return {
    id,
    name: id,
    lat: 0,
    lng: 0,
    category: 'bar',
    osmId: null,
    address: null,
    source: 'seed',
    score,
    distanceMeters: 0,
    ...rest,
  };
}

const base = { vibe: 'all', category: 'all', sort: 'distance', query: '' } as const;

test('bucket filters exclude unscored venues', () => {
  const venues = [mk('a', { value: 90 }), mk('b', { value: 10 }), mk('c', { value: null })];
  const hot = filterVenues(venues, { ...base, vibe: 'hot' });
  assert.deepEqual(hot.map((v) => v.id), ['a']);
  const all = filterVenues(venues, { ...base, vibe: 'all' });
  assert.equal(all.length, 3);
});

test('distance sort ascends', () => {
  const venues = [mk('far', { distanceMeters: 900 }), mk('near', { distanceMeters: 100 })];
  const out = sortVenues(venues, 'distance');
  assert.deepEqual(out.map((v) => v.id), ['near', 'far']);
});

test('vibe sort puts hottest first and unscored last', () => {
  const venues = [mk('none', { value: null }), mk('chill', { value: 20 }), mk('hot', { value: 90 })];
  const out = sortVenues(venues, 'vibe');
  assert.deepEqual(out.map((v) => v.id), ['hot', 'chill', 'none']);
});

test('query matches name case-insensitively', () => {
  const venues = [mk('The Rooftop', {}), mk('Coffee Lab', {})];
  const out = filterVenues(venues, { ...base, query: 'roof' });
  assert.deepEqual(out.map((v) => v.id), ['The Rooftop']);
});

test('applyFilters composes filter + sort', () => {
  const venues = [
    mk('a', { value: 90, distanceMeters: 500 }),
    mk('b', { value: 95, distanceMeters: 100 }),
    mk('c', { value: 10, distanceMeters: 50 }),
  ];
  const out = applyFilters(venues, { ...base, vibe: 'hot', sort: 'vibe' });
  assert.deepEqual(out.map((v) => v.id), ['b', 'a']);
});
