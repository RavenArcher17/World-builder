# 🗺️ World Builder

A browser-based procedural map generator for tabletop and video games. Generate worlds, kingdoms,
counties, town layouts and dungeons, then drill into any area for more detail, stitch maps
together, and export them as game assets — on square, hex or isometric grids.


## Quick start

```bash
npm install
npm run dev        # open http://localhost:5173
npm test           # generator test suite
npm run build      # static site in dist/ (works from any folder or static host)
```

## Hosting on Firebase

`firebase.json` serves the built `dist/` folder. `.github/workflows/firebase-hosting.yml` builds
and deploys automatically: pushes to `main` go live, pull requests get a preview link.

One-time setup:

1. Put your Firebase project ID in `.firebaserc` (`"default": "<project-id>"`).
2. Create a service account key that can deploy, and save it as the repository secret
   `FIREBASE_SERVICE_ACCOUNT` (GitHub → Settings → Secrets and variables → Actions).

Manual deploy from your own machine instead: `npm install -g firebase-tools`, `firebase login`,
`npm run build`, `firebase deploy --only hosting`.

## What it does

| Step | How |
| --- | --- |
| **Generate** | Pick a **scale** (World, Continent, Kingdom, County, Local area, City / Town / Village layout, Dungeon, Cave), a **grid** (square, pointy hex, flat hex, isometric), size and seed. Toggle what goes on the map — terrain types, rivers, lakes, roads, capitals, cities, towns, villages, hamlets, farms, castles, dungeons, ruins, caves, towers, temples, shrines, mines, lairs, camps, landmarks, inns — and tune sea coverage, mountains, moisture, temperature and density sliders. |
| **Re-roll an area** | Drag a box with the Select tool → **Re-roll area**. Only that area is regenerated; the edges are blended, and rivers, roads, streets and corridors are reconnected across the seam. |
| **Zoom in / detail map** | Drag a box → **Zoom in**. Overland children inherit the parent's coastline, elevation, climate, rivers, roads and named places and add finer detail. Select a town, castle or ruin and you get a street-level layout (walls, gates, keep, market, temple, taverns, docks, farmland — taking river / coast / surroundings from the parent). Select a dungeon, cave, lair or mine for a room-and-corridor or cavern level. Maps link both ways: the **Atlas** shows the hierarchy, and you double-click an outlined region (or a place with a gold dot) to open it. |
| **Edit** | Paint terrain / roads / rivers, place, drag, rename and annotate places. Full undo/redo. |
| **Stitch** | **Stitch maps** places several maps on one bigger board (auto-arrange or exact offsets), fills the gaps with blended terrain and joins settlements with roads. Maps on other grids are converted automatically. |
| **Export** | PNG image, **Tiled** map (`.tmj` + generated tileset PNG; opens in Tiled and imports into Godot, Unity via SuperTiled2Unity, GameMaker, Phaser, Defold…), **game JSON**, or **CSV**. Any map can be converted to another grid on export (e.g. hex → square tiles). |

Projects autosave in the browser; **Save** downloads a `.world.json` you can re-open anywhere.

## Export formats

**Game JSON** (`*.map.json`) — everything an engine needs:

- `grid`: type, width, height, offset convention and direction names.
- `legend`: tile id → key, name, colour, category, walkable.
- `layers` (row-major arrays, `index = row * width + col`):
  `terrain`, `elevation`, `moisture`, `temperature`, `road` / `river` (direction **bitmasks** —
  bit *d* set means "connected to the neighbour in `directions[d]`", ready for autotiling),
  `roadLevel` (1 trail, 2 road, 3 highway), `riverSize`, `building` (id per cell so adjacent
  buildings can be told apart).
- `roads` / `rivers` as polylines of `[col, row]`, and `features` with type, name, position,
  tags, notes and the id of any linked detail map.

**Tiled** (`*.tmj`) — orthogonal / hexagonal (`staggeraxis` y or x, `staggerindex` odd) /
isometric map with a `terrain` tile layer, `rivers` and `roads` polyline object layers and a
`features` point layer. Tiles carry `name`, `category` and `walkable` properties.

**CSV** — one line of tile ids per row, plus `legend.csv`.

### Grid conventions

| Grid | Storage | Neighbour directions |
| --- | --- | --- |
| `square` | row-major | E, SE, S, SW, W, NW, N, NE |
| `hex-pointy` | odd rows shifted right ("odd-r") | E, SE, SW, W, NW, NE |
| `hex-flat` | odd columns shifted down ("odd-q") | N, NE, SE, S, SW, NW |
| `iso` | square grid drawn as 2:1 diamonds | as square |

## Project layout

```
src/core/            pure TypeScript, no DOM — usable from Node scripts too
  grid.ts            square / hex / iso geometry, neighbours, coordinate conversions
  generate/          overland (terrain, climate, hydrology, places, roads), settlement, dungeon
  zoom.ts            child maps guided by a parent region
  region.ts          re-roll part of a map and stitch it back in
  compose.ts         combine maps on a larger board
  resample.ts        convert between grid types / sizes
  export/formats.ts  game JSON, Tiled, CSV
  tiles.ts           shared tile registry (ids are stable — append only)
  features.ts        place types and icons
  scales.ts          scale presets
  settings.ts        generator options (the UI forms are built from these schemas)
src/ui/              canvas renderer, editor, dialogs
tests/               vitest suite
```

Generation is deterministic: the same scale, grid, size, settings and seed always produce the
same map.
