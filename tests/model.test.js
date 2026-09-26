import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, emptyState, siteOrigin, recordVisit, rankSites, prune, editState } from '../model.js';

const now = new Date(2026, 8, 27, 10, 0).getTime();
test('URLs retain only HTTP(S) origins and reject credentials and executable schemes', () => {
  assert.equal(siteOrigin('https://example.com/private?token=secret#fragment'), 'https://example.com');
  for (const input of ['javascript:alert(1)', 'file:///secret', 'https://user:password@example.com', 'not a URL']) assert.equal(siteOrigin(input), null);
});
test('navigation bursts do not inflate a site; hidden sites never learn', () => {
  const state = emptyState();
  assert.ok(recordVisit(state, 'https://example.com/a', now, now));
  assert.equal(recordVisit(state, 'https://example.com/b', now - 60_000, now), false);
  editState(state, { type: 'hide', origin: 'https://example.com' }, now);
  assert.equal(recordVisit(state, 'https://example.com/c', now, now), false);
  assert.equal(Object.keys(state.sites).length, 0);
});
test('equal-frequency sites rank higher near their habitual time', () => {
  const state = emptyState();
  for (let i = 1; i <= 7; i++) {
    recordVisit(state, 'https://morning.test', now - i * DAY, now);
    recordVisit(state, 'https://evening.test', now - i * DAY + 10 * 3_600_000, now);
  }
  assert.equal(rankSites(state, now)[0].origin, 'https://morning.test');
  assert.equal(rankSites(state, now + 10 * 3_600_000)[0].origin, 'https://evening.test');
});
test('recent habits outweigh equally frequent old habits', () => {
  const state = emptyState();
  for (let i = 1; i <= 7; i++) {
    recordVisit(state, 'https://recent.test', now - i * DAY, now);
    recordVisit(state, 'https://old.test', now - (i + 50) * DAY, now);
  }
  assert.equal(rankSites(state, now)[0].origin, 'https://recent.test');
});
test('retention expires visits but preserves manual and pinned entries', () => {
  const state = emptyState();
  for (const host of ['old.test','manual.test','pinned.test']) recordVisit(state, `https://${host}`, now, now);
  editState(state, { type: 'add', origin: 'https://manual.test' }, now);
  editState(state, { type: 'pin', origin: 'https://pinned.test' }, now);
  prune(state, now + 91 * DAY);
  assert.equal(state.sites['https://old.test'], undefined);
  assert.deepEqual(state.sites['https://manual.test'].visits, []);
  assert.deepEqual(state.pins, ['https://pinned.test']);
  assert.equal(rankSites(state, now + 91 * DAY).length, 2);
});
test('manual add reverses hide without recovering deleted history', () => {
  const state = emptyState();
  recordVisit(state, 'https://example.com', now, now);
  editState(state, { type: 'hide', origin: 'https://example.com' }, now);
  editState(state, { type: 'add', origin: 'https://example.com' }, now);
  assert.deepEqual(state.hidden, []);
  assert.deepEqual(state.sites['https://example.com'].visits, []);
});
test('midnight proximity is circular and invalid visits never rank', () => {
  const midnight = new Date(2026, 8, 27, 0, 0).getTime();
  const state = emptyState();
  recordVisit(state, 'https://night.test', midnight - 3600_000, midnight);
  assert.equal(rankSites(state, midnight)[0].reason, 'この時間帯によく利用');
  assert.equal(recordVisit(state, 'https://future.test', midnight + DAY, midnight), false);
  assert.equal(recordVisit(state, 'https://expired.test', midnight - 91 * DAY, midnight), false);
});
