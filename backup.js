import { normalizeFeatures, editFeatures, shortcutURL } from './features.js';

export const BACKUP_LIMIT = 4_000_000;
export function createBackup(state) {
  const copy = normalizeFeatures(structuredClone(state));
  return { format: 'tsuki-no-mado-settings', version: 1, settings: {
    groups: copy.groups, activeGroup: copy.activeGroup, shortcuts: copy.shortcuts,
    appearance: copy.appearance, dailyNote: copy.dailyNote, pins: copy.pins,
  } };
}

// Only explicitly supported configuration fields enter storage. Never import permissions or history.
export function validateBackup(value) {
  const fail = () => { throw new Error('対応する月の窓の設定バックアップではありません。'); };
  if (!value || value.format !== 'tsuki-no-mado-settings' || value.version !== 1) fail();
  const data = value.settings;
  if (!data || !Array.isArray(data.groups) || data.groups.length < 1 || data.groups.length > 8 ||
      !Array.isArray(data.shortcuts) || data.shortcuts.length > 80 || !Array.isArray(data.pins) || data.pins.length > 8) fail();
  const ids = new Set();
  const groups = data.groups.map(group => {
    if (!group || typeof group.id !== 'string' || !/^[\w-]{1,80}$/.test(group.id) || ids.has(group.id) ||
        typeof group.name !== 'string' || !group.name.trim() || group.name.length > 24) fail();
    ids.add(group.id); return { id: group.id, name: group.name.trim() };
  });
  if (!ids.has(data.activeGroup)) fail();
  const shortcutIds = new Set();
  const counts = new Map();
  const shortcuts = data.shortcuts.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[\w-]{1,80}$/.test(item.id) || shortcutIds.has(item.id) || !ids.has(item.groupId) ||
        typeof item.name !== 'string' || item.name.length > 60 || typeof item.url !== 'string' || item.url.length > 2048) fail();
    shortcutIds.add(item.id); counts.set(item.groupId, (counts.get(item.groupId) || 0) + 1);
    if (counts.get(item.groupId) > 10) fail();
    return { id: item.id, name: item.name, url: shortcutURL(item.url), groupId: item.groupId };
  });
  const pins = data.pins.map(value => {
    if (typeof value !== 'string') fail();
    const url = new URL(shortcutURL(value));
    if (url.origin !== value) fail();
    return value;
  });
  if (new Set(pins).size !== pins.length || !data.appearance || typeof data.appearance !== 'object' || Array.isArray(data.appearance)) fail();
  for (const key of ['showShortcuts', 'motion', 'collapsePins', 'collapseRecommended', 'showNote']) {
    if (key in data.appearance && typeof data.appearance[key] !== 'boolean') fail();
  }
  const scratch = normalizeFeatures({});
  editFeatures(scratch, { type: 'appearance', values: data.appearance });
  editFeatures(scratch, { type: 'daily-note', text: data.dailyNote });
  return { groups, activeGroup: data.activeGroup, shortcuts, pins, appearance: scratch.appearance, dailyNote: scratch.dailyNote };
}

export function restoreBackup(state, value) {
  const settings = validateBackup(value);
  if (new Set([...Object.keys(state.sites), ...settings.pins]).size > 300) throw new Error('固定サイトの復元で登録上限を超えます。不要なサイトを整理してください。');
  // Validate everything before mutating the state; keep existing visit records and permission state.
  for (const origin of settings.pins) state.sites[origin] ||= { origin, visits: [], manual: true };
  state.hidden = state.hidden.filter(origin => !settings.pins.includes(origin));
  for (const origin of settings.pins) delete state.snoozed?.[origin];
  Object.assign(state, settings);
  return state;
}
