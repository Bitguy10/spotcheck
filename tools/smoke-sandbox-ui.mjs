/* Sandbox UI test — two fresh accounts on ONE device (shared localStorage),
 * so a passing run proves both the empty-world UX and the per-account cache. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/home/user/spotcheck/package.json');
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8081';
const ts = Date.now();
let fails = 0;
const ok = (l, c, extra = '') => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${l} ${extra}`);
  if (!c) fails++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.grantPermissions(['geolocation'], { origin: BASE });
await ctx.setGeolocation({ latitude: 6.5085, longitude: 3.387 }); // Shomolu: 5+ places @2 km
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

const rowCount = () =>
  page.evaluate(() => document.querySelectorAll('[data-testid^="venue-row"]').length);

async function signup(email) {
  await page.goto(BASE + '/(auth)/signup', { waitUntil: 'load' });
  await page.getByPlaceholder('Email').waitFor({ timeout: 20000 });
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password (6+ characters)').fill('Passw0rd!');
  await page.getByText('Create account').click();
  await page.getByPlaceholder('Search venues, areas…').waitFor({ timeout: 30000 });
}

/* -- account A: empty world auto-fills from her own pull ---------------- */
await signup(`uiA+${ts}@spotcheck.app`);
await page.waitForTimeout(600);
const early = await rowCount();
console.log('  (rows 0.6 s after first paint:', early, ')');
await page.waitForSelector('[data-testid^="venue-row"]', { timeout: 40000 });
await page.waitForTimeout(1500);
const rowsA = await rowCount();
ok('A: empty world auto-pulls her own rows', rowsA > 0, `rows=${rowsA}`);
await page.screenshot({ path: 'tools/sandbox-ui-A.png' });

/* A checks in so we can prove B never inherits it */
const venueId = (await page.locator('[data-testid^="venue-row"]').first().getAttribute('data-testid')).replace('venue-row-', '');
// move the fake GPS onto the venue (check-ins are verified at the door)
const pgmod = await import('pg');
const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const pgc = new pgmod.default.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pgc.connect();
const { rows: [coord] } = await pgc.query('select lat, lng from public.venues where id = $1', [venueId]);
await pgc.end();
await ctx.setGeolocation({ latitude: coord.lat, longitude: coord.lng });
await page.goto(BASE + `/(app)/checkin/${venueId}`, { waitUntil: 'load' });
await page.waitForSelector('[data-testid="sc-checkin-submit"]', { timeout: 20000 });
const gauge = page.locator('[data-testid="sc-gauge"]');
const bb = await gauge.boundingBox();
await page.mouse.move(bb.x + bb.width * 0.75, bb.y + bb.height / 2); // hot side
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(700);
await page.locator('[data-testid="sc-checkin-submit"]').click();
await page.waitForTimeout(1200);
if (await page.getByText('Tap again to confirm').count()) {
  await page.locator('[data-testid="sc-checkin-submit"]').click();
}
await page.waitForTimeout(3000);
const pgc2 = new pgmod.default.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pgc2.connect();
const { rows: [{ n }] } = await pgc2.query('select count(*)::int as n from public.checkins where venue_id = $1', [venueId]);
await pgc2.end();
ok('A: check-in landed server-side', n >= 1, `checkins=${n}`);
await page.screenshot({ path: 'tools/sandbox-ui-A-checkin.png' });
await page.goto(BASE + '/settings', { waitUntil: 'load' });
await page.getByText('Sign out').click();
await page.waitForTimeout(2000);

/* -- account B on the SAME device: cache must not show A's world -------- */
await signup(`uiB+${ts}@spotcheck.app`);
await page.waitForTimeout(500);
const leak = await rowCount();
ok('B: no rows hydrated from A\'s cache (same device)', leak === 0, `rows at 0.5 s=${leak}`);
await page.waitForSelector('[data-testid^="venue-row"]', { timeout: 40000 });
await page.waitForTimeout(1500);
const rowsB = await rowCount();
ok('B: empty world auto-pulls his own rows', rowsB > 0, `rows=${rowsB}`);
await page.screenshot({ path: 'tools/sandbox-ui-B.png' });

/* -- QA (pre-sandbox account): legacy world is gone until she re-pulls --- */
await page.goto(BASE + '/settings', { waitUntil: 'load' });
await page.getByText('Sign out').click();
await page.waitForTimeout(2000);
await page.evaluate(() => localStorage.clear()); // fresh device for QA
await page.goto(BASE + '/(auth)/login', { waitUntil: 'load' });
await page.getByPlaceholder('Email').waitFor({ timeout: 15000 });
await page.getByPlaceholder('Email').fill('qa@spotcheck.app');
await page.getByPlaceholder('Password').fill('Password123!');
await page.getByText('Sign in', { exact: true }).last().click();
await page.getByPlaceholder('Search venues, areas…').waitFor({ timeout: 30000 });
await page.waitForTimeout(500);
// Any instantly-hydrated rows must be QA-owned (her own cache) — never legacy
// or another account's rows. (AsyncStorage on web is IndexedDB, so caches
// survive localStorage.clear(); ownership is the real assertion.)
const qaIds = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid^="venue-row-"]')].map((e) => e.getAttribute('data-testid').slice('venue-row-'.length)));
const pgc3 = new pgmod.default.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pgc3.connect();
const qaUid = (await pgc3.query('select id from auth.users where email = $1', ['qa@spotcheck.app'])).rows[0]?.id;
let qaOwned = true;
if (qaIds.length) {
  const owners = (await pgc3.query('select id, owner_id from public.venues where id = any($1::uuid[])', [qaIds])).rows;
  qaOwned = owners.length === qaIds.length && owners.every((r) => String(r.owner_id) === String(qaUid));
}
await pgc3.end();
ok('QA: instantly-hydrated rows are all QA-owned (no legacy/foreign leak)', qaOwned, `rows at 0.5 s=${qaIds.length}, qa=${qaUid}`);
await page.waitForSelector('[data-testid^="venue-row"]', { timeout: 40000 });
const qaRows = await rowCount();
ok('QA: re-pull rebuilds her world', qaRows > 0, `rows=${qaRows}`);
await page.screenshot({ path: 'tools/sandbox-ui-QA.png' });

await browser.close();
console.log(fails === 0 ? '\nSANDBOX UI: ALL PASS' : `\nSANDBOX UI: ${fails} FAILURES`);
process.exit(fails ? 1 : 0);
