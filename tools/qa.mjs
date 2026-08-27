/**
 * Visual QA: capture the key screens across themes + viewports from the built
 * web export. Requires `npm run serve:web` running.
 *
 *   node tools/qa.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:8081';
const browser = await chromium.launch();

async function shot({ path, name, scheme = 'light', width = 1280, height = 900, wait = 2500 }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base + path, { waitUntil: 'load', timeout: 45000 }).catch((e) => errs.push(e.message));
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `tools/qa-${name}.png` });
  console.log(`shot qa-${name} (${scheme} ${width}px) errors=${errs.length ? errs.join(';') : 'none'}`);
  await ctx.close();
}

await shot({ path: '/(app)', name: 'dash-light' });
await shot({ path: '/(app)', name: 'dash-dark', scheme: 'dark' });
await shot({ path: '/', name: 'landing-dark', scheme: 'dark' });
await shot({ path: '/(app)', name: 'dash-mobile', width: 390, height: 844 });

await browser.close();
console.log('done');
