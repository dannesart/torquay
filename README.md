# MapMarks

Quick visual annotations on an interactive map. Client-only Nuxt 4 + MapLibre GL JS app;
marks are stored in the browser's IndexedDB.

## Setup

Requires Node 20+.

```sh
npm install
cp .env.example .env   # optional: add a MapTiler key for satellite imagery
npm run dev            # http://localhost:3000
```

### Satellite imagery

The Satellite and Hybrid styles are MapTiler's official `satellite-v4` and `hybrid-v4` maps
([MapTiler Cloud](https://www.maptiler.com/cloud/)). Create a free account, copy your API key into
`NUXT_PUBLIC_MAPTILER_KEY`, and in the MapTiler dashboard restrict the key to your origins
(e.g. `http://localhost:3000`). The key is a public browser key, so it is visible in the client; the origin restriction is what protects it.
The free plan covers personal/non-commercial use with a monthly quota, and requires the MapTiler logo and attribution,
which the app shows.

With a key the app starts in Hybrid; without one only Street
([OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/)) is available. If MapTiler fails
(bad key, quota, offline), a notice explains why and offers to switch to Street.

Imagery detail in Torquay stops increasing at about zoom 16 (~0.75 m/pixel); that is MapTiler's source
resolution here, not an app setting. You can zoom closer for precise marking, but the app labels that view
"Beyond imagery resolution" because the imagery is only enlarged. On high-DPI screens the app fetches imagery
one zoom level deeper, which sharpens zoomed-out views (at the cost of more tile requests).

## Usage

- **✋ Navigate**: pan/zoom as normal.
- **✕ Red X**: every click places a red cross. Dragging still pans; the mode stays on until you switch.
- **Street / Satellite / Hybrid**: switch the map style. The view and all marks stay put; the choice is remembered.
- **⌫ Eraser**: click a cross to remove it. Empty space and drags do nothing; the mode stays on until you switch.
- **Right-click** a cross to remove it in any mode.
- **Esc** returns to Navigate.
- **Ctrl+Z** undo, **Ctrl+Shift+Z** (or Ctrl+Y) redo. Undo history covers the current session only.
- Marks save automatically and survive a refresh. They live in this browser only:
  clearing site data deletes them.

## Scripts

```sh
npm test            # unit tests (marks, undo/redo, IndexedDB, map styles, hit testing)
npm run typecheck
npm run generate    # static build in .output/public
```
