import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { brandFiles } from './release.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4173);
const allowed = new Set(['newtab.html','styles.css','newtab.js','client.js','model.js','features.js', 'backup.js', 'workspace.js', 'dialogs.js','standard.js','standard.css','icons.js','atmosphere.js','atmosphere.css']);
allowed.add('brand.css');
allowed.add('navigation.js');
for (const name of brandFiles) allowed.add(name);
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png' };
http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const name = pathname === '/' ? 'newtab.html' : pathname.slice(1);
  if (!allowed.has(name)) { response.writeHead(404); response.end('Not found'); return; }
  try {
    response.writeHead(200, { 'Content-Type': types[path.extname(name)], 'Cache-Control': 'no-store' });
    response.end(await readFile(path.join(root, name)));
  } catch { response.writeHead(500); response.end('Unable to load preview'); }
}).listen(port, '127.0.0.1', () => console.log(`月の窓 preview: http://127.0.0.1:${port}`));
