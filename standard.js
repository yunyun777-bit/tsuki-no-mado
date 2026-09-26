import { defaultAppearance, normalizeFeatures, shortcutURL } from './features.js';
import { isPreview, searchOrNavigate } from './client.js';

const $ = id => document.getElementById(id);
let actions;
let editingId = null;
let currentState;
let undoShortcut = null;
const darkPreference = matchMedia('(prefers-color-scheme: dark)');

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function openShortcut(shortcut) {
  editingId = shortcut?.id || null;
  $('shortcut-title').textContent = shortcut ? 'ショートカットを編集' : 'ショートカットを追加';
  $('shortcut-name').value = shortcut?.name || '';
  $('shortcut-url').value = shortcut?.url || '';
  $('shortcut-error').textContent = '';
  $('shortcut-delete').hidden = !shortcut;
  $('shortcut-dialog').showModal();
  $('shortcut-name').focus();
}

function applyAppearance(appearance) {
  document.documentElement.dataset.theme = appearance.theme === 'system' ? (darkPreference.matches ? 'dark' : 'light') : appearance.theme;
  document.body.dataset.backdrop = appearance.backdrop;
  document.body.classList.toggle('has-wallpaper', !!appearance.image);
  document.body.style.setProperty('--wallpaper', appearance.image ? `url("${appearance.image}")` : 'none');
}

export function renderStandard(state) {
  normalizeFeatures(state);
  currentState = state;
  const appearance = state.appearance;
  applyAppearance(appearance);
  $('theme-select').value = appearance.theme;
  $('backdrop-select').value = appearance.backdrop;
  $('show-shortcuts').checked = appearance.showShortcuts;
  $('shortcut-mode').value = appearance.shortcutMode;
  $('background-clear').disabled = !appearance.image;
  $('shortcuts-area').hidden = !appearance.showShortcuts;
  const frequent = appearance.shortcutMode === 'frequent';
  const sites = frequent
    ? Object.values(state.sites).filter(site => !state.hidden.includes(site.origin) && site.visits.length)
      .sort((a, b) => b.visits.length - a.visits.length || a.origin.localeCompare(b.origin)).slice(0, 10)
      .map(site => ({ url: site.origin, name: new URL(site.origin).hostname.replace(/^www\./, '') }))
    : state.shortcuts;
  $('shortcuts-note').hidden = !frequent || sites.length > 0;
  const tiles = sites.map((shortcut, index) => {
    const tile = element('div', 'shortcut-tile');
    const link = element('a', 'shortcut-link'); link.href = shortcut.url;
    link.title = shortcut.url;
    const icon = element('span', 'shortcut-icon', shortcut.name.slice(0, 1).toUpperCase()); icon.setAttribute('aria-hidden', 'true');
    link.append(icon, element('span', 'shortcut-name', shortcut.name));
    tile.append(link);
    if (!frequent) {
      const tools = element('div', 'shortcut-tools');
      const edit = element('button', '', '⋮'); edit.setAttribute('aria-label', `${shortcut.name}のショートカットを編集`);
      edit.addEventListener('click', () => openShortcut(shortcut)); tools.append(edit);
      for (const [direction, label, symbol, disabled] of [['left','前へ','‹',index === 0],['right','後ろへ','›',index === sites.length - 1]]) {
        const move = element('button', '', symbol); move.disabled = disabled;
        move.setAttribute('aria-label', `${shortcut.name}を${label}移動`);
        move.addEventListener('click', () => actions.mutate({ type: 'shortcut-move', id: shortcut.id, direction }));
        tools.append(move);
      }
      tile.append(tools);
    }
    return tile;
  });
  if (!frequent && sites.length < 10) {
    const add = element('button', 'shortcut-tile shortcut-add');
    const icon = element('span', 'shortcut-icon', '＋'); icon.setAttribute('aria-hidden', 'true');
    add.append(icon, element('span', 'shortcut-name', 'ショートカットを追加'));
    add.addEventListener('click', () => openShortcut()); tiles.push(add);
  }
  $('shortcuts-grid').replaceChildren(...tiles);
}

export function setupStandard(handlers) {
  actions = handlers;
  if (isPreview) $('search-note').textContent = 'プレビューではGoogle検索を使います。拡張機能ではChromeの設定に従います。';
  $('web-search-form').addEventListener('submit', async event => {
    event.preventDefault();
    try { await searchOrNavigate($('web-search').value); }
    catch (error) { actions.toast(error.message); }
  });
  $('apps-open').addEventListener('click', () => $('apps-dialog').showModal());
  $('customize-open').addEventListener('click', () => $('customize-dialog').showModal());
  $('shortcut-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const url = shortcutURL($('shortcut-url').value);
      if (await actions.mutate({ type: 'shortcut-save', id: editingId, name: $('shortcut-name').value, url }, 'ショートカットを保存しました')) $('shortcut-dialog').close();
    } catch (error) { $('shortcut-error').textContent = error.message; }
  });
  $('shortcut-delete').addEventListener('click', async () => {
    const deleted = actions.getState()?.shortcuts.find(item => item.id === editingId);
    if (await actions.mutate({ type: 'shortcut-delete', id: editingId }, 'ショートカットを削除しました')) {
      undoShortcut = deleted; $('shortcut-dialog').close();
      if (deleted) {
        const undo = element('button', 'undo-button', '元に戻す');
        undo.addEventListener('click', async () => {
          if (undoShortcut && await actions.mutate({ type: 'shortcut-save', name: undoShortcut.name, url: undoShortcut.url }, 'ショートカットを戻しました')) undoShortcut = null;
        });
        $('toast').append(' ', undo);
      }
    }
  });
  for (const [id, key] of [['theme-select','theme'],['backdrop-select','backdrop'],['shortcut-mode','shortcutMode']])
    $(id).addEventListener('change', () => actions.mutate({ type: 'appearance', values: { [key]: $(id).value, ...(key === 'backdrop' ? { image: '' } : {}) } }));
  $('show-shortcuts').addEventListener('change', () => actions.mutate({ type: 'appearance', values: { showShortcuts: $('show-shortcuts').checked } }));
  $('background-clear').addEventListener('click', () => actions.mutate({ type: 'appearance', values: { image: '' } }, '背景画像を削除しました'));
  $('appearance-reset').addEventListener('click', () => actions.mutate({ type: 'appearance', values: defaultAppearance() }, '見た目を標準に戻しました'));
  $('background-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('2MB以下のPNG・JPEG・WebP画像を選んでください。');
      const image = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('画像を読み込めませんでした。')); reader.readAsDataURL(file);
      });
      const decoded = new Image(); decoded.src = image; await decoded.decode();
      await actions.mutate({ type: 'appearance', values: { image } }, '背景画像を変更しました');
    } catch (error) { actions.toast(error.message); }
    finally { event.target.value = ''; }
  });
  darkPreference.addEventListener('change', () => { if (currentState) applyAppearance(currentState.appearance); });
}
