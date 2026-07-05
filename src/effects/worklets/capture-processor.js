// capture-processor.js — recording tap that runs on the AUDIO thread.
// Replaces the ScriptProcessor recorder tap: ScriptProcessor bounces every
// audio buffer through the MAIN thread, which stutters whenever the UI is busy
// (worst on Safari, where it audibly glitches recordings). This processor
// copies input quanta and posts each one to the recorder with a transferred
// buffer — zero main-thread audio work, ~2.7 ms max in-flight tail on stop.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.stopped = false;
    this.port.onmessage = (e) => { if (e && e.data === 'stop') this.stopped = true; };
  }
  process(inputs) {
    if (this.stopped) return false; // release the node — recording ended
    const inp = inputs[0];
    const l = inp && inp[0];
    if (l && l.length) {
      const lc = new Float32Array(l); // the engine reuses the quantum buffer
      const r = inp[1];               // stereo (widener/pan) — keep both channels
      if (r && r.length) {
        const rc = new Float32Array(r);
        this.port.postMessage({ l: lc, r: rc }, [lc.buffer, rc.buffer]);
      } else {
        this.port.postMessage({ l: lc }, [lc.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
