// Real-time pitch shifter (AudioWorklet). Variable-delay crossfade method: two
// delay taps sweep a grain-length window in anti-phase; each is windowed by a
// half-sine so the wrap discontinuity is masked. Shift ratio = 2^(semitones/12).
// Polyphonic but artifact-prone on big shifts — fine for ±octave guitar.
class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'semitones', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.size = 1 << 15;                 // circular input buffer (32768 samples)
    this.buf = new Float32Array(this.size);
    this.write = 0;
    this.phase = 0;                      // 0..1 position within the grain window
    this.grain = Math.max(256, Math.floor(sampleRate * 0.08)); // ~80ms window
    this.destroyed = false;              // set by {type:'destroy'} so an abandoned
    // node stops being scheduled (process() returning true pins it alive forever)
    this.port.onmessage = (e) => { if (e.data && e.data.type === 'destroy') this.destroyed = true; };
  }

  read(pos) {
    const size = this.size, buf = this.buf;
    while (pos < 0) pos += size;
    while (pos >= size) pos -= size;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const i1 = i0 + 1 >= size ? 0 : i0 + 1;
    return buf[i0] * (1 - frac) + buf[i1] * frac;
  }

  process(inputs, outputs, params) {
    if (this.destroyed) return false;
    const output = outputs[0];
    if (!output || !output.length) return true;
    const input = inputs[0];
    const inCh = input && input[0] ? input[0] : null;
    const out = output[0];
    const n = out.length;

    const ratio = Math.pow(2, params.semitones[0] / 12);
    const mix = params.mix[0];
    const grain = this.grain;
    const inc = (1 - ratio) / grain;     // delay sweep rate per sample

    for (let i = 0; i < n; i++) {
      const x = inCh ? inCh[i] : 0;
      this.buf[this.write] = x;

      let p1 = this.phase;
      let p2 = p1 + 0.5; if (p2 >= 1) p2 -= 1;
      const s1 = this.read(this.write - p1 * grain);
      const s2 = this.read(this.write - p2 * grain);
      const wet = s1 * Math.sin(Math.PI * p1) + s2 * Math.sin(Math.PI * p2);

      out[i] = x * (1 - mix) + wet * mix;

      this.phase += inc;
      if (this.phase >= 1) this.phase -= 1;
      else if (this.phase < 0) this.phase += 1;
      this.write = this.write + 1 >= this.size ? 0 : this.write + 1;
    }
    for (let c = 1; c < output.length; c++) output[c].set(out);
    return true;
  }
}

registerProcessor('pitchshift-processor', PitchShiftProcessor);
