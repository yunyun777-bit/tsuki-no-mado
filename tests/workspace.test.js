import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, editState, recordVisit, rankSites, prune, DAY } from '../model.js';
import { normalizeFeatures, NOTE_LIMIT } from '../features.js';
import { createBackup, validateBackup } from '../backup.js';

test('migration preserves existing shortcuts, wallpaper, history and preferences', () => {
  const state = { shortcuts: [{ id: 'old', name: 'Docs', url: 'https://example.com/a?q=b' }], appearance: { image: 'data:image/png;base64,AAAA', motion: false }, sites: { a: { visits: [42] } }, pins: ['a'], hidden: ['b'], learning: true };
  normalizeFeatures(state);
  assert.equal(state.shortcuts[0].groupId, 'default');
  assert.equal(state.groups[0].name, 'いつもの');
  assert.equal(state.shortcuts[0].url, 'https://example.com/a?q=b');
  assert.equal(state.appearance.motion, false);
  assert.equal(state.appearance.image, 'data:image/png;base64,AAAA');
  assert.deepEqual(state.sites.a.visits, [42]);
  assert.deepEqual(state.hidden, ['b']);
  const migrated = structuredClone(state); normalizeFeatures(state); assert.deepEqual(state, migrated);
});

test('groups isolate reordering and enforce destination capacity; empty deletion preserves shortcuts', () => {
  const state = emptyState();
  editState(state, { type: 'shortcut-save', url: 'https://example.com/first' });
  const first = state.shortcuts[0];
  editState(state, { type: 'group-save', name: '仕事' });
  const work = state.activeGroup;
  for (let i = 0; i < 10; i++) editState(state, { type: 'shortcut-save', url: `https://work.test/${i}` });
  assert.throws(() => editState(state, { type: 'shortcut-save', id: first.id, url: first.url, groupId: work }), /10件/);
  editState(state, { type: 'group-select', id: 'default' });
  editState(state, { type: 'shortcut-save', url: 'https://example.com/second' });
  editState(state, { type: 'shortcut-move', id: first.id, direction: 'right' });
  assert.equal(state.shortcuts.filter(item => item.groupId === 'default')[1].id, first.id);
  assert.equal(state.shortcuts.filter(item => item.groupId === work)[0].url, 'https://work.test/0');
  assert.throws(() => editState(state, { type: 'group-delete', id: work }));
  editState(state, { type: 'group-save', name: '私用' });
  const personal = state.activeGroup;
  editState(state, { type: 'shortcut-save', id: first.id, url: first.url, groupId: personal });
  assert.equal(state.shortcuts.find(item => item.id === first.id).groupId, personal);
  assert.throws(() => editState(state, { type: 'group-delete', id: 'default' }));
});

test('empty groups can be renamed and deleted; last group and group limit are protected', () => {
  const state = emptyState();
  assert.throws(() => editState(state, { type: 'group-delete', id: 'default' }));
  editState(state, { type: 'group-save', name: '仕事' });
  const id = state.activeGroup;
  editState(state, { type: 'group-save', id, name: '作業' });
  assert.equal(state.groups[1].name, '作業');
  editState(state, { type: 'group-delete', id });
  assert.equal(state.activeGroup, 'default');
  for (let i = 0; i < 7; i++) editState(state, { type: 'group-save', name: `${i}` });
  assert.throws(() => editState(state, { type: 'group-save', name: 'overflow' }));
});

test('snooze expires at local midnight or seven days and keeps recording visits', () => {
  const now = new Date(2026, 8, 27, 20, 30).getTime();
  const state = emptyState(); const origin = 'https://example.com';
  recordVisit(state, origin, now, now);
  editState(state, { type: 'snooze', origin, duration: 'today' }, now);
  const until = new Date(2026, 8, 28).getTime();
  assert.equal(state.snoozed[origin], until);
  assert.equal(rankSites(state, until - 1).length, 0);
  assert.equal(rankSites(state, until).length, 1);
  recordVisit(state, origin, now + 3600000, now + 3600000);
  assert.equal(state.sites[origin].visits.length, 2);
  editState(state, { type: 'snooze', origin, duration: 'week' }, now);
  assert.equal(state.snoozed[origin], now + 7 * DAY);
  editState(state, { type: 'unsnooze', origin }, now);
  assert.equal(rankSites(state, now).length, 1);
  editState(state, { type: 'snooze', origin, duration: 'week' }, now);
  prune(state, now + 7 * DAY);
  assert.deepEqual(state.snoozed, {});
});

