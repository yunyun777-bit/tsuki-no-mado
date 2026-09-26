import { emptyState, siteOrigin, recordVisit, prune, rankSites } from '../model.js';

// Replay in time order. Predict before learning any event at the same timestamp.
export function evaluateVisits(input, { topK = 8, warmup = 20 } = {}) {
  if (!Array.isArray(input)) throw new Error('入力は訪問イベントの配列にしてください。');
  if (!Number.isInteger(topK) || topK < 1 || !Number.isInteger(warmup) || warmup < 0)
    throw new Error('topKとwarmupが無効です。');
  const visits = input.map(item => ({ origin: siteOrigin(item?.url), time: item?.time }))
    .filter(item => item.origin && Number.isFinite(item.time))
    .sort((a, b) => a.time - b.time || a.origin.localeCompare(b.origin));
  const state = emptyState();
  let learned = 0, evaluated = 0, skippedBursts = 0, coldStarts = 0, smallCandidateSets = 0;
  let weightedHits = 0, frequencyHits = 0;
  for (let index = 0; index < visits.length;) {
    const time = visits[index].time;
    prune(state, time);
    const group = new Set();
    while (index < visits.length && visits[index].time === time) {
      const { origin } = visits[index++];
      if (group.has(origin) || state.sites[origin]?.visits.some(previous => time - previous < 600_000)) skippedBursts++;
      else group.add(origin);
    }
    if (learned >= warmup && group.size) {
      const weighted = rankSites(state, time).slice(0, topK).map(site => site.origin);
      const frequency = Object.values(state.sites)
        .sort((a, b) => b.visits.length - a.visits.length || a.origin.localeCompare(b.origin))
        .slice(0, topK).map(site => site.origin);
      for (const origin of group) {
        evaluated++;
        if (!state.sites[origin]) coldStarts++;
        if (Object.keys(state.sites).length <= topK) smallCandidateSets++;
        if (weighted.includes(origin)) weightedHits++;
        if (frequency.includes(origin)) frequencyHits++;
      }
    }
    for (const origin of group) {
      recordVisit(state, origin, time, time);
      learned++;
    }
    prune(state, time);
  }
  return {
    topK, warmup, inputEvents: input.length, invalidEvents: input.length - visits.length,
    acceptedEvents: learned, skippedBursts, evaluatedEvents: evaluated,
    unseenSiteEvents: coldStarts, eventsWithAtMostKCandidates: smallCandidateSets,
    weighted: { hits: weightedHits, hitRate: evaluated ? weightedHits / evaluated : null },
    frequency: { hits: frequencyHits, hitRate: evaluated ? frequencyHits / evaluated : null },
  };
}

export function syntheticVisits() {
  const visits = [];
  for (let day = 1; day <= 28; day++) {
    for (let slot = 0; slot < 12; slot++) {
      const site = day < 15 ? slot : (slot + 4) % 12;
      visits.push({ url: `https://site-${site}.test`, time: new Date(2026, 0, day, 7 + slot).getTime() });
    }
  }
  return visits;
}
