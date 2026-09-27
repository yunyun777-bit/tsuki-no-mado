import test from 'node:test';
import assert from 'node:assert/strict';

function event() {
  const listeners = [];
  return {
    addListener: callback => listeners.push(callback),
    hasListener: callback => listeners.includes(callback),
    count: () => listeners.length,
    fire: (...args) => listeners.map(callback => callback(...args)),
  };
}

test('background worker respects permissions, persistence and deletion boundaries', async t => {
  let database = {};
  let permission = false;
  let failImport = false;
  const onMessage = event(), onVisited = event(), onVisitRemoved = event(), onRemoved = event(), onAdded = event();
  const now = Date.now();
  const historyAPI = {
    onVisited, onVisitRemoved,
    search: async () => {
      if (failImport) throw new Error('History import unavailable');
      assert.equal(permission, true);
      return [{ url: 'https://history.test/private?token=do-not-store' }];
    },
    getVisits: async () => [{ visitTime: now - 3600_000, transition: 'typed' }, { visitTime: now - 1800_000, transition: 'reload' }],
  };
  t.after(() => { delete globalThis.chrome; });
  globalThis.chrome = {
    runtime: { id: 'test-extension', onMessage },
    storage: { local: {
      get: async key => structuredClone({ [key]: database[key] }),
      set: async values => { database = { ...database, ...structuredClone(values) }; },
      clear: async () => { database = {}; },
    } },
    permissions: {
      contains: async () => permission,
      remove: async () => { const had = permission; permission = false; if (had) onRemoved.fire({ permissions: ['history'] }); return had; },
      onRemoved, onAdded,
    },
    // Chrome does not expose the optional API before the user grants access.
    get history() { return permission ? historyAPI : undefined; },
  };
  await import('../background.js');
  function send(message) {
    return new Promise(resolve => { onMessage.fire(message, { id: 'test-extension' }, resolve); });
  }
  async function state() { return (await send({ type: 'get' })).state; }

  await t.test('starts empty; rejects history access without a grant', async () => {
    assert.equal(chrome.history, undefined);
    assert.equal(onVisited.count(), 0);
    assert.equal(onVisitRemoved.count(), 0);
    assert.deepEqual((await state()).sites, {});
    assert.match((await send({ type: 'enable' })).error, /許可/);
    onVisited.fire({ url: 'https://ignored.test', lastVisitTime: now });
    assert.deepEqual((await state()).sites, {});
  });
  await t.test('imports origin-only data; excludes reloads', async () => {
    permission = true;
    onAdded.fire({ permissions: ['history'] });
    assert.equal(onVisited.count(), 1);
    assert.equal(onVisitRemoved.count(), 1);
    const result = await send({ type: 'enable' });
    assert.equal(result.state.learning, true);
    assert.deepEqual(result.state.sites['https://history.test'].visits, [now - 3600_000]);
    assert.equal(JSON.stringify(database).includes('do-not-store'), false);
    assert.equal(JSON.stringify(database).includes('/private'), false);
  });
  await t.test('grant and repeated enable register each event once and learn visits', async () => {
    onAdded.fire({ permissions: ['history'] });
    await send({ type: 'enable' });
    assert.equal(onVisited.count(), 1);
    assert.equal(onVisitRemoved.count(), 1);
    onVisited.fire({ url: 'https://after-grant.test/path', lastVisitTime: now });
    assert.deepEqual((await state()).sites['https://after-grant.test'].visits, [now]);
  });
  await t.test('serializes simultaneous mutations without dropping updates', async () => {
    await Promise.all(['one','two','three'].map(name => send({ type: 'add', origin: `https://${name}.test` })));
    for (const name of ['one','two','three']) assert.ok((await state()).sites[`https://${name}.test`]);
  });
  await t.test('pause revokes access and stops visits while preserving existing data', async () => {
    await send({ type: 'pause' });
    assert.equal(permission, false);
    onVisited.fire({ url: 'https://paused.test', lastVisitTime: now });
    const result = await state();
    assert.equal(result.learning, false);
    assert.equal(result.sites['https://paused.test'], undefined);
    assert.ok(result.sites['https://history.test']);
  });
  await t.test('history deletion clears derived visits while retaining pinned sites', async () => {
    permission = true;
    onAdded.fire({ permissions: ['history'] });
    await send({ type: 'enable' });
    assert.equal(onVisited.count(), 1);
    assert.equal(onVisitRemoved.count(), 1);
    await send({ type: 'pin', origin: 'https://history.test' });
    onVisitRemoved.fire({ allHistory: false, urls: ['https://history.test/private'] });
    const result = await state();
    assert.deepEqual(result.sites['https://history.test'].visits, []);
    assert.deepEqual(result.pins, ['https://history.test']);
  });
  await t.test('failed import reports failure without partially saving learning state', async () => {
    await send({ type: 'pause' }); permission = true; failImport = true;
    assert.match((await send({ type: 'enable' })).error, /unavailable/);
    assert.equal((await state()).learning, false);
    failImport = false;
  });
  await t.test('reset revokes permission and removes all sites and preferences', async () => {
    await send({ type: 'shortcut-save', name: 'Docs', url: 'https://example.com/docs' });
    await send({ type: 'appearance', values: { theme: 'dark', backdrop: 'sky' } });
    assert.equal((await state()).shortcuts[0].url, 'https://example.com/docs');
    assert.equal((await state()).appearance.theme, 'dark');
    await send({ type: 'reset' });
    assert.equal(permission, false);
    const result = await state();
    assert.deepEqual(result.sites, {});
    assert.deepEqual(result.pins, []);
    assert.deepEqual(result.hidden, []);
    assert.equal(result.learning, false);
    assert.equal(result.importedAt, null);
    assert.deepEqual(result.shortcuts, []);
    assert.equal(result.appearance.theme, 'system');
  });
  delete globalThis.chrome;
});

test('worker restart with an existing history grant registers listeners on startup', async t => {
  const onVisited = event(), onVisitRemoved = event();
  globalThis.chrome = {
    runtime: { id: 'test-extension', onMessage: event() },
    permissions: { onAdded: event(), onRemoved: event() },
    history: { onVisited, onVisitRemoved },
  };
  t.after(() => { delete globalThis.chrome; });
  await import('../background.js?restart-with-permission');
  assert.equal(onVisited.count(), 1);
  assert.equal(onVisitRemoved.count(), 1);
});
