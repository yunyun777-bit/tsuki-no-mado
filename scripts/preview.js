import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = new Set(['newtab.html','styles.css','newtab.js','client.js','model.js','features.js','standard.js','standard.css']);
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8' };
http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const name = pathname === '/' ? 'newtab.html' : pathname.slice(1);
  if (!allowed.has(name)) { response.writeHead(404); response.end('Not found'); return; }
  try {
    response.writeHead(200, { 'Content-Type': types[path.extname(name)], 'Cache-Control': 'no-store' });
    response.end(await readFile(path.join(root, name)));
  } catch { response.writeHead(500); response.end('Unable to load preview'); }
}).listen(4173, '127.0.0.1', () => console.log('月の窓 preview: http://127.0.0.1:4173'));
