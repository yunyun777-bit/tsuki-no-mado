import { readFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { root, runtimeFiles, checkRuntime, checkBundle } from './release.js';

const manifest = await checkRuntime();
// A release must carry the author's selected license; never invent a copyright holder.
try { await readFile(path.join(root, 'LICENSE'), 'utf8'); }
catch { throw new Error('LICENSEが未設定です。ライセンスと作者名を確定してから配布用フォルダーを作成してください。'); }
const dist = path.join(root, 'dist');
await mkdir(dist, { recursive: true });
const destination = await mkdtemp(path.join(dist, `tsuki-no-mado-${manifest.version}-`));
for (const name of [...runtimeFiles, 'LICENSE', 'PRIVACY.md']) {
  await copyFile(path.join(root, name), path.join(destination, name));
}
await checkBundle(destination);
console.log(`配布用フォルダー: ${destination}`);
console.log('Chromeの「パッケージ化されていない拡張機能を読み込む」で、このフォルダーを選択してください。');
