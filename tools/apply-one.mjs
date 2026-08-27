/** Apply a single SQL file: DATABASE_URL=... node tools/apply-one.mjs path/to.sql */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const file = process.argv[2];
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(readFileSync(file, 'utf8'));
const t = await client.query("select table_name from information_schema.tables where table_schema='public' order by 1");
console.log('tables:', t.rows.map((r) => r.table_name).join(', '));
await client.end();
console.log('applied', file);
