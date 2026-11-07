// ATHERA — interactive 3D product showcase (three.js r160)
import * as THREE from "./vendor/three/three.module.min.js";

const stage = document.getElementById("stage");
const canvas = document.getElementById("stageCanvas");

const CARDS = {
  all: {
    key: "ATHERA",
    title: "Full-envelope retrofit",
    text: "Four components working as one system on an existing building. Select a part to see what it does.",
    specs: [["Price per retrofit", "$52,150"], ["Gross margin", "42% (modelled)"], ["Power to run", "0 kWh"]],
  },
  roof: {
    key: "A · Roof",
    title: "TiO₂ ventilated roof tiles",
    text: "Anatase-coated ceramic tiles reflect sunlight. Warm air in the gap below rises and leaves by natural convection, carrying heat off the ceiling slab.",
    specs: [["Material", "Anatase TiO₂ on ceramic"], ["Mechanisms", "Reflect · convect · self-clean"], ["Price", "$22,500 · 500 m² × $45"]],
  },
  wall: {
    key: "B · Walls",
    title: "TiO₂ exterior wall coating",
    text: "A rutile TiO₂ coating backscatters UV and near-infrared before the wall absorbs it, and breaks down certain NOx and VOC pollutants.",
    specs: [["Material", "Rutile TiO₂ coating"], ["Target", ">50% solar heat gain blocked", "target"], ["Price", "$14,400 · 800 m² × $18"]],
  },
  window: {
    key: "C · Glazing",
    title: "Flexible radiative window films",
    text: "TiO₂ nanoparticles in PDMS scatter solar heat but let daylight through. The film is designed to emit long-wave infrared in the 8–13 µm band.",
    specs: [["Material", "TiO₂ in PDMS film"], ["Radiative cooling", "Needs emissivity testing", "target"], ["Price", "$5,250 · 150 m² × $35"]],
  },
  water: {
    key: "D · Water",
    title: "Integrated rainwater harvesting",
    text: "The roof doubles as a catchment. Rain runs off the tiles to the gutter and down to storage for non-potable use.",
    specs: [["Storage", "30,000 L"], ["Use", "Flushing, cleaning, irrigation"], ["Budget line", "Roof & water capture"]],
  },
};

/* ---------- UI wiring (works even without WebGL) ---------- */
const $ = (s) => document.querySelector(s);
const segs = Array.from(document.querySelectorAll(".stage__layers .seg"));
const pins = Array.from(document.querySelectorAll(".stage__pins .pin"));
const explodeBtn = $("#explodeBtn");
const spinBtn = $("#spinBtn");
const modeOut = $("#stageMode");

const state = { layer: "all", exploded: false, spinning: !matchMedia("(prefers-reduced-motion: reduce)").matches };
if (!state.spinning) { spinBtn.setAttribute("aria-pressed", "false"); spinBtn.textContent = "Rotate"; }

function renderCard(layer) {
  const c = CARDS[layer];
  $("#cardKey").textContent = c.key;
  $("#cardTitle").textContent = c.title;
  $("#cardText").textContent = c.text;
  const dl = $("#cardSpecs");
  dl.innerHTML = "";
  c.specs.forEach(([k, v, flag]) => {
    const row = document.createElement("div");
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    if (flag === "target") dd.classList.add("is-target");
    row.append(dt, dd); dl.append(row);
  });
}

