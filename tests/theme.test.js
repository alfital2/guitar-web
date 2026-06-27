// tests/theme.test.js
import { describe, it, expect } from 'vitest';
import { resolveTheme } from '../src/theme.js';

describe('resolveTheme', () => {
  it('uses system preference when no override', () => {
    expect(resolveTheme(true, null)).toBe('dark');
    expect(resolveTheme(false, null)).toBe('light');
    expect(resolveTheme(true, undefined)).toBe('dark');
  });
  it('override wins over system', () => {
    expect(resolveTheme(true, 'light')).toBe('light');
    expect(resolveTheme(false, 'dark')).toBe('dark');
  });
  it('ignores a bogus override and falls back to system', () => {
    expect(resolveTheme(false, 'rainbow')).toBe('light');
  });
});
