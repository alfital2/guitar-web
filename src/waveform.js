// src/waveform.js
// Peak computation (pure) + canvas waveform render for recorded clips.

// Max-abs amplitude per bucket (length `buckets`, values 0…1).
export function computePeaks(samples, buckets) {
  const out = new Float32Array(buckets);
  if (!samples.length || buckets <= 0) return out;
  const per = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(samples.length, Math.floor((b + 1) * per));
    let peak = 0;
    for (let i = start; i < end; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
    out[b] = peak;
  }
  return out;
}

// Draw a centered min/max waveform across the canvas's pixel width.
export function drawWaveform(canvas, samples, { color = '#d8daf8' } = {}) {
  const c = canvas.getContext('2d');
  if (!c) return;
  const W = canvas.width, H = canvas.height;
  c.clearRect(0, 0, W, H);
  const peaks = computePeaks(samples, W);
  c.fillStyle = color;
  const mid = H / 2;
  for (let x = 0; x < W; x++) {
    const h = Math.max(1, peaks[x] * (H - 2));
    c.fillRect(x, mid - h / 2, 1, h);
  }
}
