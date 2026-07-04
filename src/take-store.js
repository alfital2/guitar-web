// src/take-store.js — persist the recording session (tracks + takes, including
// the raw audio) across reloads. localStorage can't hold audio (5 MB of
// strings); IndexedDB stores the take snapshot as-is — structured clone handles
// the Float32Array sample buffers natively, no WAV round-trip needed. One row
// keyed by SESSION_KEY holds the whole { tracks, armedId, takeSeq, nextTrackId }
// snapshot (the same shape undo uses). Best-effort: every call swallows errors
// (private-mode / quota / no-IDB) so persistence never breaks the app.

const DB_NAME = 'guitarweb-session';
const STORE = 'session';
const SESSION_KEY = 'tracks';

function hasIDB() { return typeof indexedDB !== 'undefined'; }

function openDB() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Persist the session snapshot. Resolves true on success, false on any failure.
export async function saveSession(snapshot) {
  if (!hasIDB()) return false;
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(snapshot, SESSION_KEY);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };   // quota etc. — non-fatal
      tx.onabort = () => { db.close(); resolve(false); };
    });
  } catch { return false; }
}

// Load the session snapshot, or null if none / on any failure.
export async function loadSession() {
  if (!hasIDB()) return null;
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(SESSION_KEY);
      rq.onsuccess = () => { db.close(); resolve(rq.result || null); };
      rq.onerror = () => { db.close(); resolve(null); };
    });
  } catch { return null; }
}

export async function clearSession() {
  if (!hasIDB()) return;
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(SESSION_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch { /* ignore */ }
}
