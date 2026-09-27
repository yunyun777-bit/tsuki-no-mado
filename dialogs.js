const states = new Map();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function stop(state) {
  state.revision++;
  for (const animation of state.animations) animation.cancel();
  state.animations = [];
}

function finishAll() {
  for (const state of states.values()) for (const animation of state.animations) animation.finish();
}

function restoreOrigin(state) {
  state.origin?.classList.remove('dialog-origin-hidden');
  state.origin?.setAttribute('aria-expanded', 'false');
}

function focusOrigin(state) {
  const original = state.returnFocus || state.origin;
  const live = original?.isConnected ? original
    : original?.id ? document.getElementById(original.id)
      : original?.getAttribute('aria-label') ? document.querySelector(`[aria-label="${CSS.escape(original.getAttribute('aria-label'))}"]`) : null;
  if (live?.getClientRects().length) live.focus({ preventScroll: true });
  else document.getElementById('web-search')?.focus({ preventScroll: true });
}

function stateFor(dialog) {
  if (states.has(dialog)) return states.get(dialog);
  const state = { revision: 0, animations: [], closing: false, restoreFocus: true };
  states.set(dialog, state);
  dialog.tabIndex = -1;
  const heading = dialog.querySelector('h2');
  if (heading && !dialog.hasAttribute('aria-labelledby')) {
    heading.id ||= `${dialog.id}-title`;
    dialog.setAttribute('aria-labelledby', heading.id);
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); void closeDialog(dialog); });
  dialog.addEventListener('close', () => {
    // Ignore a queued close event if another action has already reopened this dialog.
    if (dialog.open) return;
    stop(state); state.closing = false;
    delete dialog.dataset.transition;
    for (const child of dialog.children) child.inert = false;
    restoreOrigin(state);
    if (state.restoreFocus) focusOrigin(state);
  });
  return state;
}

async function animate(dialog, state, source, target, opening) {
  const revision = state.revision;
  const children = [...dialog.children];
  const opacity = children.map(child => getComputedStyle(child).opacity);
  for (const child of children) child.inert = true;
  dialog.focus({ preventScroll: true });
  const complete = () => {
    if (revision !== state.revision) return;
    stop(state);
    delete dialog.dataset.transition;
    for (const child of children) child.inert = false;
    if (opening) (state.focusTarget || dialog.querySelector('button:not(:disabled),input:not(:disabled),textarea,select,a[href]'))?.focus({ preventScroll: true });
    else dialog.close();
  };
  if (document.body.dataset.motion !== 'on' || reducedMotion.matches || !source?.width || !source.height || !target?.width || !target.height) {
    complete(); return;
  }
  const base = dialog.getBoundingClientRect();
  const radius = parseFloat(getComputedStyle(dialog).borderTopLeftRadius) || 18;
  const frame = (rect, corner) => {
    const x = rect.width / base.width, y = rect.height / base.height;
    return { transform: `translate(${rect.left - base.left}px, ${rect.top - base.top}px) scale(${x}, ${y})`, borderRadius: `${corner / x}px / ${corner / y}px` };
  };
  dialog.dataset.transition = opening ? 'opening' : 'closing';
  const duration = dialog.classList.contains('note-dialog') ? (opening ? 420 : 300) : (opening ? 180 : 140);
  dialog.style.setProperty('--dialog-duration', `${duration}ms`);
  try {
    state.animations.push(dialog.animate([frame(source, opening ? 12 : radius), frame(target, opening ? radius : 12)],
      { duration, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' }));
    for (const [i, child] of children.entries()) {
      state.animations.push(child.animate(opening
        ? [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .3 }, { opacity: 1, offset: 1 }]
        : [{ opacity: opacity[i], offset: 0 }, { opacity: 0, offset: .55 }, { opacity: 0, offset: 1 }],
      { duration, easing: 'ease-out', fill: 'both' }));
    }
    await Promise.all(state.animations.map(animation => animation.finished.catch(() => {})));
  } catch {
    // A failed visual effect must never prevent opening, saving or closing.
  } finally { complete(); }
}

export function openDialog(dialog, origin = document.activeElement, options = {}) {
  if (dialog.open) return;
  const state = stateFor(dialog);
  stop(state);
  Object.assign(state, { origin, source: options.source || origin?.getBoundingClientRect(), focusTarget: options.focusTarget,
    returnFocus: options.returnFocus, closing: false, restoreFocus: true });
  dialog.showModal();
  origin?.classList.add('dialog-origin-hidden');
  origin?.setAttribute('aria-expanded', 'true');
  void animate(dialog, state, state.source, dialog.getBoundingClientRect(), true);
}

export function closeDialog(dialog, { immediate = false, restoreFocus = true } = {}) {
  if (!dialog.open) return;
  const state = stateFor(dialog);
  if (state.closing && !immediate) return;
  const source = dialog.getBoundingClientRect();
  stop(state); state.closing = true; state.restoreFocus = restoreFocus;
  if (immediate) {
    restoreOrigin(state);
    for (const child of dialog.children) child.inert = false;
    delete dialog.dataset.transition;
    dialog.close(); return;
  }
  const target = state.origin?.isConnected && state.origin.getClientRects().length ? state.origin.getBoundingClientRect() : state.source;
  return animate(dialog, state, source, target, false);
}

export function replaceDialog(previous, next, origin = document.activeElement) {
  const source = origin.getBoundingClientRect();
  const returnFocus = states.get(previous)?.origin;
  closeDialog(previous, { immediate: true, restoreFocus: false });
  openDialog(next, origin, { source, returnFocus });
}

export function syncDialogMotion() {
  if (document.body.dataset.motion !== 'on') finishAll();
}

reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) finishAll(); });
window.addEventListener('resize', finishAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) finishAll(); });
