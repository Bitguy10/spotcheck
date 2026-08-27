/**
 * Seeds a believable multi-week check-in history for a couple of venues so the
 * historical-pattern UI has real signal to show. Old rows do NOT affect the
 * live (decayed) score. Uses the QA user as the actor.
 *
 *   DATABASE_URL=... node tools/backfill-history.mjs
 */
import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const qa = await client.query("select id from auth.users where email='qa@spotcheck.app'");
const uid = qa.rows[0]?.id;
if (!uid) { console.error('qa user not found'); process.exit(1); }

const venues = await client.query("select id,name from venues where name in ('The Rooftop','Coffee Lab')");
const byName = Object.fromEntries(venues.rows.map((r) => [r.name, r.id]));

const rows = [];
// 6 weeks of history
for (let w = 1; w <= 6; w++) {
  for (let dow = 1; dow <= 7; dow++) {
    // The Rooftop: hot Fri/Sat nights, mild Wed; quiet otherwise
    const roofHours = dow === 5 || dow === 6 ? [19, 20, 21, 22, 23] : dow === 3 ? [19, 21] : dow === 7 ? [16] : [];
    for (const h of roofHours) {
      rows.push([byName['The Rooftop'], dow === 5 || dow === 6 ? 84 + (h - 19) * 2 : 58, w, dow, h]);
    }
    // Coffee Lab: chill weekday mornings
    if (dow <= 5) for (const h of [8, 9, 10]) rows.push([byName['Coffee Lab'], 22 + (h - 8) * 3, w, dow, h]);
  }
}

let n = 0;
for (const [venue, vibe, weeksAgo, dow, hour] of rows) {
  if (!venue) continue;
  // build a timestamp weeksAgo weeks ago on the given isodow+hour
  const d = new Date();
  d.setDate(d.getDate() - weeksAgo * 7);
  // shift to target isodow (1=Mon)
  const cur = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() + (dow - cur));
  d.setHours(hour, Math.floor(Math.random() * 50), 0, 0);
  await client.query(
    'insert into checkins (venue_id,user_id,vibe_value,tags,created_at) values ($1,$2,$3,$4,$5)',
    [venue, uid, vibe, [], d.toISOString()],
  );
  n++;
}
console.log('backfilled', n, 'historical check-ins');

const hist = await client.query('select dow, count(*) c, round(avg(avg_value)) v from venue_vibe_history($1) group by 1 order by 1', [byName['The Rooftop']]);
console.log('Rooftop by-day:', hist.rows.map((r) => `d${r.dow}:${r.v}`).join(' '));
await client.end();
