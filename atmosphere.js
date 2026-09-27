const DAY = 86_400_000;
const LUNATION = 29.530588853;
// Approximate decorative phase, not an astronomical ephemeris.
// USNO Circular 169: Jan 6 2000, 18:15 TDT (~18:14 UTC).
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const wrap = (value, period) => ((value % period) + period) % period;

export function moonPhase(date = new Date()) {
  return wrap((date.getTime() - NEW_MOON) / DAY, LUNATION) / LUNATION;
}

export function moonPath(phase) {
  const angle = wrap(phase, 1) * Math.PI * 2;
  const side = wrap(phase, 1) < 0.5 ? 1 : -1;
  const points = [];
  for (let i = 0; i <= 64; i++) {
    const y = -1 + i / 32;
    points.push([60 + side * 38 * Math.sqrt(Math.max(0, 1 - y * y)), 60 + y * 38]);
  }
  for (let i = 64; i >= 0; i--) {
    const y = -1 + i / 32;
    points.push([60 + side * Math.cos(angle) * 38 * Math.sqrt(Math.max(0, 1 - y * y)), 60 + y * 38]);
  }
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(3)},${y.toFixed(3)}`).join(' ') + ' Z';
}

// The stops wrap at midnight and interpolate continuously in local wall time.
const stops = [
  [0, '#18243d', '#32365c', '#455174'],
  [5, '#202f4c', '#5c577a', '#b78e9c'],
  [8, '#c4e3ee', '#edf5f5', '#f5e6cb'],
  [13, '#cee7f4', '#eef5fb', '#dfeee9'],
  [16, '#ded9f0', '#f7e6e6', '#efc8b4'],
  [18, '#756985', '#ba8b9f', '#e5b89b'],
  [21, '#18243d', '#32365c', '#455174'],
  [24, '#18243d', '#32365c', '#455174'],
];
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

export function skyColors(hour) {
  const time = wrap(hour, 24);
  const index = stops.findIndex((stop, i) => i < stops.length - 1 && time >= stop[0] && time < stops[i + 1][0]);
  const start = stops[index], end = stops[index + 1];
  const ratio = (time - start[0]) / (end[0] - start[0]);
  return [1, 2, 3].map(i => rgb(start[i]).map((c, channel) => Math.round(c + (rgb(end[i])[channel] - c) * ratio)));
}

export function atmosphere(appearance, prefersDark, date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const automaticSky = appearance.backdrop === 'time' && !appearance.image;
  const night = hour < 7 || hour >= 18;
  const dark = appearance.theme === 'dark' || (appearance.theme === 'system' && (automaticSky ? night : prefersDark));
  const colors = skyColors(hour).map(color => color.map(channel => {
    if (dark && !night) return Math.round(channel * 0.25 + 10);
    if (!dark && night) return Math.round(channel * 0.18 + 255 * 0.82);
    return channel;
  }));
  return { theme: dark ? 'dark' : 'light', colors, phase: moonPhase(date) };
}
