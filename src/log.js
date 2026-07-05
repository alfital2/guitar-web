// src/log.js — production-style structured logging for a serverless browser app.
//
// There's no server and no real filesystem here, so "log file" = persist to
// IndexedDB (survives reloads/crashes) and export a real .jsonl on demand.
//
//   • Levels  DEBUG < INFO < WARN < ERROR, one threshold (DEBUG is opt-in).
//   • Categories via logger('recorder').info('start', {atSec}) — greppable.
//   • Each entry is structured: { seq, ts, rel, level, cat, event, data, sid }.
//   • Sinks: in-memory ring (fast, for __logs()), IndexedDB (batched, capped,
//     persistent), console mirror. Uncaught errors + console.error/warn are
//     captured automatically.
//
// Console helpers (dev/bug-report):
//   __logs()          print + copy the in-memory buffer
//   __logsDownload()  save the FULL persisted log as guitarweb-<sid>.jsonl
//   __logClear()      wipe the persisted log
//   __logLevel('debug'|'info'|'warn'|'error')  change verbosity (persisted)

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const RING = 1000;
const DB_NAME = 'guitarweb-logs';
const STORE = 'entries';
const CAP = 20000;              // persisted-entry cap; oldest pruned past this
const FLUSH_MS = 800;

const relClock = () => Math.round(typeof performance !== 'undefined' ? performance.now() : 0);

function makeSid() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().slice(0, 8); } catch { /* noop */ }
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
const sid = makeSid();

let threshold = LEVELS.info;
try {
  const saved = typeof localStorage !== 'undefined' && localStorage.getItem('gw-log-level');
  if (saved && LEVELS[saved]) threshold = LEVELS[saved];
} catch { /* private mode */ }

const ring = [];
let seq = 0;

// ── IndexedDB sink (batched) ────────────────────────────────────────────────
const hasIDB = () => typeof indexedDB !== 'undefined';
let dbP = null;
function db() {
  if (!hasIDB()) return Promise.resolve(null);
  dbP = dbP || new Promise((res) => {
    let r;
    try { r = indexedDB.open(DB_NAME, 1); } catch { res(null); return; }
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'seq' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  });
  return dbP;
}
let queue = [];
let flushTimer = null;
async function flush() {
  flushTimer = null;
  if (!queue.length) return;
  const batch = queue; queue = [];
  const d = await db();
  if (!d) return;
  try {
    await new Promise((res) => {
      const tx = d.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      for (const e of batch) st.put(e);
      tx.oncomplete = res; tx.onerror = res; tx.onabort = res;
    });
    // occasional prune so the store can't grow without bound
    if (seq % 500 === 0) prune(d).catch(() => {});
  } catch { /* best-effort */ }
}
function scheduleFlush() {
  if (flushTimer || typeof setTimeout === 'undefined') return;
  flushTimer = setTimeout(() => { flush(); }, FLUSH_MS);
}
async function prune(d) {
  return new Promise((res) => {
    const tx = d.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    const countReq = st.count();
    countReq.onsuccess = () => {
      const over = countReq.result - CAP;
      if (over <= 0) { res(); return; }
      let removed = 0;
      const cur = st.openCursor();               // ascending by key (seq) = oldest first
      cur.onsuccess = (e) => {
        const c = e.target.result;
        if (c && removed < over) { c.delete(); removed++; c.continue(); } else res();
      };
      cur.onerror = () => res();
    };
    countReq.onerror = () => res();
  });
}

// ── core ────────────────────────────────────────────────────────────────────
function record(level, cat, event, data) {
  if (LEVELS[level] < threshold) return null;
  const e = { seq: ++seq, ts: Date.now(), rel: relClock(), level, cat, event: String(event), sid };
  if (data !== undefined) e.data = data;
  ring.push(e); if (ring.length > RING) ring.shift();
  queue.push(e); scheduleFlush();
  // console mirror (kept readable; errors/warns go to the matching console fn)
  if (typeof console !== 'undefined') {
    const line = `%c${cat}%c ${event}`;
    const css = level === 'error' ? 'color:#e66' : level === 'warn' ? 'color:#e9a13b' : 'color:#7aa2f7';
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.debug || console.log;
    try { data !== undefined ? fn(line, css, 'color:inherit', data) : fn(line, css, 'color:inherit'); } catch { /* noop */ }
  }
  return e;
}

