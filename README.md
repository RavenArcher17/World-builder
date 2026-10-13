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

## Firebase: hosting and cloud saves

The app is set up for the Firebase project `world-builder-fc2cf` (`.firebaserc`,
`src/cloud/config.ts`). The web config values are public by design; data is protected by the
Firestore security rules in `firestore.rules`.

**Hosting.** `firebase.json` serves the built `dist/` folder, and
`.github/workflows/firebase-hosting.yml` deploys automatically: pushes to `main` go live at
<https://world-builder-fc2cf.web.app>, pull requests get a preview link. It needs a service
account key saved as the repository secret `FIREBASE_SERVICE_ACCOUNT` (roles: Firebase Hosting
Admin, API Keys Viewer). Manual deploy instead: `npm install -g firebase-tools`,
`firebase login`, `npm run build`, `firebase deploy`.

**Cloud saves.** "☁ Sign in" offers Google sign-in or guest (anonymous) sign-in; a guest can
later link a Google account and keep their projects. The open project can then be saved to
Cloud Firestore and keeps syncing a few seconds after each change. Projects are gzipped and
split across documents (`users/{uid}/projects/{id}` + `chunks/`), so large atlases fit within
Firestore's 1 MiB document limit. One-time console setup:

1. Authentication → Get started → Sign-in method → enable **Google** and **Anonymous**.
2. Firestore Database → Create database (production mode, any location).
3. Firestore → Rules → paste `firestore.rules` → Publish (or `firebase deploy --only firestore:rules`).

Sign-in works on `localhost`, `*.web.app` and `*.firebaseapp.com`. Other domains (including PR
preview links) must be added under Authentication → Settings → Authorised domains.

## What it does

| Step | How |
| --- | --- |
| **Generate** | Pick a **scale** (World, Continent, Kingdom, County, Local area, City / Town / Village layout, Dungeon, Keep in storeys (3D), Cave), a **grid** (square, pointy hex, flat hex, isometric), size and seed. Toggle what goes on the map — terrain types, rivers, lakes, roads, capitals, cities, towns, villages, hamlets, farms, castles, dungeons, ruins, caves, towers, temples, shrines, mines, lairs, camps, landmarks, inns — and tune sea coverage, mountains, moisture, temperature and density sliders. Optional extras for overland maps, all off by default (so a seed still makes the same map): **mountains in long ranges** that divide the land, **flat plains, steep peaks**, **shallow coastal shelves**, **level ground under places** (flat sites for 3D) and **danger rings from the capital** (every place gets a danger level from 1 to 5, kept when zooming in). |
| **Re-roll an area** | Drag a box with the Select tool → **Re-roll area**. Only that area is regenerated; the edges are blended, and rivers, roads, streets and corridors are reconnected across the seam. |
| **Zoom in / detail map** | Drag a box → **Zoom in**. Overland children inherit the parent's coastline, elevation, climate, rivers, roads and named places and add finer detail. Select a town, castle or ruin and you get a street-level layout (walls, gates, keep, market, temple, taverns, docks, farmland — taking river / coast / surroundings from the parent). Select a dungeon, cave, lair or mine for a room-and-corridor or cavern level. Maps link both ways: the **Atlas** shows the hierarchy, and you double-click an outlined region (or a place with a gold dot) to open it. |
| **Edit** | Paint terrain / roads / rivers, place, drag, rename and annotate places. Full undo/redo. |
| **Stitch** | **Stitch maps** places several maps on one bigger board (auto-arrange or exact offsets), fills the gaps with blended terrain and joins settlements with roads. Maps on other grids are converted automatically. |
| **3D** | Tick **🧊 3D map** in the Map panel to see the map in 3D (turn, move and zoom by touch or mouse) and export it as a **3D model (.glb)** for Godot, Unity or Blender: ground, walls, buildings, objects, water and roads in metres, with collision set up for Godot and marker nodes carrying each place's data. Smooth hills or stepped blocks. 3D maps also get Underkeep-style building tools: storeys above and below, heights in half metres, open sky or roofed cells, stairs that climb to the floor they face, props (lights, hearths, furniture, chests, traps) and named rooms. Maps without it stay 2D. See [`docs/3d-export.md`](docs/3d-export.md). |
| **Export** | PNG image, **Tiled** map (`.tmj` + generated tileset PNG; opens in Tiled and imports into Godot, Unity via SuperTiled2Unity, GameMaker, Phaser, Defold…), **game JSON**, or **CSV**. Any map can be converted to another grid on export (e.g. hex → square tiles). |

