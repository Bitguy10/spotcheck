/**
 * Rasterises the SpotCheck mark into the icon set Expo expects.
 *
 *   node tools/build-logo.mjs
 *
 * Uses the static frame (assets/logo-static.svg) because app icons can't
 * animate. Run once, then commit the PNGs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(resolve(root, 'assets/logo-static.svg'), 'utf8');

const targets = [
  { file: 'assets/icon.png', size: 1024 },
  { file: 'assets/adaptive-icon.png', size: 1024 },
  { file: 'assets/splash-icon.png', size: 512 },
  { file: 'assets/favicon.png', size: 64 },
];

for (const t of targets) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: t.size },
    background: 'rgba(0, 0, 0, 0)',
  });
  writeFileSync(resolve(root, t.file), resvg.render().asPng());
  console.log(`wrote ${t.file} @ ${t.size}px`);
}
