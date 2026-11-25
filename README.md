# Mausam — Karachi weather

A live weather page for Karachi. Plain HTML, CSS and JavaScript modules; no build step.

```
python3 -m http.server 8000
```

## What's on the page

- **Sky** (`js/sky.js`): a WebGL shader looking south from Clifton over the Arabian Sea. The sun and moon are placed from real ephemeris maths (`js/astro.js`); cloud cover and haze come from the forecast and air-quality data.
- **Next 48 hours**: drag the chart, or use ← → and N. The sky, readings, instruments and the 3D city all move to the hour you pick.
- **The city** (`js/city.js`, three.js): all of Karachi at true scale, 66.82–67.42°E × 24.74–25.12°N. 2.27 million buildings from Google Open Buildings, each at its measured 2023 height, on Sentinel-2 imagery and Copernicus terrain. Sun and moon from their real positions; cloud (with moving cloud shadows), haze, rain, wind and tide from the same forecast hour. At night, windows and street lamps light up. Drag to orbit, right-drag or Shift-drag to pan, click then scroll (or Ctrl/⌘-scroll, or pinch) to zoom; thirteen fly-to places.
- **Instruments**: ten-day outlook, wind, UV, air quality, humidity, sea and tide, sun and moon, rain, pressure, visibility.
- **Leaderboard**: eight global forecast models scored on how close their Karachi temperature forecasts came over the past week.

## Data

| What | Source | Licence |
| --- | --- | --- |
| Forecast, air quality, marine, model archive | [Open-Meteo](https://open-meteo.com/) | CC BY 4.0 |
| Building footprints | [Google Open Buildings v3](https://sites.research.google/gr/open-buildings/) | CC BY 4.0 / ODbL |
| Building heights (2023) | Google Open Buildings 2.5D Temporal | CC BY 4.0 |
| Satellite imagery | Sentinel-2 cloudless 2023 by EOX IT Services GmbH (modified Copernicus Sentinel data 2023) | CC BY-NC-SA 4.0 |
| Terrain | Copernicus GLO-30 DEM | Copernicus licence |
| 3D engine | three.js r160 (`js/vendor/`) | MIT |

### How the city data is built

Everything under `data/city/` is generated from open data:

- `b/a_*.bin.gz`, `b/b_*.bin.gz`: buildings in 4 km chunks. Tier `a` holds the larger or taller buildings and loads for the whole city; tier `b` holds the rest and streams in around wherever you are looking. Each file is gzip, then `u32 count | u16 x·16 | u16 north·16 | u8 length·2 | u8 width·2 | u8 angle·256/π | u8 height` (metres from the chunk corner; height in half-metres up to 120 m, then 10 m steps). Buildings in each chunk are sorted by prominence so a prefix is a usable far-away level of detail.
- Footprints come from Open Buildings v3 (S2 cells `3eb3` and `394d`), reduced to their minimum rotated rectangle; footprints under 20 m² are dropped. Heights are sampled from the Open Buildings 2.5D Temporal 2023 rasters at 2 m. Buildings without a height get 3.5 m. Bahria Icon Tower is set to its published 273 m.
- `sat-*.jpg`: Sentinel-2 cloudless 2023 mosaic, reprojected to the local grid at 10 m (overview at 40 m).
- `terrain.bin`: Copernicus GLO-30 surface model with buildings opened out, at 100 m; `water.png` is where it reads sea level.
- `density.png`: built-up share at 50 m, used for night lighting.


The leaderboard scores each model against Open-Meteo's best-match analysis for the grid point, not against a weather station.

## Deploying

Any static host works. On GitHub Pages, serve the branch root. The city needs WebGL 2 and `DecompressionStream` (Chrome 80+, Safari 16.4+, Firefox 113+); without them the rest of the page still works.

Because the satellite imagery is CC BY-NC-SA, keep the site non-commercial or swap the imagery.