Projects autosave in the browser, a moment after each change: in its database (IndexedDB), which
holds big projects too, with the map layers packed small. Where the browser won't give the page a
database, a project small enough goes into localStorage instead, and you're told in plain words if
one is too big to keep there (then use **Save**, or the cloud). Projects autosaved by older versions
(in localStorage) open as before and move to the database. **Save** downloads a `.world.json` you
can re-open anywhere. Undo keeps 25 steps, each holding only the layers it changed.

## Game maps: RPG-DC

Maps whose settings carry `rpgdcMapId` (opened from the game's own map file, or made by
[RPG-DC](https://github.com/RavenArcher17/RPG-DC)'s `tools/world-builder/export-map.ts`) switch on a
game mode; every other map behaves as above.

- **Opening the game's maps:** **Open…** takes the game's `rpg-dc.maps.json` as well as project
  files, and **⟳ Get the game's maps** (Map panel) loads what the live game is playing: the
  overworld (any square from 128 to 1024 tiles a side; the game's is 768, a continent in the
  ocean), the crypt, the sewers, the caverns and the inside of every building. A big map is drawn
  just around what's on screen, as the game draws it, and zoomed out as an overview (a pixel a
  tile); painting redraws just around the brush. The 768 world is quick on a computer; it works on
  a phone, but is best edited on a computer (the Map panel says so there).
- **Ground and objects:** paint the game's thirteen grounds (grass, path, water, town cobbles, crypt
  floor and wall, wooden floors, and the new lands' sand, mud, bog water, snow, bare rock / gravel
  and ice) and what stands on each tile, in groups: Nature (trees by species and yews, boulders,
  cacti, dead trees, ore from copper to runite and rune essence, fishing spots from shrimp to eels
  and lobsters, herbs from sunleaf to frostcap), Runecrafting altars
  (air, mind, water, earth, fire, chaos, law), Fast travel (the waystone), Town (fences, stations, workbenches, doors, stairs, the
  sewer grate), Streets (well, lamp posts, market stalls, flower beds, benches, signposts, the notice
  board) and Indoors (counters, bookshelves, tables, beds, barrels, crates, lecterns). Grove
  and Ore brushes scatter one species (or cacti, or dead trees) or ore at a time.
- **Places with fields:** spawn point, monster spawns (kind, count, radius), bosses, braziers,
  links on stairs, doors and grates that name the target map and the exact tile you arrive on (tap
  it on the target map), buildings (style, size, name, roof and wall colours) and townspeople
  (banker, shopkeeper, the Slayer master, or the mayor, guard captain and villagers who just talk,
  and the hermit, fisher, farmer, trapper and miner out of town), guild forts (id and name), the
  travelling merchant's spot, and landmarks (id, name and radius): named places whose name shows as
  players arrive, drawn with their name and a faint circle for their radius; a waystone in one
  (one at most) is a stop for fast travel. Monster spawns offer every monster, the new lands' scarabs,
  mummies, bog goblins, yetis and wyverns too. The overworld shows where the game will post its
  town guards (💂, one at each gate) and where criminals come back (⛓️), and the Town Hall the
  guard who stands with the mayor.
- **Zones:** paint Safe / Frontier / Wilderness / Deep on the overworld (legend shows each zone's
  rules); dungeon floors and buildings' insides pick one zone for the whole map.
- **Check for game:** lists every problem with its tile; tap one to jump there.
- **Export → RPG-DC maps:** one `rpg-dc.maps.json` with every RPG-DC map, documented in
  [`docs/rpgdc-export.md`](docs/rpgdc-export.md).

