import { emptyState, recordVisit, prune, editState, DAY } from './model.js';
import { normalizeFeatures } from './features.js';
import { recordNavigation, clearNavigationContext, mergeNavigation, navigationState } from './navigation.js';

let queue = Promise.resolve();
function exclusive(task) {
  const operation = queue.then(task);
  queue = operation.catch(() => {});
  return operation;
}
async function read() { return normalizeFeatures((await chrome.storage.local.get('tabloom')).tabloom || emptyState()); }
async function save(state) { await chrome.storage.local.set({ tabloom: state }); }

async function historyVisits(now) {
  const startTime = now - 30 * DAY;
  const pages = await chrome.history.search({ text: '', startTime, maxResults: 250 });
  const visits = [];
  // 検索対象は最大250ページ。最初の読み込みを有限に保つ。
  for (let i = 0; i < pages.length; i += 10) {
    const batches = await Promise.all(pages.slice(i, i + 10).map(async page => {
      const history = await chrome.history.getVisits({ url: page.url });
      return history.filter(visit => visit.visitTime >= startTime && !['reload', 'auto_subframe'].includes(visit.transition))
        .map(visit => ({ ...visit, url: page.url, time: visit.visitTime }));
    }));
    visits.push(...batches.flat());
  }
  visits.sort((a, b) => a.time - b.time);
  return visits;
}

async function importHistory(state) {
  const now = Date.now();
  const visits = await historyVisits(now);
  for (const visit of visits) {
    recordVisit(state, visit.url, visit.time, now);
    recordNavigation(state, visit, now);
  }
  state.importedAt = now;
  navigationState(state).importedAt = now;
  return prune(state, now);
}

async function importNavigation(state) {
  const now = Date.now();
  const visits = await historyVisits(now);
  if (!(await chrome.permissions.contains({ permissions: ['history'] }))) throw new Error('履歴の許可が必要です。');
  // Backfill only routes between existing sites; preserve visits, preferences and newer routes.
  const draft = { ...state, navigation: { edges: [], recent: [] } };
  for (const visit of visits) recordNavigation(draft, visit, now);
  mergeNavigation(state, draft.navigation, now);
}

async function handle(message) {
  if (message.type === 'get') {
    const state = prune(await read());
    state.learning = state.learning && await chrome.permissions.contains({ permissions: ['history'] });
    if (state.learning && state.importedAt && !state.navigation.importedAt && !state.navigation.importFailed) {
      try { await importNavigation(state); }
      catch { state.navigation.importFailed = true; }
    }
    if (!state.learning) clearNavigationContext(state);
    await save(state);
    return state;
  }
  if (message.type === 'reset') {
    await chrome.permissions.remove({ permissions: ['history'] });
    await chrome.storage.local.clear();
    return emptyState();
  }
  const state = await read();
  if (message.type === 'enable') {
    if (!(await chrome.permissions.contains({ permissions: ['history'] }))) throw new Error('履歴の許可が必要です。');
    registerHistoryListeners();
    state.learning = true;
    if (!state.importedAt) await importHistory(state);
    else if (!state.navigation?.importedAt) await importNavigation(state);
  } else if (message.type === 'navigation-import') {
    if (!state.learning || !(await chrome.permissions.contains({ permissions: ['history'] }))) throw new Error('履歴からの学習を有効にしてください。');
    await importNavigation(state);
  } else if (message.type === 'pause') {
    state.learning = false;
    clearNavigationContext(state);
    await chrome.permissions.remove({ permissions: ['history'] });
  } else editState(state, message);
  await save(state);
  return state;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  exclusive(() => handle(message)).then(state => respond({ state }), error => respond({ error: error.message }));
  return true;
});

function onHistoryVisited(item) {
  exclusive(async () => {
    const state = await read();
    if (!state.learning || !(await chrome.permissions.contains({ permissions: ['history'] }))) return;
    recordVisit(state, item.url, item.lastVisitTime || Date.now());
    try {
      const visits = await chrome.history.getVisits({ url: item.url });
      for (const visit of visits.filter(visit => visit.visitTime === item.lastVisitTime)) {
        recordNavigation(state, { ...visit, url: item.url });
      }
    } catch { /* Keep the ordinary recommendation if visit details are unavailable. */ }
    if (!(await chrome.permissions.contains({ permissions: ['history'] }))) {
      state.learning = false;
      clearNavigationContext(state);
    }
    await save(prune(state));
  }).catch(() => {});
}

function onHistoryRemoved() {
  exclusive(async () => {
    const state = await read();
    // URLを永続保存しないため、一部履歴の削除でも学習した訪問記録を全消去する。
    for (const site of Object.values(state.sites)) site.visits = [];
    state.navigation = { edges: [], recent: [] };
    state.importedAt = null;
    await save(prune(state));
  }).catch(() => {});
}

function registerHistoryListeners() {
  // Optional APIs are absent before permission is granted. Register synchronously
  // on worker startup when available, and again when the grant arrives.
  const history = chrome.history;
  if (!history) return;
  if (!history.onVisited.hasListener(onHistoryVisited)) history.onVisited.addListener(onHistoryVisited);
  if (!history.onVisitRemoved.hasListener(onHistoryRemoved)) history.onVisitRemoved.addListener(onHistoryRemoved);
}

registerHistoryListeners();
chrome.permissions.onAdded.addListener(permissions => {
  if (permissions.permissions?.includes('history')) registerHistoryListeners();
});

chrome.permissions.onRemoved.addListener(permissions => {
  if (permissions.permissions?.includes('history')) exclusive(async () => {
    const state = await read(); state.learning = false; clearNavigationContext(state); await save(state);
  }).catch(() => {});
});
