// Light Rays — volumetric god-rays from the top (stage-spotlight feel). Ported
// from react-bits (MIT + Commons Clause); shader verbatim. Vendored ogl.
import { Renderer, Program, Triangle, Mesh } from '../vendor/ogl.module.js';
import { rafLoop, cappedDpr } from './_loop.js';

const VERT = `
attribute vec2 position;
varying vec2 vUv;
void main() { vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }
`;

const FRAG = `precision highp float;
uniform float iTime;
uniform vec2  iResolution;
uniform vec2  rayPos;
uniform vec2  rayDir;
uniform vec3  raysColor;
uniform float raysSpeed;
uniform float lightSpread;
uniform float rayLength;
uniform float pulsating;
uniform float fadeDistance;
uniform float saturation;
uniform vec2  mousePos;
uniform float mouseInfluence;
uniform float noiseAmount;
uniform float distortion;
varying vec2 vUv;
float noise(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }
float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord, float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  vec2 dirNorm = normalize(sourceToCoord);
  float cosAngle = dot(dirNorm, rayRefDirection);
  float distortedAngle = cosAngle + distortion * sin(iTime * 2.0 + length(sourceToCoord) * 0.01) * 0.2;
  float spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / max(lightSpread, 0.001));
  float distance = length(sourceToCoord);
  float maxDistance = iResolution.x * rayLength;
  float lengthFalloff = clamp((maxDistance - distance) / maxDistance, 0.0, 1.0);
  float fadeFalloff = clamp((iResolution.x * fadeDistance - distance) / (iResolution.x * fadeDistance), 0.5, 1.0);
  float pulse = pulsating > 0.5 ? (0.8 + 0.2 * sin(iTime * speed * 3.0)) : 1.0;
  float baseStrength = clamp(
    (0.45 + 0.15 * sin(distortedAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-distortedAngle * seedB + iTime * speed)), 0.0, 1.0);
  return baseStrength * lengthFalloff * fadeFalloff * spreadFactor * pulse;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
  vec2 finalRayDir = rayDir;
  if (mouseInfluence > 0.0) {
    vec2 mouseScreenPos = mousePos * iResolution.xy;
    vec2 mouseDirection = normalize(mouseScreenPos - rayPos);
    finalRayDir = normalize(mix(rayDir, mouseDirection, mouseInfluence));
  }
  vec4 rays1 = vec4(1.0) * rayStrength(rayPos, finalRayDir, coord, 36.2214, 21.11349, 1.5 * raysSpeed);
  vec4 rays2 = vec4(1.0) * rayStrength(rayPos, finalRayDir, coord, 22.3991, 18.0234, 1.1 * raysSpeed);
  fragColor = rays1 * 0.5 + rays2 * 0.4;
  if (noiseAmount > 0.0) { float n = noise(coord * 0.01 + iTime * 0.1); fragColor.rgb *= (1.0 - noiseAmount + noiseAmount * n); }
  float brightness = 1.0 - (coord.y / iResolution.y);
  fragColor.x *= 0.1 + brightness * 0.8;
  fragColor.y *= 0.3 + brightness * 0.6;
  fragColor.z *= 0.5 + brightness * 0.5;
  if (saturation != 1.0) { float gray = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114)); fragColor.rgb = mix(vec3(gray), fragColor.rgb, saturation); }
  fragColor.rgb *= raysColor;
}
void main() { vec4 color; mainImage(color, gl_FragCoord.xy); gl_FragColor = color; }`;

export function createLightRays(container, opts = {}) {
  const { accent = [1.0, 0.81, 0.42], renderScale = 0.8, fps = 30 } = opts;

  const renderer = new Renderer({ dpr: cappedDpr(renderScale, 2), alpha: true });
  const gl = renderer.gl;
  gl.canvas.style.width = '100%';
  gl.canvas.style.height = '100%';
  container.appendChild(gl.canvas);

  const uniforms = {
    iTime: { value: 0 }, iResolution: { value: [1, 1] },
    rayPos: { value: [0, 0] }, rayDir: { value: [0, 1] },
    raysColor: { value: accent },
    raysSpeed: { value: 0.8 }, lightSpread: { value: 0.7 }, rayLength: { value: 2.6 },
    pulsating: { value: 0.0 }, fadeDistance: { value: 1.0 }, saturation: { value: 1.0 },
    mousePos: { value: [0.5, 0.5] }, mouseInfluence: { value: 0.08 },
    noiseAmount: { value: 0.08 }, distortion: { value: 0.04 }
  };
  const program = new Program(gl, { vertex: VERT, fragment: FRAG, uniforms });
  const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

  function place() {
    renderer.dpr = cappedDpr(renderScale, 2);
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h);
    const dpr = renderer.dpr;
    uniforms.iResolution.value = [w * dpr, h * dpr];
    uniforms.rayPos.value = [0.5 * w * dpr, -0.2 * h * dpr]; // top-center anchor
    uniforms.rayDir.value = [0, 1];
  }
  window.addEventListener('resize', place);
  place();

  const stop = rafLoop(t => {
    const s = t * 0.001;
    uniforms.iTime.value = s;
    // Autonomous sway (replaces cursor input): rays gently lean side to side.
    uniforms.mousePos.value = [0.5 + 0.25 * Math.sin(s * 0.08), 0.35 + 0.05 * Math.sin(s * 0.05)];
    renderer.render({ scene: mesh });
  }, { fps });

  return {
    destroy() {
      stop();
      window.removeEventListener('resize', place);
      gl.canvas.remove();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  };
}
