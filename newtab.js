import { rankSites, siteOrigin } from './model.js';
import { command, requestHistory, isPreview } from './client.js';
import { setupStandard, renderStandard } from './standard.js';
import { setupWorkspace, renderWorkspace, openSnooze } from './workspace.js';
import { createSiteIcon } from './icons.js';

const $ = id => document.getElementById(id);
let state;
let busy = false;
let toastTimer;
let firstRender = true;
let snoozeTimer;
const displayNames = {
  'github.com': 'GitHub', 'developer.mozilla.org': 'MDN Web Docs',
  'www.notion.so': 'Notion', 'notion.so': 'Notion', 'chatgpt.com': 'ChatGPT',
  'calendar.google.com': 'Google Calendar', 'mail.google.com': 'Gmail',
  'www.figma.com': 'Figma', 'zenn.dev': 'Zenn', 'www.youtube.com': 'YouTube',
  'www.wikipedia.org': 'Wikipedia',
};
const palettes = [['#e8eee5','#55754d'],['#e8edf4','#567694'],['#f5eee1','#a08653'],['#eeebf4','#8870a3'],['#f6e9e4','#af735b']];

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000);
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function siteCard(site, pinned, index) {
  const host = new URL(site.origin).hostname;
  const label = displayNames[host] || host.replace(/^www\./, '');
  const card = node('article', 'site-card');
  if (firstRender) card.classList.add('arrive');
  card.style.setProperty('--arrival-delay', `${index * 55}ms`);
  const link = node('a', 'site-link'); link.href = site.origin;
  const top = node('div', 'site-top');
  const icon = createSiteIcon(site.origin, label, 'site-icon');
  const hash = [...host].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const colors = palettes[hash % palettes.length];
  icon.style.setProperty('--tile-bg', colors[0]); icon.style.setProperty('--tile-color', colors[1]);
  top.append(icon, node('span', 'site-arrow', '↗'));
  link.append(top, node('div', 'site-title', label), node('div', 'site-domain', host), node('div', 'site-reason', pinned ? 'いつもの場所' : site.reason));
  const controls = node('div', 'card-tools');
  for (const [type, symbol, title] of [['pin', pinned ? '−' : '＋', pinned ? '固定を解除' : '固定する'], ['hide', '×', '非表示にする']]) {
    const button = node('button', 'card-tool', symbol); button.title = title;
    button.setAttribute('aria-label', type === 'pin' && pinned ? `${label}の固定を解除` : `${label}を${title}`);
    button.addEventListener('click', () => mutate({ type, origin: site.origin }, type === 'hide' ? 'サイトを非表示にしました' : pinned ? '固定を解除しました' : 'いつもの場所に固定しました'));
    controls.append(button);
  }
  if (!pinned) {
    const snooze = node('button', 'card-tool', '◷');
    snooze.title = '一時非表示'; snooze.setAttribute('aria-label', label + 'を一時非表示');
    snooze.addEventListener('click', () => openSnooze(site.origin)); controls.prepend(snooze);
  }
  card.append(link, controls);
  if (pinned) card.append(node('span', 'pinned-badge', 'FIXED'));
  return card;
}

