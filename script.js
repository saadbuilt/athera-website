(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  window.addEventListener("load", () => document.body.classList.add("is-loaded"));

  /* ---------- Masthead state + active nav ---------- */
  const masthead = $(".masthead");
  const onScroll = () => masthead.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const navLinks = $$(".nav a");
  const sectionObs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      navLinks.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === "#" + e.target.id));
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  $$("section[id]").forEach((s) => sectionObs.observe(s));

  /* ---------- Reveal on scroll ---------- */
  const revealTargets = [
    ".section__head", ".problem__text", ".loop", ".section-cut", ".layers", ".tile-feature__img",
    ".tile-feature__text", ".spectrum", ".mechanisms", ".figures", ".callout-line", ".benefits__img",
    ".benefits__list", ".budget", ".unit__text", ".calc", ".roadmap", ".closing__text", ".ledger",
    ".triad", ".channels", ".clients", ".process", ".advantage", ".evidence", ".faq__head", ".faq__list"
  ];
  const revealObs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("is-in"); revealObs.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  revealTargets.forEach((sel) => $$(sel).forEach((el) => { el.classList.add("reveal"); revealObs.observe(el); }));

  /* ---------- Count-up numbers ---------- */
  const countObs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      countObs.unobserve(e.target);
      const el = e.target;
      const end = +el.dataset.count;
      const comma = el.dataset.format === "comma";
      if (reduced) return;
      const dur = 1400, t0 = performance.now();
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        const v = end * (1 - Math.pow(1 - p, 4));
        el.textContent = comma ? fmt(v) : Math.round(v);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.6 });
  $$("[data-count]").forEach((el) => countObs.observe(el));

  /* ---------- Feedback loop toggle ---------- */
  const loop = $("#loop"), loopBtn = $("#loopBtn");
  if (loop && loopBtn) {
    const center = $$(".loop__center", loop);
    loopBtn.addEventListener("click", () => {
      const broken = loop.classList.toggle("is-broken");
      loopBtn.setAttribute("aria-pressed", broken);
      loopBtn.textContent = broken ? "Restore the loop" : "Break the loop";
      center[0].textContent = broken ? "ATHERA stops" : "The HVAC";
      center[1].textContent = broken ? "heat at the surface" : "feedback loop";
    });
  }

  /* ---------- Envelope layers ---------- */
  const cut = $(".section-cut");
  const cards = $$(".layer-card");
  const setLayer = (name) => {
    cut.dataset.active = name;
    cards.forEach((c) => {
      const on = c.dataset.layer === name;
      c.classList.toggle("is-active", on);
      c.setAttribute("aria-selected", on);
    });
  };
  if (cut) {
    setLayer("roof");
    cards.forEach((c) => {
      c.addEventListener("click", () => setLayer(c.dataset.layer));
      c.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLayer(c.dataset.layer); }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const i = cards.indexOf(c) + (e.key === "ArrowDown" ? 1 : -1);
          const next = cards[(i + cards.length) % cards.length];
          next.focus(); setLayer(next.dataset.layer);
        }
      });
    });
    $$("#cut .layer, #cut .callout").forEach((g) => {
      g.addEventListener("click", () => setLayer(g.dataset.layer));
      g.addEventListener("mouseenter", () => setLayer(g.dataset.layer));
    });
  }

  /* ---------- Spectrum chart ---------- */
  const svg = $("#spectrum");
  const NS = "http://www.w3.org/2000/svg";
  const C2 = 14388; // hc/k in µm·K
  const planck = (l, T) => Math.pow(l, -5) / (Math.exp(C2 / (l * T)) - 1);
  const LMIN = 0.25, LMAX = 30;
  const atmPts = [
    [0.25, 0], [0.3, 0.25], [0.4, 0.7], [0.7, 0.82], [1.1, 0.78], [1.35, 0.15], [1.5, 0.72], [1.8, 0.12],
    [2.1, 0.72], [2.5, 0.35], [2.7, 0.04], [3.3, 0.45], [3.6, 0.65], [4.1, 0.6], [4.4, 0.03], [5, 0.12],
    [6, 0.02], [7.5, 0.06], [8, 0.72], [9.2, 0.78], [9.6, 0.5], [10, 0.82], [12.5, 0.8], [13.5, 0.35],
    [14.5, 0.04], [20, 0.06], [30, 0.02]
  ];
  const zoneOf = (l) => {
    if (l < 0.4) return "Ultraviolet · backscattered by the TiO₂ coating";
    if (l < 0.7) return "Visible · reflected by roof & wall, let through by window film";
    if (l < 2.5) return "Near-infrared · scattered by TiO₂ before it reaches the envelope";
    if (l < 8) return "Mid-infrared · atmosphere largely opaque";
    if (l <= 13) return "Atmospheric window · where the PDMS film is designed to radiate";
    return "Far-infrared · absorbed by CO₂ and water vapour";
  };

  let geom = null;
  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };

  const sample = (T, a, b, n = 220) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const l = Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * (i / n));
      out.push([l, planck(l, T)]);
    }
    const max = Math.max(...out.map((p) => p[1]));
    return out.map(([l, v]) => [l, v / max]);
  };
  const sunData = sample(5778, 0.25, 4);
  const irData = sample(300, 2.5, 30);
  const interp = (data, l) => {
    if (l < data[0][0] || l > data[data.length - 1][0]) return 0;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] >= l) {
        const [x0, y0] = data[i - 1], [x1, y1] = data[i];
        return y0 + (y1 - y0) * ((l - x0) / (x1 - x0));
      }
    }
    return 0;
  };

  const drawSpectrum = (animateIn) => {
    if (!svg) return;
    const W = svg.clientWidth, H = svg.clientHeight;
    if (!W || !H) return;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";
    const m = { l: 8, r: 8, t: 34, b: 30 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const x = (l) => m.l + ((Math.log(l) - Math.log(LMIN)) / (Math.log(LMAX) - Math.log(LMIN))) * pw;
    const y = (v) => m.t + ph - v * ph * 0.92;
    geom = { x, m, pw, ph, W, H };

    const defs = el("defs", {}, svg);
    const g1 = el("linearGradient", { id: "sunGrad", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "#f0a35e", "stop-opacity": ".45" }, g1);
    el("stop", { offset: "1", "stop-color": "#f0a35e", "stop-opacity": "0" }, g1);
    const g2 = el("linearGradient", { id: "irGrad", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "#8fb3e8", "stop-opacity": ".4" }, g2);
    el("stop", { offset: "1", "stop-color": "#8fb3e8", "stop-opacity": "0" }, g2);

    // grid + axis
    const grid = el("g", { class: "grid" }, svg);
    const axis = el("g", { class: "axis" }, svg);
    const ticks = W < 560 ? [0.3, 1, 3, 10, 30] : [0.3, 0.5, 1, 2, 3, 5, 10, 20, 30];
    ticks.forEach((t) => {
      el("line", { x1: x(t), x2: x(t), y1: m.t, y2: m.t + ph }, grid);
      const tx = el("text", { x: x(t), y: H - 8, "text-anchor": t === 0.3 ? "start" : t === 30 ? "end" : "middle" }, axis);
      tx.textContent = t + (t === 30 ? " µm" : "");
    });
    el("line", { x1: m.l, x2: m.l + pw, y1: m.t + ph, y2: m.t + ph, style: "stroke:rgba(255,255,255,.35)" }, grid);

    // atmospheric window band
    el("rect", { class: "win fade", x: x(8), y: m.t, width: x(13) - x(8), height: ph }, svg);
    el("line", { class: "win-line", x1: x(8), x2: x(8), y1: m.t - 18, y2: m.t + ph }, svg);
    el("line", { class: "win-line", x1: x(13), x2: x(13), y1: m.t - 18, y2: m.t + ph }, svg);
    const wl = el("text", { class: "win-label fade", x: x(8) + 6, y: m.t - 8 }, svg);
    wl.textContent = W < 560 ? "8–13 µm" : "ATMOSPHERIC WINDOW · 8–13 µm";

    // atmospheric transmittance
    const atmPath = atmPts.map(([l, v], i) => `${i ? "L" : "M"}${x(l).toFixed(1)} ${y(v).toFixed(1)}`).join("");
    el("path", { class: "atm fade", d: atmPath }, svg);

    const line = (data) => data.map(([l, v], i) => `${i ? "L" : "M"}${x(l).toFixed(1)} ${y(v).toFixed(1)}`).join("");
    const area = (data) => line(data) + `L${x(data[data.length - 1][0]).toFixed(1)} ${y(0)}L${x(data[0][0]).toFixed(1)} ${y(0)}Z`;

    el("path", { class: "sun-area fade", d: area(sunData) }, svg);
    el("path", { class: "ir-area fade", d: area(irData) }, svg);
    const sl = el("path", { class: "sun-line draw", d: line(sunData) }, svg);
    const il = el("path", { class: "ir-line draw", d: line(irData) }, svg);
    [sl, il].forEach((p) => p.style.setProperty("--len", Math.ceil(p.getTotalLength())));

    // peak labels
    const lab = (t, lx, ly, color) => {
      const n = el("text", { x: lx, y: ly, class: "fade", style: `font:11px 'IBM Plex Mono',monospace;fill:${color}` }, svg);
      n.textContent = t;
    };
    lab(W < 560 ? "SUN" : "SUNLIGHT → REFLECT", x(0.85), y(0.82), "#f0a35e");
    lab(W < 560 ? "300 K" : "SURFACE → RADIATE", x(15), y(0.82), "#8fb3e8");

    // cursor
    el("line", { class: "cursor", x1: 0, x2: 0, y1: m.t, y2: m.t + ph }, svg);
    el("circle", { class: "cursor-dot", r: 3.5, cx: -10, cy: -10 }, svg);

    if (!animateIn) svg.classList.add("is-in");
  };

  if (svg) {
    drawSpectrum(true);
    const specObs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { requestAnimationFrame(() => svg.classList.add("is-in")); specObs.disconnect(); }
      });
    }, { threshold: 0.3 });
    specObs.observe(svg);

    let rT;
    let lastW = svg.clientWidth;
    window.addEventListener("resize", () => {
      clearTimeout(rT);
      rT = setTimeout(() => {
        if (svg.clientWidth === lastW) return;
        lastW = svg.clientWidth;
        drawSpectrum(false);
      }, 120);
    });

    const wlOut = $("#wlOut"), zoneOut = $("#zoneOut");
    const move = (clientX) => {
      if (!geom) return;
      const r = svg.getBoundingClientRect();
      const px = Math.max(geom.m.l, Math.min(geom.m.l + geom.pw, clientX - r.left));
      const l = Math.exp(Math.log(LMIN) + ((px - geom.m.l) / geom.pw) * (Math.log(LMAX) - Math.log(LMIN)));
      const vs = interp(sunData, l), vi = interp(irData, l);
      const v = Math.max(vs, vi);
      const cur = $(".cursor", svg), dot = $(".cursor-dot", svg);
      cur.setAttribute("x1", px); cur.setAttribute("x2", px);
      dot.setAttribute("cx", px);
      dot.setAttribute("cy", geom.m.t + geom.ph - v * geom.ph * 0.92);
      dot.style.fill = vs >= vi ? "#f0a35e" : "#8fb3e8";
      svg.classList.add("is-hover");
      wlOut.textContent = `λ ${l < 1 ? l.toFixed(2) : l < 10 ? l.toFixed(1) : l.toFixed(0)} µm`;
      zoneOut.textContent = zoneOf(l);
    };
    svg.addEventListener("pointermove", (e) => move(e.clientX));
    svg.addEventListener("pointerdown", (e) => move(e.clientX));
    svg.addEventListener("pointerleave", () => {
      svg.classList.remove("is-hover");
      wlOut.textContent = "λ — µm";
      zoneOut.textContent = "Move across the chart";
    });
  }

  /* ---------- Customer payback calculator ---------- */
  const PRICE = 52150;
  const bill = $("#bill"), cutR = $("#cutPct");
  if (bill && cutR) {
    const fill = (r) => r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min)) * 100 + "%");
    const update = () => {
      const b = +bill.value, c = +cutR.value / 100, s = b * c;
      $("#billOut").textContent = "$" + fmt(b);
      $("#cutOut").textContent = Math.round(c * 100) + "%";
      $("#save").textContent = "$" + fmt(s);
      $("#month").textContent = "$" + fmt(s / 12);
      $("#payback").textContent = (PRICE / s).toFixed(2) + " yrs";
      const net = s * 10 - PRICE;
      $("#net10").textContent = (net < 0 ? "−$" : "$") + fmt(Math.abs(net));
      fill(bill); fill(cutR);
    };
    bill.addEventListener("input", update);
    cutR.addEventListener("input", update);
    update();
  }

  /* ---------- 3D fallback watchdog ---------- */
  // If the 3D module can't run (old browser, blocked script, no WebGL), show the still image instead of an empty stage.
  const stageEl = $("#stage");
  if (stageEl) {
    window.addEventListener("load", () => setTimeout(() => {
      if (stageEl.classList.contains("is-ready") || stageEl.classList.contains("is-fallback")) return;
      stageEl.classList.add("is-fallback");
      const fb = $("#stageFallback");
      if (fb) fb.hidden = false;
    }, 5000));
  }

  /* ---------- Budget bars ---------- */
  const budget = $(".budget");
  if (budget) {
    const bObs = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { budget.classList.add("is-in"); bObs.disconnect(); } });
    }, { threshold: 0.25 });
    bObs.observe(budget);
  }
})();
