import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../model.js';

test('reset keeps the memo draft until success, including failed and busy requests', async t => {
  class Element {
    value = '';
    textContent = '';
    listeners = new Map();
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener); this.listeners.set(type, listeners);
    }
    async fire(type, event = {}) {
      for (const listener of this.listeners.get(type) || []) await listener(event);
    }
    replaceChildren() {}
    setAttribute() {}
  }
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  globalThis.document = { getElementById: get, addEventListener() {} };
  globalThis.window = new Element();
  globalThis.matchMedia = () => new Element();
  globalThis.Option = class {};
  t.after(() => { for (const key of ['document', 'window', 'matchMedia', 'Option']) delete globalThis[key]; });
  const { setupWorkspace, renderWorkspace } = await import('../workspace.js');
  let state = emptyState(); state.dailyNote = '保存済みのメモ';
  let complete;
  setupWorkspace({
    getState: () => state,
    mutate: async message => {
      assert.equal(message.type, 'reset');
      const success = await new Promise(resolve => { complete = resolve; });
      if (success) state = emptyState();
      // Both the success and failure branches of newtab.mutate render their state.
      renderWorkspace(state);
      return success;
    },
  });
  renderWorkspace(state);
  get('daily-note').value = '失いたくない下書き\n続き';
  await get('daily-note').fire('input');

  async function expectsUnloadProtection(expected) {
    let prevented = false;
    await window.fire('beforeunload', { preventDefault() { prevented = true; } });
    assert.equal(prevented, expected);
  }

  // A failed request and a request rejected as busy both return false.
  for (let attempt = 0; attempt < 2; attempt++) {
    const pending = get('reset-confirm').fire('click');
    renderWorkspace(state);
    assert.equal(get('daily-note').value, '失いたくない下書き\n続き');
    await expectsUnloadProtection(true);
    complete(false); await pending;
    assert.equal(get('daily-note').value, '失いたくない下書き\n続き');
    assert.equal(get('note-indicator').textContent, '未保存 · 展開');
    await expectsUnloadProtection(true);
  }

  const pending = get('reset-confirm').fire('click');
  await expectsUnloadProtection(true);
  complete(true); await pending;
  assert.equal(get('daily-note').value, '');
  assert.equal(get('note-indicator').textContent, '展開');
  assert.equal(get('note-preview').textContent, '必要なときに、広げて書く');
  await expectsUnloadProtection(false);
});
