/* Sandbox isolation contract test — live DB, real RPCs, two fresh accounts. */
import { readFileSync } from 'node:fs';
import Ws from 'ws'; // Node 20: realtime needs an explicit transport
const { createClient } = await import('@supabase/supabase-js');

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const ts = Date.now();
const opts = { realtime: { transport: Ws } };
const alice = createClient(URL, KEY, opts);
const bob = createClient(URL, KEY, opts);
let fails = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label} ${extra}`);
  if (!cond) fails++;
};

const sa = await alice.auth.signUp({ email: `alice${ts}@smoke.test`, password: 'Password123!' });
const sb = await bob.auth.signUp({ email: `bob${ts}@smoke.test`, password: 'Password123!' });
ok('signups', !!sa.data.session && !!sb.data.session);
const aliceId = sa.data.user.id;

const row = (osmId, name) => ({
  osm_id: osmId, name, lat: 6.4292, lng: 3.4229, category: 'bar', address: 'Smoke St',
});

/* 1. same OSM place pulled by both accounts → two separate rows */
const ra = await alice.rpc('upsert_osm_venues', { p_rows: [row('way/900001', 'Alice Bar')] });
const rb = await bob.rpc('upsert_osm_venues', { p_rows: [row('way/900001', 'Alice Bar')] });
ok('alice pull inserts', ra.data?.inserted === 1, JSON.stringify(ra.data ?? ra.error?.message));
ok('bob pulls same osm_id → own row', rb.data?.inserted === 1, JSON.stringify(rb.data ?? rb.error?.message));

/* 2. discovery shows each account ONLY its own row */
const va = await alice.rpc('venues_with_vibe', { p_lat: 6.4292, p_lng: 3.4229, p_radius_m: 2000 });
const vb = await bob.rpc('venues_with_vibe', { p_lat: 6.4292, p_lng: 3.4229, p_radius_m: 2000 });
const aliceRows = (va.data ?? []).filter((r) => r.osm_id === 'way/900001');
const bobRows = (vb.data ?? []).filter((r) => r.osm_id === 'way/900001');
ok('alice sees exactly 1 row for the shared osm_id', aliceRows.length === 1, `got ${aliceRows.length}`);
ok('bob sees exactly 1 row for the shared osm_id', bobRows.length === 1, `got ${bobRows.length}`);
ok('rows are distinct per account', aliceRows[0]?.id !== bobRows[0]?.id);
ok('legacy 136 rows invisible (world = only own pulls)',
  (va.data ?? []).every((r) => r.osm_id === 'way/900001' || r.source === 'user'),
  `alice total rows: ${va.data?.length}`);

/* 3. check-in: owner succeeds, other account rejected server-side */
const ca = await alice.rpc('submit_checkin', {
  p_venue: aliceRows[0].id, p_vibe: 72, p_tags: ['crowd:busy'], p_lat: 6.4292, p_lng: 3.4229,
});
ok('alice checks in to her venue', ca.data?.ok === true, JSON.stringify(ca.data ?? ca.error?.message));
const cb = await bob.rpc('submit_checkin', {
  p_venue: aliceRows[0].id, p_vibe: 50, p_tags: [], p_lat: 6.4292, p_lng: 3.4229,
});
ok("bob blocked on alice's venue", cb.data?.code === 'not_your_venue', JSON.stringify(cb.data ?? cb.error?.message));

/* 4. alice's gauge moved; bob's untouched */
const va2 = await alice.rpc('venues_with_vibe', { p_lat: 6.4292, p_lng: 3.4229, p_radius_m: 2000 });
const vb2 = await bob.rpc('venues_with_vibe', { p_lat: 6.4292, p_lng: 3.4229, p_radius_m: 2000 });
ok("alice gauge reflects her check-in", (va2.data ?? []).find((r) => r.id === aliceRows[0].id)?.total_checkins === 1);
ok("bob's row has no check-ins", (vb2.data ?? []).find((r) => r.id === bobRows[0].id)?.total_checkins === 0);

/* 5. events are owner-scoped too */
const ea = await alice.rpc('create_event', { p_name: 'Alice Rave', p_lat: 6.4292, p_lng: 3.4229, p_ttl_minutes: 120 });
ok('alice event created', !!ea.data?.id, JSON.stringify(ea.data ?? ea.error?.message));
const vb3 = await bob.rpc('venues_with_vibe', { p_lat: 6.4292, p_lng: 3.4229, p_radius_m: 2000 });
ok("bob cannot see alice's event", !(vb3.data ?? []).some((r) => r.name === 'Alice Rave'));

/* 6. direct table read obeys RLS (shared-link / detail route) */
const direct = await bob.from('venues').select('id').eq('id', aliceRows[0].id).maybeSingle();
ok('bob direct-select of alice row → null (RLS)', direct.data === null && !direct.error);

/* 7. purge only deletes the caller's rows */
const purged = await bob.rpc('purge_osm_cache', { p_lat: 6.4292, p_lng: 3.4229, p_radius_m: 5000 });
ok('bob purge removed exactly his 1 OSM row', purged.data === 1, `got ${purged.data}`);
const va4 = await alice.rpc('venues_with_vibe', { p_lat: 6.4292, p_lng: 3.4229, p_radius_m: 2000 });
ok("bob's purge left alice's world intact", (va4.data ?? []).length === 2, `alice rows: ${va4.data?.length}`);

/* bob re-pulls so step 9 can prove alice's deletion doesn't touch him */
await bob.rpc('upsert_osm_venues', { p_rows: [row('way/900001', 'Alice Bar')] });

/* 8. anonymous sees an empty world */
const anon = createClient(URL, KEY, opts);
const va5 = await anon.rpc('venues_with_vibe', { p_lat: 6.4292, p_lng: 3.4229, p_radius_m: 2000 });
ok('signed-out discovery is empty', (va5.data ?? []).length === 0, `got ${va5.data?.length}`);
const anonPull = await anon.rpc('upsert_osm_venues', { p_rows: [row('way/900002', 'Anon Bar')] });
ok('anonymous pull writes nothing', anonPull.data?.inserted === 0, JSON.stringify(anonPull.data ?? anonPull.error?.message));

/* 9. account deletion takes the account's world with it */
const del = await alice.rpc('delete_own_account');
ok('delete_own_account ok', !del.error, del.error?.message ?? '');
const relogin = await alice.auth.signInWithPassword({ email: `alice${ts}@smoke.test`, password: 'Password123!' });
ok("alice's account is gone", !!relogin.error);
await new Promise((r) => setTimeout(r, 1500));
const vb4 = await bob.rpc('venues_with_vibe', { p_lat: 6.4292, p_lng: 3.4229, p_radius_m: 2000 });
ok("bob unaffected by alice's deletion", (vb4.data ?? []).length === 1, `bob rows: ${vb4.data?.length}`);
void aliceId;

console.log(fails === 0 ? '\nSANDBOX CONTRACT: ALL PASS' : `\nSANDBOX CONTRACT: ${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
