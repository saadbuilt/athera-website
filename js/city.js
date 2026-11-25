// Karachi, all of it, at true scale.
// Buildings: Google Open Buildings v3 footprints with 2023 heights from Open Buildings 2.5D Temporal.
// Ground: Sentinel-2 cloudless 2023 (EOX). Terrain: Copernicus GLO-30. Weather: whatever app.js passes in.
// Units: 1 = 1 km. +x east, −z north, +y up. Frame origin 67.0°E 24.9°N.
import * as THREE from "./vendor/three.module.min.js";
import { sunPosition, moonPosition, moonPhase } from "./astro.js?v=1";
import { skyPalette } from "./sky.js?v=1";

const BASE = new URL("../data/city/", import.meta.url);
const LAT = 24.8607, LNG = 67.0011;
const KX = 101.0, KZ = 110.6;
const toX = (lng) => (lng - 67) * KX;
const toZ = (lat) => -(lat - 24.9) * KZ;
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const MAX_D = 42;

// Places to fly to: [name, lng, lat, distance km, tilt (0 = straight down), heading deg]
export const PLACES = [
  ["All of Karachi", 67.07, 24.92, 30, 1.1, 0],
  ["Clifton & Sea View", 67.03, 24.806, 2.2, 1.18, 25],
  ["Saddar & Mazar-e-Quaid", 67.036, 24.866, 2.6, 1.08, -30],
  ["I.I. Chundrigar Road", 67.005, 24.849, 1.3, 1.2, 40],
  ["Keamari & the port", 66.984, 24.835, 3.6, 1.05, 70],
  ["Lyari", 66.996, 24.867, 1.6, 1.12, 0],
  ["Gulshan-e-Iqbal", 67.093, 24.92, 2.6, 1.08, -20],
  ["Orangi Town", 66.99, 24.953, 3.4, 1.1, 160],
  ["Korangi", 67.128, 24.832, 3.4, 1.08, 10],
  ["Jinnah International", 67.163, 24.904, 3.8, 1.0, -60],
  ["Bahria Town", 67.315, 25.005, 4.5, 1.05, 30],
  ["Port Qasim", 67.33, 24.775, 6, 1.05, 0],
  ["Hawke's Bay", 66.875, 24.86, 3.2, 1.15, 200],
];

