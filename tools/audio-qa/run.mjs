// Offline audio-QA runner.
//
// Renders every preset (or a name-filtered subset) through an
// OfflineAudioContext in headless Chrome and analyzes the output for the
// problems that can't be heard from code alone: endless echo / runaway
// feedback, silence, NaN blowups, DC offset, and gross gain-staging clipping.
//
// We can't "listen", so we render the real heard path — chain -> normGain
// (loudness-normalized, exactly like the live app) — and compute objective
// metrics on the result. The chain is driven at the same level the loudness
// gain is measured at, so peaks reflect the true operating point.
//
// Usage:
//   node tools/audio-qa/run.mjs                 # all presets
//   node tools/audio-qa/run.mjs "Echo Studio"   # only presets whose name matches
//
// Requires Google Chrome (headless). Serves the repo on a local port and
// drives Chrome over the DevTools protocol — no extra dependencies.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 8212;
const DBG = 9222;
const ONLY = process.argv.slice(2); // optional preset-name filters

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) { console.error('No Chrome/Chromium found. Tried:\n' + CHROME_CANDIDATES.join('\n')); process.exit(1); }

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, b) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(b);
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const udir = fs.mkdtempSync('/tmp/qa-chrome-');
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${udir}`,
  '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

async function cdpTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json();
      const t = j.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t.webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('no CDP target');
}
const ws = new WebSocket(await cdpTarget());
await new Promise((r) => (ws.onopen = r));
let id = 0; const waiters = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiters.has(d.id)) { waiters.get(d.id)(d); waiters.delete(d.id); } };
const send = (method, params) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((r) => waiters.set(i, r)); };

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/tools/audio-qa/blank.html` });
await new Promise((r) => setTimeout(r, 600));

const expr = `(async () => {
  const base = 'http://127.0.0.1:${PORT}';
  const { PRESETS } = await import(base + '/src/presets.js');
  const { registry } = await import(base + '/src/effects/index.js');
  const { buildChain } = await import(base + '/src/engine.js');
  const { loadWorklets } = await import(base + '/src/effects/worklets/index.js');
  const { measureLoudnessGain, makeReferenceNoise } = await import(base + '/src/normalize.js');
  const { riff } = await import(base + '/tools/audio-qa/signal.js');
  const { analyze, rms } = await import(base + '/tools/audio-qa/metrics.js');
  const SR = 44100;
  const only = ${JSON.stringify(ONLY)};
  const sel = only.length ? PRESETS.filter(p => only.some(o => p.name.toLowerCase().includes(o.toLowerCase()))) : PRESETS;
  const sig = riff(SR, {});
  // Drive the chain at the same level the loudness gain is measured at (the
  // reference pink noise), so the analyzed signal sits at the real operating
  // point and the post-normGain output reflects what the user actually hears.
  const refCtx = new OfflineAudioContext(1, SR, SR);
  const refRms = rms(makeReferenceNoise(refCtx, SR).getChannelData(0));
  const inEnd = Math.round(sig.inputEndSec * SR);
  const inRms = rms(sig.samples.subarray(0, inEnd));
  const inScale = inRms > 1e-9 ? refRms / inRms : 1;
  const out = [];
  for (const preset of sel) {
    try {
      const chain = preset.chain.map(c => ({ type: c.type, params: c.params }));
      const g = await measureLoudnessGain(chain, { sampleRate: SR });
      const ctx = new OfflineAudioContext(1, Math.round(SR * (sig.inputEndSec + 6)), SR);
      await loadWorklets(ctx);
      const eng = buildChain(ctx, chain, registry);
      const buf = ctx.createBuffer(1, sig.samples.length, SR);
      const scaled = new Float32Array(sig.samples.length);
      for (let i = 0; i < scaled.length; i++) scaled[i] = sig.samples[i] * inScale;
      buf.copyToChannel(scaled, 0);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const norm = ctx.createGain(); norm.gain.value = g; // the live normGain stage
      src.connect(eng.input); eng.output.connect(norm); norm.connect(ctx.destination); src.start();
      const rendered = await ctx.startRendering();
      // High-crest plucked transients legitimately exceed 1.0 after loudness
      // normalization (even a bypassed clean chain peaks ~1.4), so only flag
      // gross gain-staging blowups, not normal transients.
      const a = analyze(rendered.getChannelData(0), SR, { inputEndSec: sig.inputEndSec, clipThresh: 2.5 });
      out.push({ name: preset.name, verdict: a.verdict, decayDb: a.decayDb, peak: +a.peak.toFixed(2), normGain: +g.toFixed(2), reasons: a.reasons });
    } catch (e) {
      out.push({ name: preset.name, verdict: 'err', error: String(e && e.message || e) });
    }
  }
  return JSON.stringify(out);
})()`;

const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
let code = 0;
if (res.result?.exceptionDetails || res.exceptionDetails) {
  console.error('EVAL ERROR', JSON.stringify(res, null, 2).slice(0, 2000));
  code = 1;
} else {
  const data = JSON.parse(res.result.result.value);
  const c = { ok: 0, warn: 0, bad: 0 };
  for (const r of data) {
    const tag = r.verdict === 'ok' ? 'ok' : (r.verdict === 'warn' ? 'warn' : 'bad');
    c[tag]++;
    const flag = (r.reasons || []).find((x) => /echo|long tail|runaway/.test(x));
    console.log(
      r.verdict.toUpperCase().padEnd(5),
      r.name.padEnd(24),
      `peak ${r.peak ?? '-'}`.padEnd(11),
      `tail ${r.decayDb ?? '-'}dB`.padEnd(14),
      flag || r.error || (r.reasons || []).join('; ') || ''
    );
  }
  console.log(`\nTOTAL ${data.length} | ok ${c.ok} | warn ${c.warn} | fail/err ${c.bad}`);
  if (c.bad) code = 1;
}

ws.close(); chrome.kill(); server.close();
process.exit(code);
