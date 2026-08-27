/** Wave-2 E2E: favorites + share card, against the real project. */
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://127.0.0.1:8081';
const VENUE_ID = process.env.VENUE_ID ?? 'c73efac7-3307-40d2-b7b8-9e486c364fb8';
const EMAIL = 'qa@spotcheck.app';
const PASS = 'Password123!';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.grantPermissions(['geolocation', 'clipboard-read', 'clipboard-write'], { origin: base });
await ctx.setGeolocation({ latitude: 6.4292, longitude: 3.4229 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto(base + '/(auth)/login', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.getByPlaceholder('Email').fill(EMAIL);
await page.getByPlaceholder('Password').fill(PASS);
await page.getByText('Sign in', { exact: true }).last().click();
await page.waitForTimeout(2000);

// venue detail
await page.goto(base + '/venue/' + VENUE_ID, { waitUntil: 'load' });
await page.waitForTimeout(2000);

// save
await page.getByTestId('sc-save').click();
await page.waitForTimeout(800);
const heart = await page.getByTestId('sc-save').innerText();
console.log('heart after save:', JSON.stringify(heart));

// share card
await page.getByTestId('sc-share').click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'tools/w2-sharecard.png' });
console.log('share card shot');

// close modal (Close)
await page.getByText('Close').click().catch(() => {});
await page.waitForTimeout(400);

// dashboard saved filter
await page.goto(base + '/(app)', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.getByText(/♥ Saved/).click();
await page.waitForTimeout(800);
const hasRooftop = await page.evaluate(() => document.body.innerText.includes('The Rooftop'));
console.log('saved filter shows The Rooftop:', hasRooftop);
await page.screenshot({ path: 'tools/w2-saved.png' });

console.log('errors:', errs.length ? errs.slice(0, 6).join(' || ') : 'none');
await browser.close();
