// src/jam-ui.js — settings-panel UI for the "Come Together" jam (src/jam.js).
// Extracted from main.js (refactor 2026-07-03): fully self-contained — owns the
// host/join code-exchange flow, status LED, friend-volume + level meter and the
// ULTRA/Opus stats line. main.js just calls initJamUI with two getters.
import { createJam } from './jam.js';

export function initJamUI({ getCtx, getSendNode }) {
  const jam = createJam({ getCtx, getSendNode });
  const el2 = (id) => document.getElementById(id);
  const hostBtn = el2('jam-host'), joinBtn = el2('jam-join'), leaveBtn = el2('jam-leave');
  const outWrap = el2('jam-out-wrap'), outTa = el2('jam-out'), copyBtn = el2('jam-copy');
  const inWrap = el2('jam-in-wrap'), inTa = el2('jam-in'), inLabel = el2('jam-in-label'), goBtn = el2('jam-go');
  const statusEl = el2('jam-status'), statusText = el2('jam-status-text'), errEl = el2('jam-error');
  const mixRow = el2('jam-mix-row'), volEl = el2('jam-vol'), meterFill = el2('jam-meter-fill');
  const ultraRow = el2('jam-ultra-row'), ultraCb = el2('jam-ultra'), statsEl = el2('jam-stats');
  let mode = null; // 'host' | 'guest'
  let meterT = null;

  const err = (m) => { if (errEl) { errEl.textContent = m || ''; errEl.hidden = !m; } };
  const status = (cls, text) => {
    if (!statusEl) return;
    statusEl.classList.remove('live', 'wait', 'bad');
    if (cls) statusEl.classList.add(cls);
    statusText.textContent = text;
  };
  function ui(stage) {
    const idle = stage === 'idle', connected = stage === 'connected';
    if (hostBtn) hostBtn.hidden = !idle;
    if (joinBtn) joinBtn.hidden = !idle;
    if (leaveBtn) leaveBtn.hidden = idle;
    if (outWrap) outWrap.hidden = !(stage === 'host-wait' || stage === 'guest-wait');
    if (inWrap) inWrap.hidden = !(stage === 'host-wait' || stage === 'join-entry');
    if (mixRow) mixRow.hidden = !connected;
    if (ultraRow) ultraRow.hidden = !connected;
    if (statsEl) statsEl.hidden = !connected;
    if (connected) {
      clearInterval(meterT);
      meterT = setInterval(() => { if (meterFill) meterFill.style.width = `${Math.min(100, jam.remoteLevel() * 130)}%`; }, 120);
    } else { clearInterval(meterT); meterT = null; }
  }

  jam.onState((s, detail) => {
    if (s === 'connected') { status('live', 'Connected — you are jamming!'); err(''); ui('connected'); }
    else if (s === 'failed') { status('bad', 'Connection failed'); err(detail || 'Peer link failed.'); ui('idle'); mode = null; }
    else if (s === 'closed') { status('', 'Jam ended'); ui('idle'); mode = null; }
    else if (s === 'idle') { status('', 'Not connected'); ui('idle'); mode = null; }
  });

  const needPower = () => { err('Power on first — the jam sends your live amp sound.'); };

  if (hostBtn) hostBtn.addEventListener('click', async () => {
    if (!getCtx() || !getSendNode()) return needPower();
    err('');
    try {
      mode = 'host';
      status('wait', 'Creating invite…');
      const code = await jam.host();
      outTa.value = code;
      inTa.value = '';
      inLabel.textContent = "Paste your friend's REPLY code";
      status('wait', 'Send the invite, then paste the reply below');
      ui('host-wait');
    } catch (e) { err(String(e.message || e)); status('bad', 'Could not create invite'); ui('idle'); mode = null; }
  });

  if (joinBtn) joinBtn.addEventListener('click', () => {
    if (!getCtx() || !getSendNode()) return needPower();
    err('');
    mode = 'guest';
    inTa.value = '';
    inLabel.textContent = "Paste your friend's INVITE code";
    status('wait', 'Paste the invite code you received');
    ui('join-entry');
  });

  if (goBtn) goBtn.addEventListener('click', async () => {
    err('');
    try {
      if (mode === 'guest') {
        status('wait', 'Building your reply…');
        const reply = await jam.join(inTa.value);
        outTa.value = reply;
        status('wait', 'Send the reply code back — connecting…');
        ui('guest-wait');
      } else if (mode === 'host') {
        await jam.acceptReply(inTa.value);
        status('wait', 'Connecting…');
      }
    } catch (e) { err(String(e.message || e)); }
  });

  if (copyBtn) copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(outTa.value); copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200); }
    catch { outTa.select(); document.execCommand('copy'); }
  });

  if (volEl) volEl.addEventListener('input', () => jam.setRemoteLevel(parseFloat(volEl.value)));
  if (ultraCb) ultraCb.addEventListener('change', () => jam.setUltra(ultraCb.checked));
  jam.onStats((st) => {
    if (!statsEl || statsEl.hidden) return;
    const mode = st.mode === 'ultra' ? 'ULTRA raw link' : (st.wanted ? 'Opus (waiting for raw link…)' : 'Opus');
    const bits = [mode];
    if (st.rttMs != null) bits.push(`RTT ${st.rttMs} ms`);
    if (st.mode === 'ultra' && st.bufMs != null) bits.push(`buffer ${st.bufMs} ms (target ${st.targetMs})`);
    statsEl.textContent = bits.join(' · ');
  });
  if (leaveBtn) leaveBtn.addEventListener('click', () => { jam.leave(); });
}
