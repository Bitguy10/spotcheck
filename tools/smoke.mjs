/**
 * Runtime smoke test: load the built web app headlessly, surface any console /
 * page errors, and screenshot the landing + dashboard so we can *see* it run.
 *
 *   npm run serve:web   (in another terminal)
 *   node tools/smoke.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:8081';

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

async function shot(path, name, waitMs = 2500) {
  await page.goto(base + path, { waitUntil: 'load', timeout: 45000 }).catch((e) => errors.push(`[nav ${path}] ${e.message}`));
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: `tools/${name}.png`, fullPage: false });
  console.log(`shot ${name} @ ${path}`);
}

await shot('/', 'smoke-landing');
// Dashboard is behind a client-side push; navigate via the SPA route directly.
await shot('/(app)', 'smoke-dashboard', 3000);

const text = await page.evaluate(() => document.body?.innerText?.slice(0, 400) ?? '(no body)');
console.log('--- body text sample ---');
console.log(text.replace(/\n+/g, ' | ').slice(0, 400));

console.log('--- errors ---');
console.log(errors.length ? errors.slice(0, 20).join('\n') : '(none)');

await browser.close();
