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
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      const copy = new Float32Array(ch); // the engine reuses the quantum buffer
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
