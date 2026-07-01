// Shared render-loop helper for the WebGL backgrounds.
// Guards every effect the same way: FPS cap + pause when the tab is hidden.
// GPU cost stays bounded so the real-time audio thread is never starved.
// Pause rendering when the app window loses focus — no point heating the GPU
// while the user is in another app. Shared across every effect (module is a
// singleton, so these listeners are registered once).
let appFocused = !document.hidden;
window.addEventListener('focus', () => { appFocused = true; });
window.addEventListener('blur', () => { appFocused = false; });

export function rafLoop(render, { fps = 60 } = {}) {
  const interval = 1000 / fps;
  let last = 0;
  let id = 0;
  let stopped = false;

  function frame(t) {
    if (stopped) return;
    id = requestAnimationFrame(frame);
    if (document.hidden || !appFocused) return;  // unseen / unfocused → idle
    if (t - last < interval) return;             // FPS cap
    last = t;
    render(t);
  }
  id = requestAnimationFrame(frame);

  return () => {
    stopped = true;
    cancelAnimationFrame(id);
  };
}

// Cap the drawing-buffer resolution. Full-screen fragment shaders cost scales
// with pixel count, so we render below native res and let CSS upscale — on a
// soft glow it's imperceptible but much cheaper on integrated GPUs.
export function cappedDpr(scale = 1, max = 2) {
  return Math.min((window.devicePixelRatio || 1) * scale, max);
}