const GLSL_NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1., 0.)), f.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(17., 9.); a *= .5; } return s; }
uniform vec2 uWindOff; uniform float uCloudTh; uniform vec3 uSunDir; uniform float uCloudAlt;
float cloudAt(vec2 xz){ return smoothstep(uCloudTh, uCloudTh + .22, fbm(xz * .085 + uWindOff)); }
float cloudShadow(vec3 p){
  vec2 q = p.xz + uSunDir.xz / max(uSunDir.y, .08) * (uCloudAlt - p.y);
  return 1. - .62 * cloudAt(q);
}`;

// The sea, shared by the ground and the far water plane so that coast and open water match exactly.
// Returns a linear colour; call before tone mapping.
const GLSL_WATER = /* glsl */ `
uniform vec3 uZen, uHor, uSunCol, uMoonDir; uniform float uTime, uWave, uNight, uMoonLit;
vec2 waves(vec2 p, float t, float px){
  vec2 g = vec2(0.);
  g += vec2(cos(p.x * 9. + p.y * 4. + t * 1.3), cos(p.y * 7. - p.x * 3. + t * 1.1)) * .5 * (1. - smoothstep(.02, .07, px));
  g += vec2(vnoise(p * 38. + t * .6) - .5, vnoise(p * 41. - t * .5 + 7.) - .5) * 1.4 * (1. - smoothstep(.006, .02, px));
  g += vec2(vnoise(p * 140. + t * 1.4) - .5, vnoise(p * 150. - t * 1.2 + 3.) - .5) * .9 * (1. - smoothstep(.0015, .005, px));
  return g;
}
vec3 waterColor(vec3 wp, vec3 tint){
  vec3 V = normalize(cameraPosition - wp);
  float dist = length(cameraPosition - wp);
  float px = length(fwidth(wp.xz));
  float amp = .035 + uWave * .05;
  vec2 g = waves(wp.xz, uTime, px) * amp;
  vec3 N = normalize(vec3(g.x, 1., g.y));
  vec3 R = reflect(-V, N);
  float fres = .02 + .98 * pow(1. - max(dot(N, V), 0.), 5.);
  vec3 skyR = mix(uHor, uZen, pow(clamp(R.y, 0., 1.), .5));
  vec3 deep = mix(vec3(.018, .05, .062), tint, .6) * (1. - uNight * .85);
  vec3 col = mix(deep, skyR, fres);
  float far = 1. - smoothstep(30., 120., dist);
  float sd = max(dot(R, uSunDir), 0.);
  col += uSunCol * (pow(sd, 700.) * 5. + pow(sd, 60.) * .18) * smoothstep(-.02, .06, uSunDir.y) * cloudShadow(wp) * far;
  col += vec3(.8, .85, 1.) * pow(max(dot(R, uMoonDir), 0.), 300.) * 1.2 * uMoonLit * far;
  return col;
}`;

export function createCity(stage, opts = {}) {
  const canvas = stage.querySelector("canvas");
  const ui = {
    pins: stage.querySelector(".stage__pins"),
    status: stage.querySelector("[data-status]"),
    bar: stage.querySelector("[data-progress] i"),
    when: stage.querySelector("[data-when]"),
    time: stage.querySelector("[data-time]"),
    cond: stage.querySelector("[data-cond]"),
    places: stage.querySelector("[data-places]"),
    scale: stage.querySelector(".stage__scale i"),
    scaleTx: stage.querySelector(".stage__scale span"),
    north: stage.querySelector("[data-north] svg"),
    hint: stage.querySelector(".stage__hint"),
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 700;
  const q = new URLSearchParams(location.search);
  const lite = q.has("citylite");
  const noShadow = q.has("noshadow") || lite;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, logarithmicDepthBuffer: true, powerPreference: "high-performance" });
  if (!renderer.capabilities.isWebGL2) throw new Error("WebGL2 is required for the city");
  let dprCap = lite ? 0.5 : q.has("dpr") ? +q.get("dpr") : coarse ? 1.5 : 1.75;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = !noShadow;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xc8cdd2, 0.02);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.002, 420);

  /* ---------- shared uniforms ---------- */
  const U = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uWindOff: { value: new THREE.Vector2() },
    uCloudTh: { value: 2 },
    uCloudAlt: { value: 1.7 },
    uNight: { value: 0 },
    uTime: { value: 0 },
    uZen: { value: new THREE.Color() },
    uHor: { value: new THREE.Color() },
    uSat: { value: null },
    uDensity: { value: null },
    uWater: { value: null },
    uWorldWater: { value: null },
    uExt: { value: new THREE.Vector4() },      // city data: x0, x1, n0, n1 (km)
    uWorldExt: { value: new THREE.Vector4() }, // surroundings
    uCentre: { value: new THREE.Vector2(toX(67.07), toZ(24.92)) },
    uWave: { value: 0.4 },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uMoonLit: { value: 0 },
    uLit: { value: new THREE.Color() },
    uShade: { value: new THREE.Color() },
  };
  const fogU = () => ({ ...U, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) });

  /* ---------- lights ---------- */
  const hemi = new THREE.HemisphereLight(0xffffff, 0xd8d2c6, 0.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(coarse ? 2048 : 4096, coarse ? 2048 : 4096);
  sun.shadow.bias = -0.00002;
  scene.add(sun, sun.target);

  /* ---------- sky dome (its horizon colour is the fog colour, so they meet without a seam) ---------- */
  const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 48, 24), new THREE.ShaderMaterial({
    uniforms: U, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    vertexShader: /* glsl */ `varying vec3 vDir;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `varying vec3 vDir;
      uniform vec3 uZen, uHor, uSunCol, uSunDir, uMoonDir; uniform float uNight, uMoonLit, uTime;
      #include <logdepthbuf_pars_fragment>
      float hh(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){
        #include <logdepthbuf_fragment>
        vec3 d = normalize(vDir);
        float t = clamp(d.y, 0., 1.);
        vec3 col = d.y < 0. ? uHor : mix(uHor, uZen, pow(t, .5));
        float sd = max(dot(d, uSunDir), 0.);
        float up = smoothstep(-.12, .03, uSunDir.y);
        col += uSunCol * (pow(sd, 6.) * .2 + pow(sd, 90.) * .5) * up;
        col = mix(col, vec3(1., .98, .93) * 1.6, smoothstep(.99955, .9998, sd) * step(-.02, uSunDir.y));
        float md = max(dot(d, uMoonDir), 0.);
        col += vec3(.75, .8, .9) * (smoothstep(.99975, .99988, md) * .9 + pow(md, 400.) * .12) * uMoonLit;
        float s = hh(floor(d * 380.));
        col += step(.9975, s) * uNight * smoothstep(.02, .25, d.y) * (.4 + .6 * fract(s * 77.)) * (.7 + .3 * sin(uTime * 2. + s * 50.));
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  /* ---------- cloud layer ---------- */
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.ShaderMaterial({
    uniforms: fogU(), transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `varying vec3 vW;
      #include <common>
      #include <fog_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <logdepthbuf_vertex>
      #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `varying vec3 vW; uniform vec3 uLit, uShade;
      ${GLSL_NOISE}
      #include <common>
      #include <fog_pars_fragment>
      #include <logdepthbuf_pars_fragment>
      void main(){
        #include <logdepthbuf_fragment>
        float c = cloudAt(vW.xz);
        vec3 toCam = cameraPosition - vW;
        c *= smoothstep(.04, .22, abs(toCam.y) / length(toCam)) * (1. - smoothstep(35., 110., length(toCam)));
        if (c < .01) discard;
        float lit = smoothstep(.2, .9, fbm(vW.xz * .085 + uWindOff + uSunDir.xz * .05));
        gl_FragColor = vec4(mix(uShade, uLit, lit), c * .93);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  }));
  clouds.rotation.x = -Math.PI / 2;
  clouds.position.y = 1.7;
  clouds.renderOrder = 5;
  scene.add(clouds);

  /* ---------- ground: city tiles and the surroundings share one shader ---------- */
  // kind "city": 10 m imagery, 20 m water mask, night lights.
  // kind "world": 125 m imagery for 300 km around, hidden where the city tiles are, fading into haze.
  function patchGround(mat, kind) {
    const world = kind === "world";
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vW;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
          varying vec3 vW;
          uniform sampler2D uDensity, uWater, uWorldWater; uniform vec4 uExt, uWorldExt; uniform vec2 uCentre;
          ${GLSL_NOISE}
          ${GLSL_WATER}
          vec2 extUv(vec4 e){ return vec2((vW.x - e.x) / (e.y - e.x), (-vW.z - e.z) / (e.w - e.z)); }`)
        .replace("#include <map_fragment>", `
          ${world ? `{ vec2 c = extUv(uExt); float m = .25 / (uExt.y - uExt.x);
             if (c.x > m && c.x < 1. - m && c.y > m * 1.4 && c.y < 1. - m * 1.4) discard; }` : ""}
          #include <map_fragment>
          diffuseColor.rgb = pow(diffuseColor.rgb, vec3(1.08)) * 1.1;
          ${world ? "" : `{
            // close up, 10 m pixels need texture inside them: grit, patches and wear, scaled to the surface type
            float gpx = length(fwidth(vW.xz));
            float near = 1. - smoothstep(.0015, .006, gpx);
            if (near > .001) {
              float lum = dot(diffuseColor.rgb, vec3(.333));
              float grit = vnoise(vW.xz * 4200.) * .5 + vnoise(vW.xz * 1500.) * .3 + vnoise(vW.xz * 380.) * .2;
              float blot = smoothstep(.35, .75, vnoise(vW.xz * 160.));
              vec3 dusty = vec3(.62, .56, .46) * (lum * 1.6);
              vec3 detail = diffuseColor.rgb * (.82 + .36 * grit);
              detail = mix(detail, mix(detail, dusty, .35), blot * .5);
              diffuseColor.rgb = mix(diffuseColor.rgb, detail, near);
            }
            // where the city is dense the ground between blocks is street: asphalt, patched and dusty
            float dU = texture2D(uDensity, extUv(uExt)).r;
            float paved = smoothstep(.18, .5, dU);
            float wear = vnoise(vW.xz * 600.) * .6 + vnoise(vW.xz * 2400.) * .4;
            vec3 asphalt = mix(vec3(.24, .24, .235), vec3(.36, .34, .31), wear) * (.9 + .2 * dot(diffuseColor.rgb, vec3(.5)));
            diffuseColor.rgb = mix(diffuseColor.rgb, asphalt, paved * .7);
          }`}
          float wm = ${world ? "texture2D(uWorldWater, extUv(uWorldExt)).r" : "texture2D(uWater, extUv(uExt)).r"};
          wm = smoothstep(.35, .65, wm);`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          ${world ? "" : `
          float dens = texture2D(uDensity, extUv(uExt)).r;
          float px = length(fwidth(vW.xz));
          vec2 fc = fract(vW.xz * 66.) - .5;
          float lamp = step(.9 - dens * .3, h21(floor(vW.xz * 66.))) * exp(-dot(fc, fc) * 26.);
          float avgLamp = (.12 + dens * .25) * .055 * (.4 + 1.2 * vnoise(vW.xz * 9.));
          float lights = mix(lamp, avgLamp, smoothstep(.004, .02, px));
          totalEmissiveRadiance += vec3(1., .64, .32) * (lights * 2.2 * smoothstep(.04, .3, dens) + dens * .02) * uNight * (1. - wm);`}`)
        .replace("#include <aomap_fragment>", `float cs = cloudShadow(vW); reflectedLight.directDiffuse *= cs; reflectedLight.directSpecular *= cs;\n#include <aomap_fragment>`)
        .replace("#include <opaque_fragment>", `#include <opaque_fragment>
          if (wm > .001) gl_FragColor.rgb = mix(gl_FragColor.rgb, waterColor(vW, diffuseColor.rgb * .55), wm);`)
        .replace("#include <fog_fragment>", `#include <fog_fragment>
          ${world ? `#ifdef USE_FOG
            gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(60., 130., length(vW.xz - uCentre)));
          #endif` : ""}`);
    };
    mat.customProgramCacheKey = () => "ground-" + kind;
    return mat;
  }

  /* ---------- open sea beyond the surroundings ---------- */
  const farSea = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.ShaderMaterial({
    uniforms: fogU(), fog: true,
    vertexShader: /* glsl */ `varying vec3 vW;
      #include <common>
      #include <fog_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <logdepthbuf_vertex>
      #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `varying vec3 vW; uniform vec2 uCentre;
      ${GLSL_NOISE}
      ${GLSL_WATER}
      #include <common>
      #include <fog_pars_fragment>
      #include <logdepthbuf_pars_fragment>
      void main(){
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(waterColor(vW, vec3(.03, .08, .1)), 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
        #ifdef USE_FOG
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(60., 130., length(vW.xz - uCentre)));
        #endif
      }`,
  }));
  farSea.rotation.x = -Math.PI / 2;
  farSea.position.y = -0.008;
  scene.add(farSea);

  /* ---------- buildings ---------- */
  // Unit footprint with a parapet: outer walls, a rim, inner parapet walls and a roof set 1 m below the top.
  // Index order: [flat lid][outer walls][rim][inner walls][roof]. Far away we draw lid + walls;
  // close up we skip the lid and draw the parapet instead.
  const unit = (() => {
    const P = [], N = [], IN = [], DR = [], I = [];
    const C = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    const vert = (x, y, z, n, inset, drop) => { P.push(x, y, z); N.push(...n); IN.push(inset); DR.push(drop); return P.length / 3 - 1; };
    const quad = (a, b, c, d, n) => {
      // orient so the face points along n
      const pa = P.slice(a * 3, a * 3 + 3), pb = P.slice(b * 3, b * 3 + 3), pc = P.slice(c * 3, c * 3 + 3);
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const ok = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0;
      if (ok) I.push(a, b, c, a, c, d); else I.push(a, c, b, a, d, c);
    };
    const up = [0, 1, 0];
    // lid
    { const v = C.map(([x, z]) => vert(x, 1, z, up, 0, 0)); quad(v[0], v[1], v[2], v[3], up); }
    const lidEnd = I.length;
    // outer walls
    for (let k = 0; k < 4; k++) {
      const [x0, z0] = C[k], [x1, z1] = C[(k + 1) % 4];
      const n = [Math.sign(x0 + x1) * (Math.abs(x0 + x1) > 0.5 ? 1 : 0), 0, Math.sign(z0 + z1) * (Math.abs(z0 + z1) > 0.5 ? 1 : 0)];
      const a = vert(x0, 0, z0, n, 0, 0), b = vert(x1, 0, z1, n, 0, 0), c = vert(x1, 1, z1, n, 0, 0), d = vert(x0, 1, z0, n, 0, 0);
      quad(a, b, c, d, n);
    }
    const wallsEnd = I.length;
    // rim, inner walls, roof
    for (let k = 0; k < 4; k++) {
      const [x0, z0] = C[k], [x1, z1] = C[(k + 1) % 4];
      const a = vert(x0, 1, z0, up, 0, 0), b = vert(x1, 1, z1, up, 0, 0), c = vert(x1, 1, z1, up, 1, 0), d = vert(x0, 1, z0, up, 1, 0);
      quad(a, b, c, d, up);
    }
    for (let k = 0; k < 4; k++) {
      const [x0, z0] = C[k], [x1, z1] = C[(k + 1) % 4];
      const n = [-Math.sign(x0 + x1) * (Math.abs(x0 + x1) > 0.5 ? 1 : 0), 0, -Math.sign(z0 + z1) * (Math.abs(z0 + z1) > 0.5 ? 1 : 0)];
      const a = vert(x0, 1, z0, n, 1, 1), b = vert(x1, 1, z1, n, 1, 1), c = vert(x1, 1, z1, n, 1, 0), d = vert(x0, 1, z0, n, 1, 0);
      quad(a, b, c, d, n);
    }
    { const v = C.map(([x, z]) => vert(x, 1, z, up, 1, 1)); quad(v[0], v[1], v[2], v[3], up); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute("aIn", new THREE.Float32BufferAttribute(IN, 1));
    g.setAttribute("aDrop", new THREE.Float32BufferAttribute(DR, 1));
    g.setIndex(I);
    return { g, lidEnd, wallsEnd, total: I.length };
  })();

  const BUILD_ATTRS = /* glsl */ `attribute vec3 iPos; attribute vec3 iSize; attribute float iRot; attribute float aIn; attribute float aDrop;`;
  const BUILD_TRANSFORM = /* glsl */ `
    float cR = cos(iRot), sR = sin(iRot);
    vec3 pl = position * iSize;
    float thick = min(.00025, .18 * min(iSize.x, iSize.z));
    float ph = iSize.y > .0045 ? min(.0011, iSize.y * .14) : 0.;
    pl.xz -= sign(position.xz) * thick * aIn;
    pl.y -= ph * aDrop;
    vec3 transformed = vec3(pl.x * cR + pl.z * sR, pl.y, -pl.x * sR + pl.z * cR) + iPos;`;

  const BUILD_FRAG = /* glsl */ `
    // which surface: walls, parapet, rim, roof
    bool top = vUp > .5;
    bool inner = !top && vIn > .5;
    float seed = vSeed, seed2 = fract(seed * 91.7), seed3 = fract(seed * 13.3 + .37);
    float style = vHt > 38. ? 2. : (vHt > 14. ? 1. : 0.);
    // Karachi plaster: off-white, cream, concrete grey, sand, and the pastels of the older quarters
    vec3 pal[8];
    pal[0] = vec3(.78,.76,.71); pal[1] = vec3(.74,.67,.55); pal[2] = vec3(.58,.57,.55); pal[3] = vec3(.71,.63,.50);
    pal[4] = vec3(.62,.68,.66); pal[5] = vec3(.74,.62,.58); pal[6] = vec3(.80,.74,.58); pal[7] = vec3(.47,.48,.49);
    int k = int(floor(seed * 7.99));
    vec3 plaster = pal[0];
    for (int i = 1; i < 8; i++) if (i == k) plaster = pal[i];
    plaster *= .8 + .3 * seed3;
    plaster = mix(plaster, pow(vRoof, vec3(.9)) * 1.25, .3);       // dust and the real colour of the block
    vec3 sat = pow(vRoof, vec3(.9)) * 1.15;
    vec3 col; float glass = 0.; float lit = 0.; vec3 glow = vec3(0.);
    if (top) {
      // concrete roofs, stained, a little of the satellite colour for the real patchwork
      vec3 roof = mix(vec3(.70,.68,.64), vec3(.58,.55,.50), seed2) * (.85 + .3 * vnoise(vWall * .35 + seed * 40.));
      col = mix(roof, sat, .3);
      if (vIn > .02 && vIn < .98 || vDrop < .5 && vIn > .5) col = plaster * 1.05;      // parapet cap
    } else if (inner) {
      col = plaster * .78;
    } else {
      vec2 w = vWall;
      float y = w.y;
      col = plaster;
      // weathering: rain streaks hang below each window band, grime at street level
      float streak = vnoise(vec2(w.x * .9 + seed * 17., y * .06));
      col *= 1. - .28 * smoothstep(.45, .95, streak) * smoothstep(0., 6., y);
      col *= 1. - .12 * vnoise(w * vec2(.15, .4) + seed * 9.);
      col *= mix(.55, 1., smoothstep(0., 3.5, y));
      if (style < 1.5) {
        float fh = 3.1;
        float shop = step(.55, seed2) * step(6., vHt);
        float baseH = shop > .5 ? 3.6 : 0.;
        float yy = y - baseH;
        float per = style > .5 ? 3.0 : 3.4;
        float ww = style > .5 ? 1.8 : 1.3;
        vec2 g = vec2(w.x / per + seed * 3., yy / fh);
        vec2 f = fract(g);
        float inWin = step(.5 - ww / per * .5, f.x) * step(f.x, .5 + ww / per * .5) * step(.3, f.y) * step(f.y, .78)
                    * step(0., yy) * step(y, vHt - 1.2);
        float frame = inWin * (1. - step(.5 - ww / per * .5 + .03, f.x) * step(f.x, .5 + ww / per * .5 - .03) * step(.33, f.y) * step(f.y, .75));
        float shut = step(.82, h21(floor(g) + seed * 7.));             // some windows shuttered
        vec3 glassC = vec3(.18, .21, .24) + .05 * h21(floor(g) + 3.);
        col = mix(col, mix(glassC, plaster * .8, shut), inWin);
        col = mix(col, plaster * 1.08, frame);
        glass = inWin * (1. - shut) * (1. - frame);
        if (style > .5) {                                              // balcony slabs
          float slab = step(fract(yy / fh), .07) * step(0., yy);
          col = mix(col, plaster * .62, slab);
          col *= 1. - .1 * step(fract(yy / fh), .16) * step(0., yy);
        }
        lit = glass * step(.58 - .25 * seed, h21(floor(g) + seed * 31.));
        if (shop > .5 && y < baseH) {                                  // roller shutters and a signboard
          float ribs = .5 + .5 * sin(y * 40.);
          vec3 shutter = mix(vec3(.42,.43,.44), vec3(.55,.56,.57), ribs);
          float bay = step(.12, fract(w.x / 3.2)) * step(fract(w.x / 3.2), .9);
          col = mix(plaster * .7, shutter, bay * step(y, 2.8));
          vec3 signs[5]; signs[0] = vec3(.75,.12,.10); signs[1] = vec3(.08,.36,.62); signs[2] = vec3(.92,.70,.10); signs[3] = vec3(.10,.50,.28); signs[4] = vec3(.85,.85,.82);
          int sk = int(floor(seed3 * 4.99)); vec3 sc = signs[0];
          for (int i = 1; i < 5; i++) if (i == sk) sc = signs[i];
          float board = step(2.85, y) * step(y, 3.5);
          col = mix(col, sc, board);
          glow += sc * board * 1.4 + vec3(1., .86, .6) * bay * step(y, 2.8) * .9 * step(.4, seed3);
        }
      } else {
        // curtain wall: mullions, spandrels, tinted glass
        float fh = 3.7;
        vec2 g = vec2(w.x / 1.5, y / fh);
        vec2 f = fract(g);
        float mull = step(f.x, .06) + step(.94, f.x);
        float spand = step(f.y, .22);
        vec3 tint = seed2 < .33 ? vec3(.20,.30,.34) : seed2 < .66 ? vec3(.24,.27,.30) : vec3(.30,.27,.22);
        col = mix(tint, vec3(.55,.57,.58), clamp(mull + spand * .7, 0., 1.));
        glass = (1. - clamp(mull + spand, 0., 1.));
        lit = glass * step(.45, h21(vec2(floor(g.y), floor(g.x / 6.)) + seed * 9.));
      }
    }
    diffuseColor.rgb *= col;`;

  function buildingMaterial(key) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0.0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>
          ${BUILD_ATTRS}
          uniform sampler2D uSat; uniform vec4 uExt;
          varying vec3 vRoof; varying vec2 vWall; varying float vUp, vIn, vDrop, vSeed, vHt; varying vec3 vW;`)
        .replace("#include <beginnormal_vertex>", `float cR0 = cos(iRot), sR0 = sin(iRot);
          vec3 objectNormal = vec3(normal.x * cR0 + normal.z * sR0, normal.y, -normal.x * sR0 + normal.z * cR0);`)
        .replace("#include <begin_vertex>", `${BUILD_TRANSFORM}
          vec2 suv = vec2((iPos.x - uExt.x) / (uExt.y - uExt.x), (-iPos.z - uExt.z) / (uExt.w - uExt.z));
          vRoof = texture2D(uSat, suv).rgb;
          vUp = normal.y; vIn = aIn; vDrop = aDrop;
          vWall = top2(normal, pl);
          vHt = iSize.y * 1000.;
          vSeed = fract(sin(dot(iPos.xz, vec2(12.9898, 78.233))) * 43758.5453);`)
        .replace("void main() {", `vec2 top2(vec3 n, vec3 p){ return n.y > .5 ? p.xz * 1000. : vec2((abs(n.x) > .5 ? p.z : p.x) * 1000., p.y * 1000.); }
          void main() {`)
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
          varying vec3 vRoof; varying vec2 vWall; varying float vUp, vIn, vDrop, vSeed, vHt; varying vec3 vW;
          uniform float uNight, uTime; uniform vec3 uZen, uHor;
          ${GLSL_NOISE}`)
        .replace("#include <color_fragment>", BUILD_FRAG)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .12, glass);")
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          // glass picks up the sky; at night, lit rooms and shops
          vec3 Vv = normalize(cameraPosition - vW);
          float fres = pow(1. - abs(dot(normalize(vNormal), normalize((viewMatrix * vec4(Vv, 0.)).xyz))), 4.);
          totalEmissiveRadiance += glass * mix(uHor, uZen, .4) * (.12 + .55 * fres) * (1. - uNight * .85);
          totalEmissiveRadiance += mix(vec3(1., .74, .46), vec3(.86, .92, 1.), step(.8, vSeed)) * lit * uNight * 2.3;
          totalEmissiveRadiance += glow * uNight;`)
        .replace("#include <aomap_fragment>", `float cs = cloudShadow(vW); reflectedLight.directDiffuse *= cs; reflectedLight.directSpecular *= cs;
          reflectedLight.indirectDiffuse *= (vUp > .5 ? 1. : mix(.55, 1., smoothstep(0., 8., vWall.y)));
          #include <aomap_fragment>`);
    };
    mat.customProgramCacheKey = () => "building-" + key;
    return mat;
  }
  const bMat = buildingMaterial("main");
  const bDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  bDepth.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\n${BUILD_ATTRS}`)
      .replace("#include <begin_vertex>", BUILD_TRANSFORM);
  };
  bDepth.customProgramCacheKey = () => "building-depth";

  // Rooftop clutter close up: black, blue and white water tanks, and stair rooms.
  const tankGeo = new THREE.CylinderGeometry(0.00055, 0.00055, 0.0013, 10, 1, false);
  tankGeo.translate(0, 0.00065, 0);
  const tankMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.0 });
  const TANK_COL = [[0.04, 0.04, 0.045], [0.04, 0.04, 0.045], [0.05, 0.05, 0.055], [0.08, 0.22, 0.52], [0.86, 0.84, 0.78], [0.82, 0.42, 0.10]].map((c) => new THREE.Color(...c));

  /* ---------- data ---------- */
  let meta = null, terr = null, wterr = null;
  const tex = new THREE.TextureLoader();
  const loadTex = (file, srgb = true) => new Promise((res, rej) => tex.load(new URL(file, BASE).href, (t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    res(t);
  }, undefined, rej));
  async function gunzip(buf) {
    const b = new Uint8Array(buf);
    if (b[0] !== 0x1f || b[1] !== 0x8b) return buf;
    return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  }
  const getBin = async (file) => {
    const r = await fetch(new URL(file, BASE));
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    return gunzip(await r.arrayBuffer());
  };
  const decodeTerrain = (buf, info, ext) => {
    const raw = new Uint16Array(buf), data = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = raw[i] / 10 - 50;
    return { w: info.w, h: info.h, res: info.res, data, x0: ext.x0, n1: ext.n1 };
  };
  const sampleT = (t, x, z) => {
    const c = (x * 1000 - t.x0) / t.res - 0.5, r = (t.n1 + z * 1000) / t.res - 0.5;
    const c0 = Math.max(0, Math.min(t.w - 2, Math.floor(c))), r0 = Math.max(0, Math.min(t.h - 2, Math.floor(r)));
    const fx = clamp(c - c0), fy = clamp(r - r0), d = t.data, w = t.w;
    const top = d[r0 * w + c0] * (1 - fx) + d[r0 * w + c0 + 1] * fx, bot = d[(r0 + 1) * w + c0] * (1 - fx) + d[(r0 + 1) * w + c0 + 1] * fx;
    return (top * (1 - fy) + bot * fy) / 1000;
  };
  const inCity = (x, z) => meta && x * 1000 > meta.extent.x0 && x * 1000 < meta.extent.x1 && -z * 1000 > meta.extent.n0 && -z * 1000 < meta.extent.n1;
  const terrainAt = (x, z) => (terr && inCity(x, z) ? sampleT(terr, x, z) : wterr ? sampleT(wterr, x, z) : 0);

  function makeGround(ext, texture, kind, stepKm, drop = 0) {
    const w = (ext.x1 - ext.x0) / 1000, h = (ext.n1 - ext.n0) / 1000;
    const g = new THREE.PlaneGeometry(w, h, Math.max(8, Math.round(w / stepKm)), Math.max(8, Math.round(h / stepKm)));
    g.rotateX(-Math.PI / 2);
    g.translate(ext.x0 / 1000 + w / 2, 0, -(ext.n0 / 1000 + h / 2));
    const p = g.attributes.position;
    const t = kind === "world" ? wterr : terr;
    for (let i = 0; i < p.count; i++) p.setY(i, sampleT(t, p.getX(i), p.getZ(i)) - drop);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, patchGround(new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 }), kind));
    m.receiveShadow = kind !== "world";
    scene.add(m);
    return m;
  }

  async function buildGround(progress) {
    const e = meta.extent, we = meta.world.extent;
    U.uExt.value.set(e.x0 / 1000, e.x1 / 1000, e.n0 / 1000, e.n1 / 1000);
    U.uWorldExt.value.set(we.x0 / 1000, we.x1 / 1000, we.n0 / 1000, we.n1 / 1000);
    const [overview, dens, wmask, wsat, wwater, tb, wtb] = await Promise.all([
      loadTex(meta.sat.overview), loadTex(meta.density.file, false), loadTex(meta.water.file, false),
      loadTex(meta.world.sat), loadTex(meta.world.water, false), getBin(meta.terrain.file), getBin(meta.world.terrain.file),
    ]);
    progress(0.35);
    U.uSat.value = overview; U.uDensity.value = dens; U.uWater.value = wmask; U.uWorldWater.value = wwater;
    terr = decodeTerrain(tb, meta.terrain, e);
    wterr = decodeTerrain(wtb, meta.world.terrain, we);
    makeGround(we, wsat, "world", 1.0, 0.006);
    const low = makeGround(e, overview, "city", 0.1);
    if (!coarse) {
      Promise.all(meta.sat.quads.map((q2) => loadTex(q2.file).then((t) => ({ q2, t })))).then((list) => {
        list.forEach(({ q2, t }) => makeGround(q2, t, "city", 0.1));
        scene.remove(low);
        low.geometry.dispose();
      }).catch((err) => console.warn("High-resolution imagery unavailable", err));
    }
  }

  /* ---------- buildings, streamed in 4 km chunks ---------- */
  const chunks = new Map();
  let loadedCount = 0, queue = 0, aTotal = 0, aDone = 0;
  const decodeH = (v) => (v <= 240 ? v / 2 : 120 + (v - 240) * 10);
  async function loadChunk(c, tier) {
    const buf = await getBin(`b/${tier}_${c.i}_${c.j}.bin.gz`);
    const n = new DataView(buf).getUint32(0, true);
    let o = 4;
    const xs = new Uint16Array(buf, o, n); o += 2 * n;
    const ns = new Uint16Array(buf, o, n); o += 2 * n;
    const Ls = new Uint8Array(buf, o, n); o += n;
    const Ws = new Uint8Array(buf, o, n); o += n;
    const As = new Uint8Array(buf, o, n); o += n;
    const Hs = new Uint8Array(buf, o, n);
    const pos = new Float32Array(n * 3), size = new Float32Array(n * 3), rot = new Float32Array(n);
    let minY = 1e9, maxY = -1e9;
    for (let k = 0; k < n; k++) {
      const x = (c.x0 + xs[k] / 16) / 1000, z = -(c.n0 + ns[k] / 16) / 1000;
      const h = decodeH(Hs[k]) / 1000;
      const base = terrainAt(x, z) - 0.002;
      pos[k * 3] = x; pos[k * 3 + 1] = base; pos[k * 3 + 2] = z;
      size[k * 3] = Ls[k] / 2000; size[k * 3 + 1] = h + 0.002; size[k * 3 + 2] = Ws[k] / 2000;
      rot[k] = (As[k] / 256) * Math.PI;
      minY = Math.min(minY, base); maxY = Math.max(maxY, base + h);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.index = unit.g.index.clone();
    for (const a of ["position", "normal", "aIn", "aDrop"]) g.setAttribute(a, unit.g.attributes[a].clone());
    g.setAttribute("iPos", new THREE.InstancedBufferAttribute(pos, 3));
    g.setAttribute("iSize", new THREE.InstancedBufferAttribute(size, 3));
    g.setAttribute("iRot", new THREE.InstancedBufferAttribute(rot, 1));
    g.instanceCount = n;
    g.setDrawRange(0, unit.wallsEnd);
    const cx = (c.x0 + 2000) / 1000, cz = -(c.n0 + 2000) / 1000;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, (minY + maxY) / 2, cz), Math.hypot(2.9, (maxY - minY) / 2 + 0.1));
    const mesh = new THREE.Mesh(g, bMat);
    mesh.customDepthMaterial = bDepth;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { n, pos, size, rot, cx, cz };
    scene.add(mesh);
    loadedCount += n;
    return mesh;
  }

  function buildClutter(st) {
    const items = [st.a, st.b].filter(Boolean);
    const rnd = (() => { let s = 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    const tanks = [], stairs = [];
    for (const m of items) {
      const { n, pos, size, rot } = m.userData;
      for (let k = 0; k < n; k++) {
        const L = size[k * 3], H = size[k * 3 + 1], W = size[k * 3 + 2];
        if (H < 0.0055 || L * W < 0.00005) continue;
        const r = rot[k], cr = Math.cos(r), sr = Math.sin(r);
        const roofY = pos[k * 3 + 1] + H - Math.min(0.0011, H * 0.14);
        const place = (u, v) => [pos[k * 3] + u * cr + v * sr, -u * sr + v * cr + pos[k * 3 + 2]];
        const nt = Math.floor(rnd() * 2.6) + (L * W > 0.0002 ? 1 : 0);
        for (let t = 0; t < nt; t++) {
          const [x, z] = place((rnd() - 0.5) * (L - 0.002), (rnd() - 0.5) * (W - 0.002));
          tanks.push(x, roofY, z, 0.85 + rnd() * 0.4, Math.floor(rnd() * TANK_COL.length));
        }
        if (H > 0.0068 && L * W > 0.00006 && rnd() < 0.75) {
          const su = (rnd() < 0.5 ? -1 : 1) * (L / 2 - 0.0019), sv = (rnd() < 0.5 ? -1 : 1) * (W / 2 - 0.002);
          const [x, z] = place(su, sv);
          stairs.push(x, roofY, z, 0.003, 0.0026, 0.0032, r);
        }
      }
    }
    const group = new THREE.Group();
    if (tanks.length) {
      const count = tanks.length / 5;
      const im = new THREE.InstancedMesh(tankGeo, tankMat, count);
      const d = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        d.position.set(tanks[i * 5], tanks[i * 5 + 1], tanks[i * 5 + 2]);
        d.scale.setScalar(tanks[i * 5 + 3]);
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
        im.setColorAt(i, TANK_COL[tanks[i * 5 + 4]]);
      }
      im.castShadow = true; im.receiveShadow = true;
      group.add(im);
    }
    if (stairs.length) {
      const count = stairs.length / 7;
      const g = new THREE.InstancedBufferGeometry();
      g.index = unit.g.index.clone();
      for (const a of ["position", "normal", "aIn", "aDrop"]) g.setAttribute(a, unit.g.attributes[a].clone());
      const p = new Float32Array(count * 3), s = new Float32Array(count * 3), r = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        p.set([stairs[i * 7], stairs[i * 7 + 1], stairs[i * 7 + 2]], i * 3);
        s.set([stairs[i * 7 + 3], stairs[i * 7 + 4], stairs[i * 7 + 5]], i * 3);
        r[i] = stairs[i * 7 + 6];
      }
      g.setAttribute("iPos", new THREE.InstancedBufferAttribute(p, 3));
      g.setAttribute("iSize", new THREE.InstancedBufferAttribute(s, 3));
      g.setAttribute("iRot", new THREE.InstancedBufferAttribute(r, 1));
      g.instanceCount = count;
      g.setDrawRange(0, unit.wallsEnd);
      const m = new THREE.Mesh(g, bMat);
      m.frustumCulled = false;
      m.customDepthMaterial = bDepth;
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }
    scene.add(group);
    return group;
  }
  const dropClutter = (st) => {
    if (!st.clutter) return;
    scene.remove(st.clutter);
    st.clutter.traverse((o) => { if (o.geometry && o.geometry !== tankGeo) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
    st.clutter = null;
  };

  function schedule() {
    if (!meta) return;
    const list = [];
    const bRadius = coarse ? 3.2 : 6.5;
    const view = rig.d;
    for (const c of meta.buildings.chunks) {
      const cx = (c.x0 + 2000) / 1000, cz = -(c.n0 + 2000) / 1000;
      const d = Math.hypot(cx - rig.tx, cz - rig.tz);
      let st = chunks.get(c);
      if (!st) { st = { a: null, b: null, la: false, lb: false, clutter: null }; chunks.set(c, st); }
      if (c.a && !st.a && !st.la) list.push({ c, st, tier: "a", pri: d });
      const wantB = c.b && d < bRadius + view * 0.9 && view < 14;
      if (wantB && !st.b && !st.lb) list.push({ c, st, tier: "b", pri: d + 3 });
      const cam = Math.hypot(cx - camera.position.x, cz - camera.position.z, camera.position.y);
      const lod = clamp(Math.pow((coarse ? 7 : 11) / Math.max(cam, 0.1), 1.6), coarse ? 0.04 : 0.08, 1);
      const near = cam < 4.5;
      for (const t of ["a", "b"]) {
        const m = st[t];
        if (!m) continue;
        const g = m.geometry;
        g.instanceCount = Math.max(1, Math.round(m.userData.n * (t === "a" ? lod : Math.min(1, lod * 1.4))));
        // parapets close up, plain lids further out
        if (near) g.setDrawRange(unit.lidEnd, unit.total - unit.lidEnd); else g.setDrawRange(0, unit.wallsEnd);
        m.castShadow = !noShadow && view < 9 && cam < 14;
      }
      if (st.b) {
        st.b.visible = view < 16 && d < (bRadius + view) * 1.6;
        if (d > (bRadius + view) * 2.6 && view < 30) { scene.remove(st.b); st.b.geometry.dispose(); loadedCount -= st.b.userData.n; st.b = null; dropClutter(st); }
      }
      const wantClutter = !coarse && view < 3.2 && Math.hypot(cx - rig.tx, cz - rig.tz) < 3.6 && st.a && st.b;
      if (wantClutter && !st.clutter) st.clutter = buildClutter(st);
      else if (!wantClutter && st.clutter && (view > 4.5 || Math.hypot(cx - rig.tx, cz - rig.tz) > 5)) dropClutter(st);
    }
    list.sort((p, q2) => p.pri - q2.pri);
    for (const job of list) {
      if (queue >= 4) break;
      queue++;
      job.st["l" + job.tier] = true;
      loadChunk(job.c, job.tier).then((m) => { job.st[job.tier] = m; if (job.tier === "a") aDone++; })
        .catch((err) => { console.warn("chunk failed", err); if (job.tier === "a") aDone++; })
        .finally(() => { queue--; job.st["l" + job.tier] = false; });
    }
  }

  /* ---------- trees, from the satellite vegetation index ---------- */
  // Unit-space models (height 1, crown diameter 1), coloured per vertex: trunk brown, canopy green.
  const treeGeos = (() => {
    const colorize = (g, fn) => {
      const p = g.attributes.position, c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const [r, gg, b] = fn(p.getX(i), p.getY(i), p.getZ(i)); c.set([r, gg, b], i * 3); }
      g.setAttribute("color", new THREE.BufferAttribute(c, 3));
      return g;
    };
    const lumpy = (g, amt, seed) => {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const n = Math.sin(x * 12.9 + seed) * Math.cos(z * 9.1 - seed) * Math.sin(y * 7.3 + seed * 2);
        const k = 1 + n * amt;
        p.setXYZ(i, x * k, y * (1 + n * amt * 0.5), z * k);
      }
      g.computeVertexNormals();
      return g;
    };
    const merge = (parts) => {
      let total = 0; parts.forEach((g) => { total += g.attributes.position.count; });
      const P = new Float32Array(total * 3), N = new Float32Array(total * 3), C = new Float32Array(total * 3), I = [];
      let o = 0;
      for (const g0 of parts) {
        const g = g0.index ? g0 : g0;
        P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); C.set(g.attributes.color.array, o * 3);
        if (g.index) for (const v of g.index.array) I.push(v + o); else for (let v = 0; v < g.attributes.position.count; v++) I.push(v + o);
        o += g.attributes.position.count;
      }
      const m = new THREE.BufferGeometry();
      m.setAttribute("position", new THREE.BufferAttribute(P, 3));
      m.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      m.setAttribute("color", new THREE.BufferAttribute(C, 3));
      m.setIndex(I);
      return m;
    };
    const bark = () => [0.28, 0.21, 0.15];
    const trunk = (h, r) => { const g = new THREE.CylinderGeometry(r * 0.75, r, h, 6, 1, true); g.translate(0, h / 2, 0); return colorize(g, bark); };
    // broadleaf: neem, banyan, gulmohar: a broad lumpy crown on a short trunk
    const crown = lumpy(new THREE.IcosahedronGeometry(0.5, 2), 0.16, 1.7);
    crown.scale(1, 0.62, 1); crown.translate(0, 0.62, 0);
    colorize(crown, (x, y, z) => { const t = 0.85 + 0.25 * (y - 0.3); return [0.21 * t, 0.31 * t, 0.12 * t]; });
    const broad = merge([trunk(0.42, 0.05), crown]);
    // palm: a slim trunk and a drooping star of fronds
    const fronds = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2, g = new THREE.PlaneGeometry(0.55, 0.14, 3, 1);
      g.translate(0.27, 0, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setY(i, p.getY(i) - x * x * 0.55); }
      g.rotateX(-Math.PI / 2 + 0.25); g.rotateY(a); g.translate(0, 0.96, 0);
      g.computeVertexNormals();
      fronds.push(colorize(g, () => [0.22, 0.31, 0.12]));
    }
    const palm = merge([trunk(0.96, 0.018), ...fronds]);
    // mangrove and scrub: low domes, no visible trunk
    const dome = (sat) => { const g = lumpy(new THREE.IcosahedronGeometry(0.5, 1), 0.2, 3.1); g.scale(1, 0.8, 1); g.translate(0, 0.4, 0); return colorize(g, (x, y) => { const t = 0.8 + 0.3 * y; return [sat[0] * t, sat[1] * t, sat[2] * t]; }); };
    return [broad, palm, merge([dome([0.12, 0.2, 0.1])]), merge([dome([0.33, 0.33, 0.19])])];
  })();
  const TREE_ATTRS = /* glsl */ `attribute vec3 iPos; attribute vec2 iSize; attribute float iShade;`;
  const TREE_TRANSFORM = /* glsl */ `
    float tr = fract(sin(dot(iPos.xz, vec2(41.3, 289.1))) * 15731.7) * 6.2832;
    float cT = cos(tr), sT = sin(tr);
    vec3 pl = position * vec3(iSize.x, iSize.y, iSize.x);
    vec3 transformed = vec3(pl.x * cT + pl.z * sT, pl.y, -pl.x * sT + pl.z * cT) + iPos;`;
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  treeMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\n${TREE_ATTRS}\nuniform sampler2D uSat; uniform vec4 uExt;\nvarying float vShade; varying vec3 vW; varying vec3 vGround;`)
      .replace("#include <beginnormal_vertex>", `float tr0 = fract(sin(dot(iPos.xz, vec2(41.3, 289.1))) * 15731.7) * 6.2832;
        vec3 objectNormal = vec3(normal.x * cos(tr0) + normal.z * sin(tr0), normal.y, -normal.x * sin(tr0) + normal.z * cos(tr0));`)
      .replace("#include <begin_vertex>", TREE_TRANSFORM + `\nvShade = iShade;\nvGround = texture2D(uSat, vec2((iPos.x - uExt.x) / (uExt.y - uExt.x), (-iPos.z - uExt.z) / (uExt.w - uExt.z))).rgb;`)
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying float vShade; varying vec3 vW; varying vec3 vGround;\n${GLSL_NOISE}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        // leaf clusters: break the canopy into light and shade at about half a metre
        float leaf = vnoise(vW.xz * 2300. + vec2(vW.y * 1700., -vW.y * 1100.)) * .6 + vnoise(vW.xz * 900. - vW.y * 800.) * .4;
        // take some colour from the ground under the tree so canopies sit in the imagery
        vec3 g = pow(vGround, vec3(1.1)) * vec3(.85, 1.05, .8);
        diffuseColor.rgb = mix(diffuseColor.rgb, g * 1.1, .45);
        diffuseColor.rgb *= (.72 + .5 * leaf) * (.85 + .3 * vShade) * vec3(1., 1. + .08 * vShade, 1.);`)
      .replace("#include <aomap_fragment>", `float cs = cloudShadow(vW); reflectedLight.directDiffuse *= cs; reflectedLight.directSpecular *= cs;\n#include <aomap_fragment>`);
  };
  treeMat.customProgramCacheKey = () => "trees";
  const treeDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  treeDepth.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>\n${TREE_ATTRS}`).replace("#include <begin_vertex>", TREE_TRANSFORM);
  };
  treeDepth.customProgramCacheKey = () => "trees-depth";

  async function loadTrees(c) {
    const buf = await getBin(`t/${c.i}_${c.j}.bin.gz`);
    const n = new DataView(buf).getUint32(0, true);
    let o = 4;
    const xs = new Uint16Array(buf, o, n); o += 2 * n;
    const ns = new Uint16Array(buf, o, n); o += 2 * n;
    const cr = new Uint8Array(buf, o, n); o += n;
    const ht = new Uint8Array(buf, o, n); o += n;
    const kd = new Uint8Array(buf, o, n); o += n;
    const sh = new Uint8Array(buf, o, n);
    const byKind = [[], [], [], []];
    for (let k = 0; k < n; k++) byKind[kd[k]].push(k);
    const group = new THREE.Group();
    const cx = (c.x0 + 2000) / 1000, cz = -(c.n0 + 2000) / 1000;
    byKind.forEach((idx, kind) => {
      if (!idx.length) return;
      const m = idx.length, pos = new Float32Array(m * 3), size = new Float32Array(m * 2), shade = new Float32Array(m);
      idx.forEach((k, i) => {
        const x = (c.x0 + xs[k] / 16) / 1000, z = -(c.n0 + ns[k] / 16) / 1000;
        pos.set([x, terrainAt(x, z) - 0.0003, z], i * 3);
        size.set([cr[k] / 10000, ht[k] / 4000], i * 2);
        shade[i] = sh[k] / 255;
      });
      const g = new THREE.InstancedBufferGeometry();
      const base = treeGeos[kind];
      g.index = base.index.clone();
      for (const a of ["position", "normal", "color"]) g.setAttribute(a, base.attributes[a].clone());
      g.setAttribute("iPos", new THREE.InstancedBufferAttribute(pos, 3));
      g.setAttribute("iSize", new THREE.InstancedBufferAttribute(size, 2));
      g.setAttribute("iShade", new THREE.InstancedBufferAttribute(shade, 1));
      g.instanceCount = m;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, terrainAt(cx, cz), cz), 3.2);
      const mesh = new THREE.Mesh(g, treeMat);
      mesh.customDepthMaterial = treeDepth;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.n = m;
      group.add(mesh);
    });
    scene.add(group);
    return group;
  }
  const treeChunks = new Map();
  let treeQueue = 0;
  function scheduleTrees() {
    if (!meta || !meta.trees) return;
    const R = coarse ? 2.2 : 3.6;
    for (const c of meta.trees.chunks) {
      const cx = (c.x0 + 2000) / 1000, cz = -(c.n0 + 2000) / 1000;
      const d = Math.max(0, Math.hypot(cx - rig.tx, cz - rig.tz) - 2.8);
      let st = treeChunks.get(c);
      if (!st) { st = { g: null, loading: false }; treeChunks.set(c, st); }
      const want = rig.d < 7 && d < R;
      if (want && !st.g && !st.loading && treeQueue < 2) {
        st.loading = true; treeQueue++;
        loadTrees(c).then((g) => { st.g = g; }).catch((e) => console.warn("trees failed", e)).finally(() => { st.loading = false; treeQueue--; });
      }
      if (st.g) {
        const cam = Math.hypot(cx - camera.position.x, cz - camera.position.z, camera.position.y);
        st.g.visible = rig.d < 9 && d < R * 1.5;
        const lod = clamp(Math.pow(2.6 / Math.max(cam, 0.05), 1.4), 0.15, 1);
        st.g.children.forEach((m) => { m.geometry.instanceCount = Math.max(1, Math.round(m.userData.n * lod)); m.castShadow = !noShadow && cam < 5; });
        if (!want && d > R * 2.2) {
          scene.remove(st.g); st.g.children.forEach((m) => m.geometry.dispose()); st.g = null;
        }
      }
    }
  }

  /* ---------- the Mazar-e-Quaid, by hand ---------- */
  function addMazar() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.45 });
    const x = toX(67.04096), z = toZ(24.87532), y = terrainAt(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const parts = [
      [new THREE.BoxGeometry(0.075, 0.004, 0.075), 0.002],
      [new THREE.BoxGeometry(0.054, 0.026, 0.054), 0.017],
      [new THREE.CylinderGeometry(0.019, 0.022, 0.008, 40), 0.034],
      [new THREE.SphereGeometry(0.019, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), 0.038],
    ];
    for (const [geo, py] of parts) { const m = new THREE.Mesh(geo, mat); m.position.y = py; m.castShadow = m.receiveShadow = true; g.add(m); }
    scene.add(g);
  }

  /* ---------- camera rig ---------- */
  const rig = { tx: 0, tz: 0, d: 30, theta: 0, phi: 1.1 };
  const goal = { ...rig };
  let fly = null;
  const bounds = () => {
    if (!meta) return;
    const e = meta.extent, m = 0.5;
    goal.tx = clamp(goal.tx, e.x0 / 1000 + m, e.x1 / 1000 - m);
    goal.tz = clamp(goal.tz, -e.n1 / 1000 + m, -e.n0 / 1000 - m);
    goal.d = clamp(goal.d, 0.12, MAX_D);
    goal.phi = clamp(goal.phi, 0.02, 1.42);
  };
  function flyTo(place, instant = false) {
    const [, lng, lat, d, phi, head] = place;
    const to = { tx: toX(lng), tz: toZ(lat), d, phi, theta: (head * Math.PI) / 180 };
    let dt = to.theta - rig.theta;
    dt = ((dt + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    to.theta = rig.theta + dt;
    if (instant || reduce) { Object.assign(rig, to); Object.assign(goal, to); fly = null; return; }
    fly = { from: { ...rig }, to, t: 0, dur: 2.4 + Math.min(2, Math.hypot(to.tx - rig.tx, to.tz - rig.tz) / 25) };
  }
  flyTo(PLACES[0], true);

  let drag = null, idle = 0, engaged = false;
  const pointers = new Map();
  const panBy = (dx, dy) => {
    const s = (rig.d * 2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(h, 1);
    const c = Math.cos(rig.theta), sn = Math.sin(rig.theta);
    const k = 1 / Math.max(Math.cos(rig.phi), 0.35);
    goal.tx -= (dx * c + dy * sn * k) * s;
    goal.tz -= (-dx * sn + dy * c * k) * s;
    bounds();
  };
  const engage = (on) => { engaged = on; stage.classList.toggle("is-engaged", on); };
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    fly = null; idle = 0; engage(true);
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = { mode: e.button === 2 || e.shiftKey ? "pan" : "orbit" };
    stage.classList.add("is-dragging");
    ui.hint?.classList.add("is-gone");
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const before = Math.hypot(a.x - b.x, a.y - b.y), ang0 = Math.atan2(b.y - a.y, b.x - a.x);
      p.x = e.clientX; p.y = e.clientY;
      const after = Math.hypot(a.x - b.x, a.y - b.y), ang1 = Math.atan2(b.y - a.y, b.x - a.x);
      if (before > 10) goal.d = goal.d * (before / after);
      goal.theta -= ang1 - ang0;
      panBy(dx / 2, dy / 2);
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (!drag) return;
    if (drag.mode === "pan") panBy(dx, dy);
    else {
      goal.theta -= dx * 0.005;
      if (e.pointerType === "mouse") goal.phi -= dy * 0.004;
      bounds();
    }
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (!pointers.size) { drag = null; stage.classList.remove("is-dragging"); }
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  stage.addEventListener("pointerleave", () => engage(false));
  canvas.addEventListener("wheel", (e) => {
    if (!(engaged || e.ctrlKey || e.metaKey)) {
      stage.classList.add("show-wheel-hint");
      clearTimeout(canvas._wt);
      canvas._wt = setTimeout(() => stage.classList.remove("show-wheel-hint"), 1400);
      return;
    }
    e.preventDefault();
    fly = null;
    goal.d *= Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.0015));
    bounds();
  }, { passive: false });
  const zoom = (f) => { fly = null; goal.d *= f; bounds(); };
  stage.querySelector("[data-zoom='in']")?.addEventListener("click", () => zoom(0.6));
  stage.querySelector("[data-zoom='out']")?.addEventListener("click", () => zoom(1.6));
  stage.querySelector("[data-north]")?.addEventListener("click", () => { fly = null; goal.theta = Math.round(rig.theta / (2 * Math.PI)) * 2 * Math.PI; });
  stage.querySelector("[data-home]")?.addEventListener("click", () => { flyTo(PLACES[0]); setActive(PLACES[0][0]); });
  canvas.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "+" || k === "=") zoom(0.7);
    else if (k === "-") zoom(1.4);
    else if (k === "ArrowLeft" && e.shiftKey) goal.theta += 0.15;
    else if (k === "ArrowRight" && e.shiftKey) goal.theta -= 0.15;
    else if (k.startsWith("Arrow")) panBy(k === "ArrowLeft" ? 40 : k === "ArrowRight" ? -40 : 0, k === "ArrowUp" ? 40 : k === "ArrowDown" ? -40 : 0);
    else return;
    e.preventDefault(); e.stopPropagation();
  });

  /* ---------- places, pins ---------- */
  const placeBtns = [];
  const setActive = (name) => placeBtns.forEach((b) => b.setAttribute("aria-pressed", b.dataset.name === name));
  PLACES.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.name = p[0];
    b.textContent = p[0];
    b.setAttribute("aria-pressed", p === PLACES[0]);
    b.addEventListener("click", () => { flyTo(p); setActive(p[0]); });
    ui.places?.appendChild(b);
    placeBtns.push(b);
  });
  const pins = PLACES.slice(1).map((p) => {
    const n = document.createElement("button");
    n.type = "button";
    n.className = "pin";
    n.tabIndex = -1;
    n.innerHTML = `<i></i><b>${p[0]}</b>`;
    n.addEventListener("click", () => { flyTo(p); setActive(p[0]); });
    ui.pins.appendChild(n);
    return { n, p, v: new THREE.Vector3(toX(p[1]), 0, toZ(p[2])), x: 0, y: 0 };
  });

  /* ---------- time slider ---------- */
  if (ui.time) ui.time.addEventListener("input", () => opts.select && opts.select(+ui.time.value));

  /* ---------- resize / visibility ---------- */
  let w = 0, h = 0;
  const resize = () => {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch || (cw === w && ch === h)) return;
    w = cw; h = ch;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
  let visible = false;
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { rootMargin: "200px" }).observe(stage);

  /* ---------- weather ---------- */
  const want = { time: Date.now(), live: true, cloud: 0, haze: 0, vis: 20, wind: 0, wdir: 0, rain: 0, tide: 0, wave: 0.4, idx: 0, max: 47, label: "Now", temp: null };
  const cur = { time: Date.now(), cloud: 0, haze: 0, vis: 20, wind: 0, rain: 0, wave: 0.4, wx: 0, wz: 1 };
  const col = (c) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
  const raw = (c) => new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
  const dirOf = (p) => {
    const alt = (p.altitude * Math.PI) / 180, az = (p.azimuth * Math.PI) / 180;
    return new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
  };
  const put = (node, v) => { if (node && node.textContent !== v) node.textContent = v; };

  /* ---------- rain ---------- */
  const RN = 3000;
  const rainPos = new Float32Array(RN * 6);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0, fog: false });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  scene.add(rain);
  const drops = Array.from({ length: RN }, () => ({ x: Math.random() - 0.5, y: Math.random(), z: Math.random() - 0.5, v: 0.8 + Math.random() * 0.4 }));

  /* ---------- boot ---------- */
  let progressV = 0;
  const progress = (v) => { progressV = Math.max(progressV, v); };
  (async () => {
    const r = await fetch(new URL("meta.json?v=4", BASE));
    meta = await r.json();
    aTotal = meta.buildings.chunks.filter((c) => c.a).length;
    progress(0.1);
    await buildGround(progress);
    addMazar();
    stage.classList.add("is-ready");
    schedule();
  })().catch((err) => {
    console.warn("City data unavailable", err);
    stage.classList.add("is-fallback");
  });

  /* ---------- loop ---------- */
  let last = performance.now(), clockT = 0, schedT = 0, slow = 0;
  const target = new THREE.Vector3(), proj = new THREE.Vector3();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!visible || document.hidden || !w) return;
    clockT += dt;
    window.__cityFrames = (window.__cityFrames || 0) + 1;
    if (dt > 0.045) slow++; else slow = Math.max(0, slow - 1);
    if (slow > 60 && dprCap > 1) { dprCap = Math.max(1, dprCap - 0.25); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap)); w = 0; resize(); slow = 0; }

    const k = reduce ? 1 : 1 - Math.exp(-dt * 3);
    cur.time += ((want.live ? Date.now() : want.time) - cur.time) * k;
    for (const key of ["cloud", "haze", "vis", "wind", "rain", "wave"]) cur[key] += (want[key] - cur[key]) * k;
    const a = ((want.wdir + 180) * Math.PI) / 180;
    cur.wx += (Math.sin(a) - cur.wx) * k; cur.wz += (-Math.cos(a) - cur.wz) * k;

    /* camera */
    if (fly) {
      fly.t += dt / fly.dur;
      const t = ease(clamp(fly.t));
      const lift = Math.sin(Math.PI * t) * Math.min(18, Math.hypot(fly.to.tx - fly.from.tx, fly.to.tz - fly.from.tz) * 0.5);
      for (const key of ["tx", "tz", "theta", "phi"]) rig[key] = fly.from[key] + (fly.to[key] - fly.from[key]) * t;
      rig.d = Math.min(MAX_D, Math.exp(Math.log(fly.from.d) + (Math.log(fly.to.d) - Math.log(fly.from.d)) * t) + lift);
      Object.assign(goal, rig);
      if (fly.t >= 1) fly = null;
    } else {
      const g = reduce ? 1 : 1 - Math.exp(-dt * 8);
      for (const key of ["tx", "tz", "theta", "phi"]) rig[key] += (goal[key] - rig[key]) * g;
      rig.d = Math.exp(Math.log(rig.d) + (Math.log(goal.d) - Math.log(rig.d)) * g);
      if (!drag && !pointers.size) idle += dt;
      if (opts.spin && opts.spin() && idle > 4 && !reduce) { goal.theta += 0.02 * dt; rig.theta = goal.theta; }
    }
    const ty = terrainAt(rig.tx, rig.tz);
    target.set(rig.tx, ty, rig.tz);
    camera.position.set(
      rig.tx + rig.d * Math.sin(rig.phi) * Math.sin(rig.theta),
      ty + rig.d * Math.cos(rig.phi),
      rig.tz + rig.d * Math.sin(rig.phi) * Math.cos(rig.theta)
    );
    const floor = Math.max(terrainAt(camera.position.x, camera.position.z), 0) + 0.025;
    if (camera.position.y < floor) camera.position.y = floor;
    camera.lookAt(target);
    camera.near = clamp(rig.d * 0.002, 0.001, 0.05);
    camera.updateProjectionMatrix();
    sky.position.copy(camera.position);

    /* light */
    const sp = sunPosition(cur.time, LAT, LNG), mp = moonPosition(cur.time, LAT, LNG);
    const pal = skyPalette(sp.altitude, cur.haze);
    const night = 1 - smooth(-9, 1, sp.altitude);
    const phase = moonPhase(cur.time);
    const sunDir = dirOf(sp), moonDir = dirOf(mp);
    const moonLit = smooth(-1, 4, mp.altitude) * phase.fraction;
    const useMoon = sp.altitude < -2 && mp.altitude > 3;
    const lightDir = useMoon ? moonDir : sunDir.clone().setY(Math.max(sunDir.y, 0.06)).normalize();
    const span = clamp(rig.d * 0.9, 0.6, 18);
    sun.position.copy(target).addScaledVector(lightDir, span * 3 + 2);
    sun.target.position.copy(target);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.1, far: span * 6 + 6 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.normalBias = clamp(span * 0.0004, 0.00025, 0.006);
    const overcast = 1 - cur.cloud * 0.6;
    if (useMoon) { sun.intensity = 0.32 * phase.fraction * overcast; sun.color.setRGB(0.55, 0.66, 1); }
    else { sun.intensity = smooth(-1.5, 8, sp.altitude) * 2.7 * overcast * (1 - cur.haze * 0.3); sun.color.copy(col(pal.sun)); }
    hemi.intensity = 0.12 + pal.day * (0.75 + cur.cloud * 0.5);
    hemi.color.copy(col(pal.zen)).lerp(new THREE.Color(1, 1, 1), 0.45);
    hemi.groundColor.copy(col(pal.hor)).lerp(new THREE.Color(0.8, 0.76, 0.7), 0.5);

    U.uSunDir.value.copy(sunDir);
    U.uSunCol.value.copy(col(pal.sun));
    U.uMoonDir.value.copy(moonDir);
    U.uMoonLit.value = moonLit;
    U.uZen.value.copy(col(pal.zen));
    U.uHor.value.copy(col(pal.hor));
    U.uLit.value.copy(col(pal.lit));
    U.uShade.value.copy(col(pal.shade));
    U.uNight.value = night;
    U.uTime.value = reduce ? 0 : clockT;
    U.uWave.value = cur.wave;
    U.uCloudTh.value = cur.cloud < 0.02 ? 2 : 0.95 - cur.cloud * 0.62;
    const drift = (0.004 + cur.wind * 0.0009) * dt;
    U.uWindOff.value.x -= cur.wx * drift; U.uWindOff.value.y -= cur.wz * drift;
    clouds.visible = cur.cloud > 0.02;

    scene.fog.color.copy(raw(pal.hor));
    const alt = Math.max(0.05, camera.position.y);
    scene.fog.density = (1 / Math.max(cur.vis, 1)) * clamp(0.6 / Math.sqrt(alt), 0.1, 1.2) + cur.rain * 0.01;
    renderer.toneMappingExposure = 1 + night * 0.25;

    /* rain */
    const wet = clamp(cur.rain / 2.5);
    rainMat.opacity = wet > 0.01 ? 0.18 + wet * 0.35 : 0;
    if (wet > 0.01) {
      const R = clamp(rig.d * 0.8, 0.3, 6), Hh = R * 1.4, live = Math.round(RN * (0.3 + wet * 0.7));
      drops.forEach((d, i) => {
        d.y -= d.v * dt * 1.6;
        if (d.y < 0) { d.y = 1; d.x = Math.random() - 0.5; d.z = Math.random() - 0.5; }
        const x = rig.tx + d.x * 2 * R, z = rig.tz + d.z * 2 * R, y = ty + d.y * Hh;
        const on = i < live ? 1 : 0, len = Hh * 0.02;
        rainPos.set([x, y * on, z, x + cur.wx * len * 0.3, (y + len) * on, z + cur.wz * len * 0.3], i * 6);
      });
      rainGeo.attributes.position.needsUpdate = true;
    }

    schedT += dt;
    if (schedT > 0.3) { schedT = 0; schedule(); scheduleTrees(); }

    renderer.render(scene, camera);
    if (window.__citySnapReq) { window.__citySnapOut = canvas.toDataURL("image/jpeg", 0.88); window.__citySnapReq = false; }

    /* pins: project, then hide any that would overlap a nearer one */
    const placed = [];
    const sorted = pins.map((p) => {
      p.v.y = terrainAt(p.v.x, p.v.z) + clamp(rig.d * 0.01, 0.015, 0.35);
      proj.copy(p.v).project(camera);
      p.x = (proj.x * 0.5 + 0.5) * w; p.y = (-proj.y * 0.5 + 0.5) * h;
      p.dist = camera.position.distanceTo(p.v);
      p.ok = proj.z < 1 && p.x > 12 && p.x < w - 12 && p.y > 70 && p.y < h - 110 && p.dist < 60 && p.dist > rig.d * 0.35;
      return p;
    }).sort((a2, b2) => a2.dist - b2.dist);
    for (const p of sorted) {
      const wLabel = p.p[0].length * 6.4 + 24;
      const clash = placed.some((o) => Math.abs(o.y - p.y) < 24 && p.x < o.x + o.w && p.x + wLabel > o.x);
      const on = p.ok && !clash;
      if (on) placed.push({ x: p.x, y: p.y, w: wLabel });
      p.n.classList.toggle("is-on", on);
      if (on) p.n.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    }
    if (ui.north) ui.north.style.transform = `rotate(${(rig.theta * 180) / Math.PI}deg)`;
    const mPerPx = (rig.d * 2 * Math.tan((camera.fov * Math.PI) / 360)) / h;
    const nice = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
    const km = nice.find((v) => v / mPerPx > 64) || 20;
    if (ui.scale) ui.scale.style.width = `${Math.round(km / mPerPx)}px`;
    put(ui.scaleTx, km < 1 ? `${km * 1000} m` : `${km} km`);

    // conditions card
    const sunTxt = sp.altitude > -0.8 ? `Sun ${Math.round(sp.altitude)}° high` : useMoon ? `Moon, ${Math.round(phase.fraction * 100)}% lit` : "After dark";
    put(ui.cond, `${sunTxt} · wind ${Math.round(cur.wind)} km/h ${COMPASS[Math.round(want.wdir / 22.5) % 16]} · cloud ${Math.round(cur.cloud * 100)}% · ${cur.vis >= 10 ? Math.round(cur.vis) : cur.vis.toFixed(1)} km visibility${cur.rain > 0.05 ? ` · rain ${cur.rain.toFixed(1)} mm` : ""}`);
    put(ui.when, want.label || "Now");
    if (ui.time && document.activeElement !== ui.time) { ui.time.max = want.max; ui.time.value = want.idx; }
    ui.time?.style.setProperty("--p", `${(want.idx / Math.max(1, want.max)) * 100}%`);

    // loading
    if (meta) {
      const p = 0.35 + 0.65 * (aTotal ? aDone / aTotal : 0);
      progress(p);
      if (ui.bar) ui.bar.style.transform = `scaleX(${progressV.toFixed(3)})`;
      stage.classList.toggle("is-loading", progressV < 0.999);
      put(ui.status, progressV < 0.999 ? `Loading buildings · ${loadedCount.toLocaleString("en-US")}` : `${loadedCount.toLocaleString("en-US")} buildings drawn`);
    }
  }
  requestAnimationFrame(frame);

  window.__cityFly = (name) => { const p = Array.isArray(name) ? name : PLACES.find((q2) => q2[0] === name); if (p) flyTo(p, true); };
  return {
    set(next) { Object.assign(want, next); },
    flyTo: (name) => { const p = PLACES.find((q2) => q2[0] === name); if (p) flyTo(p); },
  };
}
