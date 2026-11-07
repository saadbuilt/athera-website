# ATHERA — website

Single-page site for **ATHERA: Passive Radiative Cooling for a Sustainable Built Environment**.

Plain HTML/CSS/JS, no build step. Open `index.html` or serve the folder:

```
python3 -m http.server 8000
```

- `index.html` — content and inline SVG diagrams
- `styles.css` — layout and typography (Newsreader, IBM Plex Sans/Mono)
- `script.js` — layer selector, live spectrum chart (Planck curves), feedback-loop toggle, retrofit calculator, scroll reveals
- `assets/img/` — imagery from the proposal deck

Deploys as-is to GitHub Pages, Netlify or Vercel.
