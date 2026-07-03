import { describe, it, expect, beforeEach, vi } from 'vitest';
import { maybeShowSafariNotice } from '../src/browser-notice.js';

// jsdom provides document + localStorage; requestAnimationFrame is stubbed.
beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  globalThis.requestAnimationFrame = (cb) => cb();
});

describe('maybeShowSafariNotice', () => {
  it('does nothing on non-Safari', () => {
    expect(maybeShowSafariNotice(false)).toBeNull();
    expect(document.querySelector('.browser-notice')).toBeNull();
  });

  it('renders a dismissible notice on Safari mentioning Chrome', () => {
    const el = maybeShowSafariNotice(true);
    expect(el).toBeTruthy();
    expect(document.querySelector('.browser-notice')).toBe(el);
    expect(el.textContent).toMatch(/Safari/);
    expect(el.textContent).toMatch(/Chrome/);
    expect(el.querySelector('.browser-notice-close')).toBeTruthy();
  });

  it('dismissal removes it and persists so it does not return', () => {
    vi.useFakeTimers();
    const el = maybeShowSafariNotice(true);
    el.querySelector('.browser-notice-close').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.runAllTimers();
    expect(document.querySelector('.browser-notice')).toBeNull();
    // second call after dismissal is a no-op
    expect(maybeShowSafariNotice(true)).toBeNull();
    vi.useRealTimers();
  });
});
