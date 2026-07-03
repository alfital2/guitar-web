// src/jam.js — "Come Together": two players jam over a direct WebRTC link.
//
// SERVERLESS by design: there is no signaling server. The host creates an
// INVITE CODE (their compressed SDP offer), sends it over any channel (chat,
// mail); the guest pastes it, gets a REPLY CODE back, and the host pastes that
// — done. Only Google's public STUN is used for NAT discovery (no media ever
// touches a server; audio flows peer-to-peer). Without TURN, a small minority
// of symmetric-NAT pairs cannot connect — surfaced as 'failed'.
//
// TWO transports ride the same peer link, hot-swappable per direction:
//
//  ULTRA (default) — uncompressed Int16 PCM in ~5.3 ms packets over an
//    UNRELIABLE DataChannel (ordered:false, maxRetransmits:0 → UDP semantics),
//    played through our own AudioWorklet micro jitter buffer (adaptive, starts
//    at 10 ms) with drift-compensating resampling and fade-out loss
//    concealment. This is the JackTrip architecture in a browser: ZERO codec
//    delay, no NetEQ (20-60 ms), no MediaStream plumbing (10-30 ms). Costs
//    ~0.8 Mbps each way.
//
//  STABLE (automatic fallback) — the classic WebRTC Opus media track, munged
//    for music (stereo, 192 kbps, 10 ms frames, FEC). If ULTRA packets stop
//    arriving (bad Wi-Fi, throttling), the receiver crossfades to Opus within
//    ~0.4 s and back when the raw feed recovers.
//
// The control channel (reliable) carries pings for a live RTT readout.

const STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const PCM_HEADER = 4;              // u16 seq | u16 reserved
const PCM_MAX_BUFFERED = 65536;    // skip sends when SCTP is backed up
const ULTRA_TIMEOUT_MS = 400;      // no PCM for this long → fall back to Opus

// ── Code encoding: SDP → deflate → base64url (chat-paste friendly) ─────────
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipeThrough(bytes, transform) {
  const src = new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
  const reader = src.pipeThrough(transform).getReader();
  const out = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; out.push(...value); }
  return new Uint8Array(out);
}

export async function encodeCode(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream !== 'undefined') {
    return 'J1.' + b64u(await pipeThrough(raw, new CompressionStream('deflate-raw')));
  }
  return 'J0.' + b64u(raw); // uncompressed fallback (very old browsers)
}

export async function decodeCode(code) {
  const s = String(code || '').trim();
  const dot = s.indexOf('.');
  if (dot < 0) throw new Error('That does not look like a jam code.');
  const tag = s.slice(0, dot), body = unb64u(s.slice(dot + 1));
  const raw = tag === 'J1' ? await pipeThrough(body, new DecompressionStream('deflate-raw')) : body;
  return JSON.parse(new TextDecoder().decode(raw));
}

// ── Opus music-profile SDP munge (pure; unit-tested) ────────────────────────
export function mungeOpusForMusic(sdp) {
  const m = sdp.match(/a=rtpmap:(\d+) opus\/48000/);
  if (!m) return sdp;
  const pt = m[1];
  const params = 'stereo=1;sprop-stereo=1;maxaveragebitrate=192000;useinbandfec=1;minptime=10';
  const fmtpRe = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  let out = fmtpRe.test(sdp)
    ? sdp.replace(fmtpRe, (line, existing) => {
        const keep = existing.split(';').map((kv) => kv.trim()).filter((kv) => kv && !/^(stereo|sprop-stereo|maxaveragebitrate|useinbandfec|minptime)=/.test(kv));
        return `a=fmtp:${pt} ${[...keep, ...params.split(';')].join(';')}`;
      })
    : sdp.replace(new RegExp(`(a=rtpmap:${pt} opus/48000[^\\r\\n]*\\r?\\n)`), `$1a=fmtp:${pt} ${params}\r\n`);
  if (!/a=ptime:/.test(out)) out = out.replace(/(a=fmtp:[^\r\n]*\r?\n)/, `$1a=ptime:10\r\n`);
  return out;
}

function gatherComplete(pc, timeoutMs = 8000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs);
    pc.addEventListener('icegatheringstatechange', function h() {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', h); resolve(); }
    });
  });
}

