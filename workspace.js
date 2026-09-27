import { openDialog, closeDialog, replaceDialog } from './dialogs.js';
import { createBackup, validateBackup, BACKUP_LIMIT } from './backup.js';
import { NOTE_LIMIT } from './features.js';

const $ = id => document.getElementById(id);
let actions, editingGroup, snoozeOrigin, pendingBackup;
let noteDirty = false;
let groupSignature = '';
function updateNotePreview() {
  const text = $('daily-note').value;
  $('note-preview').textContent = text.trim().replace(/\s+/g, ' ').slice(0, 90) || '必要なときに、広げて書く';
  $('note-indicator').textContent = noteDirty ? '未保存 · 展開' : '展開';
  $('note-count').textContent = `${text.length.toLocaleString('ja-JP')} / ${NOTE_LIMIT.toLocaleString('ja-JP')}文字`;
}

export function openSnooze(origin, trigger) {
  snoozeOrigin = origin;
  $('snooze-site').textContent = new URL(origin).hostname;
  openDialog($('snooze-dialog'), trigger);
}

export function renderWorkspace(state) {
  const signature = JSON.stringify(state.groups);
  if (signature !== groupSignature) {
    $('group-select').replaceChildren(...state.groups.map(group => new Option(group.name, group.id)));
    groupSignature = signature;
  }
  $('group-select').value = state.activeGroup;
  $('group-controls').hidden = state.appearance.shortcutMode !== 'custom';
  $('group-add').disabled = state.groups.length >= 8;
  $('note-area').hidden = !state.appearance.showNote;
  if (!noteDirty) $('daily-note').value = state.dailyNote;
  updateNotePreview();
  $('show-note').checked = state.appearance.showNote;
  $('recommend-count-select').value = String(state.appearance.recommendCount);
  for (const [key, button, content] of [['collapsePins', 'collapse-pins', 'pinned'], ['collapseRecommended', 'collapse-recommended', 'recommend-content']]) {
    $(content).hidden = state.appearance[key];
    $(button).textContent = state.appearance[key] ? '開く' : '折りたたむ';
    $(button).setAttribute('aria-expanded', String(!state.appearance[key]));
  }
  const entries = Object.entries(state.snoozed).filter(([, until]) => until > Date.now());
  $('snoozed-list').replaceChildren();
  if (!entries.length) $('snoozed-list').textContent = '一時非表示のサイトはありません。';
  for (const [origin, until] of entries) {
    const row = document.createElement('div'); row.className = 'snoozed-row';
    const label = document.createElement('span');
    label.textContent = `${new URL(origin).hostname} · ${new Date(until).toLocaleString('ja-JP')}まで`;
    const button = document.createElement('button'); button.className = 'button secondary'; button.textContent = '戻す';
    button.setAttribute('aria-label', `${new URL(origin).hostname}の一時非表示を解除`);
    button.addEventListener('click', () => actions.mutate({ type: 'unsnooze', origin }, '候補に戻しました'));
    row.append(label, button); $('snoozed-list').append(row);
  }
}

function openGroup(edit, trigger) {
  const state = actions.getState();
  if (!state) return;
  editingGroup = edit ? state.activeGroup : null;
  $('group-title').textContent = edit ? 'グループを編集' : 'グループを追加';
  $('group-name').value = edit ? state.groups.find(group => group.id === editingGroup).name : '';
  $('group-error').textContent = '';
  $('group-delete').hidden = !edit;
  $('group-delete').disabled = state.groups.length === 1 || state.shortcuts.some(item => item.groupId === editingGroup);
  openDialog($('group-dialog'), trigger, { focusTarget: $('group-name') });
}

