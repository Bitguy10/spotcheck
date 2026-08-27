/**
 * Optional "flavor" chips shown under the gauge after a tap.
 * Max 2 selectable, fully skippable. The set is contextual to where on the
 * gauge the user tapped — hot-side taps surface hot-side chips.
 */

export type Tag =
  | 'Packed'
  | 'Line outside'
  | 'Great energy'
  | 'Loud'
  | 'Steady crowd'
  | 'Good playlist'
  | 'Cozy'
  | 'Easy to talk'
  | 'Half full'
  | 'Empty'
  | 'Quiet'
  | 'Dead crowd'
  | 'Just opened'
  | 'Last orders';

export const MAX_TAGS = 2;

const HOT_TAGS: Tag[] = ['Packed', 'Line outside', 'Great energy', 'Loud'];
const MID_TAGS: Tag[] = ['Steady crowd', 'Good playlist', 'Cozy', 'Easy to talk', 'Half full'];
const CHILL_TAGS: Tag[] = ['Empty', 'Quiet', 'Dead crowd', 'Just opened', 'Last orders'];

/** Contextual chips for a gauge position. 0–100 in, 4 chips out. */
export function tagsForVibe(value: number): Tag[] {
  if (value >= 66) return HOT_TAGS;
  if (value <= 33) return CHILL_TAGS;
  // Mid-taps get the middle set plus one leaning neighbour so the row never
  // looks arbitrary at the boundary.
  if (value > 50) return ['Steady crowd', 'Good playlist', 'Half full', 'Packed'];
  return ['Cozy', 'Easy to talk', 'Half full', 'Quiet'];
}

export function isKnownTag(t: string): t is Tag {
  return (Object.values({ HOT_TAGS, MID_TAGS, CHILL_TAGS }).flat() as string[]).includes(t);
}
