import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, runtimeFiles, checkRuntime } from './release.js';

const manifest = await checkRuntime();
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.version, manifest.version, 'Package and extension versions differ');
const sources = [
  ...runtimeFiles.filter(name => name.endsWith('.js')),
  ...(await readdir(path.join(root, 'scripts'))).filter(name => name.endsWith('.js')).map(name => `scripts/${name}`),
];
for (const name of sources) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, name)], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Syntax check failed: ${name}\n${result.stderr || result.error}`);
}
console.log(`月の窓 ${manifest.version}: manifest, runtime dependencies and JavaScript syntax OK`);
