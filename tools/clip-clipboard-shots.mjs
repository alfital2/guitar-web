// tools/clip-clipboard-shots.mjs — live-app proof of the clip clipboard
// keyboard shortcuts (⌘/Ctrl C copy, X cut, V paste-at-playhead, D duplicate,
// A select-all; internal clipboard, OS clipboard untouched).
//
// Powers the app on with a fake mic (same flags as tools/clip-loop-shots.mjs),
// records a ~2s take, then drives the shortcuts and asserts:
//   1. click selects, Ctrl+C copies, ruler click moves the playhead,
//   2. Ctrl+V pastes AT the playhead with the same width + a real waveform,
//      a fresh take number, and the pasted clip as the new selection,
//   3. undo removes the paste, redo brings it back,
//   4. a single-track clipboard pastes into the ARMED track,
//   5. Ctrl+D duplicates immediately after the original's span (one undo step),
//   6. Ctrl+A selects every clip, Ctrl+X cuts them all in one undo step,
//   7. Delete/Backspace still deletes, and cut→paste round-trips a clip.
// Writes shots/before/clip-clipboard.png (copied, playhead parked) +
// shots/after/clip-clipboard.png (pasted at playhead) and composites them
// into shots/compare/clip-clipboard.png.
//
// Usage: node tools/clip-clipboard-shots.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { writeFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.SHOTS_PORT) || 8914;
const URL = `http://localhost:${PORT}/?e2e=1`;
const PASTE_X = 320; // 10s at 32 px/sec; on the 16px snap grid

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

async function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://localhost:${PORT}/index.html`); if (r.status < 500) return proc; } catch {}
    await sleep(150);
  }
  proc.kill();
  throw new Error('dev server did not come up on port ' + PORT);
}