function exportSettings() {
  const state = actions.getState();
  if (!state) return;
  const blob = new Blob([JSON.stringify(createBackup(state), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url;
  anchor.download = `tsuki-no-mado-settings-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  actions.toast('設定ファイルのダウンロードを開始しました');
}

export function setupWorkspace(handlers) {
  actions = handlers;
  $('group-select').addEventListener('change', () => actions.mutate({ type: 'group-select', id: $('group-select').value }));
  $('group-add').addEventListener('click', event => openGroup(false, event.currentTarget));
  $('group-edit').addEventListener('click', event => openGroup(true, event.currentTarget));
  $('group-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (await actions.mutate({ type: 'group-save', id: editingGroup, name: $('group-name').value }, 'グループを保存しました')) closeDialog($('group-dialog'));
  });
  $('group-delete').addEventListener('click', async () => {
    if (await actions.mutate({ type: 'group-delete', id: editingGroup }, '空のグループを削除しました')) closeDialog($('group-dialog'));
  });
  $('daily-note').maxLength = NOTE_LIMIT;
  $('note-open').addEventListener('click', () => {
    if (!actions.getState()) return;
    $('note-error').textContent = '';
    openDialog($('note-dialog'), $('note-open'), { focusTarget: $('daily-note') });
  });
  $('note-fold').addEventListener('click', () => { void closeDialog($('note-dialog')); });
  $('note-dialog').addEventListener('close', updateNotePreview);
  $('daily-note').addEventListener('input', () => {
    noteDirty = $('daily-note').value !== actions.getState()?.dailyNote;
    $('note-status').textContent = noteDirty ? '未保存です。閉じても、このタブでは下書きを保持します。' : '保存済み';
    $('note-error').textContent = '';
    updateNotePreview();
  });
  $('daily-note').addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
      event.preventDefault();
      if (!$('note-save').disabled) $('note-form').requestSubmit();
    }
  });
  window.addEventListener('beforeunload', event => {
    if (noteDirty) { event.preventDefault(); event.returnValue = ''; }
  });
  $('note-form').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('note-save').disabled) return;
    const text = $('daily-note').value;
    $('note-save').disabled = true;
    $('note-error').textContent = '';
    try {
      if (await actions.mutate({ type: 'daily-note', text })) {
        // Preserve any further typing that occurred while storage was being written.
        if ($('daily-note').value === text) { noteDirty = false; $('daily-note').value = actions.getState().dailyNote; }
        $('note-status').textContent = noteDirty ? '未保存の変更があります。' : '保存しました。変更するまで残ります。';
      } else if (!$('note-error').textContent) $('note-error').textContent = '保存できませんでした。もう一度保存してください。';
    } finally { $('note-save').disabled = false; updateNotePreview(); }
  });
  for (const [id, duration] of [['snooze-today', 'today'], ['snooze-week', 'week']]) {
    $(id).addEventListener('click', async () => {
      if (await actions.mutate({ type: 'snooze', origin: snoozeOrigin, duration }, '一時非表示にしました。設定からいつでも戻せます')) closeDialog($('snooze-dialog'));
    });
  }
  for (const [id, key] of [['collapse-pins', 'collapsePins'], ['collapse-recommended', 'collapseRecommended']]) {
    $(id).addEventListener('click', () => actions.mutate({ type: 'appearance', values: { [key]: !actions.getState().appearance[key] } }));
  }
  $('recommend-count-select').addEventListener('change', () => actions.mutate({ type: 'appearance', values: { recommendCount: Number($('recommend-count-select').value) } }));
  $('show-note').addEventListener('change', () => actions.mutate({ type: 'appearance', values: { showNote: $('show-note').checked } }));
  $('backup-export').addEventListener('click', exportSettings);
  $('backup-save-current').addEventListener('click', exportSettings);
  $('backup-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    pendingBackup = null; $('backup-error').textContent = '';
    try {
      if (file.size > BACKUP_LIMIT) throw new Error('4MB以下の設定ファイルを選んでください。');
      const parsed = JSON.parse(await file.text());
      const settings = validateBackup(parsed);
      if (settings.appearance.image) {
        const image = new Image(); image.src = settings.appearance.image;
        try { await image.decode(); } catch { throw new Error('バックアップの背景画像を読み込めませんでした。'); }
      }
      pendingBackup = { format: parsed.format, version: parsed.version, settings };
      $('backup-summary').textContent = `${settings.groups.length}グループ、${settings.shortcuts.length}件のショートカット、${settings.pins.length}件の固定サイトを復元します。`;
      $('backup-restore-error').textContent = '';
      replaceDialog($('settings-dialog'), $('backup-dialog'), $('backup-file'));
    } catch (error) { $('backup-error').textContent = `読み込めませんでした: ${error.message}`; }
    finally { event.target.value = ''; }
  });
  $('backup-confirm').addEventListener('click', async () => {
    if (!pendingBackup) return;
    if (await actions.mutate({ type: 'backup-restore', backup: pendingBackup }, '設定を復元しました')) {
      noteDirty = false; renderWorkspace(actions.getState()); closeDialog($('backup-dialog'));
    }
  });
  $('backup-dialog').addEventListener('close', () => { pendingBackup = null; });
  $('reset-confirm').addEventListener('click', async () => {
    if (await actions.mutate({ type: 'reset' }, 'データを削除しました')) {
      // A rejected or failed reset must keep the draft and its unload protection.
      noteDirty = false;
      $('note-status').textContent = '保存すると、この端末に残ります。';
      $('note-error').textContent = '';
      renderWorkspace(actions.getState());
      closeDialog($('reset-dialog'));
    }
  });
}
