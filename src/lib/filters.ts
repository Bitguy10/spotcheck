/**
 * List filtering + sorting.
 *
 * Pure and synchronous so it is trivially testable. Note what is *not* here:
 * score computation. Filters only reorder and hide rows whose scores have
 * already been computed server-side.
 */

import { vibeBucket } from './vibe';
import type { CategoryFilter, VenueFilters, VenueWithVibe } from './types';

const CATEGORY_GROUPS: Record<Exclude<CategoryFilter, 'all'>, string[]> = {
  bar: ['bar', 'pub'],
  pub: ['pub', 'bar'],
  cafe: ['cafe'],
  restaurant: ['restaurant'],
  club: ['club'],
  event: ['event'],
  other: ['other'],
};

export function matchesCategory(venue: VenueWithVibe, filter: CategoryFilter): boolean {
  if (filter === 'all') return true;
  return CATEGORY_GROUPS[filter].includes(venue.category);
}

export function matchesVibe(venue: VenueWithVibe, filter: VenueFilters['vibe']): boolean {
  if (filter === 'all') return true;
  const bucket = vibeBucket(venue.score.value);
  // A venue with no published score yet is a discovered *place*, not a vibe
  // match — but hiding freshly pulled venues from every section made pulls
  // look broken. Quiet venues therefore stay visible in every vibe section
  // (rows render dimmed, so "no vibe yet" still reads at a glance); only
  // scored venues are genuinely filtered by bucket.
  if (bucket === null) return true;
  return bucket === filter;
}

export function matchesQuery(venue: VenueWithVibe, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    venue.name.toLowerCase().includes(q) ||
    (venue.address ?? '').toLowerCase().includes(q) ||
    venue.category.toLowerCase().includes(q)
  );
}

export function filterVenues(venues: VenueWithVibe[], filters: VenueFilters): VenueWithVibe[] {
  return venues.filter(
    (v) =>
      matchesCategory(v, filters.category) &&
      matchesVibe(v, filters.vibe) &&
      matchesQuery(v, filters.query),
  );
}

export function sortVenues(venues: VenueWithVibe[], sort: VenueFilters['sort']): VenueWithVibe[] {
  const copy = [...venues];
  switch (sort) {
    case 'vibe':
      // Hottest first; unscored venues sink to the bottom rather than
      // masquerading as "chill".
      copy.sort((a, b) => {
        const av = a.score.value;
        const bv = b.score.value;
        if (av === null && bv === null) return dist(a, b);
        if (av === null) return 1;
        if (bv === null) return -1;
        if (bv !== av) return bv - av;
        return dist(a, b);
      });
      break;
    case 'live':
      copy.sort((a, b) => {
        if (a.score.isLive !== b.score.isLive) return a.score.isLive ? -1 : 1;
        const at = a.score.lastCheckinAt ?? 0;
        const bt = b.score.lastCheckinAt ?? 0;
        if (bt !== at) return bt - at;
        return dist(a, b);
      });
      break;
    case 'distance':
    default:
      copy.sort((a, b) => dist(a, b));
  }
  return copy;
}

function dist(a: VenueWithVibe, b: VenueWithVibe): number {
  return (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity);
}

export function applyFilters(venues: VenueWithVibe[], filters: VenueFilters): VenueWithVibe[] {
  return sortVenues(filterVenues(venues, filters), filters.sort);
}

export function countActiveFilters(filters: VenueFilters): number {
  let n = 0;
  if (filters.vibe !== 'all') n++;
  if (filters.category !== 'all') n++;
  if (filters.query.trim()) n++;
  return n;
}
