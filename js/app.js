// Mausam — Karachi weather. Data: Open-Meteo (CC BY 4.0).
import { createSky } from "./sky.js?v=1";
import { sunPosition, moonPhase, wetBulb } from "./astro.js?v=1";

const LAT = 24.8607, LNG = 67.0011;
const TZ = "Asia/Karachi", OFFSET = "+05:00";
const HOURS = 48;
const CACHE_KEY = "mausam:v1";

const place = `latitude=${LAT}&longitude=${LNG}&timezone=${encodeURIComponent(TZ)}`;
const sea = `latitude=24.78&longitude=66.95&timezone=${encodeURIComponent(TZ)}`;
const MODELS = [
  { id: "ecmwf_ifs025", name: "ECMWF IFS", org: "ECMWF", grid: "25 km" },
  { id: "icon_seamless", name: "ICON", org: "DWD", grid: "11 km" },
  { id: "gfs_seamless", name: "GFS", org: "NOAA", grid: "13 km" },
  { id: "ukmo_seamless", name: "UKMO", org: "Met Office", grid: "10 km" },
  { id: "gem_seamless", name: "GEM", org: "ECCC", grid: "15 km" },
  { id: "jma_seamless", name: "JMA GSM", org: "JMA", grid: "55 km" },
  { id: "meteofrance_seamless", name: "ARPEGE", org: "Météo-Fr.", grid: "25 km" },
  { id: "cma_grapes_global", name: "GRAPES", org: "CMA", grid: "15 km" },
];
const ids = MODELS.map((m) => m.id).join(",");
const API = {
  fc: `https://api.open-meteo.com/v1/forecast?${place}&forecast_days=10&past_days=1&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,is_day,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,visibility,uv_index&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,cloud_cover,pressure_msl,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max`,
  aq: `https://air-quality-api.open-meteo.com/v1/air-quality?${place}&forecast_days=4&past_days=1&current=us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone&hourly=us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone`,
  sea: `https://marine-api.open-meteo.com/v1/marine?${sea}&forecast_days=4&past_days=1&current=wave_height,wave_direction,wave_period,sea_surface_temperature&hourly=wave_height,wave_direction,wave_period,sea_level_height_msl,sea_surface_temperature`,
  models: `https://api.open-meteo.com/v1/forecast?${place}&forecast_days=7&hourly=temperature_2m&models=${ids}`,
  prev: `https://previous-runs-api.open-meteo.com/v1/forecast?${place}&past_days=7&forecast_days=1&hourly=temperature_2m,temperature_2m_previous_day1,temperature_2m_previous_day2,temperature_2m_previous_day3&models=best_match,${ids}`,
};

/* ---------- small helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, parent, text) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
};
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const parse = (iso) => Date.parse((iso.length === 10 ? iso + "T12:00" : iso) + ":00" + OFFSET);
const fmt = (opts, locale = "en-US") => new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts });
const F = {
  hour: fmt({ hour: "numeric", hour12: true }),
  hm: fmt({ hour: "numeric", minute: "2-digit", hour12: true }),
  clock: fmt({ hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }, "en-GB"),
  wd: fmt({ weekday: "short" }),
  wdLong: fmt({ weekday: "long" }),
  dm: fmt({ day: "numeric", month: "short" }),
};
const hour = (t) => F.hour.format(t);
const hm = (t) => F.hm.format(t);
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const bearing = (deg) => COMPASS[Math.round(deg / 22.5) % 16];
const num = (v, d = 0) => (v == null || Number.isNaN(v) ? "–" : v.toFixed(d));
const text = (id, v) => { const n = document.getElementById(id); if (n && n.textContent !== v) n.textContent = v; };

const state = { data: null, hours: [], idx: 0, unit: "C", metric: "temp", lead: 1, fetchedAt: 0 };
try { state.unit = localStorage.getItem("mausam:unit") === "F" ? "F" : "C"; } catch (e) {}

const tC = (c) => (state.unit === "F" ? (c * 9) / 5 + 32 : c);
const dC = (c) => (state.unit === "F" ? c * 1.8 : c);
const T = (c) => (c == null ? "–" : `${Math.round(tC(c))}°`);

/* ---------- vocabulary ---------- */
const COND = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Freezing fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Light showers", 81: "Showers", 82: "Violent showers", 85: "Snow showers", 86: "Snow showers",
  95: "Thunderstorm", 96: "Thunderstorm, hail", 99: "Thunderstorm, hail",
};
const iconKind = (code, isDay) => {
  if (code <= 1) return isDay ? "sun" : "moon";
  if (code === 2) return isDay ? "partly" : "partlyNight";
  if (code === 3) return "cloud";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67 || (code >= 80 && code <= 82)) return "rain";
  if (code <= 86) return "snow";
  return "storm";
};
const CLOUD = "M7.2 18.5h9.9a4.1 4.1 0 0 0 .5-8.17A5.6 5.6 0 0 0 6.9 9.6a4.5 4.5 0 0 0 .3 8.9z";
const ICONS = {
  sun: `<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"/>`,
  moon: `<path d="M19.5 14.2A8 8 0 1 1 9.8 4.5a6.4 6.4 0 0 0 9.7 9.7z"/>`,
  partly: `<circle cx="8.2" cy="8" r="3"/><path d="M8.2 2.6v1.4M2.8 8h1.4M4.4 4.2l1 1M12 4.2l-1 1"/><path d="${CLOUD}" transform="translate(2.4 2.6) scale(.86)"/>`,
  partlyNight: `<path d="M11.6 7.6a4.6 4.6 0 0 1-5.4-5 4.9 4.9 0 1 0 5.4 5z"/><path d="${CLOUD}" transform="translate(2.4 2.6) scale(.86)"/>`,
  cloud: `<path d="${CLOUD}"/>`,
  fog: `<path d="${CLOUD}" transform="translate(0 -3.2)"/><path d="M4.5 18.6h15M7 21.4h10"/>`,
  drizzle: `<path d="${CLOUD}" transform="translate(0 -3.6)"/><path d="M8.5 18.4v.01M12 20.4v.01M15.5 18.4v.01"/>`,
  rain: `<path d="${CLOUD}" transform="translate(0 -3.6)"/><path d="M9 17.6l-1.2 3M13 17.6l-1.2 3M17 17.6l-1.2 3"/>`,
  snow: `<path d="${CLOUD}" transform="translate(0 -3.6)"/><path d="M9 18.6v.01M12 21v.01M15 18.6v.01M12 17v.01"/>`,
  storm: `<path d="${CLOUD}" transform="translate(0 -3.6)"/><path d="M12.6 15.6l-2.2 3.2h3l-1.8 3"/>`,
};
const icon = (code, isDay) => `<svg viewBox="0 0 24 24" class="ico" aria-hidden="true">${ICONS[iconKind(code, isDay)]}</svg>`;

const AQI = [
  [50, "Good", "#3fa66b"], [100, "Moderate", "#c9a227"], [150, "Unhealthy for sensitive groups", "#e07a2f"],
  [200, "Unhealthy", "#d64545"], [300, "Very unhealthy", "#8e4ec6"], [Infinity, "Hazardous", "#7a2338"],
];
const aqiBand = (v) => AQI.find((b) => v <= b[0]);
const UVL = [[2.5, "Low"], [5.5, "Moderate"], [7.5, "High"], [10.5, "Very high"], [Infinity, "Extreme"]];
const DEW = [[10, "Dry"], [16, "Comfortable"], [20, "A little humid"], [24, "Muggy"], [Infinity, "Oppressive"]];
const BEAUFORT = [[2, "Calm"], [6, "Light air"], [12, "Light breeze"], [20, "Gentle breeze"], [29, "Moderate breeze"], [39, "Fresh breeze"], [50, "Strong breeze"], [62, "Near gale"], [75, "Gale"], [Infinity, "Storm"]];
const band = (table, v) => table.find((b) => v < b[0] || b[0] === Infinity)[1];

