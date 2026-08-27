/**
 * Production browser E2E against the real Supabase project.
 * Emulates GPS at "The Rooftop", signs in, browses live data, and checks in.
 *
 *   npm run serve:web  (built with EXPO_PUBLIC_SUPABASE_*)
 *   node tools/e2e.mjs
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:8081';
const VENUE = { lat: 6.4292, lng: 3.4229 }; // The Rooftop (seeded in their DB)
const EMAIL = 'qa@spotcheck.app';
const PASS = 'Password123!';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.grantPermissions(['geolocation'], { origin: base });
await ctx.setGeolocation({ latitude: VENUE.lat, longitude: VENUE.lng });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push('[console] ' + m.text()));

const step = async (name) => {
  await page.screenshot({ path: `tools/e2e-${name}.png` });
  console.log('step', name);
};

// landing → shows live venue from their DB
await page.goto(base + '/', { waitUntil: 'load' });
await page.waitForTimeout(3000);
const heroHasRooftop = await page.evaluate(() => document.body.innerText.includes('The Rooftop'));
console.log('landing shows The Rooftop:', heroHasRooftop);
await step('1-landing');

// sign in
await page.getByText('Sign in', { exact: false }).first().click();
await page.waitForTimeout(800);
await page.getByPlaceholder('Email').fill(EMAIL);
await page.getByPlaceholder('Password').fill(PASS);
await page.getByText('Sign in', { exact: true }).last().click();
await page.waitForTimeout(2500);
await step('2-dashboard');
const dashText = await page.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n+/g, ' | '));
console.log('dashboard:', dashText);

// open check-in via the sticky bar
const sticky = page.getByText(/Check in here/);
await sticky.click();
await page.waitForTimeout(1500);
await step('3-checkin');

// tap the gauge at ~75% (hot side)
const gauge = page.getByTestId('sc-gauge');
await gauge.waitFor({ timeout: 8000 }).catch(() => {});
const bb = await gauge.boundingBox();
if (bb) {
  await page.mouse.move(bb.x + bb.width * 0.75, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(700);
}
await step('4-gauge-tapped');

// submit
const submit = page.getByTestId('sc-checkin-submit');
if (await submit.count()) {
  await submit.click();
  await page.waitForTimeout(1800);
}
await step('5-submitted');
const toast = await page.evaluate(() => document.body.innerText.includes('Vibe logged'));
console.log('toast shown:', toast);

console.log('errors:', errs.length ? errs.slice(0, 8).join(' || ') : 'none');
await browser.close();
