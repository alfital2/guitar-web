// src/log.js — a tiny in-app event/error log so bugs are capturable without
// hunting the devtools console. Keeps a ring buffer, mirrors console.warn/error
// and any uncaught error/rejection into it, and logs key app events (record
// start/stop, etc.). In the browser console: `__logs()` prints the whole log
// and copies it to the clipboard so it can be pasted into a bug report.

const RING = 400;
const buf = [];
let seq = 0;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) | 0;

function fmt(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (a && typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
  return String(a);
}
function push(level, args) {
  buf.push({ i: ++seq, t: now(), level, msg: args.map(fmt).join(' ') });
  if (buf.length > RING) buf.shift();
}

export function log(...args) { push('log', args); }
export function warn(...args) { push('warn', args); }
export function getLogs() { return buf.slice(); }
export function dumpLogs() {
  return buf.map((e) => `[${e.i} +${e.t}ms ${e.level}] ${e.msg}`).join('\n');
}

// Install global capture once: mirror console.error/warn + window errors, and
// expose the console helpers.
export function installLogCapture() {
  if (typeof window === 'undefined' || window.__logInstalled) return;
  window.__logInstalled = true;
  const ce = console.error.bind(console);
  const cw = console.warn.bind(console);
  console.error = (...a) => { push('error', a); ce(...a); };
  console.warn = (...a) => { push('warn', a); cw(...a); };
  window.addEventListener('error', (e) => push('error', [`uncaught: ${e.message}`, `${e.filename}:${e.lineno}`]));
  window.addEventListener('unhandledrejection', (e) => push('error', [`unhandledrejection: ${(e.reason && (e.reason.stack || e.reason.message)) || e.reason}`]));
  window.__logs = () => {
    const s = dumpLogs();
    // eslint-disable-next-line no-console
    console.log(s);
    try { navigator.clipboard && navigator.clipboard.writeText(s); } catch { /* clipboard blocked */ }
    return s;
  };
  window.__logDump = dumpLogs;
  log('log capture installed — run __logs() to dump/copy');
}
