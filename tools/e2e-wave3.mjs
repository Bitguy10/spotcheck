/** Wave-3 E2E: historical pattern on venue page + create-event flow. */
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://127.0.0.1:8081';
const VENUE_ID = process.env.VENUE_ID ?? 'c73efac7-3307-40d2-b7b8-9e486c364fb8';
const EMAIL = 'qa@spotcheck.app';
const PASS = 'Password123!';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.grantPermissions(['geolocation'], { origin: base });
await ctx.setGeolocation({ latitude: 6.4292, longitude: 3.4229 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

// login
await page.goto(base + '/(auth)/login', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.getByPlaceholder('Email').fill(EMAIL);
await page.getByPlaceholder('Password').fill(PASS);
await page.getByText('Sign in', { exact: true }).last().click();
await page.waitForTimeout(1800);

// venue detail: historical pattern
await page.goto(base + '/venue/' + VENUE_ID, { waitUntil: 'load' });
await page.waitForTimeout(2200);
const body = await page.evaluate(() => document.body.innerText);
console.log('has Typically:', body.includes('Typically'), '| has Usually:', /Usually/.test(body));
await page.screenshot({ path: 'tools/w3-history.png' });

// create event
await page.goto(base + '/(app)', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.getByText('＋ Event').click();
await page.waitForTimeout(600);
await page.getByPlaceholder('Event name').fill('Night Market');
await page.getByText('3h').click();
await page.getByText('Drop it here').click();
await page.waitForTimeout(1800);
const dash = await page.evaluate(() => document.body.innerText);
console.log('event in list:', dash.includes('Night Market'), '| EVENT badge:', dash.includes('EVENT'));
await page.screenshot({ path: 'tools/w3-event.png' });

console.log('errors:', errs.length ? errs.slice(0, 6).join(' || ') : 'none');
await browser.close();
