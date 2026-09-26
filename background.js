import { emptyState, recordVisit, prune, editState, DAY } from './model.js';
import { normalizeFeatures } from './features.js';

let queue = Promise.resolve();
function exclusive(task) {
  const operation = queue.then(task);
  queue = operation.catch(() => {});
  return operation;
}
async function read() { return normalizeFeatures((await chrome.storage.local.get('tabloom')).tabloom || emptyState()); }
async function save(state) { await chrome.storage.local.set({ tabloom: state }); }

async function importHistory(state) {
  const now = Date.now();
  const startTime = now - 30 * DAY;
  const pages = await chrome.history.search({ text: '', startTime, maxResults: 250 });
  const visits = [];
  // 検索対象は最大250ページ。最初の読み込みを有限に保つ。
  for (let i = 0; i < pages.length; i += 10) {
    const batches = await Promise.all(pages.slice(i, i + 10).map(async page => {
      const history = await chrome.history.getVisits({ url: page.url });
      return history.filter(visit => visit.visitTime >= startTime && !['reload', 'auto_subframe'].includes(visit.transition))
        .map(visit => ({ url: page.url, time: visit.visitTime }));
    }));
    visits.push(...batches.flat());
  }
  visits.sort((a, b) => a.time - b.time);
  for (const visit of visits) recordVisit(state, visit.url, visit.time, now);
  state.importedAt = now;
  return prune(state, now);
}

async function handle(message) {
  if (message.type === 'get') {
    const state = prune(await read());
    state.learning = state.learning && await chrome.permissions.contains({ permissions: ['history'] });
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
    state.learning = true;
    if (!state.importedAt) await importHistory(state);
  } else if (message.type === 'pause') {
    state.learning = false;
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

chrome.history.onVisited.addListener(item => {
  exclusive(async () => {
    const state = await read();
    if (!state.learning || !(await chrome.permissions.contains({ permissions: ['history'] }))) return;
    recordVisit(state, item.url, item.lastVisitTime || Date.now());
    await save(prune(state));
  }).catch(() => {});
});

chrome.history.onVisitRemoved.addListener(event => {
  exclusive(async () => {
    const state = await read();
    // URLを永続保存しないため、一部履歴の削除でも学習した訪問記録を全消去する。
    for (const site of Object.values(state.sites)) site.visits = [];
    state.importedAt = null;
    await save(prune(state));
  }).catch(() => {});
});

chrome.permissions.onRemoved.addListener(permissions => {
  if (permissions.permissions?.includes('history')) exclusive(async () => {
    const state = await read(); state.learning = false; await save(state);
  }).catch(() => {});
});