function setLayer(layer) {
  state.layer = layer;
  segs.forEach((b) => { const on = b.dataset.layer === layer; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", on); });
  pins.forEach((p) => p.classList.toggle("is-on", p.dataset.layer === layer));
  stage.dataset.layer = layer;
  renderCard(layer);
}
segs.forEach((b) => b.addEventListener("click", () => setLayer(b.dataset.layer)));
pins.forEach((p) => p.addEventListener("click", () => setLayer(state.layer === p.dataset.layer ? "all" : p.dataset.layer)));
explodeBtn.addEventListener("click", () => {
  state.exploded = !state.exploded;
  explodeBtn.setAttribute("aria-pressed", state.exploded);
  explodeBtn.textContent = state.exploded ? "Assemble" : "Explode view";
  modeOut.textContent = state.exploded ? "Exploded" : "Assembled";
});
spinBtn.addEventListener("click", () => {
  state.spinning = !state.spinning;
  spinBtn.setAttribute("aria-pressed", state.spinning);
  spinBtn.textContent = state.spinning ? "Pause rotation" : "Rotate";
});
setLayer("all");

/* ---------- Renderer ---------- */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
} catch (e) {
  renderer = null;
}
if (!renderer) {
  $("#stageFallback").hidden = false;
  stage.classList.add("is-fallback");
} else {
  init();
}

function init() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);

  const W = 6, D = 4, H = 5;
  const SUN = new THREE.Vector3(0.55, 0.72, 0.42).normalize();

  /* lights */
  scene.add(new THREE.HemisphereLight(0xe4ecf7, 0xe9e3d6, 1.15));
  const sunLight = new THREE.DirectionalLight(0xfff1e0, 2.4);
  sunLight.position.copy(SUN).multiplyScalar(30);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 5, far: 70 });
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight);

  /* materials */
  const parts = { core: [], roof: [], wall: [], window: [], water: [] };
  const mat = (part, opts) => {
    const m = new THREE.MeshStandardMaterial({ transparent: true, ...opts });
    m.userData.base = opts.opacity ?? 1;
    m.emissive = new THREE.Color(0x2350c8);
    m.emissiveIntensity = 0;
    parts[part].push(m);
    return m;
  };
  const M = {
    concrete: mat("core", { color: 0xc9c3b8, roughness: 0.95 }),
    slab: mat("core", { color: 0xbdb7ab, roughness: 0.9 }),
    glass: mat("core", { color: 0x2e3a46, roughness: 0.12, metalness: 0.35 }),
    coating: mat("wall", { color: 0xf2f4f6, roughness: 0.55 }),
    tile: mat("roof", { color: 0xf5f7f7, roughness: 0.32, side: THREE.DoubleSide }),
    batten: mat("roof", { color: 0x8f8a80, roughness: 0.8 }),
    film: mat("window", { color: 0x9fc0ee, roughness: 0.08, metalness: 0.1, opacity: 0.55, side: THREE.DoubleSide }),
    pipe: mat("water", { color: 0xb3b9c0, roughness: 0.35, metalness: 0.5 }),
    tank: mat("water", { color: 0xdfe6ee, roughness: 0.2, opacity: 0.38, side: THREE.DoubleSide }),
    water: mat("water", { color: 0x3c6ad0, roughness: 0.25, opacity: 0.9 }),
  };
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x12161a, transparent: true, opacity: 0.16 });
  const edgeMats = { wall: edgeMat };

  const shadowed = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  /* plinth */
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(9.5, 9.5, 0.16, 96),
    new THREE.MeshStandardMaterial({ color: 0xefebe3, roughness: 1 })
  );
  plinth.position.y = -0.08;
  plinth.receiveShadow = true;
  scene.add(plinth);
  const polar = new THREE.PolarGridHelper(9.2, 16, 6, 96, 0x12161a, 0x12161a);
  polar.material.transparent = true;
  polar.material.opacity = 0.07;
  polar.position.y = 0.005;
  scene.add(polar);

  /* building core */
  const core = new THREE.Group();
  scene.add(core);
  const coreBox = shadowed(new THREE.Mesh(new THREE.BoxGeometry(W, H, D), M.concrete));
  coreBox.position.y = H / 2;
  core.add(coreBox);
  const slab = shadowed(new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.22, D + 0.3), M.slab));
  slab.position.y = H + 0.11;
  core.add(slab);

  /* faces + windows */
  const ROWS = [0.9, 2.55, 4.2];
  const WW = 1.1, WH = 0.95;
  const FACES = [
    { name: "front", n: new THREE.Vector3(0, 0, 1), rot: 0, half: D / 2, width: W + 0.12, cols: [-1.8, 0, 1.8] },
    { name: "back", n: new THREE.Vector3(0, 0, -1), rot: Math.PI, half: D / 2, width: W + 0.12, cols: [-1.8, 0, 1.8] },
    { name: "right", n: new THREE.Vector3(1, 0, 0), rot: Math.PI / 2, half: W / 2, width: D, cols: [-0.9, 0.9] },
    { name: "left", n: new THREE.Vector3(-1, 0, 0), rot: -Math.PI / 2, half: W / 2, width: D, cols: [-0.9, 0.9] },
  ];
  const T = 0.06; // coating thickness
  const coatGroups = [], filmGroups = [];

  FACES.forEach((f) => {
    // coating panel with window openings
    const shape = new THREE.Shape();
    shape.moveTo(-f.width / 2, 0); shape.lineTo(f.width / 2, 0); shape.lineTo(f.width / 2, H); shape.lineTo(-f.width / 2, H); shape.closePath();
    f.cols.forEach((u) => ROWS.forEach((v) => {
      const hole = new THREE.Path();
      hole.moveTo(u - WW / 2, v - WH / 2); hole.lineTo(u - WW / 2, v + WH / 2); hole.lineTo(u + WW / 2, v + WH / 2); hole.lineTo(u + WW / 2, v - WH / 2); hole.closePath();
      shape.holes.push(hole);
    }));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false });
    const cg = new THREE.Group();
    const panel = shadowed(new THREE.Mesh(geo, M.coating));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat);
    const holder = new THREE.Group();
    holder.rotation.y = f.rot;
    holder.position.copy(f.n).multiplyScalar(f.half);
    holder.add(panel, edges);
    cg.add(holder);
    cg.userData.n = f.n;
    core.parent.add(cg);
    coatGroups.push(cg);

    // dark glazing on the core + films
    const fg = new THREE.Group();
    const fh = new THREE.Group();
    fh.rotation.y = f.rot;
    fh.position.copy(f.n).multiplyScalar(f.half);
    const gh = fh.clone(); // glass holder (static)
    f.cols.forEach((u) => ROWS.forEach((v) => {
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(WW, WH), M.glass);
      glass.position.set(u, v, 0.004);
      gh.add(glass);
      const film = new THREE.Mesh(new THREE.BoxGeometry(WW + 0.12, WH + 0.12, 0.025), M.film);
      film.position.set(u, v, T + 0.02);
      film.castShadow = false;
      fh.add(film);
    }));
    core.add(gh);
    fg.add(fh);
    fg.userData.n = f.n;
    scene.add(fg);
    filmGroups.push(fg);
  });

  /* roof: battens, posts, barrel tiles */
  const roof = new THREE.Group();
  scene.add(roof);
  const GAP = 0.42, TOP = H + 0.22;
  const ROWZ = [-1.575, -0.525, 0.525, 1.575];
  [-2.1, -1.05, 0, 1.05, 2.1].forEach((z) => {
    const b = shadowed(new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.06, 0.08), M.batten));
    b.position.set(0, TOP + GAP - 0.03, z);
    roof.add(b);
    [-3, -1.5, 0, 1.5, 3].forEach((x) => {
      const p = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.07, GAP - 0.06, 0.07), M.batten));
      p.position.set(x, TOP + (GAP - 0.06) / 2, z);
      roof.add(p);
    });
  });
  const R = 0.23, LEN = 1.08;
  const tileGeo = new THREE.CylinderGeometry(R, R, LEN, 20, 1, true, -Math.PI / 2, Math.PI);
  tileGeo.rotateX(-Math.PI / 2);
  const cols = [];
  for (let x = -3.0; x <= 3.01; x += 0.46) cols.push(x);
  const tiles = new THREE.InstancedMesh(tileGeo, M.tile, cols.length * ROWZ.length);
  tiles.castShadow = true; tiles.receiveShadow = true;
  const tmp = new THREE.Object3D();
  let ti = 0;
  ROWZ.forEach((z, ri) => cols.forEach((x) => {
    tmp.position.set(x, TOP + GAP, z);
    tmp.rotation.set(ri % 2 ? 0.035 : -0.035, 0, 0);
    tmp.updateMatrix();
    tiles.setMatrixAt(ti++, tmp.matrix);
  }));
  roof.add(tiles);

  /* rainwater: gutter, downpipe, tank */
  const water = new THREE.Group();
  const TANK = new THREE.Vector3(4.75, 0, 0.9);
  water.position.copy(TANK);
  scene.add(water);
  const pipePath = new THREE.CurvePath();
  const P = (x, y, z) => new THREE.Vector3(x - TANK.x, y, z - TANK.z);
  const pA = P(3.12, TOP + 0.25, 0.9), pB = P(4.75, TOP + 0.25, 0.9), pC = P(4.75, 2.05, 0.9);
  pipePath.add(new THREE.LineCurve3(pA, pB));
  pipePath.add(new THREE.LineCurve3(pB, pC));
  water.add(shadowed(new THREE.Mesh(new THREE.TubeGeometry(pipePath, 40, 0.07, 10, false), M.pipe)));
  const gutter = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, D + 0.3), M.pipe));
  gutter.position.copy(P(3.22, TOP + 0.25, 0));
  water.add(gutter);
  const tankShell = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.0, 48, 1, true), M.tank);
  tankShell.position.y = 1.0;
  water.add(tankShell);
  const lid = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.84, 0.08, 48), M.pipe));
  lid.position.y = 2.04;
  water.add(lid);
  const base = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.84, 0.06, 48), M.pipe));
  base.position.y = 0.03;
  water.add(base);
  const waterBody = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.76, 1, 48), M.water);
  waterBody.position.y = 0.06;
  water.add(waterBody);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.805, 0.018, 8, 64), M.pipe);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.5 + i * 0.5;
    water.add(ring);
  }

  /* sun marker */
  const sunPos = SUN.clone().multiplyScalar(17).add(new THREE.Vector3(0, 2, 0));
  const sunBall = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 16), new THREE.MeshBasicMaterial({ color: 0xe98a3a, toneMapped: false }));
  sunBall.position.copy(sunPos);
  scene.add(sunBall);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 16), new THREE.MeshBasicMaterial({ color: 0xf0a35e, transparent: true, opacity: 0.18, toneMapped: false, depthWrite: false }));
  halo.position.copy(sunPos);
  scene.add(halo);

  /* ---------- photons ---------- */
  const COL = {
    sun: new THREE.Color(0xec8a35),
    out: new THREE.Color(0x2350c8),
    ir: new THREE.Color(0x6f9be6),
    day: new THREE.Color(0xf2c35c),
    rain: new THREE.Color(0x3a6bd4),
    air: new THREE.Color(0x8fb3e8),
  };
  const N = 260;
  const beamGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 6);
  const beams = new THREE.InstancedMesh(beamGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), N);
  beams.frustumCulled = false;
  scene.add(beams);
  const pool = Array.from({ length: N }, () => ({ on: false }));
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < N; i++) { beams.setMatrixAt(i, hidden); beams.setColorAt(i, COL.sun); }

  const off = { e: 0, roof: 0, coat: 0, film: 0, water: 0 };
  const rand = (a, b) => a + Math.random() * (b - a);
  const reflect = (d, n) => d.clone().sub(n.clone().multiplyScalar(2 * d.dot(n)));
  const IN = SUN.clone().negate();

  function spawn(pts, colors, speed, len = 0.7) {
    const p = pool.find((q) => !q.on);
    if (!p) return;
    const segs = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) { const l = pts[i].distanceTo(pts[i + 1]); segs.push(l); total += l; }
    Object.assign(p, { on: true, pts, colors, segs, total, s: 0, speed, len });
  }
  const wobble = (from, dir, length, amp = 0.12) => {
    const pts = [];
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0.001)).normalize();
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(from.clone().add(dir.clone().multiplyScalar(t * length)).add(side.clone().multiplyScalar(Math.sin(t * Math.PI * 4) * amp)));
    }
    return pts;
  };

  const sunFaces = FACES.filter((f) => f.n.dot(SUN) > 0);
  function pickWallPoint(f) {
    for (let k = 0; k < 20; k++) {
      const u = rand(-f.width / 2 + 0.2, f.width / 2 - 0.2), v = rand(0.3, H - 0.3);
      const inWin = f.cols.some((c) => Math.abs(u - c) < WW / 2 + 0.12) && ROWS.some((r) => Math.abs(v - r) < WH / 2 + 0.12);
      if (!inWin) return { u, v };
    }
    return { u: 0, v: 1.72 };
  }
  const facePoint = (f, u, v, out) => {
    // local u axis for each face after rotation.y = rot
    const ux = new THREE.Vector3(Math.cos(f.rot), 0, -Math.sin(f.rot));
    return ux.multiplyScalar(u).add(new THREE.Vector3(0, v, 0)).add(f.n.clone().multiplyScalar(f.half + out));
  };

  const emit = {
    roof() {
      const t = new THREE.Vector3(rand(-2.8, 2.8), TOP + GAP + R + off.roof, rand(-1.9, 1.9));
      spawn([t.clone().add(SUN.clone().multiplyScalar(8)), t, t.clone().add(reflect(IN, new THREE.Vector3(0, 1, 0)).multiplyScalar(7))], [COL.sun, COL.out], 6.5);
    },
    roofIR() {
      const t = new THREE.Vector3(rand(-2.6, 2.6), TOP + GAP + R + off.roof, rand(-1.8, 1.8));
      spawn(wobble(t, new THREE.Vector3(0, 1, 0), 3.6), Array(10).fill(COL.ir), 2.2, 0.3);
    },
    roofAir() {
      const z = ROWZ[Math.floor(Math.random() * 4)] + rand(-0.3, 0.3);
      const y = TOP + rand(0.12, GAP - 0.1) + off.roof * 0.5;
      spawn([new THREE.Vector3(-3.4, y, z), new THREE.Vector3(3.6, y + 0.25, z)], [COL.air], 2.4, 0.3);
    },
    wall() {
      const f = sunFaces[Math.random() < 0.5 ? 0 : 1];
      const { u, v } = pickWallPoint(f);
      const t = facePoint(f, u, v, T + off.coat);
      spawn([t.clone().add(SUN.clone().multiplyScalar(8)), t, t.clone().add(reflect(IN, f.n).multiplyScalar(5))], [COL.sun, COL.out], 6.5);
    },
    window() {
      const f = sunFaces[Math.random() < 0.5 ? 0 : 1];
      const u = f.cols[Math.floor(Math.random() * f.cols.length)] + rand(-0.4, 0.4);
      const v = ROWS[Math.floor(Math.random() * 3)] + rand(-0.3, 0.3);
      const t = facePoint(f, u, v, T + 0.03 + off.film);
      const start = t.clone().add(SUN.clone().multiplyScalar(8));
      if (Math.random() < 0.55) spawn([start, t, t.clone().add(reflect(IN, f.n).multiplyScalar(4.5))], [COL.sun, COL.out], 6.5);
      else spawn([start, t, t.clone().add(IN.clone().multiplyScalar(2.2))], [COL.sun, COL.day], 5.5);
    },
    windowIR() {
      const f = sunFaces[Math.random() < 0.5 ? 0 : 1];
      const u = f.cols[Math.floor(Math.random() * f.cols.length)];
      const v = ROWS[Math.floor(Math.random() * 3)];
      const t = facePoint(f, u, v, T + 0.03 + off.film);
      spawn(wobble(t, f.n.clone().add(new THREE.Vector3(0, 0.9, 0)).normalize(), 3.2, 0.1), Array(10).fill(COL.ir), 2.2, 0.3);
    },
    water() {
      const x = rand(-2.6, 2.9), z = rand(-1.7, 1.7);
      const roofY = TOP + GAP + R + off.roof;
      const wx = TANK.x + off.water;
      spawn([
        new THREE.Vector3(x, roofY + 6, z),
        new THREE.Vector3(x, roofY, z),
        new THREE.Vector3(3.22 + off.water, TOP + 0.3, 0.9),
        new THREE.Vector3(wx, TOP + 0.3, 0.9),
        new THREE.Vector3(wx, 1.2, 0.9),
      ], [COL.rain, COL.rain, COL.rain, COL.rain], 5.5, 0.3);
    },
  };
  const RATES = {
    roof: { roof: 10, roofIR: 4, roofAir: 6 },
    wall: { wall: 12 },
    window: { window: 10, windowIR: 3 },
    water: { water: 16 },
  };
  const acc = {};

  const qa = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  function updatePhotons(dt) {
    const L = state.layer;
    const active = L === "all" ? ["roof", "wall", "window", "water"] : [L];
    const mult = L === "all" ? 0.3 : 1;
    active.forEach((k) => Object.entries(RATES[k]).forEach(([fn, r]) => {
      acc[fn] = (acc[fn] || 0) + r * mult * dt;
      while (acc[fn] >= 1) { acc[fn] -= 1; emit[fn](); }
    }));
    for (let i = 0; i < N; i++) {
      const p = pool[i];
      if (!p.on) continue;
      p.s += p.speed * dt;
      if (p.s >= p.total) { p.on = false; beams.setMatrixAt(i, hidden); continue; }
      let s = p.s, k = 0;
      while (k < p.segs.length - 1 && s > p.segs[k]) { s -= p.segs[k]; k++; }
      const a = p.pts[k], b = p.pts[k + 1];
      dir.subVectors(b, a).normalize();
      pos.copy(a).addScaledVector(dir, s);
      const fade = Math.min(1, p.s / 0.5, (p.total - p.s) / 0.8);
      qa.setFromUnitVectors(up, dir);
      scl.set(fade, p.len * fade, fade);
      tmp.matrix.compose(pos.addScaledVector(dir, -p.len * 0.5 * fade), qa, scl);
      beams.setMatrixAt(i, tmp.matrix);
      beams.setColorAt(i, p.colors[Math.min(k, p.colors.length - 1)]);
    }
    beams.instanceMatrix.needsUpdate = true;
    if (beams.instanceColor) beams.instanceColor.needsUpdate = true;
  }

  /* ---------- camera rig (custom, scroll-friendly) ---------- */
  const target = new THREE.Vector3(0.9, 2.9, 0);
  const rig = { theta: 0.72, phi: 1.12, vt: 0, vp: 0, radius: 21 };
  let dragging = false, lastX = 0, lastY = 0, idle = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY; idle = 0;
    canvas.setPointerCapture(e.pointerId);
    stage.classList.add("is-dragging");
    document.getElementById("stageHint").classList.add("is-gone");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    rig.vt = -dx * 0.006;
    rig.theta += rig.vt;
    if (e.pointerType === "mouse") { rig.vp = -dy * 0.004; rig.phi += rig.vp; }
  });
  const endDrag = () => { dragging = false; stage.classList.remove("is-dragging"); };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  /* ---------- pins ---------- */
  const anchors = {
    roof: () => new THREE.Vector3(-1.4, TOP + GAP + R + 0.35 + off.roof, 1.9),
    wall: () => new THREE.Vector3(-0.9, 1.72, D / 2 + T + off.coat),
    window: () => new THREE.Vector3(1.8, 4.2, D / 2 + T + 0.04 + off.film),
    water: () => new THREE.Vector3(TANK.x + off.water, 2.4, TANK.z + 0.8),
  };
  const proj = new THREE.Vector3();

  /* ---------- resize + visibility ---------- */
  let width = 0, height = 0;
  function resize() {
    const r = { width: canvas.clientWidth, height: canvas.clientHeight };
    if (r.width === width && r.height === height) return;
    width = r.width; height = r.height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  let visible = false;
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) clock.getDelta(); }, { rootMargin: "100px" }).observe(stage);

  /* ---------- loop ---------- */
  const clock = new THREE.Clock();
  const damp = (cur, to, k, dt) => cur + (to - cur) * (1 - Math.exp(-k * dt));
  let time = 0, level = 0.45;

  function frame() {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    time += dt;

    // explode
    off.e = damp(off.e, state.exploded ? 1 : 0, 4, dt);
    const ease = off.e * off.e * (3 - 2 * off.e);
    off.roof = ease * 2.4; off.coat = ease * 0.9; off.film = ease * 2.0; off.water = ease * 1.5;
    roof.position.y = off.roof;
    coatGroups.forEach((g) => g.position.copy(g.userData.n).multiplyScalar(off.coat));
    filmGroups.forEach((g) => g.position.copy(g.userData.n).multiplyScalar(off.film));
    water.position.x = TANK.x + off.water;

    // focus fade + highlight
    const L = state.layer;
    const pulse = 0.18 + Math.sin(time * 3) * 0.08;
    Object.entries(parts).forEach(([k, mats]) => {
      const focus = L === "all" || k === L;
      const f = focus ? 1 : k === "core" ? 0.55 : 0.16;
      mats.forEach((m) => {
        m.opacity = damp(m.opacity, m.userData.base * f, 6, dt);
        m.depthWrite = m.opacity > 0.6;
        m.emissiveIntensity = damp(m.emissiveIntensity, L !== "all" && k === L ? pulse : 0, 6, dt);
      });
    });
    edgeMat.opacity = damp(edgeMat.opacity, L === "all" || L === "wall" ? 0.16 : 0.04, 6, dt);

    // tank fill
    level = damp(level, L === "water" ? 0.92 : 0.45, 0.35, dt);
    waterBody.scale.y = 1.9 * level;
    waterBody.position.y = 0.06 + (1.9 * level) / 2;

    // camera
    if (!dragging) {
      rig.vt *= Math.pow(0.04, dt); rig.vp *= Math.pow(0.04, dt);
      rig.theta += rig.vt; rig.phi += rig.vp;
      idle += dt;
      if (state.spinning && idle > 1.2) rig.theta += 0.12 * dt;
    }
    rig.phi = Math.min(1.42, Math.max(0.55, rig.phi));
    const aspect = width / Math.max(height, 1);
    const fit = Math.max(1, 1.3 / aspect);
    rig.radius = damp(rig.radius, (state.exploded ? 26 : 20.5) * fit, 3, dt);
    target.y = damp(target.y, state.exploded ? 3.4 : 2.9, 3, dt);
    camera.position.set(
      target.x + rig.radius * Math.sin(rig.phi) * Math.sin(rig.theta),
      target.y + rig.radius * Math.cos(rig.phi),
      target.z + rig.radius * Math.sin(rig.phi) * Math.cos(rig.theta)
    );
    camera.lookAt(target);

    halo.scale.setScalar(1 + Math.sin(time * 2) * 0.06);
    updatePhotons(dt);
    renderer.render(scene, camera);

    // pins
    pins.forEach((p) => {
      proj.copy(anchors[p.dataset.layer]()).project(camera);
      const x = (proj.x * 0.5 + 0.5) * width, y = (-proj.y * 0.5 + 0.5) * height;
      p.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      p.classList.toggle("is-behind", proj.z > 1);
    });
  }
  stage.classList.add("is-ready");
  frame();
}
