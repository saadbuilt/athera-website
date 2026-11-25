# Mausam — Karachi weather

A live weather page for Karachi. Plain HTML, CSS and JavaScript modules; no build step.

```
python3 -m http.server 8000
```

## What's on the page

- **Sky** (`js/sky.js`): a WebGL shader looking south from Clifton over the Arabian Sea. The sun and moon are placed from real ephemeris maths (`js/astro.js`); cloud cover and haze come from the forecast and air-quality data.
- **Next 48 hours**: drag the chart, or use ← → and N. The sky, readings, instruments and the 3D city all move to the hour you pick.
- **The city** (`js/city.js`, three.js): Karachi built from Google Open Buildings, lit by the sun from its real position, with clouds, haze, wind, rain and tide from the same hour.
- **Instruments**: ten-day outlook, wind, UV, air quality, humidity, sea and tide, sun and moon, rain, pressure, visibility.
- **Leaderboard**: eight global forecast models scored on how close their Karachi temperature forecasts came over the past week.

## Data

| What | Source | Licence |
| --- | --- | --- |
| Forecast, air quality, marine, model archive | [Open-Meteo](https://open-meteo.com/) | CC BY 4.0 |
| Building footprints | [Google Open Buildings v3](https://sites.research.google/gr/open-buildings/) | CC BY 4.0 / ODbL |
| Building heights (2023) | Google Open Buildings 2.5D Temporal | CC BY 4.0 |
| 3D engine | three.js r160 (`js/vendor/`) | MIT |

`data/karachi-buildings.bin` is derived from 1,571,619 Open Buildings footprints between 24.755–24.96°N and 66.90–67.20°E, grouped into a 303 × 227 grid of 100 m squares. It holds three byte grids, row 0 at the south edge: share of the square that is built (0–255), mean building height in half-metres, and a land mask. The land mask is inferred from where buildings are, so it is approximate at the water's edge.

The leaderboard scores each model against Open-Meteo's best-match analysis for the grid point, not against a weather station.

## Deploying

Any static host works. On GitHub Pages, serve the branch root.
