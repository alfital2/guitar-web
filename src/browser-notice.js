// src/browser-notice.js
// A one-time, dismissible notice for Safari users: WebKit's live audio-input
// path carries more latency than Chromium's, so there's a slightly larger delay
// between playing a note and hearing it. Nothing the web layer can fix (it's
// below getUserMedia), so we're honest about it and point at Chrome — while
// making clear everything still works here. Shown once; dismissal is remembered.

const KEY = 'guitar.safariLatencyNotice.dismissed';

function dismissed() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
function remember() {
  try { localStorage.setItem(KEY, '1'); } catch {}
}

// Renders the notice into <body> and wires dismissal. `isSafari` is passed in
// (main.js already computed it) so this module stays UA-agnostic and testable.
export function maybeShowSafariNotice(isSafari, doc = (typeof document !== 'undefined' ? document : null)) {
  if (!isSafari || !doc || !doc.body || dismissed()) return null;

  const el = doc.createElement('div');
  el.className = 'browser-notice';
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <span class="browser-notice-icon" aria-hidden="true">🎸</span>
    <div class="browser-notice-body">
      <strong>Safari adds a slight delay between playing and hearing your guitar.</strong>
      <span>It's a Safari limitation we can't remove — for the tightest, most responsive feel, open this in Chrome. Recording, effects and playback all work fully here either way.</span>
    </div>
    <button type="button" class="browser-notice-close" aria-label="Dismiss">Got it</button>
  `;
  const close = () => { remember(); el.classList.add('leaving'); setTimeout(() => el.remove(), 240); };
  el.querySelector('.browser-notice-close').addEventListener('click', close);
  doc.body.appendChild(el);
  // Trigger the enter transition on the next frame.
  requestAnimationFrame(() => el.classList.add('in'));
  return el;
}
