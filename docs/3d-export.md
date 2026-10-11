# 3D maps and the `.glb` export

3D is an option each map switches on: tick **🧊 3D map** in the Map panel. A map without it stays
a plain 2D map, and nothing about its other exports changes. With it on:

- **🧊 3D** (toolbar, or **View in 3D** in the Map panel) shows the map in 3D over the map area.
  Drag to turn, two fingers (or the right mouse button) to move, pinch or scroll to zoom,
  **⟲** for the starting view, **🗺️ 2D** to go back.
- **Export → 3D model (.glb)** (or **⬇ 3D model (.glb)** in the Map panel) downloads the map as
  one binary glTF 2.0 file, which Godot, Unity, Blender and three.js import as is.

The 3D code (scene builder, `.glb` writer, three.js) only downloads once a 3D map is opened.

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
| `Structures-col` | Walls, solid rock, buildings with roofs, the keep, gate and door lintels, bridge and dock decks, stairs | yes |
| `Objects-col` | Trees, rocks, ore, fences, stations, furniture, street things | yes |
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
- every object a game interacts with: stations, fishing spots, stairs and entrances, doors and herbs.

Each sits on the ground (or the water) at the cell's centre. Its glTF `extras.worldBuilder` says
what it is:

```json
{ "kind": "place", "id": "f_…", "type": "city", "label": "City", "name": "Aldoford", "col": 81, "row": 38,
  "tags": ["…"], "notes": "…", "props": { "kind": "goblin", "count": 2 }, "detailMapId": "map_…" }
{ "kind": "object", "key": "bank", "id": 9, "name": "Bank", "group": "station", "col": 12, "row": 7 }
```

`tags`, `notes`, `props` and `detailMapId` appear only when the place has them. Node names are the
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

## Sizes

A 128 × 80 hex world exports to about 5 MB, a 72 × 60 town to about 1 MB and a 48 × 40 dungeon to
about 0.6 MB. Building the scene takes well under a second on a laptop.
