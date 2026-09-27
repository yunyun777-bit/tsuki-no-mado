import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, recordVisit, rankSites, editState, prune, DAY } from '../model.js';
import { recordNavigation, rankNextSites, navigationSource, clearNavigationContext, MAX_RECENT, MAX_EDGES, MAX_EVENTS } from '../navigation.js';
import { createBackup } from '../backup.js';

const now = 1_790_000_000_000;
function setup() { const state = emptyState(); state.learning = true; return state; }
function visit(state, host, id, time, ref = '', transition = 'link', extra = {}) {
  const url = `https://${host}.test/private?secret=never-store`;
  recordVisit(state, url, time, now);
  return recordNavigation(state, { url, visitId: id, visitTime: time, referringVisitId: ref, transition, ...extra }, now);
}
function next(state, source = 'https://a.test', time = now) { return rankNextSites(state, source, rankSites(state, time), time); }

test('direct referrer wins over interleaved tabs; origins only and duplicate events ignored', () => {
  const state = setup();
  visit(state, 'a', '1', now - 180_000, '', 'typed');
  visit(state, 'unrelated', '2', now - 120_000, '', 'typed');
  visit(state, 'b', '3', now - 60_000, '1');
  visit(state, 'b', '3', now - 60_000, '1');
  assert.equal(next(state)[0].origin, 'https://b.test');
  assert.equal(next(state)[0].reason, 'このサイトからリンクで移動');
  assert.equal(state.navigation.edges.find(edge => edge.to === 'https://b.test').events.length, 1);
  assert.equal(next(state, 'https://unrelated.test').length, 0);
  assert.doesNotMatch(JSON.stringify(state.navigation), /private|secret|never-store/);
  assert.equal(navigationSource(state, now), 'https://b.test');
  assert.equal(navigationSource(state, now + 31 * 60_000), '');
  assert.equal(createBackup(state).navigation, undefined);
  assert.doesNotMatch(JSON.stringify(createBackup(state)), /navigation|referringVisitId|events/);
});

test('weak sequences need repeated evidence and never count long gaps or backwards delivery', () => {
  const state = setup();
  visit(state, 'a', '1', now - DAY);
  visit(state, 'b', '2', now - DAY + 60_000, '', 'typed');
  assert.equal(next(state).length, 0);
  visit(state, 'a', '3', now - 120_000);
  visit(state, 'b', '4', now - 60_000, '', 'typed');
  assert.equal(next(state)[0].reason, 'このサイトの後に続けて利用');
  assert.equal(visit(state, 'c', 'late', now - 100_000), false);
  assert.equal(navigationSource(state, now), 'https://b.test');
  const isolated = setup();
  visit(isolated, 'a', 'a', now - 31 * 60_000);
  visit(isolated, 'b', 'b', now, 'a');
  assert.deepEqual(isolated.navigation.edges, []);
});

test('reloads, subframes, other devices, credentials, hidden sites and same-site navigation do not add routes', () => {
  const state = setup();
  visit(state, 'a', '1', now - 120_000);
  for (const transition of ['reload', 'auto_subframe', 'manual_subframe', 'auto_toplevel']) visit(state, 'b', transition, now - 60_000, '1', transition);
  visit(state, 'b', 'remote', now - 60_000, '1', 'link', { isLocal: false });
  visit(state, 'a', 'same', now - 60_000, '1');
  visit(state, 'b', 'secret', now, 'same', 'link', { url: 'https://user:password@b.test' });
  assert.deepEqual(state.navigation.edges, []);
});

test('snooze filters both ends, hiding erases incident edges; expiration preserves settings', () => {
  const state = setup();
  visit(state, 'a', '1', now - 120_000);
  visit(state, 'b', '2', now - 60_000, '1');
  editState(state, { type: 'snooze', origin: 'https://b.test', duration: 'week' }, now);
  assert.equal(next(state).length, 0);
  editState(state, { type: 'unsnooze', origin: 'https://b.test' }, now);
  assert.equal(next(state).length, 1);
  editState(state, { type: 'snooze', origin: 'https://a.test', duration: 'week' }, now);
  assert.equal(next(state).length, 0);
  editState(state, { type: 'hide', origin: 'https://a.test' }, now);
  assert.deepEqual(state.navigation.edges, []);
  assert.equal(state.navigation.recent.some(item => item.origin === 'https://a.test'), false);
  const expired = setup();
  visit(expired, 'a', '1', now - 120_000);
  visit(expired, 'b', '2', now - 60_000, '1');
  editState(expired, { type: 'pin', origin: 'https://a.test' }, now);
  prune(expired, now + 91 * DAY);
  assert.deepEqual(expired.navigation, { edges: [], recent: [] });
  assert.deepEqual(expired.pins, ['https://a.test']);
});

test('pause clears context without deleting routes; resume does not bridge the pause', () => {
  const state = setup();
  visit(state, 'a', '1', now - 120_000);
  visit(state, 'b', '2', now - 60_000, '1');
  state.learning = false; clearNavigationContext(state);
  assert.equal(navigationSource(state, now), '');
  assert.equal(next(state).length, 1);
  state.learning = true; visit(state, 'c', '3', now, '2');
  assert.equal(state.navigation.edges.length, 1);
});

test('legacy state works without routes; ranking favors direct evidence and recent routes', () => {
  const state = setup();
  assert.deepEqual(next(state), []);
  for (let day = 3; day >= 1; day--) {
    visit(state, 'a', `a${day}`, now - day * DAY);
    visit(state, 'b', `b${day}`, now - day * DAY + 60_000, '', 'typed');
  }
  visit(state, 'a', 'a0', now - 120_000);
  visit(state, 'c', 'c0', now - 60_000, 'a0');
  assert.equal(next(state)[0].origin, 'https://c.test');
});

test('route, event and recent-ID storage have finite bounds', () => {
  const repeated = setup();
  for (let index = 0; index < MAX_EVENTS + 10; index++) {
    const time = now - (MAX_EVENTS + 10 - index) * 20 * 60_000;
    visit(repeated, 'a', `from${index}`, time);
    visit(repeated, 'b', `to${index}`, time + 1000, `from${index}`);
  }
  assert.equal(repeated.navigation.edges[0].events.length, MAX_EVENTS);
  const state = setup();
  for (let index = 0; index < MAX_RECENT + 10; index++) visit(state, 'a', String(index), now - MAX_RECENT * 1000 + index * 500);
  assert.equal(state.navigation.recent.length, MAX_RECENT);
  for (let index = 0; index < MAX_EDGES + 10; index++) {
    const from = `https://from${index}.test`, to = `https://to${index}.test`;
    state.sites[from] = { origin: from, visits: [] }; state.sites[to] = { origin: to, visits: [] };
    recordNavigation(state, { url: from, visitId: `f${index}`, visitTime: now - 10_000 + index * 2, transition: 'typed' }, now);
    recordNavigation(state, { url: to, visitId: `t${index}`, referringVisitId: `f${index}`, visitTime: now - 9_999 + index * 2, transition: 'link' }, now);
  }
  assert.ok(state.navigation.edges.length <= MAX_EDGES);
  assert.ok(state.navigation.edges.every(edge => edge.events.length <= MAX_EVENTS));
});
