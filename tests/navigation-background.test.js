import test from 'node:test';
import assert from 'node:assert/strict';

function event() {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), hasListener: fn => listeners.includes(fn), fire: (...args) => listeners.forEach(fn => fn(...args)) };
}

test('routes integrate with history import, live visits, restart, pause and deletion', async t => {
  const now = Date.now();
  let permission = true, database = {}, failVisits = false, searches = 0;
  const onMessage = event(), onVisited = event(), onVisitRemoved = event(), onRemoved = event();
  const pages = new Map([
    ['https://a.test/private?token=hidden', [{ visitId: '1', visitTime: now - 120_000, transition: 'typed', isLocal: true }]],
    ['https://b.test/private', [{ visitId: '2', referringVisitId: '1', visitTime: now - 60_000, transition: 'link', isLocal: true }]],
  ]);
  const history = { onVisited, onVisitRemoved,
    search: async () => { searches++; return [...pages.keys()].reverse().map(url => ({ url })); },
    getVisits: async ({ url }) => { if (failVisits) throw new Error('temporarily unavailable'); return pages.get(url) || []; },
  };
  globalThis.chrome = {
    runtime: { id: 'routes-test', onMessage },
    permissions: { contains: async () => permission, onAdded: event(), onRemoved,
      remove: async () => { permission = false; onRemoved.fire({ permissions: ['history'] }); } },
    get history() { return permission ? history : undefined; },
    storage: { local: {
      get: async key => structuredClone({ [key]: database[key] }),
      set: async value => { database = { ...database, ...structuredClone(value) }; },
      clear: async () => { database = {}; },
    } },
  };
  t.after(() => { delete globalThis.chrome; });
  await import('../background.js?routes-integration');
  const send = message => new Promise(resolve => onMessage.fire(message, { id: 'routes-test' }, resolve));
  const read = async () => (await send({ type: 'get' })).state;
  let state = (await send({ type: 'enable' })).state;
  assert.equal(state.navigation.edges[0].from, 'https://a.test');
  assert.equal(state.navigation.edges[0].to, 'https://b.test');
  assert.equal(state.navigation.edges[0].events[0].kind, 'link');
  assert.doesNotMatch(JSON.stringify(database), /private|token=hidden/);
  await t.test('existing learners backfill once without changing visits or preferences', async () => {
    database.tabloom.navigation = { edges: [], recent: [] };
    database.tabloom.dailyNote = 'keep this note';
    const sites = structuredClone(database.tabloom.sites);
    const importedAt = database.tabloom.importedAt;
    const before = searches;
    const migrated = await read();
    assert.equal(migrated.navigation.edges.length, 1);
    assert.ok(migrated.navigation.importedAt);
    assert.deepEqual(migrated.sites, sites);
    assert.equal(migrated.dailyNote, 'keep this note');
    assert.equal(migrated.importedAt, importedAt);
    await read();
    assert.equal(searches, before + 1);
  });
  await t.test('failed automatic backfill keeps the app usable and supports explicit retry without duplicates', async () => {
    delete database.tabloom.navigation.importedAt;
    failVisits = true;
    const failed = await read();
    assert.equal(failed.navigation.importFailed, true);
    assert.equal(failed.navigation.edges.length, 1);
    const before = searches;
    await read();
    assert.equal(searches, before);
    failVisits = false;
    const retried = (await send({ type: 'navigation-import' })).state;
    assert.equal(retried.navigation.importFailed, undefined);
    assert.equal(retried.navigation.edges[0].events.length, 1);
  });
  const url = 'https://c.test/path';
  pages.set(url, [{ visitId: '3', referringVisitId: '2', visitTime: now - 30_000, transition: 'link' }]);
  onVisited.fire({ url, lastVisitTime: now - 30_000 });
  onVisited.fire({ url, lastVisitTime: now - 30_000 });
  state = await read();
  assert.equal(state.navigation.edges.find(edge => edge.to === 'https://c.test').events.length, 1);
  // Each handler re-reads structured-cloned storage, like a fresh worker.
  assert.equal(state.navigation.recent.at(-1).id, '3');
  failVisits = true;
  onVisited.fire({ url: 'https://fallback.test', lastVisitTime: now });
  assert.ok((await read()).sites['https://fallback.test']);
  failVisits = false;
  await send({ type: 'pause' });
  state = await read();
  assert.equal(state.learning, false);
  assert.deepEqual(state.navigation.recent, []);
  assert.equal(state.navigation.edges.length, 2);
  await t.test('paused learners do not backfill or grant history access', async () => {
    delete database.tabloom.navigation.importedAt;
    const before = searches;
    await read();
    assert.equal(searches, before);
    assert.ok((await send({ type: 'navigation-import' })).error);
    // This test simulates an already migrated learner for the resume boundary check.
    database.tabloom.navigation.importedAt = now;
  });
  permission = true;
  await send({ type: 'enable' });
  pages.set('https://d.test', [{ visitId: '4', referringVisitId: '3', visitTime: now, transition: 'link' }]);
  onVisited.fire({ url: 'https://d.test', lastVisitTime: now });
  assert.equal((await read()).navigation.edges.length, 2);
  onVisitRemoved.fire({ allHistory: false, urls: ['https://a.test/private?token=hidden'] });
  state = await read();
  assert.deepEqual(state.navigation, { edges: [], recent: [] });
  assert.equal(state.importedAt, null);
  const afterDelete = searches;
  await read();
  assert.equal(searches, afterDelete);
  await send({ type: 'reset' });
  assert.deepEqual((await read()).navigation, { edges: [], recent: [] });
});
