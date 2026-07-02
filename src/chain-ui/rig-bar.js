// src/chain-ui/rig-bar.js
// "Rig bar": when BOTH the amp and the pedalboard are collapsed, their two slim
// strips (the amp value strip + the board mini strip) dock side by side into one
// row so the whole rig reads in ~60px of height. When either panel expands the
// layout returns to normal. This is purely presentational — a single body-level
// class derived from the two collapse states — so it's cheap and unit-testable.

// True only when both panels are collapsed (so their strips can share one row).
export function isRigDocked(ampCollapsed, boardCollapsed) {
  return !!(ampCollapsed && boardCollapsed);
}

// Reflect the docked state onto a body element (the CSS keys off `.rig-docked`).
// `body` is injectable for tests. Returns the docked boolean.
export function applyRigDock(ampCollapsed, boardCollapsed, body) {
  const el = body || (typeof document !== 'undefined' ? document.body : null);
  const docked = isRigDocked(ampCollapsed, boardCollapsed);
  if (el) el.classList.toggle('rig-docked', docked);
  return docked;
}