// Temperature → colour, used for the ten-day range bars.
const RAMP = [[4, [86, 150, 255]], [14, [70, 190, 222]], [21, [110, 200, 150]], [27, [240, 196, 70]], [33, [244, 140, 54]], [39, [228, 78, 52]], [46, [176, 36, 84]]];
function tempColor(c) {
  if (c <= RAMP[0][0]) return `rgb(${RAMP[0][1]})`;
  for (let i = 1; i < RAMP.length; i++) {
    if (c <= RAMP[i][0]) {
      const t = (c - RAMP[i - 1][0]) / (RAMP[i][0] - RAMP[i - 1][0]);
      return `rgb(${RAMP[i - 1][1].map((v, k) => Math.round(v + (RAMP[i][1][k] - v) * t))})`;
    }
  }
  return `rgb(${RAMP[RAMP.length - 1][1]})`;
}

/* ---------- curves ---------- */
// Monotone cubic interpolation (Fritsch–Carlson): smooth, and never overshoots the data.
function curve(pts) {
  const n = pts.length;
  if (n < 2) return "";
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx.push(pts[i + 1][0] - pts[i][0]); m.push((pts[i + 1][1] - pts[i][1]) / dx[i]); }
  t.push(m[0]);
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(pts[i][0] + h).toFixed(1)} ${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)} ${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)} ${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}
function spark(svg, values, { w, h, mark = -1 }) {
  svg.innerHTML = "";
  const ok = values.filter((v) => v != null);
  if (ok.length < 2) return;
  const lo = Math.min(...ok), hi = Math.max(...ok), span = hi - lo || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - lo) / span) * (h - 8)]).filter((p, i) => values[i] != null);
  const d = curve(pts);
  el("path", { d: `${d}L${w} ${h}L0 ${h}Z`, class: "spark__area" }, svg);
  el("path", { d, class: "spark__line" }, svg);
  if (mark >= 0 && values[mark] != null) el("circle", { cx: pts[mark][0], cy: pts[mark][1], r: 3, class: "spark__dot" }, svg);
}

/* ---------- data ---------- */
async function getJSON(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j.error) throw new Error(j.reason || "API error");
    return j;
  } finally {
    clearTimeout(timer);
  }
}

let loading = false;
async function load() {
  if (loading) return;
  loading = true;
  stamp("loading");
  // The model archive moves slowly and is the heaviest request, so it is refreshed hourly, not every ten minutes.
  const slowFresh = state.data && state.data.models && state.data.prev && Date.now() - (state.slowAt || 0) < 3600e3;
  const keys = Object.keys(API).filter((k) => !(slowFresh && (k === "models" || k === "prev")));
  const res = await Promise.allSettled(keys.map((k) => getJSON(API[k])));
  loading = false;
  const fresh = {};
  res.forEach((r, i) => { if (r.status === "fulfilled") fresh[keys[i]] = r.value; });
  if (!fresh.fc) {
    if (state.data) stamp("stale"); else fail();
    return;
  }
  state.data = { ...(state.data || {}), ...fresh };
  state.fetchedAt = Date.now();
  if (fresh.models && fresh.prev) state.slowAt = state.fetchedAt;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: state.fetchedAt, slowAt: state.slowAt || 0, data: state.data })); } catch (e) {}
  build();
  renderAll();
  stamp("live");
}

function build() {
  const { fc, aq, sea } = state.data;
  const H = fc.hourly, c = fc.current;
  const at = (obj) => (obj ? new Map(obj.hourly.time.map((t, i) => [t, i])) : null);
  const iH = at(fc), iA = at(aq), iS = at(sea);
  const start = iH.get(c.time.slice(0, 13) + ":00");
  const make = (i) => {
    const iso = H.time[i], a = iA ? iA.get(iso) : undefined, s = iS ? iS.get(iso) : undefined;
    const A = aq && a != null ? aq.hourly : null, S = sea && s != null ? sea.hourly : null;
    const pick = (src, key, k) => (src && src[key] && src[key][k] != null ? src[key][k] : null);
    return {
      iso, t: parse(iso), i,
      temp: H.temperature_2m[i], feels: H.apparent_temperature[i], rh: H.relative_humidity_2m[i], dew: H.dew_point_2m[i],
      pop: H.precipitation_probability[i] ?? 0, rain: H.precipitation[i] ?? 0, code: H.weather_code[i], cloud: H.cloud_cover[i],
      pres: H.pressure_msl[i], vis: H.visibility[i], wind: H.wind_speed_10m[i], wdir: H.wind_direction_10m[i], gust: H.wind_gusts_10m[i],
      uv: H.uv_index[i], isDay: H.is_day[i],
      aqi: pick(A, "us_aqi", a), pm25: pick(A, "pm2_5", a), pm10: pick(A, "pm10", a), no2: pick(A, "nitrogen_dioxide", a), o3: pick(A, "ozone", a),
      wave: pick(S, "wave_height", s), wper: pick(S, "wave_period", s), wfrom: pick(S, "wave_direction", s), tide: pick(S, "sea_level_height_msl", s), sst: pick(S, "sea_surface_temperature", s),
    };
  };
  const now = make(start);
  Object.assign(now, {
    iso: c.time, t: parse(c.time), temp: c.temperature_2m, feels: c.apparent_temperature, rh: c.relative_humidity_2m, dew: c.dew_point_2m,
    code: c.weather_code, cloud: c.cloud_cover, pres: c.pressure_msl, vis: c.visibility, wind: c.wind_speed_10m, wdir: c.wind_direction_10m,
    gust: c.wind_gusts_10m, uv: c.uv_index, isDay: c.is_day, rain: c.precipitation,
  });
  const over = (src, map) => { for (const k in map) if (src[map[k]] != null) now[k] = src[map[k]]; };
  if (aq && aq.current) over(aq.current, { aqi: "us_aqi", pm25: "pm2_5", pm10: "pm10", no2: "nitrogen_dioxide", o3: "ozone" });
  if (sea && sea.current) over(sea.current, { wave: "wave_height", wper: "wave_period", wfrom: "wave_direction", sst: "sea_surface_temperature" });
  const hours = [now];
  for (let i = start + 1; i < start + HOURS && i < H.time.length; i++) hours.push(make(i));
  state.hours = hours;
  state.start = start;
  state.today = fc.daily.time.indexOf(c.time.slice(0, 10));
  state.idx = Math.min(state.idx, hours.length - 1);
}

/* ---------- status ---------- */
function stamp(kind) {
  const n = $("#stamp");
  n.dataset.state = kind;
  const at = state.data ? hm(parse(state.data.fc.current.time)) : "";
  text("stampText", kind === "loading" ? (state.data ? `Updating · ${at}` : "Connecting") : kind === "live" ? `Live · ${at}` : `Offline · showing ${at}`);
}
function fail() {
  stamp("stale");
  text("stampText", "No data");
  text("cond", "Couldn't reach the weather service");
  text("say", "The sky above is still right: the sun and moon are computed, not downloaded. The numbers need a connection.");
  $("#retry").hidden = false;
}

