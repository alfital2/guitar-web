// Lightning — crackling bolt (raw WebGL1, no ogl). Ported from react-bits
// (MIT + Commons Clause); shader verbatim.
import { rafLoop } from './_loop.js';

const VERT = `
  attribute vec2 aPosition;
  void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

const FRAG = `
  precision mediump float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform float uHue;
  uniform float uXOffset;
  uniform float uSpeed;
  uniform float uIntensity;
  uniform float uSize;
  #define OCTAVE_COUNT 10
  vec3 hsv2rgb(vec3 c) {
      vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      return c.z * mix(vec3(1.0), rgb, c.y);
  }
  float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  mat2 rotate2d(float theta) { float c = cos(theta); float s = sin(theta); return mat2(c, -s, s, c); }
  float noise(vec2 p) {
      vec2 ip = floor(p); vec2 fp = fract(p);
      float a = hash12(ip);
      float b = hash12(ip + vec2(1.0, 0.0));
      float c = hash12(ip + vec2(0.0, 1.0));
      float d = hash12(ip + vec2(1.0, 1.0));
      vec2 t = smoothstep(0.0, 1.0, fp);
      return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
  }
  float fbm(vec2 p) {
      float value = 0.0; float amplitude = 0.5;
      for (int i = 0; i < OCTAVE_COUNT; ++i) { value += amplitude * noise(p); p *= rotate2d(0.45); p *= 2.0; amplitude *= 0.5; }
      return value;
  }
  void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
      vec2 uv = fragCoord / iResolution.xy;
      uv = 2.0 * uv - 1.0;
      uv.x *= iResolution.x / iResolution.y;
      uv.x += uXOffset;
      uv += 2.0 * fbm(uv * uSize + 0.8 * iTime * uSpeed) - 1.0;
      float dist = abs(uv.x);
      vec3 baseColor = hsv2rgb(vec3(uHue / 360.0, 0.7, 0.8));
      vec3 col = baseColor * pow(mix(0.0, 0.07, hash11(iTime * uSpeed)) / dist, 1.0) * uIntensity;
      col = pow(col, vec3(1.0));
      float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
      fragColor = vec4(col, a);
  }
  void main() { mainImage(gl_FragColor, gl_FragCoord.xy); }
`;

function compile(gl, src, type) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[fx] lightning shader:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh); return null;
  }
  return sh;
}

export function createLightning(container, opts = {}) {
  const { hue = 40, fps = 30, renderScale = 0.7 } = opts;
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
  if (!gl) { return { unavailable: true, destroy() { canvas.remove(); } }; }

  const program = gl.createProgram();
  const vs = compile(gl, VERT, gl.VERTEX_SHADER);
  const fs = compile(gl, FRAG, gl.FRAGMENT_SHADER);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = n => gl.getUniformLocation(program, n);
  const uRes = u('iResolution'), uTime = u('iTime'), uHue = u('uHue'),
    uX = u('uXOffset'), uSpeed = u('uSpeed'), uInt = u('uIntensity'), uSize = u('uSize');

  function resize() {
    const dpr = Math.min((window.devicePixelRatio || 1) * renderScale, 1.5);
    canvas.width = Math.max(1, canvas.clientWidth * dpr);
    canvas.height = Math.max(1, canvas.clientHeight * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  const start = performance.now();
  const stop = rafLoop(() => {
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (performance.now() - start) / 1000);
    gl.uniform1f(uHue, hue);
    gl.uniform1f(uX, 0);
    gl.uniform1f(uSpeed, 0.7);
    gl.uniform1f(uInt, 0.7);
    gl.uniform1f(uSize, 1.7);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }, { fps });

  return {
    destroy() {
      stop();
      window.removeEventListener('resize', resize);
      canvas.remove();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  };
}
