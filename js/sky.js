// The hero sky: a fragment shader fed by real solar and lunar geometry.
// The view looks due south from the Clifton shore, so the Arabian Sea is the horizon,
// the sun rises on the left (east) and sets on the right (west).

import { sunPosition, moonPosition, moonPhase } from "./astro.js?v=1";

const HORIZON = 0.27; // share of the canvas height taken by the sea
const AZ_MIN = 60;
const AZ_SPAN = 240; // 60° (ENE) … 300° (WNW) across the canvas

// altitude (deg) → [zenith rgb, horizon rgb]
const SKY_KEYS = [
  [-90, [4, 6, 14], [9, 13, 28]],
  [-18, [4, 6, 14], [9, 13, 28]],
  [-12, [8, 13, 32], [24, 30, 58]],
  [-6, [18, 30, 72], [92, 74, 106]],
  [-2, [38, 62, 120], [216, 130, 94]],
  [1, [62, 104, 170], [240, 174, 122]],
  [6, [72, 128, 204], [216, 208, 198]],
  [15, [60, 124, 212], [176, 208, 236]],
  [45, [48, 112, 206], [160, 200, 236]],
  [90, [48, 112, 206], [160, 200, 236]],
];
const SUN_KEYS = [
  [-90, [255, 110, 60]],
  [-2, [255, 120, 62]],
  [3, [255, 168, 96]],
  [12, [255, 222, 176]],
  [25, [255, 244, 222]],
  [90, [255, 246, 228]],
];

const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function keyed(keys, x, slots) {
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const t = (x - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      return slots.map((s) => mix3(keys[i - 1][s], keys[i][s], t));
    }
  }
  return slots.map((s) => keys[keys.length - 1][s]);
}