/* ---------- hero ---------- */
const sky = createSky($("#sky"), { lat: LAT, lng: LNG, onFrame: annotate });
const hero = $("#hero");
const anno = { sun: $("#annoSun"), moon: $("#annoMoon"), sea: $("#annoSea") };

(function ruler() {
  const r = $("#ruler");
  r.style.top = `${(1 - sky.horizon) * 100}%`;
  [[90, "E"], [135, "SE"], [180, "S"], [225, "SW"], [270, "W"]].forEach(([az, label]) => {
    const s = document.createElement("span");
    s.style.left = `${sky.azToX(az) * 100}%`;
    s.textContent = `${label} ${az}°`;
    r.appendChild(s);
  });
})();

const heroBody = $(".hero__body");
function annotate(f) {
  // tags step aside when the object passes behind the readout
  const hb = heroBody.getBoundingClientRect(), hr = hero.getBoundingClientRect();
  const behind = (o) => {
    const px = o.x * hr.width + hr.left, py = o.y * hr.height + hr.top;
    return px > hb.left - 30 && px < hb.left + Math.min(hb.width, 620) && py > hb.top - 40 && py < hb.bottom + 10;
  };
  const put = (node, o, show) => {
    const on = show && o.x > 0.03 && o.x < 0.97 && o.y > 0.1 && !behind(o);
    node.classList.toggle("is-on", on);
    if (on) node.style.transform = `translate(${(o.x * hero.clientWidth).toFixed(1)}px, ${(o.y * hero.clientHeight).toFixed(1)}px)`;
  };
  put(anno.sun, f.sun, f.sun.alt > -0.8);
  put(anno.moon, f.moon, f.moon.alt > 2 && f.sun.alt < 8);
  text("annoSunTag", `OBJ_01 SUN · ALT ${Math.round(f.sun.alt)}° · AZ ${Math.round(f.sun.az)}°`);
  text("annoMoonTag", `OBJ_02 MOON · ${Math.round(f.moon.fraction * 100)}% LIT`);
  anno.sea.style.top = `${f.horizonY * 100}%`;
  hero.classList.toggle("is-day", f.day > 0.5);
}

const hazeOf = (e) => clamp(Math.max(((e.pm25 ?? 20) - 15) / 130, e.vis != null ? (9000 - e.vis) / 9000 : 0));
const dayOf = (e) => state.data.fc.daily.time.indexOf(e.iso.slice(0, 10));

function narrative() {
  const h = state.hours, now = h[0], next = h.slice(0, 25);
  const hi = next.reduce((a, b) => (b.temp > a.temp ? b : a)), lo = next.reduce((a, b) => (b.temp < a.temp ? b : a));
  const hazy = (now.pm25 ?? 0) > 55 || (now.vis ?? 1e5) < 6000;
  const out = [`${COND[now.code] || "Clear"}${hazy && now.code <= 3 ? " and hazy" : ""}.`];
  if (hi.t - now.t >= 3600e3 && hi.temp - now.temp >= 1.5) {
    const after = h.slice(h.indexOf(hi)).slice(0, 20).reduce((a, b) => (b.temp < a.temp ? b : a));
    out.push(`Climbing to ${T(hi.temp)} around ${hour(hi.t)}, then down to ${T(after.temp)} by ${hour(after.t)}.`);
  } else {
    const after = h.slice(h.indexOf(lo)).slice(0, 14).reduce((a, b) => (b.temp > a.temp ? b : a));
    out.push(lo.t - now.t < 3600e3 ? `About as cool as it gets; back up to ${T(after.temp)} by ${hour(after.t)}.` : `Easing down to ${T(lo.temp)} around ${hour(lo.t)}, then back to ${T(after.temp)} by ${hour(after.t)}.`);
  }
  const wet = next.reduce((a, b) => (b.pop > a.pop ? b : a));
  const uv = Math.max(...next.map((e) => e.uv ?? 0));
  if (wet.pop >= 40) out.push(`Rain is likely around ${hour(wet.t)} (${wet.pop}%).`);
  else if ((now.aqi ?? 0) > 150) out.push(`The air is unhealthy, AQI ${Math.round(now.aqi)}. A mask is worth it outdoors.`);
  else if ((now.aqi ?? 0) > 100) out.push(`The air is rough on sensitive lungs, AQI ${Math.round(now.aqi)}.`);
  else if (uv >= 8) out.push("UV is very high around midday.");
  else if (now.gust >= 45) out.push(`Windy, gusting to ${Math.round(now.gust)} km/h.`);
  return out.join(" ");
}

function renderHero() {
  const e = state.hours[state.idx];
  if (!e) return;
  const d = state.data.fc.daily, di = dayOf(e);
  text("temp", String(Math.round(tC(e.temp))));
  $("#condIcon").innerHTML = icon(e.code, e.isDay);
  text("cond", COND[e.code] || "—");
  text("feels", `Feels like ${T(e.feels)}`);
  text("hilo", di >= 0 ? `High ${T(d.temperature_2m_max[di])} · Low ${T(d.temperature_2m_min[di])}` : "");
  if (state.idx === 0) text("say", narrative());
  else {
    const hrs = Math.round((e.t - state.hours[0].t) / 3600e3);
    text("say", `${F.wdLong.format(e.t)} at ${hour(e.t)}, ${hrs} hour${hrs === 1 ? "" : "s"} from now. ${COND[e.code] || ""}, ${T(e.temp)}, wind ${Math.round(e.wind)} km/h from the ${bearing(e.wdir)}.`);
  }
  text("annoSeaTag", e.sst != null ? `ARABIAN SEA · ${T(e.sst)} · SWELL ${num(e.wave, 1)} M` : "ARABIAN SEA");
  sky.set({ time: state.idx === 0 ? Date.now() : e.t, cloud: (e.cloud ?? 0) / 100, haze: hazeOf(e) });
  tick();
}
function tick() {
  const e = state.hours[state.idx];
  text("clock", state.idx === 0 || !e ? `${F.clock.format(Date.now())} PKT` : `${F.wd.format(e.t)} ${F.dm.format(e.t)}, ${hour(e.t)}`);
}
setInterval(() => {
  tick();
  if (state.idx === 0) sky.set({ time: Date.now() });
}, 1000);

/* ---------- 48 hours ---------- */
const chart = $("#hoursChart");
const METRICS = {
  temp: { get: (e) => tC(e.temp), label: (v) => `${Math.round(v)}°`, legend: "Solid line: air temperature. Dashed: what it feels like.", kind: "line" },
  rain: { get: (e) => e.pop, label: (v) => `${Math.round(v)}%`, legend: "Chance of rain in each hour.", kind: "bar", min: 0, max: 100 },
  wind: { get: (e) => e.wind, label: (v) => `${Math.round(v)} km/h`, legend: "Bars: sustained wind. Ticks above: gusts. Arrows point the way the wind is blowing.", kind: "bar", min: 0 },
  air: { get: (e) => e.aqi, label: (v) => `AQI ${Math.round(v)}`, legend: "US air quality index. Dashed lines mark where each category starts.", kind: "bar", min: 0 },
};
let geo = null;

