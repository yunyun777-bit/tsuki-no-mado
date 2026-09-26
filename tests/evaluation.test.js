import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVisits } from '../scripts/evaluation.js';

const event = (site, minutes) => ({ url: `https://${site}.test/private?secret=hidden`, time: Date.UTC(2026, 0, 1) + minutes * 60_000 });

test('evaluation predicts before learning and counts unseen destinations as misses', () => {
  const result = evaluateVisits([event('a', 0), event('b', 20), event('b', 40)], { topK: 8, warmup: 1 });
  assert.equal(result.evaluatedEvents, 2);
  assert.equal(result.unseenSiteEvents, 1);
  assert.equal(result.weighted.hitRate, 0.5);
  assert.equal(result.frequency.hitRate, 0.5);
  assert.doesNotMatch(JSON.stringify(result), /hidden|\.test|secret/);
});

test('simultaneous events cannot learn from each other; input order is irrelevant', () => {
  const input = [event('a', 0), event('b', 20), event('c', 20), event('b', 20)];
  const result = evaluateVisits(input, { warmup: 1 });
  assert.deepEqual(evaluateVisits([...input].reverse(), { warmup: 1 }), result);
  assert.equal(result.evaluatedEvents, 2);
  assert.equal(result.unseenSiteEvents, 2);
  assert.equal(result.weighted.hits, 0);
  assert.equal(result.skippedBursts, 1);
});

test('evaluation applies navigation deduplication and reports insufficient data honestly', () => {
  const result = evaluateVisits([event('a', 0), event('a', 1), { url: 'file:///secret', time: 1 }, { url: 'https://b.test', time: 'bad' }]);
  assert.equal(result.invalidEvents, 2);
  assert.equal(result.skippedBursts, 1);
  assert.equal(result.evaluatedEvents, 0);
  assert.equal(result.weighted.hitRate, null);
});

test('frequency baseline obeys the same retention window as weighted ranking', () => {
  const result = evaluateVisits([event('a', 0), event('a', 91 * 24 * 60)], { warmup: 1 });
  assert.equal(result.unseenSiteEvents, 1);
  assert.equal(result.weighted.hits, 0);
  assert.equal(result.frequency.hits, 0);
});
