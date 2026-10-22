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
- **⬠ Exclusion area**: click to add corners (a live preview follows the pointer); double-click, Enter or a
  click on the first corner finishes. Backspace removes the last corner, Esc cancels. Outlines whose edges cross
  are refused. The mode stays on so you can draw the next area straight away. Areas never add or remove crosses.
- **Editing an area**: in Navigate, click an area to select it, then drag its corner handles. An edit is applied
  when you release, only if the outline stays valid; Esc while dragging reverts. Delete removes the selected area.
- **⌫ Eraser**: click a cross or an area to remove it; the target is highlighted before you click. A cross wins
  over the area beneath it, and clicks just beside a cross remove nothing. Empty space and drags do nothing.
- **Right-click** a cross or area to remove it in any mode.
- **Esc** cancels a drawing or selection first, then returns to Navigate.
- **Ctrl+Z** undo, **Ctrl+Shift+Z** (or Ctrl+Y) redo. Undo history covers the current session only.
- Marks save automatically and survive a refresh. They live in this browser only:
  clearing site data deletes them, so export regularly.
- **⤓ Export** downloads every mark and area as `mapmarks-YYYY-MM-DD.geojson`: a standard GeoJSON
  FeatureCollection of Points (`"type": "red-x"`) and closed Polygons (`"type": "exclusion-area"`), each with its
  id and `createdAt`, plus `"mapmarks": { "version": 2 }`. Version 1 backups (crosses only) still import.
- **⤒ Import** merges a MapMarks export into the current marks. The whole file is validated first and saved
  in one transaction; marks already present are skipped, and a mark whose id exists with different data is
  reported as a conflict and the existing mark is kept. Nothing is ever cleared. Ctrl+Z undoes the whole import.

## Scripts

```sh
npm test            # unit tests (marks, areas, undo/redo, IndexedDB, import/export, map styles, hit testing)
npm run typecheck
npm run generate    # static build in .output/public
```
