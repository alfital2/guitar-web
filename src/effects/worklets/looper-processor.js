// Loop pedal (AudioWorklet). Records incoming audio to a buffer, then loops it
// back underneath your live playing. Mode knob drives the transport:
//   0 = stop, 1 = record, 2 = play, 3 = overdub.
// Dry signal always passes through; the loop is summed on top at `level`.
class LooperProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'mode',  defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
      { name: 'level', defaultValue: 0.9, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.max = Math.floor(sampleRate * 30); // 30s ceiling
    this.buf = new Float32Array(this.max);
    this.len = 0;        // committed loop length
    this.rec = 0;        // record write head
    this.play = 0;       // playback read head
    this.prevMode = 0;
  }

  process(inputs, outputs, params) {
    const output = outputs[0];
    if (!output || !output.length) return true;
    const input = inputs[0];
    const inCh = input && input[0] ? input[0] : null;
    const out = output[0];
    const n = out.length;

    const mode = Math.round(params.mode[0]);
    const level = params.level[0];

    if (mode !== this.prevMode) {
      if (mode === 1) { this.len = 0; this.rec = 0; this.play = 0; }          // arm fresh record
      else if (this.prevMode === 1) { this.len = this.rec; this.play = 0; }   // close the loop
      if (mode === 0) this.play = 0;                                          // stop rewinds
      this.prevMode = mode;
    }

    for (let i = 0; i < n; i++) {
      const x = inCh ? inCh[i] : 0;
      let loop = 0;
      if (mode === 1) {
        if (this.rec < this.max) this.buf[this.rec++] = x;
      } else if ((mode === 2 || mode === 3) && this.len > 0) {
        loop = this.buf[this.play];
        if (mode === 3) this.buf[this.play] += x;                             // overdub
        if (++this.play >= this.len) this.play = 0;
      }
      out[i] = x + loop * level;
    }
    for (let c = 1; c < output.length; c++) output[c].set(out);
    return true;
  }
}

registerProcessor('looper-processor', LooperProcessor);
