// src/tab/tab-file.js — persistence for the tab editor: the shareable binary
// `.lick` file, the localStorage working-copy autosave, and the ASCII-tab
// text export.
//
// .lick layout: bytes 0–3 = magic 'GWL1', byte 4 = format version, bytes 5… =
// deflate-raw(JSON.stringify(state)). Binary on purpose — a lick opens in the
// app, not in a text editor (client-side JS means this is obfuscation, not
// cryptography — accepted). Compression rides the global CompressionStream/
// DecompressionStream (Node ≥18 + all modern browsers). jsdom's Blob has
// neither .stream() nor .arrayBuffer(), so the codec pumps bytes through
// writer/reader loops and readLickFile falls back to FileReader — keeps the
// unit tests on the real code path.

import { SIXTEENTH, TUNING_PRESETS, barTicks } from './tab-model.js';

export const LICK_VERSION = 2;
export const AUTOSAVE_KEY = 'guitarweb.tab.autosave.v2';

const MAGIC = [0x47, 0x57, 0x4c, 0x31]; // 'G' 'W' 'L' '1'

// Push `bytes` through a Compression/DecompressionStream and collect the
// output. Writer runs concurrently with the reader (a large state must not
// deadlock on the transform's internal queues); writer-side errors are
// swallowed because a corrupt payload surfaces on the readable end too.
async function pipeBytes(transform, bytes) {
  const writing = (async () => {
    const w = transform.writable.getWriter();
    await w.write(bytes);
    await w.close();
  })().catch(() => {});
  const chunks = [];
  const reader = transform.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await writing;
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export async function encodeLick(state) {
  const json = new TextEncoder().encode(JSON.stringify(state));
  const packed = await pipeBytes(new CompressionStream('deflate-raw'), json);
  const out = new Uint8Array(5 + packed.length);
  out.set(MAGIC, 0);
  out[4] = LICK_VERSION;
  out.set(packed, 5);
  return out;
}

export async function decodeLick(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 5 || b[0] !== MAGIC[0] || b[1] !== MAGIC[1] || b[2] !== MAGIC[2] || b[3] !== MAGIC[3]) {
    throw new Error('Not a .lick file');
  }
  if (b[4] > LICK_VERSION) throw new Error('Unsupported .lick version');
  const json = await pipeBytes(new DecompressionStream('deflate-raw'), b.subarray(5));
  return JSON.parse(new TextDecoder().decode(json));
}

// Browser download <name>.lick. Encoding is async; returns the promise so
// callers (and tests) can await completion.
export function downloadLick(state, name) {
  return encodeLick(state).then((bytes) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${name}.lick`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

export async function readLickFile(fileOrBlob) {
  const buf = fileOrBlob.arrayBuffer
    ? await fileOrBlob.arrayBuffer()
    : await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error || new Error('Could not read file'));
        r.readAsArrayBuffer(fileOrBlob);
      });
  return decodeLick(new Uint8Array(buf));
}

// ── localStorage autosave ───────────────────────────────────────────────────
// Plain JSON — local working copy only, NOT the share format. Best-effort:
// quota errors / private mode must never break editing.
export function autosaveTab(state) {
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state)); } catch { /* best-effort */ }
}

export function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ── ASCII tab export ────────────────────────────────────────────────────────
// Classic 6-line text tab: gutter string names, `|` bar lines per barTicks,
// dashes elsewhere. Token per note = fret digits (`x` when dead) + technique
// suffix (h p / \ b). Columns are one 16th wide, 2 chars minimum; any token
// ≥2 chars widens its column so a trailing dash always separates neighbors.
export function toAscii(state) {
  const names = (TUNING_PRESETS[state.tuning] || TUNING_PRESETS.EADGBE).names;
  const perBar = barTicks(state.timeSig) / SIXTEENTH;   // 16th columns per bar
  const notes = state.notes || [];

  let lastCol = 0;
  for (const n of notes) lastCol = Math.max(lastCol, Math.floor(n.tick / SIXTEENTH));
  const cols = Math.max(perBar, Math.ceil((lastCol + 1) / perBar) * perBar);

  const grid = new Map();                               // `${col}:${string}` -> token
  for (const n of notes) {
    const t = n.tech || {};
    const base = t.dead ? 'x' : String(n.fret);
    const suffix = (t.hp || '') + (t.slide || '') + (t.bend ? 'b' : '');
    grid.set(`${Math.floor(n.tick / SIXTEENTH)}:${n.string}`, base + suffix);
  }

  const widths = [];
  for (let c = 0; c < cols; c++) {
    let w = 2;
    for (let s = 0; s < 6; s++) {
      const tok = grid.get(`${c}:${s}`);
      if (tok) w = Math.max(w, tok.length + 1);
    }
    widths[c] = w;
  }

  const gutter = Math.max(...names.map((n) => n.length));
  const lines = [];
  for (let s = 0; s < 6; s++) {
    let line = names[s].padEnd(gutter) + '|';
    for (let c = 0; c < cols; c++) {
      line += (grid.get(`${c}:${s}`) || '').padEnd(widths[c], '-');
      if ((c + 1) % perBar === 0) line += '|';
    }
    lines.push(line);
  }
  return lines.join('\n');
}
