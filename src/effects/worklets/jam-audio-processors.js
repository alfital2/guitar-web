// jam-audio-processors.js — the "Ultra" low-latency jam path (audio thread).
//
// Why this exists: the WebRTC MEDIA stack costs ~50-100 ms (Opus lookahead +
// 10 ms frames + NetEQ's adaptive jitter buffer + MediaStream plumbing). For
// two guitarists that's the difference between "jamming" and "call and
// response". This pair recreates the JackTrip architecture in-browser:
// uncompressed PCM in tiny packets over an unreliable DataChannel, played out
// through OUR OWN micro jitter buffer that we can pin to ~5-15 ms.
//
//   jam-send: taps the live chain, downmixes to mono Int16, ships 2 quanta
//             (256 samples ≈ 5.3 ms @48k) per postMessage to the main thread,
//             which frames them onto the DataChannel.
//   jam-recv: seq-ordered ring buffer + fractional-ratio reader that does BOTH
//             sample-rate conversion (remote 44.1k ↔ local 48k) and clock-drift
//             compensation (two sound cards never run at exactly the same
//             rate), plus fade-out packet-loss concealment and an adaptive
//             target depth that grows only when the network actually underruns.

const QUANTUM = 128;
const PACKET_QUANTA = 2;                    // 256 samples ≈ 5.3 ms @ 48k
const PACKET_FRAMES = QUANTUM * PACKET_QUANTA;

class JamSendProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(PACKET_FRAMES);
    this.fill = 0;
    this.stopped = false;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.stopped = true; };
  }
  process(inputs) {
    if (this.stopped) return false;
    const inp = inputs[0];
    const ch0 = inp && inp[0];
    if (ch0 && ch0.length) {
      const ch1 = inp[1];
      for (let i = 0; i < ch0.length; i++) {
        const v = ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i]; // mono downmix
        const s = Math.max(-1, Math.min(1, v));
        this.buf[this.fill++] = (s * 32767) | 0;
        if (this.fill === PACKET_FRAMES) {
          const out = this.buf.slice(0);
          this.port.postMessage(out.buffer, [out.buffer]);
          this.fill = 0;
        }
      }
    }
    return true;
  }
}

class JamRecvProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.remoteRate = o.remoteRate || sampleRate;
    this.cap = 1 << 14;                      // 16384-sample ring (~340 ms @48k)
    this.mask = this.cap - 1;
    this.ring = new Float32Array(this.cap);
    this.writeFrame = 0;                     // absolute frames written (remote clock)
    this.readPos = 0;                        // fractional absolute read position
    this.baseSeq = null;                     // first sequence seen
    this.started = false;
    this.target = Math.round(sampleRate * 0.010); // 10 ms starting depth (local frames)
    this.minT = Math.round(sampleRate * 0.005);
    this.maxT = Math.round(sampleRate * 0.045);
    this.underruns = 0; this.recentUnder = 0;
    this.minFill = Infinity;                 // min fill per adapt window (backlog detector)
    this.lastGood = 0;                       // last sample value for PLC fade
    this.statT = 0; this.adaptT = 0;
    this.muted = false;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d === 'stop') { this.stopped = true; return; }
      if (d && d.cmd === 'mute') { this.muted = !!d.on; return; }
      if (d && d.buf != null) this.ingest(d.seq, new Int16Array(d.buf));
    };
  }
  ingest(seq, pcm) {
    if (this.baseSeq == null) { this.baseSeq = seq; this.writeFrame = 0; this.readPos = -this.target; }
    // u16 wrap-safe relative distance
    let rel = (seq - this.baseSeq) & 0xffff;
    if (rel > 0x8000) return; // ancient packet from before base — drop
    const startFrame = rel * PACKET_FRAMES;
    // Too old to matter (already played)? Drop instead of corrupting the ring.
    if (startFrame + pcm.length < this.readPos - this.cap / 2) return;
    for (let i = 0; i < pcm.length; i++) {
      this.ring[(startFrame + i) & this.mask] = pcm[i] / 32768;
    }
    if (startFrame + pcm.length > this.writeFrame) this.writeFrame = startFrame + pcm.length;
  }
  process(_inputs, outputs) {
    if (this.stopped) return false;
    const out = outputs[0];
    const L = out[0], R = out[1];
    const n = L.length;
    // ratio: remote-frames consumed per local output frame — sample-rate
    // conversion plus a gentle drift servo keeping the buffer at target depth.
    let fill = this.writeFrame - this.readPos;
    // Hard resync: a backlog far past target (startup burst, tab throttling)
    // would take the gentle servo many seconds to drain — jump straight to the
    // target depth instead. One tiny seam beats seconds of extra latency.
    if (this.started && fill > this.target + sampleRate * 0.04) {
      this.readPos = this.writeFrame - this.target;
      fill = this.target;
    }
    if (this.started && fill < this.minFill) this.minFill = fill;
    const err = fill - this.target;
    const drift = Math.max(-0.003, Math.min(0.003, err / (this.target * 60)));
    const ratio = (this.remoteRate / sampleRate) * (1 + drift);
    if (!this.started) {
      if (fill < this.target) { L.fill(0); if (R) R.fill(0); return true; } // pre-roll
      this.started = true;
    }
    for (let i = 0; i < n; i++) {
      if (this.muted || this.readPos + 1 >= this.writeFrame || this.readPos < 0) {
        // Underrun (or intentionally muted): fade the last sample to zero — a
        // click-free gap beats a click.
        this.lastGood *= 0.96;
        L[i] = this.lastGood;
        if (!this.muted && this.readPos + 1 >= this.writeFrame) { this.recentUnder++; }
        this.readPos += ratio;
        continue;
      }
      const i0 = Math.floor(this.readPos);
      const frac = this.readPos - i0;
      const a = this.ring[i0 & this.mask], b = this.ring[(i0 + 1) & this.mask];
      const v = a + (b - a) * frac;                 // linear interp resample
      L[i] = v; this.lastGood = v;
      this.readPos += ratio;
    }
    if (R) R.set(L);
    // Adaptive depth: grow fast on real underruns, shrink slowly when clean.
    this.adaptT += n;
    if (this.adaptT >= sampleRate * 2) {
      this.adaptT = 0;
      if (this.recentUnder > 256) this.target = Math.min(this.maxT, this.target + QUANTUM * 2);
      else if (this.recentUnder === 0) this.target = Math.max(this.minT, this.target - 64);
      this.underruns += this.recentUnder; this.recentUnder = 0;
      // Standing backlog: if even the WINDOW MINIMUM stayed well above target,
      // that's real latency (not jitter) — drop it in one seam. The gentle
      // drift servo handles the last few ms.
      if (this.minFill !== Infinity && this.minFill > this.target + sampleRate * 0.015) {
        this.readPos = this.writeFrame - this.target;
      }
      this.minFill = Infinity;
    }
    this.statT += n;
    if (this.statT >= sampleRate / 2) {
      this.statT = 0;
      this.port.postMessage({ fillMs: Math.max(0, (this.writeFrame - this.readPos) / sampleRate * 1000), targetMs: this.target / sampleRate * 1000, underruns: this.underruns });
    }
    return true;
  }
}

registerProcessor('jam-send-processor', JamSendProcessor);
registerProcessor('jam-recv-processor', JamRecvProcessor);
