import { describe, it, expect, afterEach } from 'vitest';
import { can, setCapability, CAPS } from '../src/features.js';

// The registry is module-global state — every test that flips a cap restores
// it, so ordering never leaks between files.
afterEach(() => { for (const c of CAPS) setCapability(c, true); });

describe('features capability registry', () => {
  it('every known cap defaults to ON', () => {
    expect(CAPS).toEqual(['tab.edit', 'tab.practice', 'tab.techniques', 'tab.file', 'tab.ascii']);
    for (const c of CAPS) expect(can(c)).toBe(true);
  });

  it('unknown caps default to ON (fail-open: free app today)', () => {
    expect(can('made.up.cap')).toBe(true);
  });

  it('setCapability(false) disables; true re-enables', () => {
    setCapability('tab.practice', false);
    expect(can('tab.practice')).toBe(false);
    expect(can('tab.edit')).toBe(true);          // others untouched
    setCapability('tab.practice', true);
    expect(can('tab.practice')).toBe(true);
  });

  it('coerces truthiness', () => {
    setCapability('tab.file', 0);
    expect(can('tab.file')).toBe(false);
    setCapability('tab.file', 'yes');
    expect(can('tab.file')).toBe(true);
  });
});
