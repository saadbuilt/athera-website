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

// Places to fly to: [name, lng, lat, distance km, tilt (0 = straight down), heading deg]
export const PLACES = [
  ["All of Karachi", 67.07, 24.925, 30, 1.12, 0],
  ["Clifton & Sea View", 67.032, 24.808, 3.2, 1.08, 20],
  ["Saddar & Mazar-e-Quaid", 67.036, 24.866, 3.4, 1.0, -30],
  ["I.I. Chundrigar Road", 67.005, 24.849, 1.8, 1.12, 40],
  ["Keamari & the port", 66.984, 24.835, 4.2, 1.0, 70],
  ["Lyari", 66.996, 24.867, 2.4, 1.05, 0],
  ["Gulshan-e-Iqbal", 67.093, 24.92, 3.6, 1.0, -20],
  ["Orangi Town", 66.99, 24.953, 4.4, 1.05, 160],
  ["Korangi", 67.128, 24.832, 4.5, 1.0, 10],
  ["Jinnah International", 67.163, 24.904, 4.6, 0.95, -60],
  ["Bahria Town", 67.315, 25.005, 5.5, 1.0, 30],
  ["Port Qasim", 67.33, 24.775, 7, 1.0, 0],
  ["Hawke's Bay", 66.88, 24.855, 5, 1.1, 120],
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

export function createCity(stage, opts = {}) {
  const canvas = stage.querySelector("canvas");
  const pinsEl = stage.querySelector(".stage__pins");
  const readEl = stage.querySelector(".stage__read");
  const statusEl = stage.querySelector(".stage__status");
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
  renderer.toneMappingExposure = 1.0;
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
    uCloudTh: { value: 0.95 },
    uCloudAlt: { value: 1.7 },
    uNight: { value: 0 },
    uTime: { value: 0 },
    uZen: { value: new THREE.Color() },
    uHor: { value: new THREE.Color() },
    uSat: { value: null },
    uDensity: { value: null },
    uWater: { value: null },
    uExt: { value: new THREE.Vector4() }, // x0, x1, n0, n1 in km
    uTerrain: { value: null },
    uTerrInfo: { value: new THREE.Vector4() }, // w, h, res km, unused
    uWave: { value: 0.4 },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uMoonLit: { value: 0 },
    uLit: { value: new THREE.Color() },
    uShade: { value: new THREE.Color() },
    uCover: { value: 0 },
  };

  /* ---------- lights ---------- */
  const hemi = new THREE.HemisphereLight(0xffffff, 0xd8d2c6, 0.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(coarse ? 2048 : 4096, coarse ? 2048 : 4096);
  sun.shadow.bias = -0.00002;
  sun.shadow.normalBias = 0.0012;
  scene.add(sun, sun.target);

  /* ---------- sky dome ---------- */
  const skyMat = new THREE.ShaderMaterial({
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
        vec3 col = mix(uHor, uZen, pow(t, .5));
        if (d.y < 0.) col = uHor;
        float sd = max(dot(d, uSunDir), 0.);
        float up = smoothstep(-.12, .03, uSunDir.y);
        col += uSunCol * (pow(sd, 6.) * .22 + pow(sd, 90.) * .55) * up;
        col = mix(col, vec3(1., .98, .93) * 1.6, smoothstep(.99955, .9998, sd) * step(-.02, uSunDir.y));
        float md = max(dot(d, uMoonDir), 0.);
        col += vec3(.75, .8, .9) * (smoothstep(.99975, .99988, md) * .9 + pow(md, 400.) * .12) * uMoonLit;
        vec3 sp = floor(d * 380.);
        float s = hh(sp);
        col += step(.9975, s) * uNight * smoothstep(.02, .25, d.y) * (.4 + .6 * fract(s * 77.)) * (.7 + .3 * sin(uTime * 2. + s * 50.));
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 48, 24), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  /* ---------- clouds: one textured layer that also shades the ground ---------- */
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: { ...U, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) }, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `varying vec3 vW;
      #include <common>
      #include <fog_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <logdepthbuf_vertex>
      #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `varying vec3 vW; uniform vec3 uLit, uShade, uSunCol; uniform float uNight;
      ${GLSL_NOISE}
      #include <common>
      #include <fog_pars_fragment>
      #include <logdepthbuf_pars_fragment>
      void main(){
        #include <logdepthbuf_fragment>
        float c = cloudAt(vW.xz);
        // seen nearly edge-on, a flat layer aliases into streaks: thin it out with distance and grazing angle
        vec3 toCam = cameraPosition - vW;
        float graze = smoothstep(.04, .22, abs(toCam.y) / length(toCam));
        c *= graze * (1. - smoothstep(35., 110., length(toCam)));
        if (c < .01) discard;
        float lit = smoothstep(.2, .9, fbm(vW.xz * .085 + uWindOff + uSunDir.xz * .05));
        vec3 col = mix(uShade, uLit, lit);
        gl_FragColor = vec4(col, c * .93);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), cloudMat);
  clouds.rotation.x = -Math.PI / 2;
  clouds.position.y = 1.7;
  clouds.renderOrder = 5;
  scene.add(clouds);

  /* ---------- material patches ---------- */
  const groundMats = [];
  function patchGround(mat, apron = false) {
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      // a touch more contrast than the cloudless mosaic, which is averaged across a year of passes
      sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", apron ? `
          vec2 ov = vec2((vW.x - uExt.x) / (uExt.y - uExt.x), (-vW.z - uExt.z) / (uExt.w - uExt.z));
          float outside = max(max(-ov.x, ov.x - 1.), max(-ov.y, ov.y - 1.));
          if (outside < -.0015) discard;
          vec2 mir = 1. - abs(1. - mod(ov, 2.));   // mirror the city's surroundings outward, then blur them away
          if (texture(uWater, clamp(ov, .001, .999), 2.).r > .5) discard;   // the coast carries straight on past the edge
          vec4 sampledDiffuseColor = texture(map, mir, clamp(2.5 + outside * 25., 2.5, 9.));
          diffuseColor *= sampledDiffuseColor;` : `#include <map_fragment>`)
        .replace("#include <color_fragment>", "#include <color_fragment>\n diffuseColor.rgb = pow(diffuseColor.rgb, vec3(1.08)) * 1.1;");
      if (apron) sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D uWater;");
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vW;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vW;\nuniform sampler2D uDensity; uniform vec4 uExt; uniform float uNight, uTime;\n${GLSL_NOISE}`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          vec2 duv = vec2((vW.x - uExt.x) / (uExt.y - uExt.x), (-vW.z - uExt.z) / (uExt.w - uExt.z));
          float dens = texture2D(uDensity, duv).r;
          // street lamps: points about 15 m apart where people live, averaged out once they are smaller than a pixel
          float px = length(fwidth(vW.xz));
          vec2 cell = floor(vW.xz * 66.);
          vec2 fc = fract(vW.xz * 66.) - .5;
          float lampOn = step(.9 - dens * .3, h21(cell));
          float lamp = lampOn * exp(-dot(fc, fc) * 26.);
          float avgLamp = (.12 + dens * .25) * .055 * (.4 + 1.2 * vnoise(vW.xz * 9.)) ;
          float lights = mix(lamp, avgLamp, smoothstep(.004, .02, px));
          totalEmissiveRadiance += vec3(1., .64, .32) * (lights * 2.2 * smoothstep(.04, .3, dens) + dens * .02) * uNight;`)
        .replace("#include <aomap_fragment>", `float cs = cloudShadow(vW); reflectedLight.directDiffuse *= cs; reflectedLight.directSpecular *= cs;\n#include <aomap_fragment>`);
    };
    mat.customProgramCacheKey = () => (apron ? "ground-apron" : "ground");
    groundMats.push(mat);
    return mat;
  }

  const BUILD_VERT_HEAD = /* glsl */ `
    attribute vec3 iPos; attribute vec3 iSize; attribute float iRot;
    uniform sampler2D uSat; uniform vec4 uExt;
    varying vec3 vRoof; varying vec2 vWall; varying float vUp; varying float vSeed; varying vec3 vW; varying float vHt;`;
  const BUILD_TRANSFORM = /* glsl */ `
    float cR = cos(iRot), sR = sin(iRot);
    vec3 pl = position * iSize;
    vec3 transformed = vec3(pl.x * cR + pl.z * sR, pl.y, -pl.x * sR + pl.z * cR) + iPos;`;

  function buildingMaterial() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0.0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>\n${BUILD_VERT_HEAD}`)
        .replace("#include <beginnormal_vertex>", `float cR0 = cos(iRot), sR0 = sin(iRot);
          vec3 objectNormal = vec3(normal.x * cR0 + normal.z * sR0, normal.y, -normal.x * sR0 + normal.z * cR0);`)
        .replace("#include <begin_vertex>", `${BUILD_TRANSFORM}
          vec2 suv = vec2((iPos.x - uExt.x) / (uExt.y - uExt.x), (-iPos.z - uExt.z) / (uExt.w - uExt.z));
          vRoof = texture2D(uSat, suv).rgb;
          vUp = normal.y;
          vWall = vec2((abs(normal.x) > .5 ? pl.z : pl.x) * 1000., pl.y * 1000.);
          vHt = iSize.y * 1000.;
          vSeed = fract(sin(dot(iPos.xz, vec2(12.9898, 78.233))) * 43758.5453);`)
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
          varying vec3 vRoof; varying vec2 vWall; varying float vUp; varying float vSeed; varying vec3 vW; varying float vHt;
          uniform float uNight, uTime;
          ${GLSL_NOISE}`)
        .replace("#include <color_fragment>", `
          // Karachi walls: whitewash, cream, sand, grey concrete, with the odd pastel
          vec3 pal[5]; pal[0] = vec3(.93,.91,.86); pal[1] = vec3(.86,.80,.70); pal[2] = vec3(.78,.77,.75); pal[3] = vec3(.90,.86,.78); pal[4] = vec3(.80,.84,.82);
          int k = int(floor(vSeed * 5.));
          vec3 wallBase = k == 0 ? pal[0] : k == 1 ? pal[1] : k == 2 ? pal[2] : k == 3 ? pal[3] : pal[4];
          vec3 sat = pow(vRoof, vec3(.9)) * 1.18;
          vec3 roof = mix(sat, vec3(dot(sat, vec3(.333))), .25) * (.92 + .16 * vSeed);
          vec3 wall = mix(wallBase, sat, .28);
          // grime toward the street, staining under the parapet
          wall *= mix(.72, 1., smoothstep(0., 9., vWall.y)) * (1. - .08 * smoothstep(vHt - 1.2, vHt, vWall.y));
          // floors and windows
          float floorH = 3.2;
          vec2 g = vec2(vWall.x / 3.4, vWall.y / floorH);
          vec2 f = fract(g);
          float win = step(.22, f.x) * step(f.x, .78) * step(.32, f.y) * step(f.y, .82) * step(1., g.y) * step(vWall.y, vHt - .9);
          win *= step(.5, abs(vUp - 1.));
          float lit = step(.55 - .25 * vSeed, h21(floor(g) + vSeed * 31.));
          vec3 glass = vec3(.32, .36, .40);
          vec3 col = vUp > .5 ? roof : mix(wall, glass, win * .7);
          diffuseColor.rgb *= col;
          float winLit = win * lit * uNight;`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          totalEmissiveRadiance += mix(vec3(1., .74, .46), vec3(.86, .92, 1.), step(.8, vSeed)) * winLit * 2.4;`)
        .replace("#include <aomap_fragment>", `float cs = cloudShadow(vW); reflectedLight.directDiffuse *= cs; reflectedLight.directSpecular *= cs;\n#include <aomap_fragment>`);
    };
    return mat;
  }
  const bMat = buildingMaterial();
  const bDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  bDepth.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 iPos; attribute vec3 iSize; attribute float iRot;")
      .replace("#include <begin_vertex>", BUILD_TRANSFORM);
  };

  // unit box without a floor, base at y = 0
  const unitBox = (() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    const idx = g.index.array, keep = [];
    for (let i = 0; i < idx.length; i += 3) {
      const ny = g.attributes.normal.getY(idx[i]);
      if (ny > -0.5) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    g.setIndex(keep);
    return g;
  })();

  /* ---------- water ---------- */
  const waterMat = new THREE.ShaderMaterial({
    uniforms: { ...U, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) }, fog: true,
    vertexShader: /* glsl */ `varying vec3 vW;
      #include <common>
      #include <fog_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <logdepthbuf_vertex>
      #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `varying vec3 vW;
      uniform sampler2D uSat, uWater; uniform vec4 uExt; uniform vec3 uZen, uHor, uSunCol, uMoonDir; uniform float uTime, uWave, uNight, uMoonLit;
      ${GLSL_NOISE}
      #include <common>
      #include <fog_pars_fragment>
      #include <logdepthbuf_pars_fragment>
      vec2 waves(vec2 p, float t, float px){
        vec2 g = vec2(0.);
        g += vec2(cos(p.x * 9. + p.y * 4. + t * 1.3), cos(p.y * 7. - p.x * 3. + t * 1.1)) * .5 * (1. - smoothstep(.02, .07, px));
        g += vec2(vnoise(p * 38. + t * .6) - .5, vnoise(p * 41. - t * .5 + 7.) - .5) * 1.4 * (1. - smoothstep(.006, .02, px));
        g += vec2(vnoise(p * 140. + t * 1.4) - .5, vnoise(p * 150. - t * 1.2 + 3.) - .5) * .9 * (1. - smoothstep(.0015, .005, px));
        return g;
      }
      void main(){
        #include <logdepthbuf_fragment>
        vec2 uv = vec2((vW.x - uExt.x) / (uExt.y - uExt.x), (-vW.z - uExt.z) / (uExt.w - uExt.z));
        bool inside = uv.x > 0. && uv.x < 1. && uv.y > 0. && uv.y < 1.;
        vec3 base = vec3(.07, .16, .19);
        float shore = 0.;
        if (inside) { base = mix(base, texture2D(uSat, uv).rgb * .8, .55); shore = 1. - texture2D(uWater, uv).r; }
        vec3 V = normalize(cameraPosition - vW);
        float dist = length(cameraPosition - vW);
        float px = length(fwidth(vW.xz));
        float amp = .035 + uWave * .05;
        vec3 N = normalize(vec3(waves(vW.xz, uTime, px) * amp, 1.));
        N = vec3(N.x, N.z, N.y);
        vec3 R = reflect(-V, N);
        float fres = .02 + .98 * pow(1. - max(dot(N, V), 0.), 5.);
        vec3 skyR = mix(uHor, uZen, pow(clamp(R.y, 0., 1.), .5));
        float spec = pow(max(dot(R, uSunDir), 0.), 600.) * 6. + pow(max(dot(R, uSunDir), 0.), 60.) * .25;
        float moonSpec = pow(max(dot(R, uMoonDir), 0.), 300.) * 1.4 * uMoonLit * (1. - smoothstep(12., 60., dist));
        vec3 col = mix(base * (1. - uNight * .8), skyR, fres);
        col += uSunCol * spec * smoothstep(-.02, .06, uSunDir.y) * cloudShadow(vW) * (1. - smoothstep(40., 160., dist));
        col += vec3(.8, .85, 1.) * moonSpec;
        col = mix(col, base * 1.1 + .02, shore * .35);
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.receiveShadow = false;
  scene.add(water);
  if (q.has("nowater")) water.visible = false;

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

  /* ---------- data ---------- */
  let meta = null, terr = null;
  const tex = new THREE.TextureLoader();
  const loadTex = (file, srgb = true) => new Promise((res, rej) => tex.load(new URL(file, BASE).href, (t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    res(t);
  }, undefined, rej));

  async function gunzip(buf) {
    const b = new Uint8Array(buf);
    if (b[0] !== 0x1f || b[1] !== 0x8b) return buf; // server already decoded it
    const ds = new DecompressionStream("gzip");
    return new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer();
  }
  const getBin = async (file) => {
    const r = await fetch(new URL(file, BASE));
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    return gunzip(await r.arrayBuffer());
  };

  function terrainAt(x, z) {
    if (!terr) return 0;
    const { w, h, data, x0, n1 } = terr;
    const c = (x * 1000 - x0) / 100 - 0.5, r = (n1 + z * 1000) / 100 - 0.5;
    const c0 = Math.max(0, Math.min(w - 2, Math.floor(c))), r0 = Math.max(0, Math.min(h - 2, Math.floor(r)));
    const fx = clamp(c - c0), fy = clamp(r - r0);
    const v = (cc, rr) => data[rr * w + cc];
    const top = v(c0, r0) * (1 - fx) + v(c0 + 1, r0) * fx, bot = v(c0, r0 + 1) * (1 - fx) + v(c0 + 1, r0 + 1) * fx;
    return (top * (1 - fy) + bot * fy) / 1000;
  }

  const groundMeshes = [];
  async function buildGround() {
    const e = meta.extent;
    U.uExt.value.set(e.x0 / 1000, e.x1 / 1000, e.n0 / 1000, e.n1 / 1000);
    const [overview, dens, wmask] = await Promise.all([loadTex(meta.sat.overview), loadTex(meta.density.file, false), loadTex(meta.water.file, false)]);
    U.uSat.value = overview; U.uDensity.value = dens; U.uWater.value = wmask;
    const tb = await getBin(meta.terrain.file);
    const raw = new Uint16Array(tb);
    const data = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = raw[i] / 10 - 50;
    terr = { w: meta.terrain.w, h: meta.terrain.h, data, x0: e.x0, n1: e.n1 };

    const makeTile = (q, texture) => {
      const w = (q.x1 - q.x0) / 1000, h = (q.n1 - q.n0) / 1000;
      const sx = Math.max(8, Math.round(w / 0.1)), sy = Math.max(8, Math.round(h / 0.1));
      const g = new THREE.PlaneGeometry(w, h, sx, sy);
      g.rotateX(-Math.PI / 2);
      g.translate(q.x0 / 1000 + w / 2, 0, -(q.n0 / 1000 + h / 2));
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, terrainAt(p.getX(i), p.getZ(i)));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, patchGround(new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 })));
      m.receiveShadow = true;
      scene.add(m);
      groundMeshes.push(m);
      return m;
    };
    const whole = { x0: e.x0, x1: e.x1, n0: e.n0, n1: e.n1 };
    const low = makeTile(whole, overview);
    // apron: the land carries on past the data, blurred, until the haze takes it
    {
      const g = new THREE.PlaneGeometry(800, 800, 400, 400);
      g.rotateX(-Math.PI / 2);
      g.translate((e.x0 + e.x1) / 2000, 0, -(e.n0 + e.n1) / 2000);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, terrainAt(p.getX(i), p.getZ(i)) - 0.003);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, patchGround(new THREE.MeshStandardMaterial({ map: overview, roughness: 1 }), true));
      m.receiveShadow = false;
      if (!q.has("noapron")) scene.add(m);
    }
    if (!coarse) {
      // swap the overview for the 10 m quadrants once they arrive
      Promise.all(meta.sat.quads.map((q) => loadTex(q.file).then((t) => ({ q, t })))).then((list) => {
        list.forEach(({ q, t }) => makeTile(q, t));
        scene.remove(low);
        low.geometry.dispose();
      }).catch((err) => console.warn("High-resolution imagery unavailable", err));
    }
  }

  /* ---------- buildings, streamed in 4 km chunks ---------- */
  const chunks = new Map();
  let loadedCount = 0, queue = 0;
  const MAXQ = 4;
  function decodeH(v) { return v <= 240 ? v / 2 : 120 + (v - 240) * 10; }
  async function loadChunk(c, tier) {
    const key = `${tier}_${c.i}_${c.j}`;
    const buf = await getBin(`b/${key}.bin.gz`);
    const dv = new DataView(buf);
    const n = dv.getUint32(0, true);
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
    g.index = unitBox.index.clone();
    g.setAttribute("position", unitBox.attributes.position.clone());
    g.setAttribute("normal", unitBox.attributes.normal.clone());
    g.setAttribute("iPos", new THREE.InstancedBufferAttribute(pos, 3));
    g.setAttribute("iSize", new THREE.InstancedBufferAttribute(size, 3));
    g.setAttribute("iRot", new THREE.InstancedBufferAttribute(rot, 1));
    g.instanceCount = n;
    const cx = (c.x0 + 2000) / 1000, cz = -(c.n0 + 2000) / 1000;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, (minY + maxY) / 2, cz), Math.hypot(2.9, (maxY - minY) / 2 + 0.1));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(cx - 2.1, minY, cz - 2.1), new THREE.Vector3(cx + 2.1, maxY, cz + 2.1));
    const mesh = new THREE.Mesh(g, bMat);
    mesh.userData.n = n;
    mesh.customDepthMaterial = bDepth;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    scene.add(mesh);
    loadedCount += n;
    return mesh;
  }
  function schedule() {
    if (!meta) return;
    const list = [];
    const bRadius = coarse ? 3.2 : 6.5;
    const view = rig.d;
    for (const c of meta.buildings.chunks) {
      const cx = (c.x0 + 2000) / 1000, cz = -(c.n0 + 2000) / 1000;
      const d = Math.hypot(cx - rig.tx, cz - rig.tz);
      let st = chunks.get(c);
      if (!st) { st = { a: null, b: null, la: false, lb: false }; chunks.set(c, st); }
      if (c.a && !st.a && !st.la) list.push({ c, st, tier: "a", pri: d });
      // far chunks draw only their most prominent buildings (each file is sorted that way)
      const cam = Math.hypot(cx - camera.position.x, cz - camera.position.z, camera.position.y);
      const lod = clamp(Math.pow((coarse ? 7 : 11) / Math.max(cam, 0.1), 1.6), coarse ? 0.04 : 0.08, 1);
      for (const t of ["a", "b"]) {
        const m = st[t];
        if (!m) continue;
        m.geometry.instanceCount = Math.max(1, Math.round(m.userData.n * (t === "a" ? lod : Math.min(1, lod * 1.4))));
        m.castShadow = !noShadow && view < 9 && cam < 14;
      }
      const wantB = c.b && d < bRadius + view * 0.9 && view < 14;
      if (wantB && !st.b && !st.lb) list.push({ c, st, tier: "b", pri: d + 3 });
      if (st.b) {
        st.b.visible = view < 16 && d < (bRadius + view) * 1.6;
        if (d > (bRadius + view) * 2.6 && view < 30) {
          scene.remove(st.b); st.b.geometry.dispose(); loadedCount -= st.b.userData.n; st.b = null;
        }
      }
    }
    list.sort((p, q) => p.pri - q.pri);
    for (const job of list) {
      if (queue >= MAXQ) break;
      queue++;
      job.st["l" + job.tier] = true;
      loadChunk(job.c, job.tier).then((m) => { job.st[job.tier] = m; })
        .catch((err) => console.warn("chunk failed", err))
        .finally(() => { queue--; job.st["l" + job.tier] = false; });
    }
  }

  /* ---------- landmark: Mazar-e-Quaid (dome) and Icon Tower crown ---------- */
  const markMat = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.5 });
  function addMazar() {
    const x = toX(67.04096), z = toZ(24.87532), y = terrainAt(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.004, 0.075), markMat);
    plinth.position.y = 0.002;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.026, 0.054), markMat);
    body.position.y = 0.017;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.022, 0.008, 32), markMat);
    drum.position.y = 0.034;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.019, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), markMat);
    dome.position.y = 0.038;
    [plinth, body, drum, dome].forEach((m) => { m.castShadow = m.receiveShadow = true; g.add(m); });
    scene.add(g);
  }

  /* ---------- camera rig ---------- */
  const rig = { tx: 0, tz: 0, d: 50, theta: 0, phi: 0.6 };
  const goal = { ...rig };
  let fly = null;
  function flyTo(place, instant = false) {
    const [, lng, lat, d, phi, head] = place;
    const to = { tx: toX(lng), tz: toZ(lat), d, phi, theta: (head * Math.PI) / 180 };
    // turn the short way round
    let dt = to.theta - rig.theta;
    dt = ((dt + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    to.theta = rig.theta + dt;
    if (instant || reduce) { Object.assign(rig, to); Object.assign(goal, to); fly = null; return; }
    fly = { from: { ...rig }, to, t: 0, dur: 2.6 + Math.min(2, Math.hypot(to.tx - rig.tx, to.tz - rig.tz) / 25) };
  }
  flyTo(PLACES[0], true);

  let drag = null, idle = 0, engaged = false;
  const pointers = new Map();
  const hint = stage.querySelector(".stage__hint");
  const panBy = (dx, dy) => {
    const s = (rig.d * 2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(h, 1);
    const c = Math.cos(rig.theta), sn = Math.sin(rig.theta);
    goal.tx -= (dx * c + dy * sn / Math.max(Math.cos(rig.phi), 0.35)) * s;
    goal.tz -= (-dx * sn + dy * c / Math.max(Math.cos(rig.phi), 0.35)) * s;
  };
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    fly = null; idle = 0; engaged = true; stage.classList.add("is-engaged");
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = { mode: e.button === 2 || e.shiftKey ? "pan" : "orbit" };
    stage.classList.add("is-dragging");
    if (hint) hint.classList.add("is-gone");
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
      if (before > 10) goal.d = clamp(goal.d * (before / after), 0.25, 90);
      goal.theta -= ang1 - ang0;
      panBy(dx / 2, dy / 2);
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (!drag) return;
    if (drag.mode === "pan") panBy(dx, dy);
    else {
      goal.theta -= dx * 0.005;
      if (e.pointerType === "mouse") goal.phi = clamp(goal.phi - dy * 0.004, 0.02, 1.42);
    }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (!pointers.size) { drag = null; stage.classList.remove("is-dragging"); }
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  stage.addEventListener("pointerleave", () => { engaged = false; stage.classList.remove("is-engaged"); });
  canvas.addEventListener("wheel", (e) => {
    if (!(engaged || e.ctrlKey || e.metaKey)) {
      stage.classList.add("show-wheel-hint");
      clearTimeout(canvas._wt);
      canvas._wt = setTimeout(() => stage.classList.remove("show-wheel-hint"), 1400);
      return;
    }
    e.preventDefault();
    fly = null;
    goal.d = clamp(goal.d * Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.0015)), 0.25, 90);
  }, { passive: false });

  const zoom = (f) => { fly = null; goal.d = clamp(goal.d * f, 0.25, 90); };
  stage.querySelector("[data-zoom='in']")?.addEventListener("click", () => zoom(0.6));
  stage.querySelector("[data-zoom='out']")?.addEventListener("click", () => zoom(1.6));
  stage.querySelector("[data-north]")?.addEventListener("click", () => { fly = null; goal.theta = Math.round(rig.theta / (2 * Math.PI)) * 2 * Math.PI; });
  canvas.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "+" || k === "=") zoom(0.7);
    else if (k === "-") zoom(1.4);
    else if (k === "ArrowLeft" && e.shiftKey) goal.theta += 0.15;
    else if (k === "ArrowRight" && e.shiftKey) goal.theta -= 0.15;
    else if (k.startsWith("Arrow")) {
      const m = 40;
      panBy(k === "ArrowLeft" ? m : k === "ArrowRight" ? -m : 0, k === "ArrowUp" ? m : k === "ArrowDown" ? -m : 0);
    } else return;
    e.preventDefault(); e.stopPropagation();
  });

  /* ---------- pins ---------- */
  const pins = PLACES.slice(1).map((p) => {
    const n = document.createElement("button");
    n.type = "button";
    n.className = "pin";
    n.tabIndex = -1;
    n.innerHTML = `<i></i><b>${p[0]}</b>`;
    n.addEventListener("click", () => { flyTo(p); setActive(p[0]); });
    pinsEl.appendChild(n);
    return { n, p, v: new THREE.Vector3(toX(p[1]), 0.06, toZ(p[2])) };
  });
  const placesEl = stage.parentElement.querySelector(".places");
  const placeBtns = [];
  const setActive = (name) => placeBtns.forEach((b) => b.setAttribute("aria-pressed", b.dataset.name === name));
  if (placesEl) {
    PLACES.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.name = p[0];
      b.textContent = p[0];
      b.setAttribute("aria-pressed", p === PLACES[0]);
      b.addEventListener("click", () => { flyTo(p); setActive(p[0]); });
      placesEl.appendChild(b);
      placeBtns.push(b);
    });
  }

  const chips = ["sun", "wind", "cloud", "vis", "rain", "tide"].reduce((o, k) => {
    const n = document.createElement("span");
    readEl.appendChild(n);
    o[k] = n;
    return o;
  }, {});
  const put = (node, v) => { if (node && node.textContent !== v) node.textContent = v; };

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
  const want = { time: Date.now(), live: true, cloud: 0, haze: 0, vis: 20, wind: 0, wdir: 0, rain: 0, tide: 0, wave: 0.4 };
  const cur = { time: Date.now(), cloud: 0, haze: 0, vis: 20, wind: 0, rain: 0, tide: 0, wave: 0.4, wx: 0, wz: 1 };
  const col = (c) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
  const raw = (c) => new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), proj = new THREE.Vector3();
  const scaleEl = stage.querySelector(".stage__scale i"), scaleTx = stage.querySelector(".stage__scale span"), northEl = stage.querySelector("[data-north] svg");
  const dirOf = (p) => {
    const alt = (p.altitude * Math.PI) / 180, az = (p.azimuth * Math.PI) / 180;
    return new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
  };

  /* ---------- boot ---------- */
  const status = (t) => { if (statusEl) statusEl.textContent = t; };
  status("Loading Karachi…");
  (async () => {
    const r = await fetch(new URL("meta.json?v=2", BASE));
    meta = await r.json();
    await buildGround();
    addMazar();
    stage.classList.add("is-ready");
    schedule();
  })().catch((err) => {
    console.warn("City data unavailable", err);
    stage.classList.add("is-fallback");
  });

  /* ---------- loop ---------- */
  let last = performance.now(), clockT = 0, schedT = 0, slow = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!visible || document.hidden || !w) return;
    clockT += dt;
    window.__cityFrames = (window.__cityFrames || 0) + 1;
    // keep the frame rate honest on weaker GPUs
    if (dt > 0.045) slow++; else slow = Math.max(0, slow - 1);
    if (slow > 60 && dprCap > 1) { dprCap = Math.max(1, dprCap - 0.25); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap)); w = 0; resize(); slow = 0; }

    const k = reduce ? 1 : 1 - Math.exp(-dt * 3);
    cur.time += ((want.live ? Date.now() : want.time) - cur.time) * k;
    for (const key of ["cloud", "haze", "vis", "wind", "rain", "tide", "wave"]) cur[key] += (want[key] - cur[key]) * k;
    const a = ((want.wdir + 180) * Math.PI) / 180;
    cur.wx += (Math.sin(a) - cur.wx) * k; cur.wz += (-Math.cos(a) - cur.wz) * k;

    /* camera */
    if (fly) {
      fly.t += dt / fly.dur;
      const t = ease(clamp(fly.t));
      const lift = Math.sin(Math.PI * t) * Math.min(25, Math.hypot(fly.to.tx - fly.from.tx, fly.to.tz - fly.from.tz) * 0.6);
      for (const key of ["tx", "tz", "theta", "phi"]) rig[key] = fly.from[key] + (fly.to[key] - fly.from[key]) * t;
      rig.d = Math.exp(Math.log(fly.from.d) + (Math.log(fly.to.d) - Math.log(fly.from.d)) * t) + lift;
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
    const target = new THREE.Vector3(rig.tx, ty, rig.tz);
    camera.position.set(
      rig.tx + rig.d * Math.sin(rig.phi) * Math.sin(rig.theta),
      ty + rig.d * Math.cos(rig.phi),
      rig.tz + rig.d * Math.sin(rig.phi) * Math.cos(rig.theta)
    );
    const floor = terrainAt(camera.position.x, camera.position.z) + 0.03;
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
    sunDir.copy(dirOf(sp)); moonDir.copy(dirOf(mp));
    const moonLit = smooth(-1, 4, mp.altitude) * phase.fraction;
    const useMoon = sp.altitude < -2 && mp.altitude > 3;
    const lightDir = useMoon ? moonDir : sunDir.clone().setY(Math.max(sunDir.y, 0.06)).normalize();
    const span = clamp(rig.d * 0.9, 0.8, 18);
    sun.position.copy(target).addScaledVector(lightDir, span * 3 + 2);
    sun.target.position.copy(target);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.1, far: span * 6 + 6 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.normalBias = clamp(span * 0.00045, 0.0003, 0.006);
    const overcast = 1 - cur.cloud * 0.6;
    if (useMoon) { sun.intensity = 0.32 * phase.fraction * overcast; sun.color.setRGB(0.55, 0.66, 1); }
    else { sun.intensity = smooth(-1.5, 8, sp.altitude) * 3.6 * overcast * (1 - cur.haze * 0.3); sun.color.copy(col(pal.sun)); }
    hemi.intensity = 0.12 + pal.day * (0.88 + cur.cloud * 0.5);
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
    U.uCover.value = cur.cloud;
    U.uCloudTh.value = cur.cloud < 0.02 ? 2 : 0.95 - cur.cloud * 0.62;
    const drift = (0.004 + cur.wind * 0.0009) * dt;
    U.uWindOff.value.x -= cur.wx * drift; U.uWindOff.value.y -= cur.wz * drift;
    clouds.visible = cur.cloud > 0.02;
    water.position.y = cur.tide * 0.001;

    // aerial perspective: thick near the ground, thinner from high up
    scene.fog.color.copy(raw(pal.hor));
    const alt = Math.max(0.05, camera.position.y);
    const physical = 1.0 / Math.max(cur.vis, 1);
    scene.fog.density = physical * clamp(0.6 / Math.sqrt(alt), 0.08, 1.2) + cur.rain * 0.01;
    renderer.toneMappingExposure = 1 + night * 0.25;

    /* rain around the view */
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
    if (schedT > 0.35) { schedT = 0; schedule(); }

    renderer.render(scene, camera);
    if (window.__citySnapReq) { window.__citySnapOut = canvas.toDataURL("image/jpeg", 0.88); window.__citySnapReq = false; }

    /* overlays */
    for (const p of pins) {
      p.v.y = terrainAt(p.v.x, p.v.z) + clamp(rig.d * 0.012, 0.02, 0.4);
      proj.copy(p.v).project(camera);
      const x = (proj.x * 0.5 + 0.5) * w, y = (-proj.y * 0.5 + 0.5) * h;
      const dist = camera.position.distanceTo(p.v);
      const on = proj.z < 1 && x > 10 && x < w - 10 && y > 56 && y < h - 70 && dist < 70;
      p.n.style.opacity = on ? 1 : 0;
      p.n.style.pointerEvents = on ? "auto" : "none";
      if (on) p.n.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    if (northEl) northEl.style.transform = `rotate(${(rig.theta * 180) / Math.PI}deg)`;
    // scale bar at the target
    const mPerPx = (rig.d * 2 * Math.tan((camera.fov * Math.PI) / 360)) / h;
    const nice = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
    const km = nice.find((v) => v / mPerPx > 70) || 20;
    if (scaleEl) scaleEl.style.width = `${Math.round(km / mPerPx)}px`;
    put(scaleTx, km < 1 ? `${km * 1000} m` : `${km} km`);

    put(chips.sun, sp.altitude > -0.8 ? `SUN · ALT ${Math.round(sp.altitude)}° · AZ ${Math.round(sp.azimuth)}°` : useMoon ? `MOON · ${Math.round(phase.fraction * 100)}% LIT` : "SUN DOWN");
    put(chips.wind, `WIND · ${Math.round(cur.wind)} KM/H ${COMPASS[Math.round(want.wdir / 22.5) % 16]}`);
    put(chips.cloud, `CLOUD · ${Math.round(cur.cloud * 100)}%`);
    put(chips.vis, `VISIBILITY · ${cur.vis >= 10 ? Math.round(cur.vis) : cur.vis.toFixed(1)} KM`);
    put(chips.rain, cur.rain > 0.02 ? `RAIN · ${cur.rain.toFixed(1)} MM/H` : "DRY");
    put(chips.tide, `TIDE · ${cur.tide >= 0 ? "+" : "−"}${Math.abs(cur.tide).toFixed(1)} M`);
    if (meta) status(`${loadedCount.toLocaleString("en-US")} of ${(meta.buildings.total.a + meta.buildings.total.b).toLocaleString("en-US")} buildings in view range`);
  }
  requestAnimationFrame(frame);

  window.__cityFly = (name) => { const p = PLACES.find((q) => q[0] === name); if (p) flyTo(p, true); };
  return {
    set(next) { Object.assign(want, next); },
    flyTo: (name) => { const p = PLACES.find((q) => q[0] === name); if (p) flyTo(p); },
  };
}