function renderHours() {
  const hrs = state.hours;
  if (!hrs.length) return;
  const M = METRICS[state.metric];
  const W = chart.clientWidth, H = W < 560 ? 220 : 280;
  const pad = { l: 14, r: 14, t: 52, b: 38 };
  const n = hrs.length, step = (W - pad.l - pad.r) / (n - 1);
  const x = (i) => pad.l + i * step;
  chart.innerHTML = "";
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H }, chart);

  const vals = hrs.map(M.get);
  const ok = vals.filter((v) => v != null);
  let lo = M.min ?? Math.min(...ok), hi = M.max ?? Math.max(...ok, 1);
  if (state.metric === "temp") {
    const feels = hrs.map((e) => tC(e.feels));
    lo = Math.min(lo, ...feels) - dC(1.5);
    hi = Math.max(hi, ...feels) + dC(1);
  }
  if (state.metric === "wind") hi = Math.max(hi, ...hrs.map((e) => e.gust ?? 0), 20) * 1.08;
  if (state.metric === "air") hi = Math.max(hi * 1.15, 60);
  const y0 = H - pad.b, y1 = pad.t;
  const y = (v) => y0 - ((v - lo) / (hi - lo || 1)) * (y0 - y1);

  // night bands
  let from = null;
  hrs.forEach((e, i) => {
    const night = !e.isDay;
    if (night && from == null) from = i;
    if ((!night || i === n - 1) && from != null) {
      const a = Math.max(pad.l, x(from) - step / 2), b = Math.min(W - pad.r, x(night ? i : i - 1) + step / 2);
      el("rect", { x: a, y: y1 - 8, width: b - a, height: y0 - y1 + 8, class: "c-night" }, svg);
      from = null;
    }
  });
  el("line", { x1: pad.l, x2: W - pad.r, y1: y0, y2: y0, class: "c-base" }, svg);

  // days and hours along the bottom
  const every = W < 560 ? 6 : 3;
  hrs.forEach((e, i) => {
    const hh = +e.iso.slice(11, 13);
    if (i > 0 && hh === 0) {
      el("line", { x1: x(i), x2: x(i), y1: 26, y2: y0, class: "c-midnight" }, svg);
      el("text", { x: x(i) + 6, y: 36, class: "c-day" }, svg, `${F.wd.format(e.t)} ${F.dm.format(e.t)}`.toUpperCase());
    }
    if (i === 0) el("text", { x: x(0), y: H - 14, class: "c-hour c-hour--now" }, svg, "NOW");
    else if (hh % every === 0 && x(i) > 46 && x(i) < W - 24) el("text", { x: x(i), y: H - 14, class: "c-hour", "text-anchor": "middle" }, svg, hour(e.t).replace(" ", "").toLowerCase());
  });
  el("text", { x: pad.l, y: 36, class: "c-day" }, svg, `${F.wd.format(hrs[0].t)} ${F.dm.format(hrs[0].t)}`.toUpperCase());

  const marks = [];
  if (M.kind === "line") {
    const pts = vals.map((v, i) => [x(i), y(v)]);
    const d = curve(pts);
    el("path", { d: `${d}L${x(n - 1)} ${y0}L${x(0)} ${y0}Z`, class: "c-area" }, svg);
    el("path", { d: curve(hrs.map((e, i) => [x(i), y(tC(e.feels))])), class: "c-feels" }, svg);
    el("path", { d, class: "c-line" }, svg);
    // label the turning points
    for (let i = 1; i < n - 1; i++) {
      const win = vals.slice(Math.max(0, i - 5), i + 6);
      const top = vals[i] === Math.max(...win), bot = vals[i] === Math.min(...win);
      if ((top || bot) && vals[i] !== vals[i - 1] && x(i) > 30 && x(i) < W - 30) {
        el("circle", { cx: x(i), cy: y(vals[i]), r: 2.5, class: "c-peak" }, svg);
        el("text", { x: x(i), y: y(vals[i]) + (top ? -9 : 17), class: "c-val", "text-anchor": "middle" }, svg, `${Math.round(vals[i])}°`);
      }
    }
    hrs.forEach((_, i) => marks.push(pts[i]));
  } else {
    const bw = Math.max(2, step * 0.64);
    if (state.metric === "air") {
      [[51, "MODERATE"], [101, "SENSITIVE GROUPS"], [151, "UNHEALTHY"], [201, "VERY UNHEALTHY"]].forEach(([v, name]) => {
        if (v > hi) return;
        el("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: "c-thresh" }, svg);
        el("text", { x: W - pad.r, y: y(v) - 5, class: "c-day", "text-anchor": "end" }, svg, `${name} ${v}`);
      });
    }
    vals.forEach((v, i) => {
      const top = v == null ? y0 : Math.min(y(v), y0 - 1.5);
      const b = el("rect", { x: x(i) - bw / 2, y: top, width: bw, height: y0 - top, rx: Math.min(3, bw / 2), class: "c-bar" }, svg);
      b.dataset.i = i;
      marks.push([x(i), top]);
      if (state.metric === "wind") {
        const e = hrs[i];
        el("line", { x1: x(i) - bw / 2, x2: x(i) + bw / 2, y1: y(e.gust), y2: y(e.gust), class: "c-gust" }, svg);
        if (i % every === 0 && x(i) > 20 && x(i) < W - 20)
          el("path", { d: "M0 -6L0 6M-3.5 2L0 6L3.5 2", class: "c-arrow", transform: `translate(${x(i)} ${y1 - 8}) rotate(${e.wdir})` }, svg);
      }
    });
    if (state.metric === "rain" && Math.max(...ok) === 0)
      el("text", { x: W / 2, y: (y0 + y1) / 2 + 6, class: "c-empty", "text-anchor": "middle" }, svg, "No rain in the next 48 hours");
    const peak = vals.indexOf(Math.max(...ok));
    if (Math.max(...ok) > 0 && x(peak) > 40 && x(peak) < W - 40 && state.metric !== "air")
      el("text", { x: x(peak), y: marks[peak][1] - 8 - (state.metric === "wind" ? y(hrs[peak].wind) - y(hrs[peak].gust) : 0), class: "c-val", "text-anchor": "middle" }, svg, M.label(vals[peak]));
  }

  const ghost = el("line", { y1: y1 - 8, y2: y0, class: "c-ghost" }, svg);
  const sel = el("g", { class: "c-sel" }, svg);
  el("line", { y1: 18, y2: y0, class: "c-sel__line" }, sel);
  el("circle", { r: 4.5, class: "c-sel__dot" }, sel);
  const tag = el("g", { class: "c-sel__tag" }, sel);
  const tagBg = el("rect", { height: 18, y: 0 }, tag);
  const tagTx = el("text", { y: 12.5, x: 7 }, tag);

  geo = { W, pad, step, n, x, marks, vals, M, svg, ghost, sel, tagBg, tagTx, tag, bars: $$(".c-bar", svg) };
  text("hoursLegend", M.legend);
  paintSel();
}

function paintSel() {
  if (!geo) return;
  const i = state.idx, e = state.hours[i], g = geo;
  const [mx, my] = g.marks[i];
  g.sel.firstChild.setAttribute("x1", mx);
  g.sel.firstChild.setAttribute("x2", mx);
  const dot = g.sel.children[1];
  dot.setAttribute("cx", mx); dot.setAttribute("cy", my);
  dot.style.display = g.M.kind === "line" ? "" : "none";
  g.bars.forEach((b) => b.classList.toggle("is-on", +b.dataset.i === i));
  const label = `${i === 0 ? "NOW" : `${F.wd.format(e.t)} ${hour(e.t)}`.toUpperCase()} · ${g.vals[i] == null ? "–" : g.M.label(g.vals[i])}`;
  g.tagTx.textContent = label;
  const tw = label.length * 6.25 + 14;
  g.tagBg.setAttribute("width", tw);
  g.tag.setAttribute("transform", `translate(${clamp(mx, 0, g.W - tw)} 0)`);
  chart.setAttribute("aria-valuenow", i);
  chart.setAttribute("aria-valuetext", label);
}

