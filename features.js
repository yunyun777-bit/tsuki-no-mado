export function defaultAppearance() {
  return { theme: 'system', backdrop: 'plain', image: '', showShortcuts: true, shortcutMode: 'custom' };
}

export function normalizeFeatures(state) {
  state.shortcuts ||= [];
  state.appearance = { ...defaultAppearance(), ...state.appearance };
  return state;
}

export function shortcutURL(value) {
  let text = String(value || '').trim();
  if (!text || /[\u0000-\u001f\u007f]/.test(text)) throw new Error('有効なURLを入力してください。');
  if (!/^[a-z][a-z\d+.-]*:/i.test(text)) text = `https://${text}`;
  let url;
  try { url = new URL(text); } catch { throw new Error('有効なURLを入力してください。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('ユーザー情報を含まない http または https のURLを入力してください。');
  return url.href;
}

export function searchAction(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^(javascript|data|file|vbscript|chrome|chrome-extension):/i.test(text))
    throw new Error('この種類のURLはアドレスバーから開いてください。');
  const explicit = /^https?:\/\//i.test(text);
  const address = !/\s/.test(text) && /^(localhost(?::\d+)?|\[[\da-f:]+\](?::\d+)?|[^/?#:]+\.[^/?#:]+(?::\d+)?)(?:[/?#]|$)/i.test(text);
  if (explicit || address) {
    const url = shortcutURL(explicit ? text : `https://${text}`);
    return { type: 'navigate', url };
  }
  return { type: 'search', text };
}

export function editFeatures(state, action) {
  normalizeFeatures(state);
  if (action.type === 'shortcut-save') {
    const url = shortcutURL(action.url);
    const name = String(action.name || '').trim().slice(0, 60) || new URL(url).hostname;
    const index = state.shortcuts.findIndex(item => item.id === action.id);
    if (index < 0 && state.shortcuts.length >= 10) throw new Error('ショートカットは10件まで登録できます。');
    if (index >= 0) state.shortcuts[index] = { id: action.id, name, url };
    else state.shortcuts.push({ id: crypto.randomUUID(), name, url });
    return true;
  }
  if (action.type === 'shortcut-delete') {
    state.shortcuts = state.shortcuts.filter(item => item.id !== action.id);
    return true;
  }
  if (action.type === 'shortcut-move') {
    const index = state.shortcuts.findIndex(item => item.id === action.id);
    const next = index + (action.direction === 'left' ? -1 : 1);
    if (index >= 0 && next >= 0 && next < state.shortcuts.length)
      [state.shortcuts[index], state.shortcuts[next]] = [state.shortcuts[next], state.shortcuts[index]];
    return true;
  }
  if (action.type === 'appearance') {
    const patch = action.values || {};
    const updated = { ...state.appearance };
    if ('theme' in patch) {
      if (!['system', 'light', 'dark'].includes(patch.theme)) throw new Error('無効なテーマです。');
      updated.theme = patch.theme;
    }
    if ('backdrop' in patch) {
      if (!['plain','forest','sky','sand'].includes(patch.backdrop)) throw new Error('無効な背景です。');
      updated.backdrop = patch.backdrop;
    }
    if ('image' in patch) {
      if (patch.image !== '' && (typeof patch.image !== 'string' || patch.image.length > 2_800_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z\d+/=]+$/.test(patch.image)))
        throw new Error('背景は2MB以下のPNG・JPEG・WebP画像を選んでください。');
      updated.image = patch.image;
    }
    if ('showShortcuts' in patch) updated.showShortcuts = Boolean(patch.showShortcuts);
    if ('shortcutMode' in patch) {
      if (!['custom','frequent'].includes(patch.shortcutMode)) throw new Error('無効な表示方法です。');
      updated.shortcutMode = patch.shortcutMode;
    }
    state.appearance = updated;
    return true;
  }
  return false;
}