function render() {
  if (!state) return;
  renderStandard(state);
  renderWorkspace(state);
  const query = $('filter').value.trim().toLowerCase();
  const matches = site => !query || `${site.origin} ${displayNames[new URL(site.origin).hostname] || ''}`.toLowerCase().includes(query);
  const ranked = rankSites(state);
  const pins = state.pins.map(origin => ranked.find(site => site.origin === origin)).filter(Boolean).filter(matches);
  const suggestions = ranked.filter(site => !state.pins.includes(site.origin)).filter(matches).slice(0, state.appearance.recommendCount);
  $('pinned').replaceChildren(...pins.map((site, index) => siteCard(site, true, index)));
  $('recommended').replaceChildren(...suggestions.map((site, index) => siteCard(site, false, index)));
  firstRender = false;
  $('pinned-section').hidden = pins.length === 0;
  $('pin-count').textContent = pins.length; $('recommend-count').textContent = suggestions.length;
  $('empty').hidden = suggestions.length > 0;
  $('empty-copy').textContent = query ? '条件に一致するサイトはありません。検索語を変えてみてください。' : state.pins.length ? '固定以外のサイトが、ここに表示されます。' : 'サイトを追加するか、閲覧履歴からおすすめを見つけましょう。';
  $('onboarding').hidden = state.learning;
  $('learning-status').textContent = state.learning ? '端末内で学習中' : '手動追加モード · 学習は停止中';
  $('learning-dot').style.background = state.learning ? '#559879' : '#9ca799';
  $('learning-toggle').textContent = state.learning ? '学習を停止する' : '学習を有効にする';
  $('hidden-count').textContent = `${state.hidden.length}件のサイトをおすすめから除外しています。`;
  $('restore').disabled = state.hidden.length === 0;
  clearTimeout(snoozeTimer);
  const nextExpiry = Math.min(...Object.values(state.snoozed).filter(until => until > Date.now()));
  if (Number.isFinite(nextExpiry)) {
    const refresh = () => {
      if (busy) snoozeTimer = setTimeout(refresh, 1000);
      else render();
    };
    snoozeTimer = setTimeout(refresh, Math.max(1, Math.min(nextExpiry - Date.now(), 2_147_483_647)));
  }
}

function setBusy(value) {
  busy = value; document.body.classList.toggle('busy', value);
  for (const id of ['enable', 'learning-toggle', 'reset-confirm']) $(id).disabled = value;
}

async function mutate(message, success) {
  if (busy) return false;
  setBusy(true);
  try { state = await command(message); render(); if (success) toast(success); return true; }
  catch (error) {
    render(); toast(error.message);
    const inlineError = document.querySelector('dialog[open] .error');
    if (inlineError) inlineError.textContent = error.message;
    return false;
  }
  finally { setBusy(false); }
}

async function enableLearning() {
  if (busy) return;
  // ユーザー操作から直接リクエストし、Chromeの権限ダイアログを表示する。
  const permission = requestHistory();
  setBusy(true);
  try {
    if (!(await permission)) { toast('履歴を許可しませんでした。手動追加で利用できます。'); return; }
    toast('履歴を端末内で読み込んでいます…');
    state = await command({ type: 'enable' }); render(); toast('おすすめの準備ができました');
  } catch (error) { toast(error.message); }
  finally { setBusy(false); }
}

$('add-open').addEventListener('click', () => { $('add-error').textContent = ''; $('add-dialog').showModal(); });
$('settings-open').addEventListener('click', () => $('settings-dialog').showModal());
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(button.dataset.close).close());
$('filter').addEventListener('input', render);
document.addEventListener('keydown', event => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) {
    event.preventDefault(); $('web-search').focus();
  }
});
$('enable').addEventListener('click', enableLearning);
$('learning-toggle').addEventListener('click', () => state.learning ? mutate({ type: 'pause' }, '学習を停止し、履歴の許可を取り消しました') : enableLearning());
$('restore').addEventListener('click', () => mutate({ type: 'restore' }, '非表示を解除しました'));
$('reset-open').addEventListener('click', () => { $('settings-dialog').close(); $('reset-dialog').showModal(); });
$('reset-confirm').addEventListener('click', async () => { if (await mutate({ type: 'reset' }, 'データを削除しました')) $('reset-dialog').close(); });
$('add-form').addEventListener('submit', async event => {
  event.preventDefault();
  let value = $('site-url').value.trim();
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) value = `https://${value}`;
  const origin = siteOrigin(value);
  if (!origin) { $('add-error').textContent = '有効な http または https のURLを入力してください。'; return; }
  if (await mutate({ type: 'add', origin }, 'サイトを追加しました')) { $('site-url').value = ''; $('add-dialog').close(); }
});

function updateDate() {
  $('date').textContent = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
}
setupStandard({ mutate, toast, getState: () => state });
setupWorkspace({ mutate, toast, getState: () => state });
updateDate();
$('demo-banner').hidden = !isPreview;
try { state = await command({ type: 'get' }); render(); }
catch (error) { toast(`読み込みに失敗しました: ${error.message}`); }
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || busy) return;
  updateDate();
  try { state = await command({ type: 'get' }); render(); } catch (error) { toast(error.message); }
});