// ── The session ─────────────────────────────────────────────────────────────
export function createJam({ getCtx, getSendNode } = {}) {
  let pc = null, state = 'idle', role = null;
  let sendDest = null, remoteEl = null, remoteSrc = null, remoteGain = null, remoteAnalyser = null;
  let dcAudio = null, dcCtl = null;
  let sendNode = null, recvNode = null, ultraGain = null;
  let sendSeq = 0, lastPcmAt = 0, remoteRate = 48000, ultraWanted = true, ultraLive = false;
  let superT = null, pingT = null, rttMs = null, bufMs = null, targetMs = null, underruns = 0;
  let volume = 1;
  const listeners = new Set(), statListeners = new Set();
  const setState = (s, detail) => { state = s; listeners.forEach((cb) => { try { cb(s, detail); } catch {} }); };
  const emitStats = () => statListeners.forEach((cb) => { try { cb({ mode: ultraLive ? 'ultra' : 'opus', rttMs, bufMs, targetMs, underruns, wanted: ultraWanted }); } catch {} });

  function newPc() {
    const p = new RTCPeerConnection(STUN);
    p.addEventListener('connectionstatechange', () => {
      if (p !== pc) return;
      if (p.connectionState === 'connected') { setState('connected'); startSupervisor(); }
      else if (p.connectionState === 'failed') setState('failed', 'Peer link failed (some networks need a relay we don’t use).');
      else if (p.connectionState === 'disconnected' || p.connectionState === 'closed') { if (state === 'connected') setState('closed'); }
    });
    p.addEventListener('track', (ev) => {
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      try { ev.receiver.jitterBufferTarget = 0; } catch {}
      try { ev.receiver.playoutDelayHint = 0; } catch {}
      const ctx = getCtx && getCtx();
      // Chromium quirk: remote streams flow into WebAudio only once attached to
      // a media element. Keep it muted; our graph does the audible playout.
      remoteEl = document.createElement('audio');
      remoteEl.muted = true; remoteEl.srcObject = stream; remoteEl.play().catch(() => {});
      if (ctx) {
        remoteSrc = ctx.createMediaStreamSource(stream);
        remoteGain = ctx.createGain(); remoteGain.gain.value = 0; // supervisor unmutes if ULTRA is down
        remoteAnalyser = ctx.createAnalyser(); remoteAnalyser.fftSize = 512;
        remoteSrc.connect(remoteGain); remoteGain.connect(ctx.destination);
        remoteSrc.connect(remoteAnalyser);
      } else {
        remoteEl.muted = false;
      }
    });

    // Negotiated channels: identical IDs on both sides ride the one SDP
    // exchange — no renegotiation, no extra codes.
    dcAudio = p.createDataChannel('pcm', { negotiated: true, id: 7, ordered: false, maxRetransmits: 0 });
    dcAudio.binaryType = 'arraybuffer';
    dcAudio.onmessage = (e) => {
      const buf = e.data;
      if (!(buf instanceof ArrayBuffer) || buf.byteLength <= PCM_HEADER) return;
      lastPcmAt = performance.now();
      if (!recvNode) initRecv();
      if (recvNode) {
        const seq = new DataView(buf).getUint16(0, true);
        const body = buf.slice(PCM_HEADER);
        recvNode.port.postMessage({ seq, buf: body }, [body]);
      }
    };
    dcCtl = p.createDataChannel('ctl', { negotiated: true, id: 8, ordered: true });
    dcCtl.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.t === 'ping') dcCtl.send(JSON.stringify({ t: 'pong', ts: m.ts }));
        else if (m.t === 'pong') rttMs = Math.round(performance.now() - m.ts);
      } catch {}
    };
    return p;
  }

  function attachSend(p) {
    const ctx = getCtx && getCtx();
    const node = getSendNode && getSendNode();
    if (!ctx || !node) throw new Error('Power on first — the jam sends your live amp output.');
    // Opus media track (the STABLE fallback path)
    sendDest = ctx.createMediaStreamDestination();
    node.connect(sendDest);
    for (const track of sendDest.stream.getAudioTracks()) p.addTrack(track, sendDest.stream);
    // ULTRA tap: worklet → main thread → unreliable DataChannel
    try {
      sendNode = new AudioWorkletNode(ctx, 'jam-send-processor', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2 });
      sendNode.port.onmessage = (e) => {
        if (!dcAudio || dcAudio.readyState !== 'open' || dcAudio.bufferedAmount > PCM_MAX_BUFFERED) return;
        const body = e.data; // Int16 ArrayBuffer
        const framed = new ArrayBuffer(PCM_HEADER + body.byteLength);
        new DataView(framed).setUint16(0, sendSeq++ & 0xffff, true);
        new Uint8Array(framed, PCM_HEADER).set(new Uint8Array(body));
        try { dcAudio.send(framed); } catch {}
      };
      node.connect(sendNode);
      const sink = ctx.createGain(); sink.gain.value = 0; // keep the worklet pulled, silently
      sendNode.connect(sink); sink.connect(ctx.destination);
    } catch { sendNode = null; /* worklet unavailable → Opus-only */ }
  }

  function initRecv() {
    const ctx = getCtx && getCtx();
    if (!ctx) return;
    try {
      recvNode = new AudioWorkletNode(ctx, 'jam-recv-processor', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { remoteRate },
      });
      recvNode.port.onmessage = (e) => {
        const d = e.data || {};
        if (d.fillMs != null) { bufMs = Math.round(d.fillMs); targetMs = Math.round(d.targetMs); underruns = d.underruns; }
      };
      ultraGain = ctx.createGain(); ultraGain.gain.value = 0;
      recvNode.connect(ultraGain); ultraGain.connect(ctx.destination);
      if (remoteAnalyser) ultraGain.connect(remoteAnalyser);
    } catch { recvNode = null; }
  }

  // Crossfade supervisor: ULTRA while raw packets flow (and wanted), Opus otherwise.
  function startSupervisor() {
    const ctx = getCtx && getCtx();
    clearInterval(superT); clearInterval(pingT);
    superT = setInterval(() => {
      const live = ultraWanted && recvNode && (performance.now() - lastPcmAt) < ULTRA_TIMEOUT_MS;
      if (live !== ultraLive) {
        ultraLive = live;
        if (recvNode) recvNode.port.postMessage({ cmd: 'mute', on: !live });
      }
      const t = ctx ? ctx.currentTime : 0;
      if (ultraGain && ctx) ultraGain.gain.setTargetAtTime(ultraLive ? volume : 0, t, 0.03);
      if (remoteGain && ctx) remoteGain.gain.setTargetAtTime(ultraLive ? 0 : volume, t, 0.03);
      emitStats();
    }, 250);
    pingT = setInterval(() => {
      if (dcCtl && dcCtl.readyState === 'open') { try { dcCtl.send(JSON.stringify({ t: 'ping', ts: performance.now() })); } catch {} }
    }, 2000);
  }

  return {
    onState(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    onStats(cb) { statListeners.add(cb); return () => statListeners.delete(cb); },
    getState: () => state,
    setUltra(on) { ultraWanted = !!on; },
    setRemoteLevel(v) { volume = v; },
    remoteLevel() {
      if (!remoteAnalyser) return 0;
      const b = new Uint8Array(remoteAnalyser.fftSize);
      remoteAnalyser.getByteTimeDomainData(b);
      let peak = 0; for (let i = 0; i < b.length; i++) peak = Math.max(peak, Math.abs(b[i] - 128) / 128);
      return peak;
    },

    async host() {
      this.leave();
      role = 'host'; pc = newPc();
      attachSend(pc);
      setState('inviting');
      const offer = await pc.createOffer();
      await pc.setLocalDescription({ type: 'offer', sdp: mungeOpusForMusic(offer.sdp) });
      await gatherComplete(pc);
      setState('waiting-reply');
      const ctx = getCtx && getCtx();
      return encodeCode({ v: 2, t: 'o', sdp: pc.localDescription.sdp, sr: ctx ? ctx.sampleRate : 48000 });
    },
    async acceptReply(code) {
      const msg = await decodeCode(code);
      if (msg.t !== 'a') throw new Error('That is an invite code — you need your friend’s REPLY code here.');
      remoteRate = msg.sr || 48000;
      await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
      setState('connecting');
    },
    async join(code) {
      this.leave();
      const msg = await decodeCode(code);
      if (msg.t === 'a') throw new Error('That is a reply code — ask your friend for their INVITE code.');
      if (msg.t !== 'o') throw new Error('Unrecognized jam code.');
      role = 'guest'; pc = newPc();
      remoteRate = msg.sr || 48000;
      attachSend(pc);
      await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription({ type: 'answer', sdp: mungeOpusForMusic(answer.sdp) });
      await gatherComplete(pc);
      setState('connecting');
      const ctx = getCtx && getCtx();
      return encodeCode({ v: 2, t: 'a', sdp: pc.localDescription.sdp, sr: ctx ? ctx.sampleRate : 48000 });
    },
    leave() {
      clearInterval(superT); clearInterval(pingT); superT = pingT = null;
      if (pc) { try { pc.close(); } catch {} pc = null; }
      if (sendNode) { try { sendNode.port.postMessage('stop'); sendNode.disconnect(); } catch {} sendNode = null; }
      if (recvNode) { try { recvNode.port.postMessage('stop'); recvNode.disconnect(); } catch {} recvNode = null; }
      for (const n of [sendDest, remoteSrc, remoteGain, remoteAnalyser, ultraGain]) { try { n && n.disconnect(); } catch {} }
      sendDest = remoteSrc = remoteGain = remoteAnalyser = ultraGain = null;
      dcAudio = dcCtl = null;
      if (remoteEl) { try { remoteEl.srcObject = null; remoteEl.remove(); } catch {} remoteEl = null; }
      role = null; sendSeq = 0; lastPcmAt = 0; ultraLive = false; rttMs = bufMs = targetMs = null; underruns = 0;
      if (state !== 'idle') setState('idle');
    },
  };
}
