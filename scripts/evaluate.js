import { readFile } from 'node:fs/promises';
import { evaluateVisits, syntheticVisits } from './evaluation.js';

const [inputPath, ...extra] = process.argv.slice(2);
if (!inputPath || extra.length) {
  console.error('Usage: npm run evaluate -- --demo | npm run evaluate -- local-data/visits.json');
  process.exitCode = 1;
} else {
  try {
    const demo = inputPath === '--demo';
    const visits = demo ? syntheticVisits() : JSON.parse(await readFile(inputPath, 'utf8'));
    console.log(JSON.stringify({
      dataSource: demo ? 'synthetic-demo-not-evidence-of-real-world-accuracy' : 'local-user-supplied-data',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...evaluateVisits(visits),
    }, null, 2));
  } catch {
    // Do not echo JSON parser errors: they may contain private URLs from malformed input.
    console.error('評価できませんでした。入力ファイルが読めることと、JSON配列の形式を確認してください。');
    process.exitCode = 1;
  }
}
