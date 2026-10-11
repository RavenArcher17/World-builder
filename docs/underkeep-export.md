# Underkeep maps

[Underkeep](https://github.com/RavenArcher17/Underkeep) is a first-person extraction game in
Godot 4.6. Its in-game map editor saves maps as JSON in `user://maps/`, and the game plays any map
in that folder. World Builder reads and writes that same file, so maps can be designed here (by
hand or generated, on a phone) and played there. The game doesn't change.

A map is an Underkeep map when its settings carry `underkeep: true`. Tick **🗝 Underkeep map** in
the Map panel of a 3D map on a square grid, or open an Underkeep file with **Open…**. Everything
else is the 3D editing of [`3d-export.md`](3d-export.md): storeys, heights, sky/roof, stairs with
a facing, props and rooms.

## Getting a map into the game

1. **Export → Underkeep map** (or **⬇ Underkeep map** in the Map panel) downloads `<name>.json`.
2. On the PC, put it in `%APPDATA%\Godot\app_userdata\Underkeep\maps\`.
3. It shows up in the Gatehouse's map picker and in the game's map editor (Gatehouse → Map
   editor). The game refuses a map with errors and plays the built-in keep instead, so run
   **✓ Check for Underkeep** first.

To edit a map made in the game, copy its `.json` from that folder and **Open…** it. It joins the
open project as a 3D map.

## Generating a keep

**Generate → Keep in storeys (3D)** (or the dungeon style **Keep in storeys**, on a square or
isometric grid) makes a whole keep in Underkeep's shape:

- a walled keep of rooms on the ground storey, with a Great Hall, an open courtyard and rooms such
  as a chapel, kitchens, barracks and an armoury, each named and furnished for what it is;
- a tower of up to three storeys over one room (the top one an open belfry) and a crypt of up to
  two storeys under the halls, joined by staircases of three cells climbing 0, 2 and 4 m;
- the Great Stair, a hearth, lights in every room, and enemies, chests and traps whose tier rises
  with the distance from the Great Stair, and a boss with the best chest: the Castellan at the
  top of the tower, or with no tower the Sacristan deep in the crypt (the Warden or the
  Kennel-master when there is neither).

Tower storeys, crypt storeys and the courtyard are in the generator's settings. Tick
**🗝 Underkeep map** and export: generated keeps pass the game's checks (hundreds of seeds and
sizes were tried) and play in the game as they are. On a hex grid this style makes an ordinary
dungeon of rooms instead.

## The file (version 2)

```json
{
  "version": 2,
  "name": "Test tower",
  "w": 14, "h": 12,
  "storeys": [
    { "tiles": ["##############", "#............#", "…"], "roof": ["11111111111111", "…"], "height": [[0, 0, …], …] }
  ],
  "objects": [{ "t": "stair", "x": 2, "y": 10, "z": 0, "r": 0, "tier": -1 }, …],
  "regions": [{ "name": "The Hall", "z": 0, "x0": 1, "y0": 1, "x1": 12, "y1": 10 }],
  "notes": "Made in World Builder …"
}
```

- **Layout.** `w` × `h` cells of 2 m. Rows run north to south and columns west to east. `storeys`
  go from the lowest up, 5 m apart.
- **`tiles`** use `#` wall, `.` stone, `_` wood, `,` grass, ` ` nothing, and the stairs
  `^ > v <` (climbing north, east, south or west).
- **`roof`**: `1` covered, `0` open sky (moonlit, so the dark-born can come).
- **`height`** is in half metres within the storey: −8 to 9 on the lowest storey, 0 to 9 above.
- **Objects.** Each one names its storey `z`. `r` is the number of quarter turns clockwise from
  north; a chest with `r` −1 faces the most open floor. `tier` −1 lets the distance from the stair
  decide; 0–3 sets it (3 is a Champion enemy or a Treasure chest). There is one object per cell.
- **`regions`** are named rooms, which the game says as you walk in.

## How World Builder maps to it

| World Builder | Underkeep |
|---|---|
| Storeys −1, 0, 1 … | `storeys[0]`, `[1]`, `[2]` … (lowest first) |
| Walls, crypt walls, rock, buildings, the keep | `#` |
| Wooden floor, bridges, docks | `_` |
| Grass and other green ground | `,` |
| Nothing (open air) | ` ` |
| Stairs up / down with a facing | `^ > v <` (stairs down face the other way); stairs without a facing (a generated dungeon's links to other maps) are floor |
| Any other floor (stone, cobbles, corridors, water, pits) | `.`; pits are 4 m deep (height −8) |
| Height (half metres), Sky / roof | `height`, `roof`; a map with no 3D data is covered everywhere |
| Props | their Underkeep objects (pillar, statue, rubble, locked door, pew, chair, desk, wardrobe, shelf, altar, rug, banner, dummy, gravestone, hay, cauldron, fountain, great bell, brazier, torch, candelabra, standing torch, hearth, campfire, bonfire, chest, pot, rack, trap) |
| Objects: door, table, counter, bed, bench, bookshelf, barrel, crate, lectern, trees, boulder, well, lamp post, cooking fire | door, table, table, bed, bench, bookshelf, barrel, crate, desk, tree, rubble, fountain, standing torch, campfire |
| Door tiles with nothing else on them | `door` (a doorway: lintel and torch) |
| Places: Great Stair, Way out, Enemy, the clapper | `stair`, `rope` / `grate` / `lift` / `postern`, the enemy kind, `clapper`, with their tier and facing |
| Places from World Builder's dungeons: entrance, monsters, boss, treasure, trap, altar | `stair` (unless there is a Great Stair), the enemy named by the place's `kind` (keeps name one) or else `shieldman` / `castellan`, `chest` (tier 2), `trap`, `altar` |
| Rooms | `regions` |

If a cell holds more than one thing, the place wins over a prop and a prop over an object. Things
with no Underkeep match (stations, fishing spots, ore, herbs) are left out, and Check for
Underkeep lists them.

Opening an Underkeep file works the other way round. The storey with the Great Stair becomes the
ground storey. Exits, enemies, the stair, chests, traps and the clapper become places that carry
their tier and facing. Writing that map back out gives the same file.

## Check for Underkeep

These are the game's own checks (`Maps.validate` in `prototype/data/maps.gd`), run on the file
that would be exported, with the same movement rules: level ground, ledges down 3.5 m (a storey
for the player), stairs end to end and out of the top of a storey, drops from upper floors, and
1.5 m mantles.

- **Errors** (the game refuses the map):
  - no Great Stair, or more than one;
  - the stair doesn't open onto floor;
  - an object not on a floor cell;
  - two objects in one cell;
  - a stair cell rising more than 2 m;
  - a stair running into the floor above.
- **Warnings:**
  - exits, chests or enemies that can't be reached from the stair;
  - stairs that go nowhere;
  - stairs that start against a wall;
  - storeys that can't be reached;
  - no lights, no hearth, campfire or bonfire, or no enemies.
- **World Builder adds warnings** for:
  - a map outside the game editor's 12–96 cells a side (the game still plays it);
  - heights outside what a storey allows (they are exported at the limit);
  - things with no Underkeep match.

Tap a problem to jump to its cell and storey.

## How this was checked

The checks and the export were compared against the game itself, running Underkeep's own code in
Godot 4.6.3:

- `Maps.validate` gives the same errors, warnings and reachable floor as Check for Underkeep for:
  - a test tower;
  - five broken variants of it;
  - a round trip;
  - a dungeon and a cave generated in World Builder.
- The game's level builder builds the exported tower, the dungeon and the cave without script
  errors: storeys, regions, lights and enemies all come through.

When the game's format or rules change, change `src/core/underkeep/` and this document to match.
