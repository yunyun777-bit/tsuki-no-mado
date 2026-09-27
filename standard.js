import { openDialog, closeDialog, syncDialogMotion } from './dialogs.js';
import { defaultAppearance, normalizeFeatures, shortcutURL } from './features.js';
import { isPreview, searchOrNavigate } from './client.js';
import { createSiteIcon } from './icons.js';
import { atmosphere, moonPath } from './atmosphere.js';

const $ = id => document.getElementById(id);
let actions;
let editingId = null;
let currentState;
let undoShortcut = null;
let firstRender = true;
const darkPreference = matchMedia('(prefers-color-scheme: dark)');

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function openShortcut(shortcut, trigger) {
  editingId = shortcut?.id || null;
  $('shortcut-title').textContent = shortcut ? 'ページのショートカットを編集' : 'ページのショートカットを追加';
  $('shortcut-name').value = shortcut?.name || '';
  $('shortcut-url').value = shortcut?.url || '';
  $('shortcut-group').replaceChildren(...currentState.groups.map(group => new Option(group.name, group.id)));
  $('shortcut-group').value = shortcut?.groupId || currentState.activeGroup;
  $('shortcut-error').textContent = '';
  $('shortcut-delete').hidden = !shortcut;
  openDialog($('shortcut-dialog'), trigger, { focusTarget: $('shortcut-name') });
}

function applyAppearance(appearance) {
  const sky = atmosphere(appearance, darkPreference.matches);
  document.documentElement.dataset.theme = sky.theme;
  for (const [i, name] of ['top', 'middle', 'bottom'].entries())
    document.body.style.setProperty(`--sky-${name}`, `rgb(${sky.colors[i].join(',')})`);
  const phasePath = moonPath(sky.phase);
  $('moon-lit').setAttribute('d', phasePath);
  $('moon-clip-shape').setAttribute('d', phasePath);
  document.body.dataset.backdrop = appearance.backdrop;
  document.body.dataset.motion = appearance.motion ? 'on' : 'off';
  syncDialogMotion();
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
  $('show-motion').checked = appearance.motion;
  $('shortcut-mode').value = appearance.shortcutMode;
  $('background-clear').disabled = !appearance.image;
  $('shortcuts-area').hidden = !appearance.showShortcuts;
  const frequent = appearance.shortcutMode === 'frequent';
  const sites = frequent
    ? Object.values(state.sites).filter(site => !state.hidden.includes(site.origin) && site.visits.length && !(state.snoozed[site.origin] > Date.now()))
      .sort((a, b) => b.visits.length - a.visits.length || a.origin.localeCompare(b.origin)).slice(0, 10)
      .map(site => ({ url: site.origin, name: new URL(site.origin).hostname.replace(/^www\./, '') }))
    : state.shortcuts.filter(item => item.groupId === state.activeGroup);
  $('shortcuts-note').hidden = !frequent || sites.length > 0;
  const tiles = sites.map((shortcut, index) => {
    const tile = element('div', 'shortcut-tile');
    if (firstRender) tile.classList.add('arrive');
    tile.style.setProperty('--arrival-delay', `${index * 55}ms`);
    const link = element('a', 'shortcut-link'); link.href = shortcut.url;
    link.title = shortcut.url;
    const icon = createSiteIcon(shortcut.url, shortcut.name, 'shortcut-icon');
    link.append(icon, element('span', 'shortcut-name', shortcut.name));
    tile.append(link);
    if (!frequent) {
      const tools = element('div', 'shortcut-tools');
      const edit = element('button', '', '⋮'); edit.setAttribute('aria-label', `${shortcut.name}のショートカットを編集`);
      edit.addEventListener('click', event => openShortcut(shortcut, event.currentTarget)); tools.append(edit);
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
    add.setAttribute('aria-label', 'ページのショートカットを追加');
    add.append(icon, element('span', 'shortcut-name', 'ページを追加'));
    add.addEventListener('click', event => openShortcut(undefined, event.currentTarget)); tiles.push(add);
  }
  $('shortcuts-grid').replaceChildren(...tiles);
  firstRender = false;
}

export function setupStandard(handlers) {
  actions = handlers;
  if (isPreview) $('search-note').textContent = 'プレビューではGoogle検索を使います。拡張機能ではChromeの設定に従います。';
  $('web-search-form').addEventListener('submit', async event => {
    event.preventDefault();
    try { await searchOrNavigate($('web-search').value); }
    catch (error) { actions.toast(error.message); }
  });
  $('apps-open').addEventListener('click', event => openDialog($('apps-dialog'), event.currentTarget));
  $('customize-open').addEventListener('click', event => openDialog($('customize-dialog'), event.currentTarget));
  $('shortcut-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const url = shortcutURL($('shortcut-url').value);
      if (await actions.mutate({ type: 'shortcut-save', id: editingId, name: $('shortcut-name').value, url, groupId: $('shortcut-group').value }, 'ショートカットを保存しました')) closeDialog($('shortcut-dialog'));
    } catch (error) { $('shortcut-error').textContent = error.message; }
  });
  $('shortcut-delete').addEventListener('click', async () => {
    const deleted = actions.getState()?.shortcuts.find(item => item.id === editingId);
    if (await actions.mutate({ type: 'shortcut-delete', id: editingId }, 'ショートカットを削除しました')) {
      undoShortcut = deleted; closeDialog($('shortcut-dialog'));
      if (deleted) {
        const undo = element('button', 'undo-button', '元に戻す');
        undo.addEventListener('click', async () => {
          if (undoShortcut && await actions.mutate({ type: 'shortcut-save', name: undoShortcut.name, url: undoShortcut.url, groupId: undoShortcut.groupId }, 'ショートカットを戻しました')) undoShortcut = null;
        });
        $('toast').append(' ', undo);
      }
    }
  });
  for (const [id, key] of [['theme-select','theme'],['backdrop-select','backdrop'],['shortcut-mode','shortcutMode']])
    $(id).addEventListener('change', () => actions.mutate({ type: 'appearance', values: { [key]: $(id).value, ...(key === 'backdrop' ? { image: '' } : {}) } }));
  $('show-shortcuts').addEventListener('change', () => actions.mutate({ type: 'appearance', values: { showShortcuts: $('show-shortcuts').checked } }));
  $('show-motion').addEventListener('change', () => actions.mutate({ type: 'appearance', values: { motion: $('show-motion').checked } }));
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
  const updateVisibility = () => { document.documentElement.dataset.pageHidden = String(document.hidden); };
  document.addEventListener('visibilitychange', updateVisibility);
  updateVisibility();
  // Keep already-open tabs current without rebuilding cards or losing focus.
  setInterval(() => {
    if (document.visibilityState === 'visible' && currentState) applyAppearance(currentState.appearance);
  }, 60_000);
}
