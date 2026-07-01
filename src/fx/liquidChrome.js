// Liquid Chrome — flowing molten-metal shader. Ported from react-bits (MIT +
// Commons Clause) to a vanilla factory; shader verbatim. Uses vendored ogl.
import { Renderer, Program, Mesh, Triangle } from '../vendor/ogl.module.js';
import { rafLoop, cappedDpr } from './_loop.js';

const VERT = `
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }
`;

const FRAG = `
  precision highp float;
  uniform float uTime;
  uniform vec3 uResolution;
  uniform vec3 uBaseColor;
  uniform float uAmplitude;
  uniform float uFrequencyX;
  uniform float uFrequencyY;
  uniform vec2 uMouse;
  varying vec2 vUv;

  vec4 renderImage(vec2 uvCoord) {
      vec2 fragCoord = uvCoord * uResolution.xy;
      vec2 uv = (2.0 * fragCoord - uResolution.xy) / min(uResolution.x, uResolution.y);
      for (float i = 1.0; i < 10.0; i++){
          uv.x += uAmplitude / i * cos(i * uFrequencyX * uv.y + uTime + uMouse.x * 3.14159);
          uv.y += uAmplitude / i * cos(i * uFrequencyY * uv.x + uTime + uMouse.y * 3.14159);
      }
      vec2 diff = (uvCoord - uMouse);
      float dist = length(diff);
      float falloff = exp(-dist * 20.0);
      float ripple = sin(10.0 * dist - uTime * 2.0) * 0.03;
      uv += (diff / (dist + 0.0001)) * ripple * falloff;
      vec3 color = uBaseColor / abs(sin(uTime - uv.y - uv.x));
      return vec4(color, 1.0);
  }

  void main() {
      // Single sample (was a 3x3 supersample — 9x the GPU cost for a barely
      // visible smoothness gain; dropped so it runs much cooler).
      gl_FragColor = renderImage(vUv);
  }
`;

export function createLiquidChrome(container, opts = {}) {
  const { accent = [0.94, 0.71, 0.16], renderScale = 0.5, fps = 30 } = opts;
  // Dark tint of the accent so the metal reads as brushed brass, not white-hot.
  const baseColor = [accent[0] * 0.14, accent[1] * 0.1, accent[2] * 0.05];

  const renderer = new Renderer({ antialias: false, dpr: cappedDpr(renderScale, 1.5) });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 1);

  const program = new Program(gl, {
    vertex: VERT,
    fragment: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uResolution: { value: new Float32Array([1, 1, 1]) },
      uBaseColor: { value: new Float32Array(baseColor) },
      uAmplitude: { value: 0.35 },
      uFrequencyX: { value: 3 },
      uFrequencyY: { value: 3 },
      uMouse: { value: new Float32Array([0, 0]) }
    }
  });
  const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

  function resize() {
    renderer.setSize(container.offsetWidth, container.offsetHeight);
    const r = program.uniforms.uResolution.value;
    r[0] = gl.canvas.width; r[1] = gl.canvas.height; r[2] = gl.canvas.width / gl.canvas.height;
  }
  window.addEventListener('resize', resize);
  container.appendChild(gl.canvas);
  resize();

  const stop = rafLoop(t => {
    const s = t * 0.001;
    program.uniforms.uTime.value = s * 0.28;
    // Autonomous drift (replaces cursor input): slow Lissajous sweep.
    program.uniforms.uMouse.value[0] = 0.5 + 0.5 * Math.sin(s * 0.05);
    program.uniforms.uMouse.value[1] = 0.5 + 0.5 * Math.cos(s * 0.037);
    renderer.render({ scene: mesh });
  }, { fps });

  return {
    destroy() {
      stop();
      window.removeEventListener('resize', resize);
      gl.canvas.remove();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  };
}
