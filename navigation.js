const DAY = 86_400_000;
export const CONTEXT_AGE = 30 * 60_000;
export const MAX_EDGES = 600;
export const MAX_EVENTS = 120;
export const MAX_RECENT = 500;

function originOf(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

export function navigationState(state) {
  return state.navigation ||= { edges: [], recent: [] };
}

export function clearNavigationContext(state) {
  navigationState(state).recent = [];
}

export function mergeNavigation(state, imported, now = Date.now()) {
  const data = navigationState(state);
  for (const incoming of imported.edges) {
    let edge = data.edges.find(item => item.from === incoming.from && item.to === incoming.to);
    if (!edge) { edge = { from: incoming.from, to: incoming.to, events: [] }; data.edges.push(edge); }
    const events = [...edge.events, ...incoming.events].sort((a, b) => a.time - b.time);
    edge.events = [];
    for (const event of events) {
      const previous = edge.events.at(-1);
      if (!previous || event.time - previous.time >= 10 * 60_000) edge.events.push(event);
      else if (event.kind === 'link') previous.kind = 'link';
    }
  }
  data.recent = [...new Map([...imported.recent, ...data.recent].map(item => [item.id, item])).values()]
    .sort((a, b) => a.time - b.time);
  data.importedAt = now;
  delete data.importFailed;
  pruneNavigation(state, now);
}

export function pruneNavigation(state, now = Date.now()) {
  const data = navigationState(state);
  const allowed = origin => Boolean(state.sites[origin]) && !state.hidden.includes(origin);
  data.recent = data.recent.filter(item => allowed(item.origin) && item.time <= now && item.time >= now - CONTEXT_AGE).slice(-MAX_RECENT);
  data.edges = data.edges.filter(edge => {
    edge.events = edge.events.filter(event => event.time <= now && event.time >= now - 90 * DAY).slice(-MAX_EVENTS);
    return allowed(edge.from) && allowed(edge.to) && edge.events.length;
  }).sort((a, b) => b.events.at(-1).time - a.events.at(-1).time).slice(0, MAX_EDGES);
  return data;
}

// Raw page URLs are reduced to origins before anything reaches storage.
// A visit ID identifies one observation even if Chrome emits the event twice.
export function recordNavigation(state, visit, now = Date.now()) {
  const data = navigationState(state);
  const origin = originOf(visit.url), time = visit.visitTime;
  if (!origin || !state.sites[origin] || state.hidden.includes(origin) || visit.isLocal === false
    || !Number.isFinite(time) || time > now || time < now - 90 * DAY
    || !visit.visitId || ['reload', 'auto_subframe', 'manual_subframe', 'auto_toplevel'].includes(visit.transition)
    || data.recent.some(item => item.id === visit.visitId)) return false;
  const previous = data.recent.at(-1);
  // Late delivery must not invent a backward sequence or replace the latest context.
  if (previous && time < previous.time) return false;
  const referrer = data.recent.find(item => item.id === visit.referringVisitId);
  let source = referrer, kind = 'link';
  if (!referrer || visit.transition !== 'link') {
    source = previous;
    kind = 'sequence';
  }
  const gap = source ? time - source.time : Infinity;
  if (source && source.origin !== origin && gap > 0 && gap <= (kind === 'link' ? CONTEXT_AGE : 5 * 60_000)) {
    let edge = data.edges.find(item => item.from === source.origin && item.to === origin);
    if (!edge) { edge = { from: source.origin, to: origin, events: [] }; data.edges.push(edge); }
    // Repeated redirects and rapid back-and-forth visits count once per ten minutes.
    if (!edge.events.some(event => Math.abs(event.time - time) < 10 * 60_000)) edge.events.push({ time, kind });
    edge.events = edge.events.slice(-MAX_EVENTS);
  }
  data.recent.push({ id: visit.visitId, origin, time });
  data.recent = data.recent.filter(item => item.time >= time - CONTEXT_AGE).slice(-MAX_RECENT);
  if (data.edges.length > MAX_EDGES) data.edges.sort((a, b) => b.events.at(-1).time - a.events.at(-1).time).splice(MAX_EDGES);
  return true;
}

export function navigationSource(state, now = Date.now()) {
  if (!state.learning) return '';
  const latest = state.navigation?.recent.at(-1);
  return latest && latest.time <= now && latest.time >= now - CONTEXT_AGE
    && !state.hidden.includes(latest.origin) && !(state.snoozed?.[latest.origin] > now) ? latest.origin : '';
}

export function rankNextSites(state, source, ranked, now = Date.now()) {
  if (!source || state.hidden.includes(source) || state.snoozed?.[source] > now) return [];
  const candidates = new Map(ranked.map(site => [site.origin, site]));
  return (state.navigation?.edges || []).filter(edge => edge.from === source && candidates.has(edge.to)).flatMap(edge => {
    let weight = 0, direct = 0, sequential = 0;
    for (const event of edge.events) {
      const age = now - event.time;
      if (age < 0 || age > 90 * DAY) continue;
      if (event.kind === 'link') direct++; else sequential++;
      weight += (event.kind === 'link' ? 1 : .25) * Math.exp(-Math.LN2 * age / (14 * DAY));
    }
    // One accidental adjacency is not enough to advertise a habit.
    if (!direct && sequential < 2) return [];
    const site = candidates.get(edge.to);
    return [{ ...site, routeScore: 2 * Math.log1p(weight) + .15 * site.score,
      reason: direct ? 'このサイトからリンクで移動' : 'このサイトの後に続けて利用' }];
  }).sort((a, b) => b.routeScore - a.routeScore || a.origin.localeCompare(b.origin));
}