export function skyPalette(alt, haze) {
  let [zen, hor] = keyed(SKY_KEYS, alt, [1, 2]);
  const [sun] = keyed(SUN_KEYS, alt, [1]);
  const day = smooth(-6, 6, alt);
  const golden = smooth(-4, 1, alt) * (1 - smooth(4, 14, alt));
  // Particulates flatten the blue and lift a tan band off the horizon by day;
  // at night they read as a dull city glow.
  hor = mix3(hor, mix3([34, 30, 30], [198, 188, 172], day), haze * 0.7);
  zen = mix3(zen, mix3([10, 11, 16], [124, 142, 166], day), haze * 0.38);
  const lit = mix3(mix3([40, 46, 66], [250, 250, 252], day), [255, 208, 172], golden * 0.8);
  const shade = mix3(mix3([14, 17, 28], [150, 162, 180], day), [104, 96, 124], golden * 0.6);
  const hazeCol = mix3([30, 27, 27], [204, 194, 178], day);
  return { zen, hor, sun, lit, shade, hazeCol, day };
}

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime;
uniform vec2 uSun; uniform vec2 uMoon;
uniform float uSunAlt, uCloud, uHaze, uNight, uMoonPhase, uMoonUp, uHy;
uniform vec3 uZen, uHor, uSunCol, uLit, uShade, uHazeCol;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
}
float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++){ s += a * noise(p); p = p * 2.03 + vec2(17., 9.); a *= .5; } return s; }
vec3 skyAt(float t){ return mix(uHor, uZen, pow(clamp(t, 0., 1.), .62)); }

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * asp, uv.y);
  vec2 sun = vec2(uSun.x * asp, uSun.y);
  vec2 moon = vec2(uMoon.x * asp, uMoon.y);
  float sunUp = smoothstep(-7., 2., uSunAlt);
  vec3 col;

  if (uv.y > uHy) {
    float t = (uv.y - uHy) / (1. - uHy);
    col = skyAt(t);

    // stars
    vec2 cell = floor(gl_FragCoord.xy / 2.6);
    float s = hash(cell);
    float star = step(.9962, s) * (.6 + .4 * sin(uTime * 1.3 + s * 80.)) * (.5 + fract(s * 91.7));
    col += star * uNight * (1. - uCloud) * smoothstep(.02, .3, t) * (1. - uHaze * .75);

    // sun
    float d = distance(p, sun);
    float glow = exp(-d * d * 70.) * .5 + exp(-d * 7.5) * .22 + exp(-d * 2.2) * .07;
    col += uSunCol * glow * .85 * sunUp * (1. - uCloud * .55);

    // moon, with its terminator
    vec2 m = (p - moon) / .017;
    float md = length(m);
    if (md < 1.2 && uMoonUp > .5) {
      float k = cos(6.2831853 * uMoonPhase);
      float side = uMoonPhase < .5 ? m.x : -m.x;
      float limb = sqrt(max(0., 1. - m.y * m.y));
      float lit = smoothstep(-.08, .08, side - k * limb);
      float inDisc = smoothstep(1.02, .94, md);
      vec3 mc = mix(col + vec3(.035), vec3(.93, .93, .88), lit);
      col = mix(col, mc, inDisc * (1. - uCloud * .7) * (.35 + .65 * uNight));
    }
    col += vec3(.75, .8, .9) * exp(-distance(p, moon) * 9.) * .1 * uMoonUp * uNight;

    // clouds, foreshortened toward the horizon
    vec2 q = vec2(p.x * (1.1 + (1. - t) * 1.6) + uTime * .008, pow(t, .72) * 3.2);
    float n = fbm(q * 1.35);
    float th = mix(.86, .26, uCloud);
    float dens = smoothstep(th, th + .24, n);
    vec3 cc = mix(uShade, uLit, smoothstep(.32, .78, fbm(q * 1.35 + vec2(.12, .2))));
    cc += uSunCol * exp(-d * 2.6) * .22 * sunUp;
    col = mix(col, cc, dens * .88 * smoothstep(0., .1, t));

    // haze hugs the horizon
    col = mix(col, uHazeCol, uHaze * (exp(-t * 4.2) * .82 + .1));

    // the disc itself, dulled a little by haze and cloud but never lost in them
    float disc = smoothstep(.0215, .0185, d) * step(uHy, uSun.y + .012);
    col = mix(col, mix(vec3(1., .99, .95), uSunCol, .12 + uHaze * .3), disc * (1. - uCloud * .5));
  } else {
    float depth = (uHy - uv.y) / uHy;
    vec3 refl = skyAt(depth * .55);
    col = refl * mix(.56, .2, depth) * vec3(.82, .9, 1.);
    col = mix(col, uHazeCol * .8, uHaze * exp(-depth * 7.) * .7);

    float spread = .012 + depth * .16;
    float rip = noise(vec2(p.x * 70., depth * 240. - uTime * .7));
    float dx = abs(p.x - sun.x);
    float glit = exp(-dx * dx / (spread * spread)) * smoothstep(.42, .92, rip);
    col += uSunCol * glit * .7 * (1. - depth * .45) * smoothstep(-3., 5., uSunAlt) * (1. - uCloud * .8);
    float mx = abs(p.x - moon.x);
    col += vec3(.8, .85, .95) * exp(-mx * mx / (spread * spread)) * smoothstep(.5, .95, rip) * .28 * uMoonUp * uNight * (1. - uCloud);

    col += (noise(vec2(p.x * 9., depth * 110. - uTime * .22)) - .5) * .022;
  }

  col += (hash(gl_FragCoord.xy + fract(uTime) * 100.) - .5) * .016;
  gl_FragColor = vec4(col, 1.);
}`;

export function createSky(canvas, { lat, lng, onFrame }) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const target = { time: Date.now(), cloud: 0, haze: 0 };
  const cur = { time: Date.now(), cloud: 0, haze: 0 };
  let gl = null;
  try {
    gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
  } catch (e) {
    gl = null;
  }

  let U = null;
  if (gl) {
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      U = {};
      for (const n of ["uRes", "uTime", "uSun", "uMoon", "uSunAlt", "uCloud", "uHaze", "uNight", "uMoonPhase", "uMoonUp", "uHy", "uZen", "uHor", "uSunCol", "uLit", "uShade", "uHazeCol"])
        U[n] = gl.getUniformLocation(prog, n);
    } catch (e) {
      console.warn("Sky shader unavailable, using a gradient instead.", e);
      gl = null;
    }
  }
  if (!gl) canvas.classList.add("is-flat");

  let w = 0, h = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (cw === w && ch === h) return;
    w = cw; h = ch;
    canvas.width = w; canvas.height = h;
    if (gl) gl.viewport(0, 0, w, h);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  let visible = true;
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(canvas);

  const place = (pos) => ({
    x: (((pos.azimuth - AZ_MIN) % 360) + 360) % 360 / AZ_SPAN,
    y: HORIZON + (pos.altitude / 90) * (1 - HORIZON) * 0.94,
  });
  const v3 = (c) => [c[0] / 255, c[1] / 255, c[2] / 255];

  let last = performance.now();
  const t0 = last;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!visible || document.hidden) return;

    const k = reduce ? 1 : 1 - Math.exp(-dt * 5);
    cur.time += (target.time - cur.time) * k;
    cur.cloud += (target.cloud - cur.cloud) * k;
    cur.haze += (target.haze - cur.haze) * k;

    const sp = sunPosition(cur.time, lat, lng);
    const mp = moonPosition(cur.time, lat, lng);
    const ph = moonPhase(cur.time);
    const sun = place(sp), moon = place(mp);
    const pal = skyPalette(sp.altitude, cur.haze);
    const night = 1 - smooth(-12, -3, sp.altitude);
    // a bright moon lifts the night sky off black
    const moonlight = night * ph.fraction * smooth(-2, 12, mp.altitude) * 0.55;
    pal.zen = mix3(pal.zen, [18, 27, 54], moonlight);
    pal.hor = mix3(pal.hor, [30, 40, 70], moonlight);

    if (gl) {
      gl.uniform2f(U.uRes, w, h);
      gl.uniform1f(U.uTime, reduce ? 0 : (now - t0) / 1000);
      gl.uniform2f(U.uSun, sun.x, sun.y);
      gl.uniform2f(U.uMoon, moon.x, moon.y);
      gl.uniform1f(U.uSunAlt, sp.altitude);
      gl.uniform1f(U.uCloud, cur.cloud);
      gl.uniform1f(U.uHaze, cur.haze);
      gl.uniform1f(U.uNight, night);
      gl.uniform1f(U.uMoonPhase, ph.phase);
      gl.uniform1f(U.uMoonUp, mp.altitude > -0.5 ? 1 : 0);
      gl.uniform1f(U.uHy, HORIZON);
      gl.uniform3fv(U.uZen, v3(pal.zen));
      gl.uniform3fv(U.uHor, v3(pal.hor));
      gl.uniform3fv(U.uSunCol, v3(pal.sun));
      gl.uniform3fv(U.uLit, v3(pal.lit));
      gl.uniform3fv(U.uShade, v3(pal.shade));
      gl.uniform3fv(U.uHazeCol, v3(pal.hazeCol));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      const c = (a) => `rgb(${a.map(Math.round).join(",")})`;
      const sea = pal.zen.map((v) => v * 0.3);
      canvas.style.background = `linear-gradient(180deg, ${c(pal.zen)} 0%, ${c(pal.hor)} ${(1 - HORIZON) * 100}%, ${c(sea)} ${(1 - HORIZON) * 100 + 0.2}%, ${c(sea.map((v) => v * 0.5))} 100%)`;
    }

    onFrame && onFrame({
      sun: { x: sun.x, y: 1 - sun.y, alt: sp.altitude, az: sp.azimuth },
      moon: { x: moon.x, y: 1 - moon.y, alt: mp.altitude, az: mp.azimuth, fraction: ph.fraction, name: ph.name },
      horizonY: 1 - HORIZON,
      day: pal.day,
    });
  }
  requestAnimationFrame(frame);

  return {
    set(next) { Object.assign(target, next); },
    azToX: (az) => (az - AZ_MIN) / AZ_SPAN,
    horizon: HORIZON,
  };
}
