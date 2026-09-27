import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultAppearance, normalizeFeatures, shortcutURL, searchAction } from '../features.js';
import { emptyState, editState } from '../model.js';

test('search distinguishes queries, operators, full URLs and bare domains', () => {
  assert.equal(searchAction('  '), null);
  assert.deepEqual(searchAction('猫 動画'), { type: 'search', text: '猫 動画' });
  assert.deepEqual(searchAction('site:example.com CSS'), { type: 'search', text: 'site:example.com CSS' });
  assert.deepEqual(searchAction('example.com/docs?lang=ja#start'), { type: 'navigate', url: 'https://example.com/docs?lang=ja#start' });
  assert.deepEqual(searchAction('http://localhost:8080/app'), { type: 'navigate', url: 'http://localhost:8080/app' });
  assert.deepEqual(searchAction('https://example.com/日本語'), { type: 'navigate', url: 'https://example.com/%E6%97%A5%E6%9C%AC%E8%AA%9E' });
});
test('executable schemes, file access and credential-bearing URLs cannot navigate', () => {
  for (const value of ['javascript:alert(1)','data:text/html,hello','file:///secret','chrome://settings','https://user:secret@example.com']) assert.throws(() => searchAction(value));
  for (const value of ['javascript:alert(1)','file:///secret','https://user:secret@example.com','']) assert.throws(() => shortcutURL(value));
});
test('shortcuts preserve complete destinations and support multiple pages on one host', () => {
  const state = emptyState();
  editState(state, { type: 'shortcut-save', name: 'Issues', url: 'https://github.com/org/repo/issues?q=open#top' });
  editState(state, { type: 'shortcut-save', name: 'PRs', url: 'https://github.com/org/repo/pulls' });
  assert.equal(state.shortcuts.length, 2);
  assert.equal(state.shortcuts[0].url, 'https://github.com/org/repo/issues?q=open#top');
  const firstId = state.shortcuts[0].id;
  editState(state, { type: 'shortcut-save', id: firstId, name: 'Docs', url: 'https://example.com/docs' });
  assert.equal(state.shortcuts.length, 2);
  assert.equal(state.shortcuts[0].name, 'Docs');
  editState(state, { type: 'shortcut-move', id: firstId, direction: 'right' });
  assert.equal(state.shortcuts[1].id, firstId);
  editState(state, { type: 'shortcut-delete', id: firstId });
  assert.equal(state.shortcuts.length, 1);
  assert.equal(state.shortcuts[0].name, 'PRs');
});
test('10-shortcut limit allows edits but rejects a new eleventh entry', () => {
  const state = emptyState();
  for (let i = 0; i < 10; i++) editState(state, { type: 'shortcut-save', name: `${i}`, url: `https://example.com/${i}` });
  assert.throws(() => editState(state, { type: 'shortcut-save', url: 'https://eleventh.test' }), /10件/);
  editState(state, { type: 'shortcut-save', id: state.shortcuts[0].id, url: 'https://updated.test' });
  assert.equal(state.shortcuts.length, 10);
});
test('old data gains feature defaults without losing recommendation preferences', () => {
  const old = { version: 1, sites: { x: { visits: [1] } }, pins: ['x'], hidden: ['y'], learning: true };
  normalizeFeatures(old);
  assert.deepEqual(old.appearance, defaultAppearance());
  assert.deepEqual(old.shortcuts, []);
  assert.deepEqual(old.pins, ['x']);
  assert.deepEqual(old.sites.x.visits, [1]);
  assert.equal(old.learning, true);
});
test('appearance rejects external or executable image URLs and oversized backgrounds atomically', () => {
  const state = emptyState();
  for (const image of ['https://tracking.test/image.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,' + 'A'.repeat(2_800_000)]) {
    assert.throws(() => editState(state, { type: 'appearance', values: { theme: 'dark', image } }));
    assert.equal(state.appearance.theme, 'system');
  }
  editState(state, { type: 'appearance', values: { theme: 'dark', backdrop: 'sky', showShortcuts: false, image: 'data:image/png;base64,AAAA' } });
  assert.equal(state.appearance.theme, 'dark');
  assert.equal(state.appearance.showShortcuts, false);
  editState(state, { type: 'appearance', values: defaultAppearance() });
  assert.deepEqual(state.appearance, defaultAppearance());
});

test('motion can be disabled without replacing a saved background or image', () => {
  const state = emptyState();
  editState(state, { type: 'appearance', values: { backdrop: 'forest', image: 'data:image/png;base64,AAAA' } });
  editState(state, { type: 'appearance', values: { motion: false } });
  normalizeFeatures(state);
  assert.equal(state.appearance.motion, false);
  assert.equal(state.appearance.backdrop, 'forest');
  assert.equal(state.appearance.image, 'data:image/png;base64,AAAA');
  editState(state, { type: 'appearance', values: { motion: true } });
  assert.equal(state.appearance.motion, true);
});
