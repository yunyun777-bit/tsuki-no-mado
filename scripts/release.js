import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

export const root = fileURLToPath(new URL('../', import.meta.url));
// Copy only runtime files. Personal evaluation data and developer files never enter the bundle.
export const runtimeFiles = Object.freeze([
  'manifest.json', 'newtab.html', 'styles.css', 'standard.css',
  'newtab.js', 'standard.js', 'client.js', 'model.js', 'features.js', 'background.js',
]);

export async function checkRuntime(directory = root) {
  const contents = Object.fromEntries(await Promise.all(runtimeFiles.map(async name =>
    [name, await readFile(path.join(directory, name), 'utf8')])));
  const manifest = JSON.parse(contents['manifest.json']);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, '月の窓');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.chrome_url_overrides.newtab, 'newtab.html');
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.background.type, 'module');
  assert.deepEqual(manifest.permissions, ['storage', 'search']);
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
        ? [...source.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)].map(match => match[1]) : [];
    for (const target of references) assert.ok(runtimeFiles.includes(target), `${name}: missing bundled dependency ${target}`);
  }
  return manifest;
}

export async function checkBundle(directory) {
  const expected = [...runtimeFiles, 'LICENSE', 'PRIVACY.md'].sort();
  assert.deepEqual((await readdir(directory)).sort(), expected, 'Bundle contains missing or unexpected files');
  assert.ok((await readFile(path.join(directory, 'LICENSE'), 'utf8')).trim(), 'License is empty');
  return checkRuntime(directory);
}
