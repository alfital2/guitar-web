// src/spectrum.js
export function spectrumBars(freqBytes, numBars) {
  const out = new Array(numBars).fill(0);
  const groupSize = Math.max(1, Math.floor(freqBytes.length / numBars));
  for (let b = 0; b < numBars; b++) {
    let sum = 0, n = 0;
    const start = b * groupSize;
    const end = (b === numBars - 1) ? freqBytes.length : start + groupSize;
    for (let i = start; i < end; i++) { sum += freqBytes[i]; n++; }
    out[b] = n ? (sum / n) / 255 : 0;
  }
  return out;
}