const indexAt = (clientX) => {
  const r = chart.getBoundingClientRect();
  return clamp(Math.round((clientX - r.left - geo.pad.l) / geo.step), 0, geo.n - 1);
};
let dragging = false;
chart.addEventListener("pointerdown", (ev) => {
  if (!geo) return;
  dragging = true;
  chart.setPointerCapture(ev.pointerId);
  select(indexAt(ev.clientX));
});
chart.addEventListener("pointermove", (ev) => {
  if (!geo) return;
  const i = indexAt(ev.clientX);
  if (dragging) select(i);
  else { geo.ghost.setAttribute("x1", geo.x(i)); geo.ghost.setAttribute("x2", geo.x(i)); geo.ghost.style.opacity = 1; }
});
const stopDrag = () => { dragging = false; };
chart.addEventListener("pointerup", stopDrag);
chart.addEventListener("pointercancel", stopDrag);
chart.addEventListener("pointerleave", () => { if (geo) geo.ghost.style.opacity = 0; });

function select(i) {
  if (!state.hours.length) return;
  i = clamp(i, 0, state.hours.length - 1);
  if (i === state.idx) return;
  state.idx = i;
  paintSel();
  renderHero();
  renderInstruments();
  renderDock();
}
document.addEventListener("keydown", (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey || /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
  if (ev.key === "ArrowRight") { select(state.idx + 1); ev.preventDefault(); }
  else if (ev.key === "ArrowLeft") { select(state.idx - 1); ev.preventDefault(); }
  else if (ev.key === "n" || ev.key === "N" || ev.key === "Escape") select(0);
});
$$("#metric button").forEach((b) => b.addEventListener("click", () => {
  state.metric = b.dataset.metric;
  $$("#metric button").forEach((o) => o.setAttribute("aria-selected", o === b));
  renderHours();
}));

function renderDock() {
  const dock = $("#dock"), e = state.hours[state.idx];
  dock.hidden = state.idx === 0;
  if (state.idx === 0) return;
  const hrs = Math.round((e.t - state.hours[0].t) / 3600e3);
  text("dockText", `${F.wd.format(e.t)} ${hour(e.t)} · in ${hrs} h`);
}
$("#dockPrev").addEventListener("click", () => select(state.idx - 1));
$("#dockNext").addEventListener("click", () => select(state.idx + 1));
$("#dockNow").addEventListener("click", () => select(0));

/* ---------- ten days ---------- */
function renderDays() {
  const d = state.data.fc.daily, list = $("#daysList");
  const from = state.today, to = Math.min(d.time.length, from + 10);
  const lo = Math.min(...d.temperature_2m_min.slice(from, to)), hi = Math.max(...d.temperature_2m_max.slice(from, to));
  const pos = (v) => ((v - lo) / (hi - lo || 1)) * 100;
  list.innerHTML = "";
  for (let i = from; i < to; i++) {
    const a = d.temperature_2m_min[i], b = d.temperature_2m_max[i], pop = d.precipitation_probability_max[i] ?? 0;
    const li = document.createElement("li");
    const now = i === from ? `<i class="days__now" style="left:${clamp(pos(state.hours[0].temp), 0, 100)}%"></i>` : "";
    li.innerHTML = `<span class="days__d">${i === from ? "Today" : F.wd.format(parse(d.time[i]))}<small>${F.dm.format(parse(d.time[i]))}</small></span>
      <span class="days__i">${icon(d.weather_code[i], 1)}${pop >= 20 ? `<small>${pop}%</small>` : ""}</span>
      <span class="days__lo">${T(a)}</span>
      <span class="days__bar"><i style="left:${pos(a)}%;right:${100 - pos(b)}%;background:linear-gradient(90deg,${tempColor(a)},${tempColor(b)})"></i>${now}</span>
      <span class="days__hi">${T(b)}</span>`;
    li.title = COND[d.weather_code[i]] || "";
    list.appendChild(li);
  }
}

/* ---------- instruments ---------- */
const compass = $("#compass");
(function buildCompass() {
  el("circle", { cx: 100, cy: 100, r: 86, class: "cp-ring" }, compass);
  for (let a = 0; a < 360; a += 10) {
    const r1 = a % 90 === 0 ? 72 : a % 30 === 0 ? 76 : 80, rad = (a * Math.PI) / 180;
    el("line", { x1: 100 + Math.sin(rad) * r1, y1: 100 - Math.cos(rad) * r1, x2: 100 + Math.sin(rad) * 86, y2: 100 - Math.cos(rad) * 86, class: a % 30 === 0 ? "cp-tick cp-tick--major" : "cp-tick" }, compass);
  }
  [["N", 100, 43], ["E", 160, 104], ["S", 100, 165], ["W", 40, 104]].forEach(([t, x, y]) => el("text", { x, y, class: "cp-letter", "text-anchor": "middle" }, compass, t));
  const g = el("g", { id: "cpArrow", class: "cp-arrow" }, compass);
  el("path", { d: "M100 150V54" }, g);
  el("path", { d: "M100 44l-7 13h14z", class: "cp-head" }, g);
  el("circle", { cx: 100, cy: 152, r: 3.2, class: "cp-tail" }, g);
})();

const fx = { dir: 0, speed: 0, parts: [], ctx: $("#windFx").getContext("2d") };
(function windField() {
  const c = $("#windFx"), S = 320, R = 150;
  for (let i = 0; i < 70; i++) fx.parts.push({ x: Math.random() * S, y: Math.random() * S, life: Math.random() });
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let vis = false, last = performance.now();
  new IntersectionObserver((es) => { vis = es[0].isIntersecting; }).observe(c);
  function step(now) {
    requestAnimationFrame(step);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!vis || still) return;
    const ctx = fx.ctx, a = ((fx.dir + 180) * Math.PI) / 180;
    const vx = Math.sin(a), vy = -Math.cos(a), v = 14 + fx.speed * 5.5;
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,.09)";
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(36,86,255,.5)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const p of fx.parts) {
      const nx = p.x + vx * v * dt, ny = p.y + vy * v * dt;
      if (Math.hypot(p.x - 160, p.y - 160) < R && Math.hypot(nx - 160, ny - 160) < R) { ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); }
      p.x = nx; p.y = ny; p.life -= dt * 0.25;
      if (p.life < 0 || nx < -10 || nx > S + 10 || ny < -10 || ny > S + 10) {
        const side = Math.random() * S - S / 2;
        p.x = 160 - vx * 170 + -vy * side; p.y = 160 - vy * 170 + vx * side; p.life = 0.6 + Math.random();
      }
    }
    ctx.stroke();
  }
  requestAnimationFrame(step);
})();

function moonIcon(svg, phase) {
  svg.innerHTML = "";
  el("circle", { cx: 20, cy: 20, r: 16, class: "mn-dark" }, svg);
  const k = Math.cos(2 * Math.PI * phase), rx = Math.max(0.01, 16 * Math.abs(k));
  const d = `M20 4A16 16 0 0 1 20 36A${rx} 16 0 0 ${k > 0 ? 0 : 1} 20 4Z`;
  el("path", { d, class: "mn-lit", transform: phase > 0.5 ? "translate(40 0) scale(-1 1)" : "" }, svg);
  el("circle", { cx: 20, cy: 20, r: 16, class: "mn-rim" }, svg);
}

