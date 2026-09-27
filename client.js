import { emptyState, recordVisit, editState, DAY } from './model.js';
import { searchAction } from './features.js';
import { recordNavigation, clearNavigationContext } from './navigation.js';

export const isPreview = !globalThis.chrome?.runtime?.id;
let demo = emptyState();
if (isPreview) {
  const now = Date.now();
  const examples = [
    ['https://github.com', 21], ['https://developer.mozilla.org', 17],
    ['https://www.notion.so', 14], ['https://chatgpt.com', 12],
    ['https://calendar.google.com', 9], ['https://www.figma.com', 8],
    ['https://zenn.dev', 6], ['https://www.youtube.com', 4],
    ['https://mail.google.com', 18], ['https://www.wikipedia.org', 3],
  ];
  for (const [url, count] of examples) {
    for (let day = 1; day <= count; day++) recordVisit(demo, url, now - day * DAY, now);
  }
  demo.pins = ['https://github.com', 'https://www.notion.so'];
  demo.learning = true;
  for (let day = 3; day >= 0; day--) {
    const time = now - day * DAY - 120_000;
    recordNavigation(demo, { url: 'https://github.com', visitId: `github-${day}`, visitTime: time, transition: 'typed' }, now);
    recordNavigation(demo, { url: 'https://developer.mozilla.org', visitId: `mdn-${day}`, referringVisitId: `github-${day}`, visitTime: time + 30_000, transition: 'link' }, now);
    recordNavigation(demo, { url: 'https://zenn.dev', visitId: `zenn-${day}`, referringVisitId: `github-${day}`, visitTime: time + 60_000, transition: 'link' }, now);
  }
  recordNavigation(demo, { url: 'https://github.com', visitId: 'github-now', visitTime: now, transition: 'typed' }, now);
  demo.shortcuts = [
    { id: 'demo-mail', name: 'Gmail', url: 'https://mail.google.com/mail/u/0/' },
    { id: 'demo-drive', name: 'Google Drive', url: 'https://drive.google.com/drive/my-drive' },
    { id: 'demo-github', name: 'GitHub', url: 'https://github.com/' },
  ];
}

export async function command(message) {
  if (!isPreview) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response || response.error) throw new Error(response?.error || '拡張機能との接続に失敗しました。');
    return response.state;
  }
  if (message.type === 'reset') demo = emptyState();
  else if (message.type === 'pause') { demo.learning = false; clearNavigationContext(demo); }
  else if (message.type === 'enable') demo.learning = true;
  else if (message.type === 'navigation-import') { demo.navigation ||= { edges: [], recent: [] }; demo.navigation.importedAt = Date.now(); delete demo.navigation.importFailed; }
  else if (message.type !== 'get') editState(demo, message);
  return structuredClone(demo);
}

export async function requestHistory() {
  return isPreview || chrome.permissions.request({ permissions: ['history'] });
}

export async function searchOrNavigate(value, { navigate = url => location.assign(url), search = info => chrome.search.query(info) } = {}) {
  const action = searchAction(value);
  if (!action) return;
  if (action.type === 'navigate') return navigate(action.url);
  if (isPreview) return navigate(`https://www.google.com/search?q=${encodeURIComponent(action.text)}`);
  return search({ text: action.text, disposition: 'CURRENT_TAB' });
}
