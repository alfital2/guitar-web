// tests/auto-fold.test.js — the transport auto-fold state machine: fold on
// transport start, restore each panel to its PRE-transport state on stop
// (never blindly expanding what the user had collapsed manually), with no
// thrash on repeated/overlapping transport events.
import { describe, it, expect, vi } from 'vitest';
import { createAutoFold } from '../src/chain-ui/auto-fold.js';

function harness(initial = { amp: false, board: false }) {
  let state = { ...initial };
  const setState = vi.fn((s, restoring) => { state = { ...s }; setState.lastRestoring = restoring; });
  const af = createAutoFold({ getState: () => ({ ...state }), setState });
  return { af, setState, state: () => state };
}

describe('createAutoFold', () => {
  it('fold() collapses both panels and snapshots the prior state', () => {
    const { af, setState, state } = harness({ amp: false, board: false });
    expect(af.isFolded()).toBe(false);
    expect(af.fold()).toBe(true);
    expect(af.isFolded()).toBe(true);
    expect(state()).toEqual({ amp: true, board: true });
    expect(setState).toHaveBeenCalledWith({ amp: true, board: true }, false);
  });

  it('restore() returns both panels to their pre-transport state', () => {
    const { af, setState, state } = harness({ amp: false, board: false });
    af.fold();
    expect(af.restore()).toBe(true);
    expect(state()).toEqual({ amp: false, board: false });
    // restore passes restoring=true so the caller re-persists the user state
    expect(setState).toHaveBeenLastCalledWith({ amp: false, board: false }, true);
    expect(af.isFolded()).toBe(false);
  });

  it('a panel the user had ALREADY collapsed stays collapsed after restore', () => {
    const { af, state } = harness({ amp: true, board: false }); // amp manually collapsed
    af.fold();
    expect(state()).toEqual({ amp: true, board: true });
    af.restore();
    expect(state()).toEqual({ amp: true, board: false }); // amp NOT blindly expanded
  });

  it('both-already-collapsed: fold + restore keep everything collapsed', () => {
    const { af, state } = harness({ amp: true, board: true });
    af.fold();
    af.restore();
    expect(state()).toEqual({ amp: true, board: true });
  });

  it('repeated fold() calls are a no-op (no thrash, snapshot preserved)', () => {
    const { af, setState } = harness({ amp: false, board: true });
    expect(af.fold()).toBe(true);
    expect(af.fold()).toBe(false);   // already folded — no second setState
    expect(af.fold()).toBe(false);
    expect(setState).toHaveBeenCalledTimes(1);
    af.restore();
    // the ORIGINAL user state survives the overlapping folds
    expect(setState).toHaveBeenLastCalledWith({ amp: false, board: true }, true);
  });

  it('restore() without a fold is a no-op', () => {
    const { af, setState } = harness();
    expect(af.restore()).toBe(false);
    expect(setState).not.toHaveBeenCalled();
  });

  it('repeated restore() calls are a no-op after the first', () => {
    const { af, setState } = harness();
    af.fold();
    expect(af.restore()).toBe(true);
    expect(af.restore()).toBe(false);
    expect(setState).toHaveBeenCalledTimes(2); // one fold + one restore
  });

  it('a full second transport cycle re-snapshots the CURRENT user state', () => {
    const { af, state } = harness({ amp: false, board: false });
    af.fold(); af.restore();
    // user collapses the board between takes
    const s = state(); s.board = true;
    // (simulate by folding from the mutated state)
    const h2 = harness({ amp: false, board: true });
    h2.af.fold(); h2.af.restore();
    expect(h2.state()).toEqual({ amp: false, board: true });
  });
});
