// src/chain-ui/auto-fold.js
// Auto-fold state machine. Tuning happens BEFORE a take; during recording or
// playback the tracks deserve the vertical space, so the amp + pedalboard fold
// into the rig bar while transport is active and restore afterwards.
//
// The restore is the crux: it puts each panel back to the collapse state the
// user had BEFORE transport started — so a panel the user had already collapsed
// manually stays collapsed (we never blindly expand it). The prior state is
// snapshotted on the first fold and restored on the matching restore; repeated
// fold()/restore() calls are idempotent, so overlapping transport events (e.g.
// a play that stops a record) never double-fold or lose the original state.
//
// `getState()` returns the current `{ amp, board }` collapse booleans.
// `setState({ amp, board }, restoring)` applies them (and, when `restoring`,
// persists them so storage matches the user's real preference again). Both are
// injected so this module carries no DOM/audio knowledge and tests cleanly.
export function createAutoFold({ getState, setState }) {
  let prior = null; // saved user state while folded; null when not folded

  return {
    isFolded: () => prior !== null,

    // Transport became active — fold both panels into the rig bar. No-op (and no
    // thrash) if already folded.
    fold() {
      if (prior !== null) return false;
      prior = getState();
      setState({ amp: true, board: true }, false);
      return true;
    },

    // Transport went idle — restore each panel to its pre-transport state.
    restore() {
      if (prior === null) return false;
      const s = prior;
      prior = null;
      setState({ amp: s.amp, board: s.board }, true);
      return true;
    },
  };
}
