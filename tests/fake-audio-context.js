function param(value) { return { value, setValueAtTime(v){ this.value = v; }, linearRampToValueAtTime(v){ this.value = v; } }; }

export class FakeNode {
  constructor(kind, ctx) { this.kind = kind; this.id = ctx._nextId++; this.ctx = ctx; }
  connect(node) { this.ctx.connections.push({ from: this.id, to: node.id, fromKind: this.kind, toKind: node.kind }); return node; }
  disconnect() { this.ctx.connections = this.ctx.connections.filter(c => c.from !== this.id); }
}

export class FakeAudioContext {
  constructor(sampleRate = 48000) { this.sampleRate = sampleRate; this._nextId = 0; this.connections = []; this.destination = new FakeNode('destination', this); }
  _mk(kind, extra = {}) { return Object.assign(new FakeNode(kind, this), extra); }
  createGain() { return this._mk('gain', { gain: param(1) }); }
  createWaveShaper() { return this._mk('waveshaper', { curve: null, oversample: 'none' }); }
  createBiquadFilter() { return this._mk('biquad', { type: 'peaking', frequency: param(350), Q: param(1), gain: param(0) }); }
  createDynamicsCompressor() { return this._mk('compressor', { threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) }); }
  createDelay() { return this._mk('delay', { delayTime: param(0) }); }
  createConvolver() { return this._mk('convolver', { buffer: null }); }
  createOscillator() {
    const ctx = this;
    const n = this._mk('oscillator', { frequency: { value: 440 }, type: 'sine' });
    n.start = () => { ctx.oscStarts = (ctx.oscStarts || 0) + 1; };
    n.stop = () => {};
    return n;
  }
  createBuffer(channels, length, rate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate: rate, getChannelData: i => data[i] };
  }
}
