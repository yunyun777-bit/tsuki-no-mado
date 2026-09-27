import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const brandFiles = Object.freeze([
  'assets/brand/tsuki-no-mado-logo-v3.png',
  ...[16, 32, 48, 128].map(size => `assets/brand/icon-${size}.png`),
]);
// Copy only runtime files. Personal evaluation data and developer files never enter the bundle.
export const runtimeFiles = Object.freeze([
  'manifest.json', 'newtab.html', 'styles.css', 'standard.css',
  'newtab.js', 'standard.js', 'client.js', 'model.js', 'features.js', 'backup.js', 'workspace.js', 'background.js', 'icons.js', 'atmosphere.js', 'atmosphere.css',
  'brand.css', ...brandFiles,
]);

export async function checkRuntime(directory = root) {
  const contents = Object.fromEntries(await Promise.all(runtimeFiles.filter(name => !name.endsWith('.png')).map(async name =>
    [name, await readFile(path.join(directory, name), 'utf8')])));
  const manifest = JSON.parse(contents['manifest.json']);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, '月の窓');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.chrome_url_overrides.newtab, 'newtab.html');
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.background.type, 'module');
  for (const name of brandFiles) {
    const image = await readFile(path.join(directory, name));
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${name}: invalid PNG`);
    const size = /icon-(\d+)\.png$/.exec(name)?.[1];
    if (size) {
      assert.equal(manifest.icons?.[size], name);
      assert.equal(image.readUInt32BE(16), Number(size), `${name}: wrong width`);
      assert.equal(image.readUInt32BE(20), Number(size), `${name}: wrong height`);
    }
  }
  assert.deepEqual(manifest.permissions, ['storage', 'search', 'favicon']);
  assert.deepEqual(manifest.optional_permissions, ['history']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_security_policy.extension_pages,
    "script-src 'self'; object-src 'none'; connect-src 'none'");
  assert.ok(contents['newtab.html'].includes('<title>月の窓</title>'));
  assert.doesNotMatch(contents['newtab.html'], /tabloom/i);
  for (const [name, source] of Object.entries(contents)) {
    const references = name.endsWith('.js')
      ? [...source.matchAll(/\b(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)].map(match => match[1].slice(2))
      : name === 'newtab.html'
        ? [...source.matchAll(/(?:src|href)="([^"#]+\.(?:js|css|png))"/g)].map(match => match[1]) : [];
    for (const target of references) assert.ok(runtimeFiles.includes(target), `${name}: missing bundled dependency ${target}`);
  }
  return manifest;
}

export async function checkBundle(directory) {
  const expected = [...runtimeFiles, 'LICENSE', 'PRIVACY.md'].sort();
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = entries.filter(entry => entry.isFile()).map(entry =>
    path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
  assert.deepEqual(files.sort(), expected, 'Bundle contains missing or unexpected files');
  assert.ok((await readFile(path.join(directory, 'LICENSE'), 'utf8')).trim(), 'License is empty');
  return checkRuntime(directory);
}
