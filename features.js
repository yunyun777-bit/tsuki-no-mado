export function defaultAppearance() {
  return { theme: 'system', backdrop: 'time', image: '', showShortcuts: true, shortcutMode: 'custom', motion: true, recommendCount: 12, collapsePins: false, collapseRecommended: false, showNote: true };
}

export function normalizeFeatures(state) {
  state.shortcuts ||= [];
  state.appearance = { ...defaultAppearance(), ...state.appearance };
  state.groups ||= [{ id: 'default', name: 'いつもの' }];
  if (!state.groups.some(group => group.id === state.activeGroup)) state.activeGroup = state.groups[0].id;
  for (const shortcut of state.shortcuts) shortcut.groupId ||= state.groups[0].id;
  state.snoozed ||= {};
  state.dailyNote ||= '';
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
  if (action.type === 'group-save') {
    const name = String(action.name || '').trim();
    if (!name || name.length > 24) throw new Error('グループ名は1〜24文字で入力してください。');
    const group = state.groups.find(item => item.id === action.id);
    if (group) group.name = name;
    else {
      if (state.groups.length >= 8) throw new Error('グループは8件まで登録できます。');
      const id = crypto.randomUUID(); state.groups.push({ id, name }); state.activeGroup = id;
    }
    return true;
  }
  if (action.type === 'group-select' || action.type === 'group-delete') {
    if (!state.groups.some(item => item.id === action.id)) throw new Error('グループが見つかりません。');
    if (action.type === 'group-select') state.activeGroup = action.id;
    else {
      if (state.groups.length === 1 || state.shortcuts.some(item => item.groupId === action.id)) throw new Error('最後のグループやショートカットが残っているグループは削除できません。');
      state.groups = state.groups.filter(item => item.id !== action.id);
      if (state.activeGroup === action.id) state.activeGroup = state.groups[0].id;
    }
    return true;
  }
  if (action.type === 'daily-note') {
    if (typeof action.text !== 'string' || action.text.length > 160 || /[\r\n]/.test(action.text)) throw new Error('メモは160文字以内の一行で入力してください。');
    state.dailyNote = action.text.trim(); return true;
  }
  if (action.type === 'shortcut-save') {
    const url = shortcutURL(action.url);
    const name = String(action.name || '').trim().slice(0, 60) || new URL(url).hostname;
    const index = state.shortcuts.findIndex(item => item.id === action.id);
    const groupId = action.groupId || state.shortcuts[index]?.groupId || state.activeGroup;
    if (!state.groups.some(group => group.id === groupId)) throw new Error('グループが見つかりません。');
    if (state.shortcuts.filter(item => item.groupId === groupId && item.id !== action.id).length >= 10) throw new Error('ショートカットは各グループ10件まで登録できます。');
    if (index >= 0) state.shortcuts[index] = { id: action.id, name, url, groupId };
    else state.shortcuts.push({ id: crypto.randomUUID(), name, url, groupId });
    return true;
  }
  if (action.type === 'shortcut-delete') {
    state.shortcuts = state.shortcuts.filter(item => item.id !== action.id);
    return true;
  }
  if (action.type === 'shortcut-move') {
    const index = state.shortcuts.findIndex(item => item.id === action.id);
    const peers = state.shortcuts.filter(item => item.groupId === state.shortcuts[index]?.groupId);
    const position = peers.findIndex(item => item.id === action.id);
    const neighbor = peers[position + (action.direction === 'left' ? -1 : 1)];
    const next = state.shortcuts.indexOf(neighbor);
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
      if (!['time','plain','forest','sky','sand'].includes(patch.backdrop)) throw new Error('無効な背景です。');
      updated.backdrop = patch.backdrop;
    }
    if ('image' in patch) {
      if (patch.image !== '' && (typeof patch.image !== 'string' || patch.image.length > 2_800_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z\d+/=]+$/.test(patch.image)))
        throw new Error('背景は2MB以下のPNG・JPEG・WebP画像を選んでください。');
      updated.image = patch.image;
    }
    if ('showShortcuts' in patch) updated.showShortcuts = Boolean(patch.showShortcuts);
    if ('motion' in patch) updated.motion = Boolean(patch.motion);
    for (const key of ['collapsePins', 'collapseRecommended', 'showNote']) if (key in patch) updated[key] = Boolean(patch[key]);
    if ('recommendCount' in patch) {
      if (![4, 8, 12].includes(patch.recommendCount)) throw new Error('おすすめの件数は4・8・12から選んでください。');
      updated.recommendCount = patch.recommendCount;
    }
    if ('shortcutMode' in patch) {
      if (!['custom','frequent'].includes(patch.shortcutMode)) throw new Error('無効な表示方法です。');
      updated.shortcutMode = patch.shortcutMode;
    }
    state.appearance = updated;
    return true;
  }
  return false;
}
