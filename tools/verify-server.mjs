/**
 * End-to-end server verification against a live Supabase project:
 *   signup → confirm (SQL) → login → submit_checkin (at venue) / too-far / no-auth.
 *
 * Reads EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY and DATABASE_URL
 * from the environment, falling back to a local .env file. No credentials are
 * stored in source control.
 *
 *   node tools/verify-server.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Minimal .env loader so the script runs with no inline args (never commits secrets).
const envFile = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const BASE = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const DB = process.env.DATABASE_URL;
for (const [name, value] of [['EXPO_PUBLIC_SUPABASE_URL', BASE], ['EXPO_PUBLIC_SUPABASE_ANON_KEY', ANON], ['DATABASE_URL', DB]]) {
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in (see README).`);
    process.exit(1);
  }
}

const email = 'qa@spotcheck.app';
const pass = 'Password123!';

const H = { apikey: ANON, 'Content-Type': 'application/json' };

const client = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
await client.connect();

// 1 signup
let r = await fetch(`${BASE}/auth/v1/signup`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: pass }) });
let j = await r.json().catch(() => ({}));
console.log('signup', r.status, j.id ? 'user-created' : j.msg || j.error || '');

// 2 confirm via SQL (column name varies by GoTrue version)
try {
  await client.query('update auth.users set email_confirmed_at=now(), confirmed_at=now() where email=$1', [email]);
} catch {
  await client.query('update auth.users set email_confirmed_at=now() where email=$1', [email]);
}
const v = await client.query('select id, name, lat, lng from public.venues order by created_at limit 1');
const venue = v.rows[0];
console.log('venue', venue.name, venue.lat, venue.lng);

// 3 login
r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: pass }) });
j = await r.json().catch(() => ({}));
const tok = j.access_token;
console.log('login', r.status, tok ? 'token-ok' : j.error_description || j.msg || '');

const AUTH = { ...H, Authorization: `Bearer ${tok}` };

// 4 check-in AT the venue → expect success + score
r = await fetch(`${BASE}/rest/v1/rpc/submit_checkin`, {
  method: 'POST', headers: AUTH,
  body: JSON.stringify({ p_venue: venue.id, p_vibe: 72, p_tags: ['Packed'], p_lat: venue.lat, p_lng: venue.lng, p_grace: 150 }),
});
j = await r.json().catch(() => ({}));
console.log('checkin@venue', r.status, j.checkin ? `OK score=${j.score?.value} active=${j.score?.active_checkins}` : JSON.stringify(j).slice(0, 140));

// 5 too far
r = await fetch(`${BASE}/rest/v1/rpc/submit_checkin`, {
  method: 'POST', headers: AUTH,
  body: JSON.stringify({ p_venue: venue.id, p_vibe: 72, p_tags: [], p_lat: venue.lat + 0.05, p_lng: venue.lng + 0.05, p_grace: 150 }),
});
j = await r.json().catch(() => ({}));
console.log('checkin-far', r.status, j.code, j.distance_m);

// 6 no auth
r = await fetch(`${BASE}/rest/v1/rpc/submit_checkin`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ p_venue: venue.id, p_vibe: 72, p_lat: venue.lat, p_lng: venue.lng }),
});
j = await r.json().catch(() => ({}));
console.log('checkin-noauth', r.status, j.code);

// 7 venues_with_vibe returns the seeded venue with a score now
const vv = await client.query('select name, vibe_value, active_checkins, is_live from public.venues_with_vibe($1,$2,2000,10)', [venue.lat, venue.lng]);
console.log('venues_with_vibe', vv.rows.map((x) => `${x.name}:${x.vibe_value ?? 'null'}(a${x.active_checkins}${x.is_live ? ',live' : ''})`).join(' '));

await client.end();
console.log('done');
