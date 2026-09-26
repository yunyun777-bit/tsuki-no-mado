import test from 'node:test';
import assert from 'node:assert/strict';

test('extension search delegates to the configured Chrome provider without modifying settings', async () => {
  globalThis.chrome = { runtime: { id: 'extension' } };
  const { searchOrNavigate } = await import('../client.js');
  const navigations = [], searches = [];
  const adapters = { navigate: url => navigations.push(url), search: query => searches.push(query) };
  await searchOrNavigate('日本語の検索', adapters);
  assert.deepEqual(searches, [{ text: '日本語の検索', disposition: 'CURRENT_TAB' }]);
  assert.deepEqual(navigations, []);
  await searchOrNavigate('https://example.com/page?q=1', adapters);
  assert.deepEqual(navigations, ['https://example.com/page?q=1']);
  await searchOrNavigate(' ', adapters);
  assert.equal(searches.length, 1);
  await assert.rejects(() => searchOrNavigate('javascript:alert(1)', adapters));
  delete globalThis.chrome;
});
