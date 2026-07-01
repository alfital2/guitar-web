// Iridescence — shimmering shader field. Ported from react-bits (MIT + Commons
// Clause); shader verbatim. Vendored ogl.
import { Renderer, Program, Mesh, Color, Triangle } from '../vendor/ogl.module.js';
import { rafLoop, cappedDpr } from './_loop.js';

const VERT = `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 0, 1); }
`;

const FRAG = `
precision highp float;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uResolution;
uniform vec2 uMouse;
uniform float uAmplitude;
uniform float uSpeed;
varying vec2 vUv;
void main() {
  float mr = min(uResolution.x, uResolution.y);
  vec2 uv = (vUv.xy * 2.0 - 1.0) * uResolution.xy / mr;
  uv += (uMouse - vec2(0.5)) * uAmplitude;
  float d = -uTime * 0.5 * uSpeed;
  float a = 0.0;
  for (float i = 0.0; i < 8.0; ++i) {
    a += cos(i - d - a * uv.x);
    d += sin(uv.y * i + a);
  }
  d += uTime * 0.5 * uSpeed;
  vec3 col = vec3(cos(uv * vec2(d, a)) * 0.6 + 0.4, cos(a + d) * 0.5 + 0.5);
  col = cos(col * cos(vec3(d, a, 2.5)) * 0.5 + 0.5) * uColor;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createIridescence(container, opts = {}) {
  const { accent = [0.95, 0.62, 0.26], renderScale = 0.7, fps = 30 } = opts;

  const renderer = new Renderer({ dpr: cappedDpr(renderScale, 1.5) });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 1);

  const program = new Program(gl, {
    vertex: VERT,
    fragment: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new Color(...accent) },
      uResolution: { value: new Color(1, 1, 1) },
      uMouse: { value: new Float32Array([0.5, 0.5]) },
      uAmplitude: { value: 0.1 },
      uSpeed: { value: 0.7 }
    }
  });
  const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

  function resize() {
    renderer.setSize(container.offsetWidth, container.offsetHeight);
    program.uniforms.uResolution.value = new Color(gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height);
  }
  window.addEventListener('resize', resize);
  container.appendChild(gl.canvas);
  resize();

  const stop = rafLoop(t => {
    const s = t * 0.001;
    program.uniforms.uTime.value = s;
    // Autonomous drift (replaces cursor input): slow parallax of the field.
    program.uniforms.uMouse.value[0] = 0.5 + 0.5 * Math.sin(s * 0.04);
    program.uniforms.uMouse.value[1] = 0.5 + 0.5 * Math.cos(s * 0.031);
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
