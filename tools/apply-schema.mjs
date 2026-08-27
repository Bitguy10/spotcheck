/**
 * Applies the SpotCheck schema + seed to a Supabase/Postgres database using a
 * direct connection string. Run:
 *
 *   DATABASE_URL="postgresql://user:pass@host:port/postgres" node tools/apply-schema.mjs
 *
 * Applies, in order: 0001_schema.sql, 0002_rpc_api.sql, seed.sql.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL');
  process.exit(1);
}

const files = [
  'supabase/migrations/0001_schema.sql',
  'supabase/migrations/0002_rpc_api.sql',
  'supabase/seed.sql',
];

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log('connected');

for (const f of files) {
  const sql = readFileSync(resolve(root, f), 'utf8');
  try {
    await client.query(sql);
    console.log(`applied ${f}`);
  } catch (e) {
    console.error(`FAILED ${f}: ${e.message}`);
    await client.end();
    process.exit(1);
  }
}

// sanity: list tables + functions
const t = await client.query(`select table_name from information_schema.tables where table_schema='public' order by 1`);
console.log('tables:', t.rows.map((r) => r.table_name).join(', '));
const fn = await client.query(`select routine_name from information_schema.routines where routine_schema='public' and routine_name in ('submit_checkin','vibe_score_for_venue','venues_with_vibe','upsert_osm_venues','checkin_count_today')`);
console.log('functions:', fn.rows.map((r) => r.routine_name).join(', '));

await client.end();
console.log('done');
