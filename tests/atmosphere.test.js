import test from 'node:test';
import assert from 'node:assert/strict';
import { atmosphere, skyColors, moonPhase, moonPath } from '../atmosphere.js';
import { normalizeFeatures, defaultAppearance } from '../features.js';

test('sky interpolation wraps smoothly across midnight and stays within color bounds', () => {
  assert.deepEqual(skyColors(0), skyColors(24));
  assert.deepEqual(skyColors(-1), skyColors(23));
  for (let hour = 0; hour < 24; hour += 0.1)
    for (const channel of skyColors(hour).flat()) assert.ok(channel >= 0 && channel <= 255);
  for (const hour of [5, 8, 13, 16, 18, 21, 24]) {
    const before = skyColors(hour - 0.001).flat(), after = skyColors(hour + 0.001).flat();
    assert.ok(before.every((channel, i) => Math.abs(channel - after[i]) <= 1));
  }
});

test('automatic sky uses local time while explicit theme, custom background and image retain priority', () => {
  const night = new Date(2026, 8, 27, 22), day = new Date(2026, 8, 27, 10);
  const appearance = defaultAppearance();
  assert.equal(atmosphere(appearance, false, night).theme, 'dark');
  assert.equal(atmosphere(appearance, true, day).theme, 'light');
  assert.equal(atmosphere({ ...appearance, theme: 'light' }, true, night).theme, 'light');
  assert.equal(atmosphere({ ...appearance, theme: 'dark' }, false, day).theme, 'dark');
  assert.equal(atmosphere({ ...appearance, backdrop: 'forest' }, false, night).theme, 'light');
  assert.equal(atmosphere({ ...appearance, image: 'data:image/png;base64,AAAA' }, false, night).theme, 'light');
  const saved = { appearance: { backdrop: 'plain', theme: 'dark', image: 'saved-image' } };
  normalizeFeatures(saved);
  assert.equal(saved.appearance.backdrop, 'plain');
  assert.equal(saved.appearance.image, 'saved-image');
});

test('decorative moon phase follows a complete cycle and handles dates before the epoch', () => {
  const epoch = Date.UTC(2000, 0, 6, 18, 14), period = 29.530588853 * 86_400_000;
  assert.equal(moonPhase(new Date(epoch)), 0);
  assert.ok(Math.abs(moonPhase(new Date(epoch + period / 2)) - 0.5) < 1e-8);
  assert.ok(Math.abs(moonPhase(new Date(epoch - period / 4)) - 0.75) < 1e-8);
  for (const phase of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
    const path = moonPath(phase);
    assert.doesNotMatch(path, /NaN|Infinity/);
    assert.match(path, /^M.* Z$/);
    const coordinates = [...path.matchAll(/-?\d+\.\d+/g)].map(match => Number(match[0]));
    assert.ok(coordinates.every(value => value >= 22 && value <= 98));
  }
  assert.equal(moonPath(0), moonPath(1));
});