const fmt = (a) => {
  if (a instanceof Error) return a.stack || a.message;
  if (a && typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
  return String(a);
};

// Namespaced logger for a subsystem: logger('recorder').info('start', {...}).
export function logger(cat) {
  return {
    debug: (event, data) => record('debug', cat, event, data),
    info: (event, data) => record('info', cat, event, data),
    warn: (event, data) => record('warn', cat, event, data),
    error: (event, data) => record('error', cat, event, data),
  };
}

// Back-compat flat helpers (category 'app').
export function log(...args) { return record('info', 'app', args.map(fmt).join(' ')); }
export function warn(...args) { return record('warn', 'app', args.map(fmt).join(' ')); }
export function getLogs() { return ring.slice(); }
export function dumpLogs() {
  return ring.map((e) => `[${e.seq} +${e.rel}ms ${e.level} ${e.cat}] ${e.event}${e.data !== undefined ? ' ' + fmt(e.data) : ''}`).join('\n');
}

// Read the FULL persisted log (IndexedDB) merged with the live tail, as JSONL.
async function persistedJsonl() {
  await flush();
  const d = await db();
  const rows = [];
  if (d) {
    await new Promise((res) => {
      const tx = d.transaction(STORE, 'readonly');
      const cur = tx.objectStore(STORE).openCursor();
      cur.onsuccess = (e) => { const c = e.target.result; if (c) { rows.push(c.value); c.continue(); } else res(); };
      cur.onerror = () => res();
    });
  }
  const seen = new Set(rows.map((r) => r.seq));
  for (const e of ring) if (!seen.has(e.seq)) rows.push(e);
  rows.sort((a, b) => a.seq - b.seq);
  return rows.map((r) => JSON.stringify(r)).join('\n');
}

function download(name, text) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function setLevel(name) {
  if (!LEVELS[name]) return threshold;
  threshold = LEVELS[name];
  try { localStorage.setItem('gw-log-level', name); } catch { /* noop */ }
  record('info', 'log', 'level', { level: name });
  return threshold;
}

// Install global capture + console helpers once.
export function installLogCapture() {
  if (typeof window === 'undefined' || window.__logInstalled) return;
  window.__logInstalled = true;

  const ce = console.error.bind(console);
  const cw = console.warn.bind(console);
  console.error = (...a) => { record('error', 'console', a.map(fmt).join(' ')); ce(...a); };
  console.warn = (...a) => { record('warn', 'console', a.map(fmt).join(' ')); cw(...a); };
  window.addEventListener('error', (e) => record('error', 'window', 'uncaught', { message: e.message, at: `${e.filename}:${e.lineno}:${e.colno}`, stack: e.error && e.error.stack }));
  window.addEventListener('unhandledrejection', (e) => record('error', 'window', 'unhandledrejection', { reason: (e.reason && (e.reason.stack || e.reason.message)) || String(e.reason) }));
  window.addEventListener('pagehide', () => { flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  window.__logs = () => { const s = dumpLogs(); try { navigator.clipboard && navigator.clipboard.writeText(s); } catch { /* noop */ } return s; };
  window.__logDump = dumpLogs;
  window.__logsDownload = async () => { const t = await persistedJsonl(); download(`guitarweb-${sid}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.jsonl`, t); return `downloaded ${t.split('\n').length} entries`; };
  window.__logClear = async () => { const d = await db(); if (d) await new Promise((res) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete = res; tx.onerror = res; }); ring.length = 0; queue = []; return 'cleared'; };
  window.__logLevel = (name) => setLevel(name);

  record('info', 'app', 'boot', {
    sid,
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    url: typeof location !== 'undefined' ? location.href : '',
    level: Object.keys(LEVELS).find((k) => LEVELS[k] === threshold),
  });
}

export { sid as logSessionId };