function plotSea(e) {
  const svg = $("#seaChart"), hrs = state.hours, W = svg.clientWidth || 300, H = 132;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";
  const v = hrs.map((h) => h.tide);
  if (v.some((t) => t == null)) { el("text", { x: 0, y: 60, class: "c-empty" }, svg, "Sea level data unavailable"); return null; }
  const lo = Math.min(...v, -0.5), hi = Math.max(...v, 0.5), top = 30, bot = H - 22;
  const x = (i) => 2 + (i / (hrs.length - 1)) * (W - 4), y = (t) => bot - ((t - lo) / (hi - lo)) * (bot - top);
  const pts = v.map((t, i) => [x(i), y(t)]);
  const d = curve(pts);
  el("path", { d: `${d}L${x(hrs.length - 1)} ${H}L${x(0)} ${H}Z`, class: "p-water" }, svg);
  el("line", { x1: 0, x2: W, y1: y(0), y2: y(0), class: "c-thresh" }, svg);
  el("text", { x: W, y: 8, class: "c-day", "text-anchor": "end" }, svg, "METRES · DASHED LINE IS MEAN SEA LEVEL");
  el("path", { d, class: "p-line" }, svg);
  const turns = [];
  for (let i = 1; i < v.length - 1; i++) {
    const high = v[i] > v[i - 1] && v[i] >= v[i + 1], low = v[i] < v[i - 1] && v[i] <= v[i + 1];
    if (high || low) {
      turns.push({ i, high, t: hrs[i].t, m: v[i] });
      if (x(i) > 20 && x(i) < W - 20) el("text", { x: x(i), y: y(v[i]) + (high ? -6 : 14), class: "c-val", "text-anchor": "middle" }, svg, `${v[i] > 0 ? "+" : "−"}${Math.abs(v[i]).toFixed(1)}`);
    }
  }
  el("line", { x1: x(state.idx), x2: x(state.idx), y1: 4, y2: H, class: "p-now" }, svg);
  el("circle", { cx: x(state.idx), cy: y(v[state.idx]), r: 4, class: "p-dot" }, svg);
  return turns;
}

function plotSun(e) {
  const svg = $("#sunChart"), W = svg.clientWidth || 300, H = 132, horizon = 92;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";
  const day0 = parse(e.iso.slice(0, 10) + "T00:00");
  const samples = [];
  for (let m = 0; m <= 1440; m += 15) samples.push([m, sunPosition(day0 + m * 6e4, LAT, LNG).altitude]);
  const peak = samples.reduce((a, b) => (b[1] > a[1] ? b : a));
  const x = (m) => (m / 1440) * W, y = (alt) => (alt >= 0 ? horizon - (alt / 90) * 86 : horizon + (Math.min(-alt, 40) / 40) * 20);
  const pts = samples.map(([m, a]) => [x(m), y(a)]);
  const clip = el("clipPath", { id: "aboveHorizon" }, el("defs", {}, svg));
  el("rect", { x: 0, y: 0, width: W, height: horizon }, clip);
  el("path", { d: `${curve(pts)}L${W} ${horizon}L0 ${horizon}Z`, class: "p-daylight", "clip-path": "url(#aboveHorizon)" }, svg);
  el("path", { d: curve(pts), class: "p-below" }, svg);
  el("path", { d: curve(pts), class: "p-line", "clip-path": "url(#aboveHorizon)" }, svg);
  el("line", { x1: 0, x2: W, y1: horizon, y2: horizon, class: "c-base" }, svg);
  [[0, "12 AM", "start"], [720, "NOON", "middle"], [1440, "12 AM", "end"]].forEach(([m, t, a]) => el("text", { x: x(m), y: H - 6, class: "c-day", "text-anchor": a }, svg, t));
  const mNow = (e.t - day0) / 6e4, alt = sunPosition(e.t, LAT, LNG).altitude;
  el("circle", { cx: x(mNow), cy: y(alt), r: 6, class: alt > 0 ? "p-sun" : "p-sun p-sun--down" }, svg);
  return { peak: { t: day0 + peak[0] * 6e4, alt: peak[1] }, alt };
}

function plotRain() {
  const d = state.data.fc.daily, svg = $("#rainChart"), W = svg.clientWidth || 300, H = 104;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";
  const from = state.today, to = Math.min(d.time.length, from + 10), n = to - from;
  const mm = d.precipitation_sum.slice(from, to), top = Math.max(...mm, 5), step = W / n, bw = Math.min(26, step * 0.56);
  el("line", { x1: 0, x2: W, y1: H - 24, y2: H - 24, class: "c-base" }, svg);
  mm.forEach((v, k) => {
    const cx = step * (k + 0.5), h = Math.max(1.5, (v / top) * (H - 46));
    el("rect", { x: cx - bw / 2, y: H - 24 - h, width: bw, height: h, rx: 3, class: v > 0 ? "c-bar is-wet" : "c-bar" }, svg);
    if (v >= 0.1) el("text", { x: cx, y: H - 30 - h, class: "c-val", "text-anchor": "middle" }, svg, v.toFixed(v < 10 ? 1 : 0));
    el("text", { x: cx, y: H - 8, class: "c-day", "text-anchor": "middle" }, svg, k === 0 ? "TODAY" : F.wd.format(parse(d.time[from + k])).toUpperCase());
  });
  const first = mm.findIndex((v) => v >= 0.2);
  const last = parse(d.time[to - 1]);
  text("rainTxt", first < 0 ? `Dry through ${F.wd.format(last)} ${F.dm.format(last)}. No model day shows measurable rain.`
    : `${first === 0 ? "Rain today" : `Next rain ${F.wdLong.format(parse(d.time[from + first]))}`}: about ${mm[first].toFixed(1)} mm, ${d.precipitation_probability_max[from + first] ?? 0}% chance.`);
}

