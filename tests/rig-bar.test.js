// tests/rig-bar.test.js — rig bar dock/undock logic: the strips share one row
// only when BOTH panels are collapsed, and the body class tracks that exactly.
import { describe, it, expect } from 'vitest';
import { isRigDocked, applyRigDock } from '../src/chain-ui/rig-bar.js';

describe('isRigDocked', () => {
  it('docks only when BOTH the amp and the board are collapsed', () => {
    expect(isRigDocked(true, true)).toBe(true);
    expect(isRigDocked(true, false)).toBe(false);
    expect(isRigDocked(false, true)).toBe(false);
    expect(isRigDocked(false, false)).toBe(false);
  });

  it('coerces truthy/falsy inputs to a strict boolean', () => {
    expect(isRigDocked(1, 'yes')).toBe(true);
    expect(isRigDocked(undefined, true)).toBe(false);
    expect(isRigDocked(null, null)).toBe(false);
  });
});

describe('applyRigDock', () => {
  it('adds .rig-docked to the body when both panels are collapsed', () => {
    const body = document.createElement('div');
    expect(applyRigDock(true, true, body)).toBe(true);
    expect(body.classList.contains('rig-docked')).toBe(true);
  });

  it('removes .rig-docked when either panel expands (either order)', () => {
    const body = document.createElement('div');
    applyRigDock(true, true, body);
    expect(applyRigDock(false, true, body)).toBe(false);
    expect(body.classList.contains('rig-docked')).toBe(false);
    applyRigDock(true, true, body);
    expect(applyRigDock(true, false, body)).toBe(false);
    expect(body.classList.contains('rig-docked')).toBe(false);
  });

  it('is idempotent — repeated applications do not toggle the class', () => {
    const body = document.createElement('div');
    applyRigDock(true, true, body);
    applyRigDock(true, true, body);
    expect(body.classList.contains('rig-docked')).toBe(true);
    applyRigDock(false, false, body);
    applyRigDock(false, false, body);
    expect(body.classList.contains('rig-docked')).toBe(false);
  });

  it('defaults to document.body when no body is injected', () => {
    applyRigDock(true, true);
    expect(document.body.classList.contains('rig-docked')).toBe(true);
    applyRigDock(false, true);
    expect(document.body.classList.contains('rig-docked')).toBe(false);
  });
});
