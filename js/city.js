// Karachi as a table-top model, standing in the weather the rest of the page reports.
// Building data: Google Open Buildings (CC BY 4.0). Landmarks are modelled by hand.
// 1 unit = 1 km. +x is east, −z is north, +y is up. Heights are exaggerated (VEX).
import * as THREE from "./vendor/three.module.min.js";
import { sunPosition, moonPosition, moonPhase } from "./astro.js?v=1";
import { skyPalette } from "./sky.js?v=1";

const LAT = 24.8607, LNG = 67.0011;
const LAT0 = 24.84, LNG0 = 67.03, KX = 101.0, KZ = 110.6;
const VEX = 10;
const X = (lng) => (lng - LNG0) * KX;
const Z = (lat) => -(lat - LAT0) * KZ;
const up = (metres) => (metres / 1000) * VEX;

// The city itself comes from Google Open Buildings: 1.57 million building footprints (v3)
// grouped into 100 m squares, with heights from the Open Buildings 2.5D Temporal layer (2023).
// data/karachi-buildings.bin holds three byte grids, row 0 at the south edge:
// built share of each square, mean building height in half-metres, and a land mask.
const GRID = { w: 303, h: 227, cell: 0.1, lng0: 66.9, lat0: 24.755 };

const PLACES = [
  { id: "mazar", name: "Mazar-e-Quaid", at: [67.041, 24.8754], clear: 0.34, h: 0.75 },
  { id: "icon", name: "Icon Tower", at: [67.0222, 24.8133], clear: 0.16, h: (273 / 1000) * VEX + 0.1 },
  { id: "hbl", name: "HBL Plaza", at: [67.002, 24.8497], clear: 0.12, h: (101 / 1000) * VEX + 0.1 },
  { id: "port", name: "Port · Keamari", at: [66.9865, 24.8335], clear: 0, h: 0.6 },
  { id: "manora", name: "Manora light", at: [66.9785, 24.7915], clear: 0.06, h: 0.42 },
  { id: "clifton", name: "Clifton beach", at: [67.046, 24.7945], clear: 0, h: 0.2 },
  { id: "air", name: "Jinnah Intl", at: [67.1608, 24.9065], clear: 0, h: 0.2 },
  { id: "frere", name: "Frere Hall", at: [67.033, 24.8475], clear: 0.13, h: 0.4, quiet: true },
  { id: "empress", name: "Empress Market", at: [67.0289, 24.8627], clear: 0.14, h: 0.46, quiet: true },
  { id: "talwar", name: "Teen Talwar", at: [67.0338, 24.8338], clear: 0.09, h: 0.34, quiet: true },
];

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
// Small deterministic generator so the city is the same city on every visit.
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function createCity(stage) {
  const canvas = stage.querySelector("canvas");
  const pinsEl = stage.querySelector(".stage__pins");
  const readEl = stage.querySelector(".stage__read");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xffffff, 0.012);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xd8d2c6, 1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 10, far: 130 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.03;
  scene.add(key, key.target);

  /* ----- ground ----- */
  const mat = {
    land: new THREE.MeshStandardMaterial({ color: 0xd3d0c7, roughness: 1 }),
    block: new THREE.MeshStandardMaterial({ color: 0xfbfaf7, roughness: 0.85 }),
    mark: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.6, metalness: 0.3 }),
    park: new THREE.MeshStandardMaterial({ color: 0xcfd8c4, roughness: 1 }),
    tar: new THREE.MeshStandardMaterial({ color: 0xb9b8b4, roughness: 1 }),
    sea: new THREE.MeshStandardMaterial({ color: 0x9db4c8, roughness: 0.28, metalness: 0.15 }),
  };
  const seaMesh = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), mat.sea);
  seaMesh.rotation.x = -Math.PI / 2;
  seaMesh.position.set(0, -0.05, 0);
  seaMesh.receiveShadow = true;
  scene.add(seaMesh);

  const rnd = mulberry(1947);
  const places = PLACES.map((p) => ({ ...p, x: X(p.at[0]), z: Z(p.at[1]) }));
  const dummy = new THREE.Object3D();

  // warm points for the city at night
  const glow = document.createElement("canvas");
  glow.width = glow.height = 32;
  const gx = glow.getContext("2d"), grad = gx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.35, "rgba(255,255,255,.55)"); grad.addColorStop(1, "rgba(255,255,255,0)");
  gx.fillStyle = grad; gx.fillRect(0, 0, 32, 32);
  const lightMat = new THREE.PointsMaterial({ color: 0xff9c40, map: new THREE.CanvasTexture(glow), size: 0.34, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });

  /* ----- the built city, from Google Open Buildings ----- */
  const gx0 = X(GRID.lng0), gz0 = Z(GRID.lat0);
  fetch(new URL("../data/karachi-buildings.bin?v=1", import.meta.url))
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
    .then((buf) => {
      const n = GRID.w * GRID.h, d = new Uint8Array(buf);
      if (d.length < n * 3) throw new Error("building grid is truncated");
      const cover = d.subarray(0, n), tall = d.subarray(n, 2 * n), land = d.subarray(2 * n, 3 * n);

      // land: one plate, cut to the coast by the mask
      const px = new Uint8Array(n * 4);
      for (let k = 0; k < n; k++) { px[k * 4] = px[k * 4 + 1] = px[k * 4 + 2] = land[k]; px[k * 4 + 3] = 255; }
      const mask = new THREE.DataTexture(px, GRID.w, GRID.h, THREE.RGBAFormat);
      mask.magFilter = mask.minFilter = THREE.LinearFilter;
      mask.needsUpdate = true;
      mat.land.alphaMap = mask; mat.land.alphaTest = 0.5; mat.land.needsUpdate = true;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(GRID.w * GRID.cell, GRID.h * GRID.cell), mat.land);
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(gx0 + (GRID.w * GRID.cell) / 2, 0, gz0 - (GRID.h * GRID.cell) / 2);
      plate.receiveShadow = true;
      scene.add(plate);

      // one block per built hectare: footprint = share of the square that is built, height = mean building height
      const cells = [];
      for (let j = 0; j < GRID.h; j++) {
        for (let i = 0; i < GRID.w; i++) {
          const k = j * GRID.w + i;
          if (cover[k] < 10 || !land[k]) continue;
          const x = gx0 + (i + 0.5) * GRID.cell, z = gz0 - (j + 0.5) * GRID.cell;
          if (places.some((p) => p.clear && Math.hypot(p.x - x, p.z - z) < p.clear)) continue;
          cells.push({ x, z, side: Math.max(0.03, GRID.cell * Math.sqrt(cover[k] / 255) * 0.97), h: up(Math.max(tall[k] / 2, 3)), share: cover[k] / 255 });
        }
      }
      const boxGeo = new THREE.BoxGeometry(1, 1, 1);
      boxGeo.translate(0, 0.5, 0);
      const city = new THREE.InstancedMesh(boxGeo, mat.block, cells.length);
      city.castShadow = true; city.receiveShadow = true;
      const lights = [];
      cells.forEach((c, i) => {
        dummy.position.set(c.x, 0, c.z);
        dummy.scale.set(c.side, c.h, c.side);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        city.setMatrixAt(i, dummy.matrix);
        if (rnd() < c.share * 0.5) lights.push(c.x + (rnd() - 0.5) * c.side, c.h + 0.02, c.z + (rnd() - 0.5) * c.side);
      });
      scene.add(city);
      const lightGeo = new THREE.BufferGeometry();
      lightGeo.setAttribute("position", new THREE.Float32BufferAttribute(lights, 3));
      scene.add(new THREE.Points(lightGeo, lightMat));
      stage.classList.add("has-city");
    })
    .catch((err) => {
      console.warn("Building data unavailable; showing landmarks only.", err);
      stage.classList.add("no-city");
    });

  /* ----- landmarks ----- */
  const add = (geo, material, x, y, z, parent = scene) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const at = (id) => places.find((p) => p.id === id);
  {
    const p = at("mazar"); // white marble cube on a platform, under a dome, in its park
    add(new THREE.CylinderGeometry(0.33, 0.33, 0.012, 48), mat.park, p.x, 0.006, p.z).castShadow = false;
    add(new THREE.BoxGeometry(0.46, 0.05, 0.46), mat.mark, p.x, 0.025, p.z);
    const body = add(new THREE.CylinderGeometry(0.2, 0.25, 0.36, 4), mat.mark, p.x, 0.23, p.z);
    body.rotation.y = Math.PI / 4;
    add(new THREE.SphereGeometry(0.175, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat.mark, p.x, 0.41, p.z);
  }
  {
    const p = at("icon");
    add(new THREE.BoxGeometry(0.17, up(273), 0.17), mat.mark, p.x, up(273) / 2, p.z);
    add(new THREE.BoxGeometry(0.19, 0.03, 0.19), mat.steel, p.x, up(273) + 0.015, p.z);
    add(new THREE.BoxGeometry(0.15, up(170), 0.15), mat.mark, p.x + 0.22, up(170) / 2, p.z + 0.05);
  }
  {
    const p = at("hbl");
    add(new THREE.CylinderGeometry(0.1, 0.1, up(101), 24), mat.mark, p.x, up(101) / 2, p.z);
  }
  {
    const p = at("port"); // four gantry cranes along the East Wharf
    for (let k = 0; k < 4; k++) {
      const g = new THREE.Group();
      g.position.set(p.x - 0.2 + k * 0.03, 0, p.z - 0.45 + k * 0.3);
      g.rotation.y = 0.35;
      [[-0.06, -0.05], [0.06, -0.05], [-0.06, 0.05], [0.06, 0.05]].forEach(([dx, dz]) => add(new THREE.BoxGeometry(0.016, 0.34, 0.016), mat.steel, dx, 0.17, dz, g));
      add(new THREE.BoxGeometry(0.42, 0.02, 0.03), mat.steel, -0.1, 0.35, 0, g);
      add(new THREE.BoxGeometry(0.14, 0.03, 0.12), mat.steel, 0, 0.33, 0, g);
      scene.add(g);
    }
  }
  {
    const p = at("manora");
    add(new THREE.CylinderGeometry(0.022, 0.034, 0.3, 12), mat.mark, p.x, 0.15, p.z);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), mat.steel, p.x, 0.315, p.z);
  }
  {
    const p = at("frere");
    add(new THREE.BoxGeometry(0.2, 0.09, 0.12), mat.mark, p.x, 0.045, p.z);
    add(new THREE.ConeGeometry(0.035, 0.24, 4), mat.mark, p.x - 0.05, 0.21, p.z);
  }
  {
    const p = at("empress");
    add(new THREE.BoxGeometry(0.24, 0.07, 0.2), mat.mark, p.x, 0.035, p.z);
    add(new THREE.BoxGeometry(0.05, 0.28, 0.05), mat.mark, p.x, 0.14, p.z + 0.1);
    add(new THREE.ConeGeometry(0.04, 0.06, 4), mat.mark, p.x, 0.31, p.z + 0.1).rotation.y = Math.PI / 4;
  }
  {
    const p = at("talwar");
    [-0.05, 0, 0.05].forEach((dx, k) => add(new THREE.ConeGeometry(0.014, 0.2 + (k === 1 ? 0.04 : 0), 4), mat.mark, p.x + dx, 0.11 + (k === 1 ? 0.02 : 0), p.z));
  }
  {
    const p = at("air");
    const strip = (len, off) => {
      const m = add(new THREE.BoxGeometry(len, 0.01, 0.07), mat.tar, p.x, 0.006, p.z + off);
      m.rotation.y = (20 * Math.PI) / 180; m.castShadow = false;
    };
    strip(3.4, 0); strip(3.0, 0.3);
    add(new THREE.BoxGeometry(0.5, 0.06, 0.16), mat.mark, p.x - 0.2, 0.03, p.z + 0.62);
  }

  /* ----- clouds ----- */
  const CL = 28, PUFFS = 5;
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.94 });
  const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), cloudMat, CL * PUFFS);
  clouds.castShadow = true;
  clouds.frustumCulled = false;
  scene.add(clouds);
  const cl = Array.from({ length: CL }, (_, i) => ({
    x: (rnd() - 0.5) * 44, z: (rnd() - 0.5) * 36, y: 3.4 + rnd() * 1.6, grow: 0, order: i,
    puffs: Array.from({ length: PUFFS }, (_, k) => ({ dx: (k - 2) * 0.62 + (rnd() - 0.5) * 0.3, dy: (rnd() - 0.4) * 0.22, dz: (rnd() - 0.5) * 0.6, s: 0.42 + rnd() * 0.42 - Math.abs(k - 2) * 0.08 })),
  }));

  /* ----- wind and rain ----- */
  const WN = 110;
  const windPos = new Float32Array(WN * 6);
  const windGeo = new THREE.BufferGeometry();
  windGeo.setAttribute("position", new THREE.BufferAttribute(windPos, 3));
  const windMat = new THREE.LineBasicMaterial({ color: 0x2456ff, transparent: true, opacity: 0.5, fog: false });
  scene.add(new THREE.LineSegments(windGeo, windMat));
  const gust = Array.from({ length: WN }, () => ({ x: (rnd() - 0.5) * 40, z: (rnd() - 0.5) * 32, y: 0.5 + rnd() * 2.2, k: 0.6 + rnd() * 0.8 }));

  const RN = 1400;
  const rainPos = new Float32Array(RN * 6);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0x8aa0b8, transparent: true, opacity: 0 });
  const rainMesh = new THREE.LineSegments(rainGeo, rainMat);
  rainMesh.frustumCulled = false;
  scene.add(rainMesh);
  const drops = Array.from({ length: RN }, () => ({ x: (rnd() - 0.5) * 40, z: (rnd() - 0.5) * 32, y: rnd() * 7, v: 7 + rnd() * 4 }));

  /* ----- pins ----- */
  const pins = places.filter((p) => !p.quiet).map((p, i) => {
    const n = document.createElement("span");
    n.className = "pin";
    n.innerHTML = `<i></i><b>OBJ_${String(i + 3).padStart(2, "0")} ${p.name.toUpperCase()}</b>`;
    pinsEl.appendChild(n);
    return { n, v: new THREE.Vector3(p.x, p.h, p.z) };
  });
  const chips = ["sun", "wind", "cloud", "vis", "rain", "tide"].reduce((o, k) => {
    const n = document.createElement("span");
    readEl.appendChild(n);
    o[k] = n;
    return o;
  }, {});

  /* ----- camera rig ----- */
  const target = new THREE.Vector3(2.2, 0.2, -3.4);
  const rig = { theta: -0.48, phi: 1.08, vt: 0, radius: 29, plan: false, spin: !reduce };
  let dragging = false, lx = 0, ly = 0, idle = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; lx = e.clientX; ly = e.clientY; idle = 0;
    canvas.setPointerCapture(e.pointerId);
    stage.classList.add("is-dragging");
    const hint = stage.querySelector(".stage__hint");
    if (hint) hint.classList.add("is-gone");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    rig.vt = -(e.clientX - lx) * 0.006;
    rig.theta += rig.vt;
    if (e.pointerType === "mouse" && !rig.plan) rig.phi = clamp(rig.phi - (e.clientY - ly) * 0.004, 0.35, 1.42);
    lx = e.clientX; ly = e.clientY;
  });
  const end = () => { dragging = false; stage.classList.remove("is-dragging"); };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  const spinBtn = document.getElementById("citySpin"), topBtn = document.getElementById("cityTop");
  if (spinBtn) {
    if (!rig.spin) { spinBtn.setAttribute("aria-pressed", "false"); spinBtn.textContent = "Rotate"; }
    spinBtn.addEventListener("click", () => {
      rig.spin = !rig.spin;
      spinBtn.setAttribute("aria-pressed", rig.spin);
      spinBtn.textContent = rig.spin ? "Pause rotation" : "Rotate";
    });
  }
  if (topBtn) topBtn.addEventListener("click", () => {
    rig.plan = !rig.plan;
    topBtn.setAttribute("aria-pressed", rig.plan);
    topBtn.textContent = rig.plan ? "Model view" : "Plan view";
  });

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
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { rootMargin: "120px" }).observe(stage);

  /* ----- weather state ----- */
  const want = { time: Date.now(), live: true, cloud: 0, haze: 0, vis: 20, wind: 0, wdir: 0, rain: 0, tide: 0, wave: 0 };
  const cur = { time: Date.now(), cloud: 0, haze: 0, vis: 20, wind: 0, rain: 0, tide: 0, wx: 0, wz: 1, phi: rig.phi };
  const col = (c) => new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
  const css = (c) => `rgb(${c.map(Math.round).join(",")})`;
  const sunDir = new THREE.Vector3(), proj = new THREE.Vector3();
  const scaleEl = document.getElementById("cityScale"), northEl = document.getElementById("cityNorth");
  const put = (node, v) => { if (node.textContent !== v) node.textContent = v; };

  let last = performance.now(), clock = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!visible || document.hidden || !w) return;
    clock += dt;

    const k = reduce ? 1 : 1 - Math.exp(-dt * 4);
    cur.time += ((want.live ? Date.now() : want.time) - cur.time) * k;
    for (const key of ["cloud", "haze", "vis", "wind", "rain", "tide"]) cur[key] += (want[key] - cur[key]) * k;
    // the wind blows toward (bearing + 180°)
    const a = ((want.wdir + 180) * Math.PI) / 180;
    cur.wx += (Math.sin(a) - cur.wx) * k; cur.wz += (-Math.cos(a) - cur.wz) * k;

    /* light */
    const sun = sunPosition(cur.time, LAT, LNG), moon = moonPosition(cur.time, LAT, LNG);
    const pal = skyPalette(sun.altitude, cur.haze);
    const night = 1 - smooth(-8, 2, sun.altitude);
    const useMoon = sun.altitude < -1.5 && moon.altitude > 3;
    const src = useMoon ? moon : sun;
    const alt = (Math.max(src.altitude, 4) * Math.PI) / 180, az = (src.azimuth * Math.PI) / 180;
    sunDir.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
    key.position.copy(target).addScaledVector(sunDir, 60);
    key.target.position.copy(target);
    const overcast = 1 - cur.cloud * 0.72;
    if (useMoon) { key.intensity = 0.55 * moonPhase(cur.time).fraction * overcast; key.color.setRGB(0.66, 0.76, 1); }
    else { key.intensity = smooth(-1.5, 9, sun.altitude) * 3.4 * overcast * (1 - cur.haze * 0.3); key.color.copy(col(pal.sun)); }
    hemi.intensity = 0.3 + pal.day * (0.36 + cur.cloud * 0.5);
    hemi.color.copy(col(pal.zen)).lerp(new THREE.Color(1, 1, 1), 0.55);
    hemi.groundColor.copy(col(pal.hor)).lerp(new THREE.Color(0.85, 0.83, 0.78), 0.6);
    lightMat.opacity = night * 0.85;

    const fogC = col(pal.hor).lerp(col(pal.zen), 0.25);
    scene.fog.color.copy(fogC);
    scene.fog.density = clamp(0.085 / Math.max(cur.vis, 0.5), 0.003, 0.034) + cur.rain * 0.003;
    stage.style.background = `linear-gradient(180deg, ${css(pal.zen)} 0%, ${css(pal.hor)} 58%, ${css(pal.hor)} 100%)`;
    stage.classList.toggle("is-night", pal.day < 0.45);
    mat.sea.color.copy(col(pal.zen)).lerp(col(pal.hor), 0.2).multiplyScalar(0.42 + pal.day * 0.2);
    seaMesh.position.y = -0.05 + cur.tide * 0.012;
    cloudMat.color.copy(col(pal.lit)).lerp(col(pal.shade), 0.25);

    /* clouds drift with the wind */
    const drift = (0.05 + cur.wind * 0.012) * dt;
    const shown = cur.cloud * CL;
    let n = 0;
    for (const c of cl) {
      c.x += cur.wx * drift * 6; c.z += cur.wz * drift * 6;
      if (c.x > 24) c.x -= 48; if (c.x < -24) c.x += 48;
      if (c.z > 20) c.z -= 40; if (c.z < -20) c.z += 40;
      c.grow += (clamp(shown - c.order) - c.grow) * (reduce ? 1 : 1 - Math.exp(-dt * 2));
      for (const p of c.puffs) {
        const s = p.s * c.grow * (1.25 + cur.cloud * 0.9);
        dummy.position.set(c.x + p.dx * (1 + cur.cloud), c.y + p.dy, c.z + p.dz);
        dummy.scale.set(s * 1.25, s * 0.62, s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        clouds.setMatrixAt(n++, dummy.matrix);
      }
    }
    clouds.instanceMatrix.needsUpdate = true;

    /* wind streaks */
    const speed = 0.5 + cur.wind * 0.16, len = 0.25 + cur.wind * 0.045;
    gust.forEach((g, i) => {
      g.x += cur.wx * speed * g.k * dt; g.z += cur.wz * speed * g.k * dt;
      if (g.x > 21) g.x -= 42; if (g.x < -21) g.x += 42;
      if (g.z > 17) g.z -= 34; if (g.z < -17) g.z += 34;
      windPos.set([g.x, g.y, g.z, g.x - cur.wx * len * g.k, g.y, g.z - cur.wz * len * g.k], i * 6);
    });
    windGeo.attributes.position.needsUpdate = true;
    windMat.opacity = clamp(0.12 + cur.wind / 60, 0.12, 0.6);

    /* rain */
    const wet = clamp(cur.rain / 2.5);
    rainMat.opacity = wet > 0.01 ? 0.25 + wet * 0.4 : 0;
    if (wet > 0.01) {
      const live = Math.round(RN * (0.25 + wet * 0.75));
      drops.forEach((d, i) => {
        d.y -= d.v * dt; d.x += cur.wx * cur.wind * 0.02 * dt; d.z += cur.wz * cur.wind * 0.02 * dt;
        if (d.y < 0) { d.y = 6 + Math.random(); d.x = (Math.random() - 0.5) * 40; d.z = (Math.random() - 0.5) * 32; }
        const on = i < live ? 1 : 0;
        rainPos.set([d.x, d.y * on, d.z, d.x - cur.wx * 0.05, (d.y + 0.22) * on, d.z - cur.wz * 0.05], i * 6);
      });
      rainGeo.attributes.position.needsUpdate = true;
    }

    /* camera */
    if (!dragging) {
      rig.vt *= Math.pow(0.03, dt);
      rig.theta += rig.vt;
      idle += dt;
      if (rig.spin && idle > 1.5) rig.theta += 0.035 * dt;
    }
    cur.phi += ((rig.plan ? 0.02 : rig.phi) - cur.phi) * (reduce ? 1 : 1 - Math.exp(-dt * 3.5));
    const fit = Math.max(1, 1.25 / (w / h));
    const radius = (rig.plan ? 48 : 29) * fit;
    rig.radius += (radius - rig.radius) * (reduce ? 1 : 1 - Math.exp(-dt * 3.5));
    camera.position.set(
      target.x + rig.radius * Math.sin(cur.phi) * Math.sin(rig.theta),
      target.y + rig.radius * Math.cos(cur.phi),
      target.z + rig.radius * Math.sin(cur.phi) * Math.cos(rig.theta)
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    renderer.render(scene, camera);

    /* overlays */
    for (const p of pins) {
      proj.copy(p.v).project(camera);
      const x = (proj.x * 0.5 + 0.5) * w, y = (-proj.y * 0.5 + 0.5) * h;
      const on = proj.z < 1 && x > 8 && x < w - 8 && y > 40 && y < h - 30;
      p.n.style.opacity = on ? 1 : 0;
      if (on) p.n.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    northEl.style.transform = `rotate(${(rig.theta * 180) / Math.PI}deg)`;
    scaleEl.style.width = `${((5 * h) / (2 * Math.tan((camera.fov * Math.PI) / 360) * rig.radius)).toFixed(0)}px`;

    put(chips.sun, sun.altitude > -0.8 ? `SUN · ALT ${Math.round(sun.altitude)}° · AZ ${Math.round(sun.azimuth)}°` : useMoon ? `MOON · ALT ${Math.round(moon.altitude)}°` : "SUN DOWN");
    put(chips.wind, `WIND · ${Math.round(cur.wind)} KM/H ${COMPASS[Math.round(want.wdir / 22.5) % 16]}`);
    put(chips.cloud, `CLOUD · ${Math.round(cur.cloud * 100)}%`);
    put(chips.vis, `VISIBILITY · ${cur.vis >= 10 ? Math.round(cur.vis) : cur.vis.toFixed(1)} KM`);
    put(chips.rain, cur.rain > 0.02 ? `RAIN · ${cur.rain.toFixed(1)} MM/H` : "DRY");
    put(chips.tide, `TIDE · ${cur.tide >= 0 ? "+" : "−"}${Math.abs(cur.tide).toFixed(1)} M`);
  }
  stage.classList.add("is-ready");
  requestAnimationFrame(frame);

  return { set(next) { Object.assign(want, next); } };
}
