import { normalizeFeatures, editFeatures } from './features.js';
import { restoreBackup } from './backup.js';
import { pruneNavigation } from './navigation.js';
export const DAY = 86_400_000;
export const MAX_SITES = 300;
export const RETENTION_DAYS = 90;

export function emptyState() {
  return normalizeFeatures({ version: 1, sites: {}, pins: [], hidden: [], learning: false, importedAt: null });
}

export function siteOrigin(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch { return null; }
}

export function prune(state, now = Date.now()) {
  for (const [origin, until] of Object.entries(state.snoozed || {})) if (until <= now) delete state.snoozed[origin];
  const cutoff = now - RETENTION_DAYS * DAY;
  for (const [origin, site] of Object.entries(state.sites)) {
    site.visits = site.visits.filter(time => Number.isFinite(time) && time >= cutoff && time <= now);
    if (!site.visits.length && !site.manual && !state.pins.includes(origin)) delete state.sites[origin];
  }
  const removable = Object.values(state.sites)
    .filter(site => !site.manual && !state.pins.includes(site.origin))
    .sort((a, b) => (a.visits.at(-1) || 0) - (b.visits.at(-1) || 0));
  while (Object.keys(state.sites).length > MAX_SITES && removable.length) {
    delete state.sites[removable.shift().origin];
  }
  pruneNavigation(state, now);
  return state;
}

export function recordVisit(state, value, time = Date.now(), now = Date.now()) {
  const origin = siteOrigin(value);
  if (!origin || state.hidden.includes(origin) || !Number.isFinite(time)
    || time > now || time < now - RETENTION_DAYS * DAY) return false;
  const site = state.sites[origin] ||= { origin, visits: [], manual: false };
  // 同じサイト内の連続移動・リロードによる過大評価を抑える。
  if (site.visits.some(previous => Math.abs(previous - time) < 10 * 60_000)) return false;
  site.visits.push(time);
  site.visits.sort((a, b) => a - b);
  site.visits = site.visits.slice(-1200);
  return true;
}

export function rankSites(state, now = Date.now()) {
  const current = new Date(now);
  const currentHour = current.getHours() + current.getMinutes() / 60;
  const currentWeekend = [0, 6].includes(current.getDay());
  return Object.values(state.sites).filter(site => !state.hidden.includes(site.origin) && !(state.snoozed?.[site.origin] > now)).map(site => {
    let frequency = 0, timing = 0, weekday = 0, latest = 0;
    for (const time of site.visits) {
      const age = (now - time) / DAY;
      if (age < 0 || age > RETENTION_DAYS) continue;
      const decay = Math.exp(-Math.LN2 * age / 14);
      const date = new Date(time);
      const hour = date.getHours() + date.getMinutes() / 60;
      const distance = Math.min(Math.abs(hour - currentHour), 24 - Math.abs(hour - currentHour));
      frequency += decay;
      timing += decay * Math.exp(-(distance ** 2) / 8);
      if ([0, 6].includes(date.getDay()) === currentWeekend) weekday += decay;
      latest = Math.max(latest, time);
    }
    const recency = latest ? Math.exp(-Math.LN2 * (now - latest) / (3 * DAY)) : 0;
    const score = .9 * Math.log1p(frequency) + 1.4 * Math.log1p(timing)
      + .35 * Math.log1p(weekday) + .8 * recency + (site.manual ? .15 : 0);
    const reason = frequency === 0 ? 'あなたが追加したサイト'
      : timing / frequency > .6 ? 'この時間帯によく利用'
      : recency > .75 ? '最近アクセスしたサイト' : '繰り返し訪れるサイト';
    return { ...site, score, reason, latest };
  }).sort((a, b) => b.score - a.score || a.origin.localeCompare(b.origin));
}

export function editState(state, action, now = Date.now()) {
  if (action.type === 'backup-restore') return restoreBackup(state, action.backup);
  if (editFeatures(state, action)) return state;
  const origin = siteOrigin(action.origin);
  if (action.type === 'restore') { state.hidden = []; return state; }
  if (!origin) throw new Error('http または https のサイトURLを入力してください。');
  if (action.type === 'snooze') {
    if (!state.sites[origin]) throw new Error('サイトが見つかりません。');
    if (!['today', 'week'].includes(action.duration)) throw new Error('非表示の期間を選んでください。');
    const tomorrow = new Date(now); tomorrow.setHours(24, 0, 0, 0);
    state.snoozed[origin] = action.duration === 'today' ? tomorrow.getTime() : now + 7 * DAY;
  } else if (action.type === 'unsnooze') {
    delete state.snoozed[origin];
  } else if (action.type === 'add') {
    if (!state.sites[origin] && Object.keys(state.sites).length >= MAX_SITES)
      throw new Error('登録上限（300サイト）に達しました。不要なサイトを非表示にしてください。');
    state.sites[origin] ||= { origin, visits: [], manual: true };
    state.sites[origin].manual = true;
    state.hidden = state.hidden.filter(item => item !== origin);
    delete state.snoozed[origin];
  } else if (action.type === 'pin') {
    if (!state.sites[origin]) throw new Error('サイトが見つかりません。');
    if (state.pins.includes(origin)) state.pins = state.pins.filter(item => item !== origin);
    else {
      if (state.pins.length >= 8) throw new Error('固定できるサイトは8件までです。');
      state.pins.push(origin);
    }
  } else if (action.type === 'hide') {
    if (!state.hidden.includes(origin)) state.hidden.push(origin);
    state.pins = state.pins.filter(item => item !== origin);
    delete state.sites[origin];
    delete state.snoozed[origin];
  } else throw new Error('不明な操作です。');
  return prune(state, now);
}