// All clips, in DOM order, with per-strip grouping and selection/label state.
const laneState = (page) => page.evaluate(() => {
  const strips = [...document.querySelectorAll('.track-strip')];
  const clips = strips.flatMap((s, si) => [...s.querySelectorAll('.track-clip')].map((c) => {
    const canvas = c.querySelector('canvas.clip-wave');
    let ink = 0;
    if (canvas) {
      const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
    }
    return {
      strip: si,
      left: parseFloat(c.style.left) || 0,
      width: parseFloat(c.style.width) || 0,
      n: Number((c.querySelector('.clip-label')?.textContent.match(/#(\d+)/) || [])[1] || 0),
      selected: c.classList.contains('selected'),
      ink,
    };
  }));
  return {
    clips,
    total: clips.length,
    selected: clips.filter((c) => c.selected).length,
    playhead: parseFloat(document.querySelector('.track-playhead')?.style.left) || 0,
  };
});

const clickClipAt = async (page, left, strip = 0) => {
  const box = await page.locator(`.track-strip >> nth=${strip}`).boundingBox();
  const s = await laneState(page);
  const c = s.clips.find((k) => k.strip === strip && Math.abs(k.left - left) <= 2);
  if (!c) throw new Error(`no clip at ${left} on strip ${strip}`);
  await page.mouse.click(box.x + c.left + c.width / 2, box.y + 40);
  await sleep(120);
};

async function run() {
  mkdirSync(join(ROOT, 'shots/before'), { recursive: true });
  mkdirSync(join(ROOT, 'shots/after'), { recursive: true });
  mkdirSync(join(ROOT, 'shots/compare'), { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('console', (m) => { if (process.env.VERBOSE) console.log('  [page]', m.text()); });

  try {
    await page.goto(URL, { waitUntil: 'load' });
    await page.click('#power');
    await page.waitForFunction(() => window.__neuralE2E && window.__neuralE2E.booted(), null, { timeout: 15000 });
    await sleep(600);

    // ── Record a ~2s take (tone through the chain for a visible waveform) ──
    await page.evaluate(() => window.__neuralE2E.feedTone(110, 0.3));
    await page.click('#tp-record');
    await sleep(2000);
    await page.click('#tp-record');
    await page.evaluate(() => window.__neuralE2E.stopTone());
    await page.waitForSelector('.track-clip', { timeout: 5000 });
    await sleep(200);

    let s = await laneState(page);
    const orig = s.clips[0];
    const w0 = orig.width, left0 = orig.left, ink0 = orig.ink;
    console.log(`Recorded take: #${orig.n} at ${left0}px, width ${w0}px`);
    check('recorded clip exists with a waveform', s.total === 1 && w0 > 40 && ink0 > 50, `${w0}px, ink ${ink0}`);

    // ── 1. Select + copy + park the playhead ──
    await clickClipAt(page, left0);
    s = await laneState(page);
    check('click selects the clip', s.selected === 1 && s.clips.find((c) => c.left === left0)?.selected, `${s.selected} selected`);
    await page.keyboard.press('Control+c');
    await sleep(100);
    s = await laneState(page);
    check('copy leaves the lane untouched', s.total === 1, `${s.total} clips`);

    const tl = await page.locator('.track-timeline').boundingBox();
    await page.mouse.click(tl.x + PASTE_X, tl.y + 11); // ruler click → seek
    await sleep(150);
    s = await laneState(page);
    check(`ruler click parks the playhead at ${PASTE_X}px`, Math.abs(s.playhead - PASTE_X) <= 1, `${s.playhead}px`);

    const frame = { x: tl.x - 4, y: tl.y - 4, width: PASTE_X + Math.ceil(w0) + 120, height: 170 };
    await page.screenshot({ path: join(ROOT, 'shots/before/clip-clipboard.png'), clip: frame });

    // ── 2. Paste at the playhead ──
    await page.keyboard.press('Control+v');
    await sleep(200);
    s = await laneState(page);
    const pasted = s.clips.find((c) => c.left === PASTE_X);
    check('paste adds a clip AT the playhead', s.total === 2 && !!pasted, `${s.total} clips, at ${s.clips.map((c) => c.left)}`);
    check('pasted clip keeps the width + waveform', !!pasted && Math.abs(pasted.width - w0) <= 1 && pasted.ink > 50, `w ${pasted?.width} vs ${w0}, ink ${pasted?.ink}`);
    check('pasted clip gets a fresh take number', !!pasted && pasted.n > orig.n, `#${pasted?.n} > #${orig.n}`);
    check('pasted clip is the new selection', s.selected === 1 && !!pasted?.selected, `${s.selected} selected`);

    await page.screenshot({ path: join(ROOT, 'shots/after/clip-clipboard.png'), clip: frame });

    // ── 3. Undo / redo the paste ──
    await page.keyboard.press('Control+z');
    await sleep(150);
    s = await laneState(page);
    check('undo removes the pasted clip', s.total === 1, `${s.total} clips`);
    await page.keyboard.press('Control+Shift+z');
    await sleep(150);
    s = await laneState(page);
    check('redo restores the pasted clip', s.total === 2 && s.clips.some((c) => c.left === PASTE_X), `${s.total} clips`);

    // ── 4. Single-track clipboard pastes into the ARMED track ──
    await page.click('.track-add');
    await sleep(200);
    await page.evaluate(() => document.querySelectorAll('.track-header')[1].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await sleep(200);
    const armed2 = await page.evaluate(() => document.querySelectorAll('.track-header')[1].classList.contains('armed'));
    check('second track armed', armed2);
    await page.keyboard.press('Control+v');
    await sleep(200);
    s = await laneState(page);
    const onT2 = s.clips.find((c) => c.strip === 1);
    check('paste lands on the ARMED track at the playhead', s.total === 3 && !!onT2 && Math.abs(onT2.left - PASTE_X) <= 1, `strip1 clip at ${onT2?.left}`);
    await page.keyboard.press('Control+z');
    await sleep(150);
    await page.evaluate(() => document.querySelectorAll('.track-header')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))); // re-arm track 1
    await sleep(200);

    // ── 5. Duplicate right after the original ──
    await clickClipAt(page, left0);
    await page.keyboard.press('Control+d');
    await sleep(200);
    s = await laneState(page);
    const dup = s.clips.find((c) => c.strip === 0 && Math.abs(c.left - (left0 + w0)) <= 1);
    check('duplicate lands right after the original span', s.total === 3 && !!dup, `clips at ${s.clips.filter((c) => c.strip === 0).map((c) => c.left)}`);
    check('duplicate is the new selection', s.selected === 1 && !!dup?.selected, `${s.selected} selected`);
    await page.keyboard.press('Control+z');
    await sleep(150);
    s = await laneState(page);
    check('one undo reverses the duplicate', s.total === 2, `${s.total} clips`);
    await page.keyboard.press('Control+Shift+z');
    await sleep(150);

    // ── 6. Select all, cut all (one undo step) ──
    await page.keyboard.press('Control+a');
    await sleep(120);
    s = await laneState(page);
    check('select-all selects every clip', s.total === 3 && s.selected === 3, `${s.selected}/${s.total}`);
    await page.keyboard.press('Control+x');
    await sleep(200);
    s = await laneState(page);
    check('cut removes all selected clips', s.total === 0, `${s.total} clips`);
    await page.keyboard.press('Control+z');
    await sleep(150);
    s = await laneState(page);
    check('one undo restores the whole cut', s.total === 3, `${s.total} clips`);

    // ── 7. Delete still works; cut→paste round-trips ──
    await clickClipAt(page, PASTE_X);
    await page.keyboard.press('Backspace');
    await sleep(150);
    s = await laneState(page);
    check('Backspace still deletes the selection', s.total === 2, `${s.total} clips`);
    await page.keyboard.press('Control+z');
    await sleep(150);

    const before = await laneState(page);
    const maxN = Math.max(...before.clips.map((c) => c.n));
    await clickClipAt(page, left0);
    await page.keyboard.press('Control+x');
    await sleep(150);
    s = await laneState(page);
    check('cut removes the original', s.total === 2 && !s.clips.some((c) => c.strip === 0 && c.left === left0), `${s.total} clips`);
    await page.keyboard.press('Control+v');
    await sleep(200);
    s = await laneState(page);
    const overlapped = s.clips.some((a, i) => s.clips.some((b, j) => i < j && a.strip === b.strip && a.left < b.left + b.width && a.left + a.width > b.left));
    check('paste after cut returns the clip, no overlaps, fresh #', s.total === 3 && !overlapped && Math.max(...s.clips.map((c) => c.n)) > maxN, `n max ${Math.max(...s.clips.map((c) => c.n))} > ${maxN}`);

    // ── Composite before/after (tools/ui-compare.mjs pattern, this pair only) ──
    const html = `<!doctype html><html><head><style>
      body { margin: 0; background: #101216; font: 700 13px -apple-system, sans-serif; }
      .wrap { display: flex; gap: 14px; padding: 16px; align-items: flex-start; width: fit-content; }
      figure { margin: 0; } figcaption { color: #8b93a3; letter-spacing: .12em; margin-bottom: 8px; }
      figcaption.after { color: #f0b429; }
      img { display: block; max-width: 880px; height: auto; border-radius: 8px; border: 1px solid #2a2f3a; }
      h1 { color: #e7e9ee; font-size: 14px; margin: 14px 0 0 16px; letter-spacing: .06em; }
    </style></head><body><h1>clip-clipboard</h1><div class="wrap">
      <figure><figcaption>BEFORE — ⌘C, playhead parked at bar 6</figcaption><img src="${pathToFileURL(join(ROOT, 'shots/before/clip-clipboard.png')).href}"></figure>
      <figure><figcaption class="after">AFTER — ⌘V pasted at the playhead</figcaption><img src="${pathToFileURL(join(ROOT, 'shots/after/clip-clipboard.png')).href}"></figure>
    </div></body></html>`;
    const tmp = join(ROOT, 'shots/compare/_clip-clipboard.html');
    await writeFile(tmp, html);
    const cpage = await context.newPage();
    await cpage.setViewportSize({ width: 1860, height: 700 });
    await cpage.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle' });
    const b = await cpage.locator('.wrap').boundingBox();
    await cpage.screenshot({ path: join(ROOT, 'shots/compare/clip-clipboard.png'), clip: { x: 0, y: 0, width: Math.min(1860, b.x + b.width + 16), height: Math.min(700, b.y + b.height + 16) } });
    await cpage.close();
    await rm(tmp, { force: true });

    console.log(`\n${failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'} — shots/compare/clip-clipboard.png`);
  } finally {
    await context.close();
    await browser.close();
    server.kill();
  }
  if (failures) process.exit(1);
}

run().catch((e) => { console.error('CLIP-CLIPBOARD ERROR:', e); process.exit(1); });