function renderInstruments() {
  const e = state.hours[state.idx];
  if (!e) return;
  const d = state.data.fc.daily, H = state.data.fc.hourly, di = dayOf(e);

  // wind
  text("windSpd", num(e.wind));
  text("windTxt", `${band(BEAUFORT, e.wind)} from the ${bearing(e.wdir)}`);
  text("windGust", `${num(e.gust)} km/h`);
  text("windDir", `${Math.round(e.wdir)}°`);
  $("#cpArrow").style.transform = `rotate(${e.wdir + 180}deg)`;
  fx.dir = e.wdir; fx.speed = e.wind;
  const on = e.wdir >= 170 && e.wdir <= 285, off = e.wdir >= 325 || e.wdir <= 95;
  text("windNote", e.wind < 4 ? "Barely moving. Smoke and haze will sit where they are." : on ? "Onshore: coming in off the Arabian Sea, which is what keeps Karachi bearable." : off ? "Offshore: dry air from inland, pushing out to sea." : "");

  // uv
  text("uvNum", num(e.uv, e.uv < 10 ? 1 : 0));
  text("uvLvl", band(UVL, e.uv));
  $("#uvMark").style.left = `${clamp(e.uv / 12) * 100}%`;
  const sameDay = [];
  for (let i = 0; i < H.time.length; i++) if (H.time[i].slice(0, 10) === e.iso.slice(0, 10) && H.uv_index[i] >= 3) sameDay.push(parse(H.time[i]));
  text("uvTxt", sameDay.length ? `Cover up between ${hour(sameDay[0])} and ${hour(sameDay[sameDay.length - 1] + 3600e3)}. Peak ${num(d.uv_index_max[di], 1)}.` : "No sun protection needed today.");

  // air
  if (e.aqi != null) {
    const b = aqiBand(e.aqi);
    text("aqiNum", num(e.aqi));
    text("aqiLvl", b[1]);
    $("#aqiNum").style.color = b[2];
    $("#aqiMark").style.left = `${clamp(e.aqi / 300) * 100}%`;
    text("pm25", `${num(e.pm25)} µg/m³`); text("pm10", `${num(e.pm10)} µg/m³`); text("no2", `${num(e.no2)} µg/m³`); text("o3", `${num(e.o3)} µg/m³`);
    const who = e.pm25 / 15;
    const day = state.hours.slice(0, 25).filter((h) => h.aqi != null);
    const worst = day.reduce((a, c) => (c.aqi > a.aqi ? c : a), day[0]);
    text("aqiTxt", `Fine particles are ${who >= 1.15 ? `${who.toFixed(1)}× ` : "within "}the WHO daily guideline. Worst in the next day: ${Math.round(worst.aqi)} around ${hour(worst.t)}.`);
    spark($("#aqiSpark"), state.hours.slice(0, 25).map((h) => h.aqi), { w: 160, h: 44, mark: state.idx < 25 ? state.idx : -1 });
  } else { text("aqiNum", "–"); text("aqiLvl", "Air data unavailable"); }

  // humidity
  text("humNum", num(e.rh));
  text("dew", T(e.dew)); text("wetbulb", T(wetBulb(e.temp, e.rh))); text("feels2", T(e.feels));
  $("#dewMark").style.left = `${clamp((e.dew - 2) / 26) * 100}%`;
  const comfort = band(DEW, e.dew);
  text("feelTxt", `${comfort}. ${e.feels - e.temp >= 2 ? `Humidity adds ${Math.round(dC(e.feels - e.temp))}° to how it feels.` : e.temp - e.feels >= 2 ? `Feels ${Math.round(dC(e.temp - e.feels))}° cooler than the thermometer.` : "Feels about like the thermometer says."}`);

  // sea
  const turns = plotSea(e);
  text("wave", e.wave != null ? `${num(e.wave, 1)} m` : "–");
  text("wper", e.wper != null ? `${num(e.wper)} s` : "–");
  text("wfrom", e.wfrom != null ? bearing(e.wfrom) : "–");
  text("sst", T(e.sst));
  if (turns) {
    const next = turns.filter((t) => t.i > state.idx).slice(0, 2);
    const say = (t) => `${t.high ? "high" : "low"} water ${hm(t.t)} (${t.m > 0 ? "+" : "−"}${Math.abs(t.m).toFixed(1)} m)`;
    const rising = state.idx < state.hours.length - 1 && state.hours[state.idx + 1].tide > e.tide;
    text("seaTxt", next.length ? `Tide ${rising ? "coming in" : "going out"}. Next ${next.map(say).join(", then ")}.` : `Tide ${rising ? "coming in" : "going out"}.`);
  } else text("seaTxt", "Marine data unavailable.");

  // sun & moon
  const sun = plotSun(e);
  if (di >= 0) {
    const rise = parse(d.sunrise[di]), set = parse(d.sunset[di]), len = (set - rise) / 6e4;
    text("sunrise", hm(rise)); text("sunset", hm(set));
    text("daylen", `${Math.floor(len / 60)} h ${Math.round(len % 60)} m`);
    text("noon", `${Math.round(sun.peak.alt)}° at ${hm(sun.peak.t)}`);
  }
  const ph = moonPhase(e.t);
  moonIcon($("#moonIcon"), ph.phase);
  text("moonTxt", `${ph.name}, ${Math.round(ph.fraction * 100)}% lit`);

  // pressure
  text("presNum", num(e.pres));
  const prior = H.pressure_msl[(e.i ?? state.start) - 3];
  const dp = prior != null ? e.pres - prior : 0;
  text("presTxt", `${Math.abs(dp) < 0.8 ? "Steady" : dp > 0 ? "Rising" : "Falling"}${Math.abs(dp) >= 0.8 ? `, ${dp > 0 ? "+" : "−"}${Math.abs(dp).toFixed(1)} hPa in three hours` : " over the last three hours"}.`);
  spark($("#presSpark"), state.hours.map((h) => h.pres), { w: 300, h: 48, mark: state.idx });

  // visibility
  const km = e.vis / 1000;
  text("visNum", km >= 10 ? num(km) : num(km, 1));
  text("visTxt", km < 2 ? "Poor. Fog or thick haze." : km < 6 ? "Hazy. The far shore is gone." : km < 12 ? "Fair, with some haze." : km < 20 ? "Good." : "Very clear.");
  text("cloud", `${num(e.cloud)}%`);
  $("#cloudBar").style.width = `${e.cloud}%`;

  if (city) city.set(cityState(e));
}

/* ---------- models ---------- */
function score() {
  const p = state.data.prev;
  if (!p) return null;
  const h = p.hourly, truth = h.temperature_2m_best_match, now = Date.now();
  const upto = h.time.findIndex((t) => parse(t) > now), end = upto < 0 ? h.time.length : upto;
  const out = {};
  for (const lead of [1, 2, 3]) {
    out[lead] = MODELS.map((m) => {
      const f = h[`temperature_2m_previous_day${lead}_${m.id}`] || [];
      let n = 0, abs = 0, sum = 0;
      for (let i = 0; i < end; i++) if (f[i] != null && truth[i] != null) { n++; abs += Math.abs(f[i] - truth[i]); sum += f[i] - truth[i]; }
      return { ...m, n, mae: n ? abs / n : null, bias: n ? sum / n : null };
    }).filter((r) => r.n > 24).sort((a, b) => a.mae - b.mae);
  }
  out.window = [parse(h.time[0]), parse(h.time[Math.max(0, end - 1)])];
  return out;
}

function renderModels() {
  const s = score(), bars = $("#bars");
  if (!s) { bars.innerHTML = `<p class="board__empty">The model archive didn't answer. Try again in a few minutes.</p>`; return; }
  const rows = s[state.lead], top = Math.max(...rows.map((r) => r.mae));
  bars.innerHTML = "";
  rows.forEach((r, k) => {
    const b = document.createElement("div");
    b.className = "bar" + (k === 0 ? " is-best" : "");
    b.setAttribute("role", "listitem");
    b.dataset.model = r.id;
    const warm = r.bias > 0;
    b.innerHTML = `<span class="bar__rank">${String(k + 1).padStart(2, "0")}</span>
      <span class="bar__val">${dC(r.mae).toFixed(2)}°</span>
      <span class="bar__col"><i style="height:${(r.mae / top) * 100}%;--w:${(r.mae / top) * 100}%"></i></span>
      <span class="bar__name">${r.name}</span>
      <span class="bar__org">${r.org} · ${r.grid}</span>
      <span class="bar__bias ${Math.abs(r.bias) < 0.3 ? "" : warm ? "is-warm" : "is-cool"}">${Math.abs(r.bias) < 0.3 ? "No lean" : `${dC(Math.abs(r.bias)).toFixed(1)}° ${warm ? "warm" : "cool"}`}</span>`;
    b.addEventListener("pointerenter", () => focusModel(r.id));
    b.addEventListener("pointerleave", () => focusModel(null));
    bars.appendChild(b);
  });
  const lead = ["", "one day", "two days", "three days"][state.lead];
  text("boardTitle", `Mean error in air temperature, forecast ${lead} ahead`);
  text("boardCredit", `${F.dm.format(s.window[0])} – ${F.dm.format(s.window[1])} · ${rows[0].n} hours per model · °${state.unit}`);

  const total = rows.reduce((a, r) => a + r.n, 0);
  const best = rows[0], worst = rows[rows.length - 1];
  $("#chips").innerHTML = [
    [rows.length, "global models"], [total.toLocaleString("en-US"), "hourly forecasts scored"],
    [`${dC(best.mae).toFixed(1)}°`, `typical miss, ${best.name}`], [`${dC(worst.mae).toFixed(1)}°`, `typical miss, ${worst.name}`],
  ].map(([n, l]) => `<div class="chip"><b>${n}</b><span>${l}</span></div>`).join("");
  renderSpread();
}

