/** Tiny relative-time helpers. No date library — the strings are the product. */

export function relativeTime(ts: number | string | Date | null, now: number = Date.now()): string {
  if (ts === null || ts === undefined) return 'never';
  const at = typeof ts === 'number' ? ts : ts instanceof Date ? ts.getTime() : Date.parse(ts);
  if (Number.isNaN(at)) return 'never';

  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "12:04 AM" style, for the venue's recent-activity feed. */
export function clockTime(ts: number | string | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function minutesBetween(a: number, b: number): number {
  return Math.abs(b - a) / 60000;
}

/** "2h left" / "45m left" for ephemeral events; null when no expiry. */
export function formatTtl(expiresAt: number | null, now: number = Date.now()): string | null {
  if (expiresAt === null || expiresAt === undefined) return null;
  const mins = Math.max(0, Math.round((expiresAt - now) / 60000));
  if (mins < 60) return `${mins}m left`;
  return `${Math.round(mins / 60)}h left`;
}
