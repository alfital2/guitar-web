// tools/neural/serve.mjs
// Minimal static server rooted at the repo root for the NAM de-risk spike.
// Plain HTTP: the plain-wasm engine is single-thread, so NO COOP/COEP is needed.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)); // tools/neural -> repo root
const PORT = Number(process.env.PORT) || 8791;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.nam': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/tools/neural/derisk.html';
    const safe = normalize(p).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, safe);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const info = await stat(file);
    if (info.isDirectory()) { res.writeHead(403).end('forbidden'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('not found'); }
});

server.listen(PORT, '127.0.0.1', () => console.log(`derisk serving at http://localhost:${PORT}`));
