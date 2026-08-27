/**
 * Serves the production web export (dist/) for local preview, with the SPA
 * fallback that Vercel provides in production (any unknown path → index.html).
 *
 *   npm run web:export && npm run serve:web
 *
 * Binds 0.0.0.0 so the sandboxed live-preview host can reach it.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const PORT = Number(process.env.PORT ?? 8081);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
};

async function send(res, file, status = 200) {
  const body = await readFile(file);
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const target = normalize(join(dist, pathname));
  if (!target.startsWith(dist)) {
    res.writeHead(403).end();
    return;
  }

  try {
    const s = await stat(target);
    if (s.isFile()) return await send(res, target);
  } catch {
    /* fall through to SPA */
  }

  // Expo Router single-output SPA: unknown route → index.html
  return await send(res, join(dist, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SpotCheck web preview → http://0.0.0.0:${PORT}`);
});
