// Sun and moon geometry. Formulas follow the low-precision series used by SunCalc
// (Vladimir Agafonkin, BSD-2) which in turn follow Meeus, "Astronomical Algorithms".
// Good to roughly a tenth of a degree for the sun — plenty for drawing a sky.

const RAD = Math.PI / 180;
const DAY_MS = 864e5;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

const toDays = (ms) => ms / DAY_MS - 0.5 + J1970 - J2000;

const rightAscension = (l, b) =>
  Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l, b) =>
  Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
const azimuth = (H, phi, dec) =>
  Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
const altitude = (H, phi, dec) =>
  Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
const siderealTime = (d, lw) => RAD * (280.16 + 360.9856235 * d) - lw;

function sunCoords(d) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

function moonCoords(d) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

// Azimuth is returned in degrees clockwise from north; altitude in degrees above the horizon.
function horizontal(coords, ms, lat, lng) {
  const lw = RAD * -lng;
  const phi = RAD * lat;
  const H = siderealTime(toDays(ms), lw) - coords.ra;
  return {
    azimuth: ((azimuth(H, phi, coords.dec) / RAD + 180) % 360 + 360) % 360,
    altitude: altitude(H, phi, coords.dec) / RAD,
  };
}

export const sunPosition = (ms, lat, lng) => horizontal(sunCoords(toDays(ms)), ms, lat, lng);
export const moonPosition = (ms, lat, lng) => horizontal(moonCoords(toDays(ms)), ms, lat, lng);

const PHASES = [
  "New moon", "Waxing crescent", "First quarter", "Waxing gibbous",
  "Full moon", "Waning gibbous", "Last quarter", "Waning crescent",
];

// phase: 0 new → 0.5 full → 1 new again. fraction: lit share of the disc.
export function moonPhase(ms) {
  const d = toDays(ms);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const SUN_DIST = 149598000;
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra)
  );
  const inc = Math.atan2(SUN_DIST * Math.sin(phi), m.dist - SUN_DIST * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra)
  );
  const phase = 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI;
  const fraction = (1 + Math.cos(inc)) / 2;
  // Quarter and full/new names only within a narrow band, otherwise the in-between name.
  const eighth = phase * 8;
  const near = Math.round(eighth);
  const idx = Math.abs(eighth - near) < 0.22 && near % 2 === 0 ? near % 8 : (Math.floor(eighth / 2) * 2 + 1) % 8;
  return { phase, fraction, name: PHASES[idx] };
}

// Wet-bulb temperature from air temperature (°C) and relative humidity (%). Stull (2011).
export function wetBulb(t, rh) {
  return (
    t * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(t + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035
  );
}