test('backup round trip restores settings without exporting or replacing history or permissions', () => {
  const state = emptyState(); const now = Date.now();
  recordVisit(state, 'https://example.com', now, now);
  editState(state, { type: 'pin', origin: 'https://example.com' });
  editState(state, { type: 'group-save', name: '仕事' });
  editState(state, { type: 'shortcut-save', name: '文書', url: 'https://example.com/docs?q=1#top' });
  editState(state, { type: 'appearance', values: { recommendCount: 4, collapsePins: true, collapseRecommended: true, showNote: false } });
  editState(state, { type: 'daily-note', text: '今日の作業' });
  const backup = createBackup(state);
  assert.equal(backup.settings.sites, undefined); assert.equal(backup.settings.learning, undefined);
  const target = emptyState(); target.learning = true;
  recordVisit(target, 'https://keep.test', now, now);
  editState(target, { type: 'backup-restore', backup });
  assert.deepEqual(createBackup(target), backup);
  assert.equal(target.learning, true);
  assert.deepEqual(target.sites['https://keep.test'].visits, [now]);
  assert.deepEqual(target.sites['https://example.com'].visits, []);
});

test('invalid backups cannot partially change live state or inject unsupported fields', () => {
  const state = emptyState();
  editState(state, { type: 'shortcut-save', url: 'https://safe.test' });
  const before = structuredClone(state);
  for (const corrupt of [
    b => b.version = 999,
    b => b.settings.shortcuts[0].url = 'javascript:alert(1)',
    b => b.settings.shortcuts[0].groupId = 'missing',
    b => b.settings.groups.push(b.settings.groups[0]),
    b => b.settings.appearance.image = 'https://remote.test/image.png',
    b => b.settings.appearance.recommendCount = 100,
    b => b.settings.appearance.motion = 'false',
    b => b.settings.pins = ['https://example.com/secret'],
    b => b.settings.dailyNote = 'a'.repeat(NOTE_LIMIT + 1),
  ]) {
    const backup = createBackup(state); corrupt(backup);
    assert.throws(() => editState(state, { type: 'backup-restore', backup }));
    assert.deepEqual(state, before);
  }
  const backup = createBackup(state); backup.settings.learning = true; backup.settings.appearance.tracker = 'https://example.com';
  const validated = validateBackup(backup);
  assert.equal(validated.learning, undefined); assert.equal(validated.appearance.tracker, undefined);
});

test('note and display preferences validate without changing other saved data', () => {
  const state = emptyState();
  editState(state, { type: 'daily-note', text: '  原稿を書く  ' });
  assert.equal(state.dailyNote, '  原稿を書く  ');
  assert.throws(() => editState(state, { type: 'daily-note', text: 'a'.repeat(NOTE_LIMIT + 1) }));
  editState(state, { type: 'appearance', values: { recommendCount: 8, showNote: false } });
  assert.equal(state.dailyNote, '  原稿を書く  ');
  assert.equal(state.appearance.recommendCount, 8);
  editState(state, { type: 'daily-note', text: '' });
  assert.equal(state.dailyNote, '');
});


test('expanded memo preserves multiline whitespace, accepts the limit and round-trips through backups', () => {
  const state = emptyState();
  state.dailyNote = '以前の一行メモ';
  normalizeFeatures(state);
  assert.equal(state.dailyNote, '以前の一行メモ');
  const text = '  見出し\n\n    インデントを残す\n最後の行\n';
  editState(state, { type: 'daily-note', text });
  assert.equal(state.dailyNote, text);
  const target = emptyState();
  editState(target, { type: 'backup-restore', backup: createBackup(state) });
  assert.equal(target.dailyNote, text);
  editState(state, { type: 'daily-note', text: 'あ'.repeat(NOTE_LIMIT) });
  assert.equal(state.dailyNote.length, NOTE_LIMIT);
  assert.throws(() => editState(state, { type: 'daily-note', text: 'あ'.repeat(NOTE_LIMIT + 1) }));
  assert.equal(state.dailyNote.length, NOTE_LIMIT);
});