function renderSpread() {
  const m = state.data.models, svg = $("#spreadChart");
  svg.innerHTML = "";
  if (!m) return;
  const W = svg.clientWidth || 800, H = W < 560 ? 240 : 320, pad = { l: 38, r: 12, t: 16, b: 30 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const time = m.hourly.time, n = time.length;
  const series = MODELS.map((mm) => ({ id: mm.id, name: mm.name, v: (m.hourly[`temperature_2m_${mm.id}`] || []).map((c) => (c == null ? null : tC(c))) })).filter((s) => s.v.some((c) => c != null));
  const all = series.flatMap((s) => s.v.filter((c) => c != null));
  const lo = Math.floor(Math.min(...all) - 1), hi = Math.ceil(Math.max(...all) + 1);
  const x = (i) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r), y = (c) => H - pad.b - ((c - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const gap = hi - lo > 14 ? 5 : hi - lo > 7 ? 3 : 2;
  for (let c = Math.ceil(lo / gap) * gap; c <= hi; c += gap) {
    el("line", { x1: pad.l, x2: W - pad.r, y1: y(c), y2: y(c), class: "c-grid" }, svg);
    el("text", { x: pad.l - 8, y: y(c) + 3.5, class: "c-day", "text-anchor": "end" }, svg, `${c}°`);
  }
  time.forEach((t, i) => {
    if (t.slice(11, 13) !== "00") return;
    if (i > 0) el("line", { x1: x(i), x2: x(i), y1: pad.t, y2: H - pad.b, class: "c-midnight" }, svg);
    const day = i / 24;
    if (x(i) < W - 40 && (W >= 560 || day % 2 === 0)) el("text", { x: x(i) + 5, y: H - 10, class: "c-day" }, svg, (W >= 700 ? `${F.wd.format(parse(t))} ${F.dm.format(parse(t))}` : F.wd.format(parse(t))).toUpperCase());
  });
  const top = [], bot = [], mid = [];
  let widest = { d: 0, i: 0 };
  for (let i = 0; i < n; i++) {
    const col = series.map((s) => s.v[i]).filter((c) => c != null).sort((a, b) => a - b);
    if (col.length < 3) continue;
    top.push([x(i), y(col[col.length - 1])]); bot.push([x(i), y(col[0])]);
    mid.push([x(i), y(col.length % 2 ? col[(col.length - 1) / 2] : (col[col.length / 2 - 1] + col[col.length / 2]) / 2)]);
    if (col[col.length - 1] - col[0] > widest.d) widest = { d: col[col.length - 1] - col[0], i, hiY: y(col[col.length - 1]), loY: y(col[0]) };
  }
  el("path", { d: `${curve(top)}L${bot.slice().reverse().map((p) => p.join(" ")).join("L")}Z`, class: "s-band" }, svg);
  series.forEach((s) => {
    const runs = [[]];
    s.v.forEach((c, i) => { if (c == null) { if (runs[runs.length - 1].length) runs.push([]); } else runs[runs.length - 1].push([x(i), y(c)]); });
    const g = el("g", { class: "s-model", "data-model": s.id }, svg);
    runs.filter((r) => r.length > 1).forEach((r) => el("path", { d: curve(r) }, g));
    const lastRun = runs.filter((r) => r.length > 1).pop();
    if (lastRun) el("text", { x: lastRun[lastRun.length - 1][0] - 4, y: lastRun[lastRun.length - 1][1] - 6, "text-anchor": "end", class: "s-name" }, g, s.name);
  });
  el("path", { d: curve(mid), class: "s-median" }, svg);
  if (widest.d > 0) {
    const wx = x(widest.i);
    el("line", { x1: wx, x2: wx, y1: widest.hiY, y2: widest.loY, class: "s-gap" }, svg);
    const label = `${widest.d.toFixed(1)}° APART`;
    el("text", { x: clamp(wx + 6, 0, W - 80), y: widest.hiY - 7, class: "s-gaptx" }, svg, label);
    const t = parse(time[widest.i]);
    text("spreadKey", `Black line: the median. Widest disagreement ${F.wd.format(t)} ${hour(t)}.`);
  }
}
function focusModel(id) {
  $("#spreadChart").classList.toggle("has-focus", !!id);
  $$("#spreadChart .s-model").forEach((g) => g.classList.toggle("is-on", g.dataset.model === id));
}
$$("#lead button").forEach((b) => b.addEventListener("click", () => {
  state.lead = +b.dataset.lead;
  $$("#lead button").forEach((o) => o.setAttribute("aria-selected", o === b));
  renderModels();
}));

/* ---------- the city in 3D (loaded when you get near it) ---------- */
let city = null;
const cityState = (e) => ({
  time: state.idx === 0 ? Date.now() : e.t, live: state.idx === 0, cloud: (e.cloud ?? 0) / 100, haze: hazeOf(e), vis: (e.vis ?? 20000) / 1000,
  wind: e.wind ?? 0, wdir: e.wdir ?? 0, rain: e.rain ?? 0, tide: e.tide ?? 0, wave: e.wave ?? 0, temp: e.temp, code: e.code,
});
const cityStage = $("#cityStage");
if (cityStage) {
  const io = new IntersectionObserver((es) => {
    if (!es[0].isIntersecting) return;
    io.disconnect();
    import("./city.js?v=1").then((mod) => {
      city = mod.createCity(cityStage);
      if (state.hours.length) city.set(cityState(state.hours[state.idx]));
    }).catch((err) => {
      console.warn("3D city unavailable", err);
      cityStage.classList.add("is-fallback");
    });
  }, { rootMargin: "600px" });
  io.observe(cityStage);
}

/* ---------- units, lifecycle ---------- */
function paintUnit() { $$("#unit button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.unit === state.unit)); }
$$("#unit button").forEach((b) => b.addEventListener("click", () => {
  state.unit = b.dataset.unit;
  try { localStorage.setItem("mausam:unit", state.unit); } catch (e) {}
  paintUnit();
  if (state.data) renderAll();
}));
paintUnit();

function renderAll() {
  $("#retry").hidden = true;
  document.body.classList.add("has-data");
  renderHero();
  renderHours();
  renderDays();
  renderInstruments();
  plotRain();
  renderModels();
  renderDock();
}

let rz;
window.addEventListener("resize", () => {
  clearTimeout(rz);
  rz = setTimeout(() => { if (state.data) { renderHours(); renderInstruments(); plotRain(); renderSpread(); } }, 150);
});
$("#retry").addEventListener("click", load);
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - state.fetchedAt > 10 * 60e3) load(); });
setInterval(() => { if (!document.hidden) load(); }, 10 * 60e3);

try {
  const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
  if (cached && cached.data && cached.data.fc && Date.now() - cached.at < 3 * 3600e3) {
    state.data = cached.data;
    state.fetchedAt = cached.at;
    state.slowAt = cached.slowAt || 0;
    build();
    renderAll();
  }
} catch (e) {}
load();