- **Game art preview:** "Draw with the game's art" in the Map panel draws the map with the game's
  own sprites (Flare, CC BY-SA 3.0), loaded from `https://rpg-dc.onrender.com/art/` (the game
  serves them cross-origin): houses in their colours, doors, herbs, street decorations, waystones, insides
  with their furniture, the Duel Arena's fenced pits, a fort's banner and chest, the sewers' damp
  stone, moss, drains and water, and the caverns' rock walls, lava, glowing cracks and mine
  clutter; the new lands' snow, sand, mud, gravel, ice and bogs with their edges and shores,
  snowy pines and rocks, yews, cacti, dead trees, reeds and lily pads; and the monsters,
  townspeople (in their work clothes) and guards where they stand. **Looks like** (Map panel)
  sets a dungeon floor's look: crypt, sewers or caverns.

Projects from the game's exporter are converted to this form when opened. Everything works by
touch on a phone: one finger paints or places, two fingers pinch and pan.

## Game maps: Underkeep

3D maps on a square grid can be made for [Underkeep](https://github.com/RavenArcher17/Underkeep)
(`settings.underkeep`): tick **🗝 Underkeep map** in the Map panel or **Open…** a map file from the
game. Place gets the game's Great Stair, ways out, enemies (with tiers) and the bell's clapper.
**✓ Check for Underkeep** runs the game's own checks, and **Export → Underkeep map** writes the
`.json` its map editor saves. Put that file in `%APPDATA%\Godot\app_userdata\Underkeep\maps\`
and the game plays it. **Generate → Keep in storeys (3D)** makes a whole keep for it: rooms over
rooms, a tower and a crypt joined by stairs, lights, a hearth, and enemies and loot that get
tougher the further you go. See [`docs/underkeep-export.md`](docs/underkeep-export.md).

## Export formats

**Game JSON** (`*.map.json`) — everything an engine needs:

- `grid`: type, width, height, offset convention and direction names.
- `legend`: tile id → key, name, colour, category, walkable.
- `layers` (row-major arrays, `index = row * width + col`):
  `terrain`, `elevation`, `moisture`, `temperature`, `road` / `river` (direction **bitmasks** —
  bit *d* set means "connected to the neighbour in `directions[d]`", ready for autotiling),
  `roadLevel` (1 trail, 2 road, 3 highway), `riverSize`, `building` (id per cell so adjacent
  buildings can be told apart), `object` (what stands on the cell; see `objectLegend`).
- `roads` / `rivers` as polylines of `[col, row]`, and `features` with type, name, position,
  tags, notes and the id of any linked detail map.

**Tiled** (`*.tmj`) — orthogonal / hexagonal (`staggeraxis` y or x, `staggerindex` odd) /
isometric map with a `terrain` tile layer, `rivers` and `roads` polyline object layers and a
`features` point layer. Tiles carry `name`, `category` and `walkable` properties.

**CSV** — one line of tile ids per row, plus `legend.csv`.

**3D model** (`*.glb`, maps with 3D on) — binary glTF 2.0 with vertex colours, Godot collision
names and marker nodes; documented in [`docs/3d-export.md`](docs/3d-export.md).

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
  objects.ts         object layer registry (ids are stable — append only)
  brushes.ts         grove and ore-cluster brushes
  rpgdc/             RPG-DC game mode: rules, migration, checks, export
  scene3d/           3D option: map → 3D scene (meshes + markers), .glb writer, storeys, props
  underkeep/         Underkeep maps: file format, import, export, the game's checks
src/cloud/           Firebase config, Google sign-in, Firestore project storage (lazy-loaded)
  tiles.ts           shared tile registry (ids are stable — append only)
  features.ts        place types and icons
  scales.ts          scale presets
  settings.ts        generator options (the UI forms are built from these schemas)
src/ui/              canvas renderer, editor, dialogs; map3dUi.ts and view3d.ts (three.js, lazy-loaded)
tests/               vitest suite
```

Generation is deterministic: the same scale, grid, size, settings and seed always produce the
same map.
