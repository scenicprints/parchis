// A static server for docs/, for working on the game before it is deployed.
//
//   node scripts/serve.mjs [port]
//
// Open http://localhost:8099/?local=1 to play both sides with no network.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const PORT = Number(process.argv[2]) || 8099;

// Somewhere to drop a picture of the board while working on how it looks.
// POST a PNG to /shot/<name> and it lands here. Development only: nothing
// under docs/ knows this exists.
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '.shots');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);

  if (req.method === 'POST' && path.startsWith('/shot/')) {
    const name = path.slice(6).replace(/[^a-z0-9._-]/gi, '') || 'board.png';
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    await mkdir(SHOTS, { recursive: true });
    await writeFile(join(SHOTS, name), Buffer.concat(chunks));
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(name);
    return;
  }
  const rel = normalize(path === '/' ? 'index.html' : path.slice(1)).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, rel);

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}).listen(PORT, () => console.log(`parchis on http://localhost:${PORT}`));
