# 3D maps and the `.glb` export

3D is an option each map switches on: tick **🧊 3D map** in the Map panel. A map without it stays
a plain 2D map, and nothing about its other exports changes. With it on:

- **🧊 3D** (toolbar, or **View in 3D** in the Map panel) shows the map in 3D over the map area.
  Drag to turn, two fingers (or the right mouse button) to move, pinch or scroll to zoom,
  **⟲** for the starting view, **🗺️ 2D** to go back.
- **Export → 3D model (.glb)** (or **⬇ 3D model (.glb)** in the Map panel) downloads the map as
  one binary glTF 2.0 file, which Godot, Unity, Blender and three.js import as is.

The 3D code (scene builder, `.glb` writer, three.js) only downloads once a 3D map is opened.

## Building in 3D

Maps with 3D on get these tools (after Underkeep's map editor). Plain maps never show them.

- **Storeys.** Map panel → **＋ Storey above** / **＋ Storey below**, up to six in all. Switch the
  storey you edit with **▼ ▲** in the toolbar; the storey below shows through, dimmed. A new
  storey starts as **Nothing (open air)**: paint its floors and walls with the usual Paint →
  Terrain. Paint, Place and Props work on the storey being edited. Each storey sits one wall
  height plus a 0.5 m floor above the last (5 m with 4.5 m walls).
- **Paint → Height** raises or lowers cells half a metre per tap, sets them to a height, or
  flattens them. Heights show on the map in metres.
- **Paint → Sky / roof** marks cells as covered (they get a ceiling) or open to the sky.
- **Stairs.** Paint Terrain → Stairs up with a facing: the stairs climb towards the cell they
  face, up to that cell's floor, or to the floor of the storey above when the cell in front is
  open. Three stair cells at heights 0, 2 and 4 m climb a whole storey; leave the cells over the
  upper part as Nothing on the storey above. Stairs down face the other way.
- **Paint → Props**: lights (brazier, torches, candelabra, hearth, campfire, bonfire), furniture,
  loot (chest, pots, weapon rack), building pieces (pillar, statue, rubble, locked door), decor
  and spike traps. Props that have a front take the chosen facing.
- **Paint → Turn** turns the stairs or prop under your finger a quarter turn.
- **Rooms.** Drag a box with Select, then **🏷 Name as room**. Rooms are listed in the Map panel.

The 3D view hides ceilings so you can see in; **🏠** shows them. The export always has them.

**Generate → Keep in storeys (3D)** (square or isometric grids) makes a 3D map with all of
this already built: rooms, a tower above and a crypt below joined by stairs, props and named
rooms. See [`underkeep-export.md`](underkeep-export.md#generating-a-keep).

## Options (Map panel)

They are saved in the map's settings:

| Setting key | Option | Default |
|---|---|---|
| `map3d` | `true` when 3D is on (the key is removed when it is switched off) | off |
| `map3dLook` | Ground: `smooth` (a surface through the cell centres) or `blocks` (flat-topped columns in steps) | `smooth` for overland maps, `blocks` for towns and dungeons |
| `map3dTile` | Cell size in metres: the distance between neighbouring cell centres | 2 for dungeons, 4 otherwise |
| `map3dRelief` | Overland maps: metres from sea level to the highest possible ground | 10 % of the map's longest side |
| `map3dWall` | Towns and dungeons: height of dungeon walls and solid rock | 4.5 |

Blocks step in half metres on towns and dungeons, and in half a cell on overland maps.

## Axes and units

- Metres, y up, right-handed, as glTF and Godot use them.
- x runs east along the columns and z south along the rows.
- The origin is the map's top-left corner, so the map's north is −z (Godot's forward).
- A cell's centre is its logical position times the cell size.
  - Square and isometric cells: (col + 0.5, row + 0.5). Isometric maps are square grids in 3D.
  - Hexes use the same centres as the game JSON's grid conventions, with neighbouring centres one cell size apart.
- Sea level is y = 0. Overland ground follows the map's elevation (smoothed once so single-cell
  peaks don't stand up as spikes). Towns and dungeons are flat at y = 0, and water there sits
  0.4 m down.

## What is in the file

The scene's root node is named after the map, and its glTF `extras.worldBuilder` holds the map's
facts: `format: "world-builder-3d"`, `version: 1`, the map's name, id, kind, grid, width, height,
seed, `tileMetres`, `look`, `reliefMetres` and `wallMetres`.

Under it, one mesh node per part. Parts with nothing in them are left out.

| Node | What | Collision in Godot |
|---|---|---|
| `Ground-col` | The ground, with a base under the map's edges | yes |
| `Structures-col` | Walls, solid rock, buildings with roofs, the keep, gate and door lintels, bridge and dock decks, stairs, the floors and walls of other storeys | yes |
| `Roofs-col` | Ceilings over covered cells with nothing built above them | yes |
| `Objects-col` | Trees, rocks, ore, fences, stations, furniture, street things, and 3D props | yes |
| `Places-col` | Small models of places on overland maps: houses, castles, towers, cave mouths, ruins, temples | yes |
| `Roads` | Roads lying just above the ground | no (the ground under them has it) |
| `Water` | Sea, lakes, rivers and pools, see-through | no |

- **Collision.** The `-col` suffix makes Godot's importer give that mesh a `StaticBody3D` with a
  trimesh `CollisionShape3D` (and drop the suffix from the name). This was checked by importing
  exported files in Godot 4.6.3.
- **Colours.** Every vertex carries its colour (`COLOR_0`, linear, 16-bit), so there are no
  textures. The two materials are `Painted` (opaque, rough) and `Water` (alpha-blended).

### Markers

Empty nodes under `Markers` mark:

- every place on the map;
- every object a game interacts with: stations, fishing spots, stairs and entrances, doors and herbs;
- every light, loot and danger prop;
- every named room (at its middle).

Each sits on the ground (or the water) at the cell's centre. Its glTF `extras.worldBuilder` says
what it is:

```json
{ "kind": "place", "id": "f_…", "type": "city", "label": "City", "name": "Aldoford", "col": 81, "row": 38,
  "tags": ["…"], "notes": "…", "props": { "kind": "goblin", "count": 2 }, "detailMapId": "map_…" }
{ "kind": "object", "key": "bank", "id": 9, "name": "Bank", "group": "station", "col": 12, "row": 7 }
{ "kind": "prop", "key": "hearth", "id": 23, "name": "Hearth", "group": "light", "col": 10, "row": 8,
  "storey": 1, "facing": "south", "lightRadius": 5, "sanctuary": true }
{ "kind": "room", "name": "Great Hall", "storey": 1, "c0": 3, "r0": 3, "c1": 20, "r1": 8 }
```

`storey` appears only on storeys other than the ground storey, `facing` only where one was set,
and `sanctuary` on hearths, campfires and bonfires.

`tags`, `notes`, `props` and `detailMapId` appear only when the place has them. Overland maps
generated with **Danger rings from the capital** give every place
`"props": { "danger": 3, "dangerName": "Frontier" }` (1 Heartland, 2 Borderland, 3 Frontier,
4 Wilds, 5 Deep wilds, by distance from home), and the home place also has `"home": true`.
**Level ground under places** gives towns and places flat ground to build on. Node names are the
place's label and name (for example `City Aldoford`) or the object's key and cell (`bank 12,7`).

### Reading it in Godot

Godot keeps glTF `extras` as node metadata:

```gdscript
var map := preload("res://my-map.glb").instantiate()
add_child(map)
for marker in map.find_child("Markers", true, false).get_children():
    var data: Dictionary = marker.get_meta("extras")["worldBuilder"]
    if data.kind == "place" and data.type == "monster_spawn":
        spawn_monsters(marker.global_position, data.props)
```

Godot's JSON reads numbers as floats, so convert `col` and `row` with `int()` when you need them
as integers.

## How 3D maps are saved

The project file keeps 3D data only on maps that use it. All of it is optional, and it is checked
and repaired when the project opens.

| Field | What |
|---|---|
| `layers3d` | The ground storey's per-cell `height` (half metres), `roof` (1 covered, 0 open sky), `facing` (0 north, 1 east, 2 south, 3 west, −1 automatic) and `prop` (id in `src/core/scene3d/props.ts`, 0 none); row-major like the other layers. |
| `storeys` | The other storeys: `{ z, layers, layers3d }`, with `z` 1 for the storey above the ground storey and −1 for the one below. |
| `rooms` | `{ name, z, c0, r0, c1, r1 }`. |
| `features[].z` | The storey a place is on (absent on the ground storey). |

Prop ids are stable: they are only ever added to, never renumbered.

## Sizes

A 128 × 80 hex world exports to about 5 MB, a 72 × 60 town to about 1 MB and a 48 × 40 dungeon to
about 0.6 MB. Building the scene takes well under a second on a laptop.
