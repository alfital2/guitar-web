// src/chain-store.js
// Persistence behind a single interface. localStorage now; a DB backend can
// replace the internals later without changing callers.
const KEY = 'gs-chain';
const REVERB_KEY = 'gs-amp-reverb';
const PRESETS_HIDDEN_KEY = 'gs-presets-hidden';
const AMP_COLLAPSED_KEY = 'gs-amp-collapsed';
const BOARD_COLLAPSED_KEY = 'gs-board-collapsed';

export function save(chain) {
  try {
    const data = chain.map((u) => ({ type: u.type, params: u.params, bypassed: !!u.bypassed }));
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {}
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

// Amp reverb (separate from the pedal chain). { size, mix } or null.
export function saveReverb(reverb) {
  try { localStorage.setItem(REVERB_KEY, JSON.stringify(reverb)); } catch {}
}

export function loadReverb() {
  try {
    const raw = localStorage.getItem(REVERB_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw);
    return (r && typeof r.mix === 'number') ? r : null;
  } catch {
    return null;
  }
}

// Preset-browser collapsed state (wide screens).
export function savePresetsHidden(hidden) {
  try { localStorage.setItem(PRESETS_HIDDEN_KEY, hidden ? '1' : '0'); } catch {}
}

export function loadPresetsHidden() {
  try { return localStorage.getItem(PRESETS_HIDDEN_KEY) === '1'; } catch { return false; }
}

// Amp collapsed-to-value-strip state. Defaults to collapsed (true) so the amp
// stays compact until the user chooses to tune it.
export function saveAmpCollapsed(collapsed) {
  try { localStorage.setItem(AMP_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch {}
}

export function loadAmpCollapsed() {
  try {
    const v = localStorage.getItem(AMP_COLLAPSED_KEY);
    return v === null ? true : v === '1';
  } catch { return true; }
}

// Pedalboard collapsed-to-mini-strip state. Defaults to expanded (false) so
// the full board is visible until the user folds it after tuning.
export function saveBoardCollapsed(collapsed) {
  try { localStorage.setItem(BOARD_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch {}
}

export function loadBoardCollapsed() {
  try { return localStorage.getItem(BOARD_COLLAPSED_KEY) === '1'; } catch { return false; }
}
