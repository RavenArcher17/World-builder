# RPG-DC maps export (`rpg-dc.maps.json`)

World Builder's **Export → RPG-DC maps** (also in the Map panel of any RPG-DC map) writes every
RPG-DC map in the project to one file for [RPG-DC](https://github.com/RavenArcher17/RPG-DC).
A map counts as an RPG-DC map when its settings carry `rpgdcMapId`.

The checks from **Check for game** run before exporting. Problems are reported but never block
the export.

## Top level

```json
{
  "format": "rpgdc-maps",
  "version": 1,
  "exportedAt": "2026-10-08T12:00:00.000Z",
  "maps": [ /* one entry per map: the overworld first, then dungeon floors, then insides, each by id */ ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `format` | `"rpgdc-maps"` | Always this string. |
| `version` | `1` | Bumped only if the layout of this file changes incompatibly. |
| `exportedAt` | ISO 8601 string | When the file was written. |
| `maps` | array | Every RPG-DC map in the project. |

## A map

Coordinates: `x` = column, `y` = row, both from 0 at the map's top-left corner. Layers are
row-major: the value for tile (x, y) is at index `y * width + x`.

```json
{
  "id": "overworld",
  "name": "RPG-DC overworld",
  "kind": "overworld",
  "width": 128,
  "height": 128,
  "zone": null,
  "groundLegend": ["grass", "path", "water", "town_floor", "crypt_floor", "crypt_wall", "planks"],
  "ground": [0, 0, 1, ...],
  "objectLegend": ["", "tree", "oak", "willow", "boulder", "fence", "copper_rock", "tin_rock", "iron_rock", "bank", "shop", "furnace", "anvil", "cooking_fire", "fishing_shrimp", "fishing_trout", "fishing_salmon", "crypt_entrance", "stairs_down", "stairs_up", "herb_sunleaf", "herb_silverweed", "herb_thornberry", "herb_nightshade", "herb_emberbloom", "door", "sewer_grate", "alchemy_table", "sewing_table", "fletching_bench", "counter", "bookshelf", "table", "bed", "barrel", "crate", "lectern"],
  "objects": [0, 4, 0, ...],
  "zoneLegend": ["safe", "frontier", "wilderness", "deep"],
  "zones": [0, 1, 1, ...],
  "places": [
    { "type": "spawn_point", "x": 64, "y": 65 },
    { "type": "monster_spawn", "x": 70, "y": 52, "kind": "goblin", "count": 1, "radius": 7 },
    { "type": "link", "x": 36, "y": 44, "toMap": "crypt1", "toX": 19, "toY": 7 },
    { "type": "building", "x": 57, "y": 58, "w": 6, "h": 5, "style": "stone", "sign": "Bank" }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The game's map id (`settings.rpgdcMapId`): `overworld`, `crypt1`, `sewer1`, `bank`, … |
| `name` | string | Display name ("You enter the Bank."). |
| `kind` | `"overworld"` \| `"dungeon"` \| `"interior"` | One overworld. Dungeon floors are dark (braziers light them); interiors are a building's inside, lit. Both use one zone for the whole map. In World Builder an interior is a dungeon-kind map with `settings.rpgdcKind` `"interior"`. |
| `width`, `height` | integers | Size in tiles. The game needs 128×128 for the overworld, 16 to 64 a side for dungeon floors and 4 to 32 for insides. |
| `zone` | string \| `null` | Dungeons and insides: the whole map's zone key from `zoneLegend`. Overworld: `null`. |
| `groundLegend` | string[] | Ground kinds; `ground` values index into it. Always all seven, even if unused. |
| `ground` | integer[] (`width*height`) | Ground per tile. |
| `objectLegend` | string[] | Objects; `objects` values index into it. Index 0 (`""`) means nothing. Always all thirty-seven. |
| `objects` | integer[] (`width*height`) | What stands on each tile. |
| `zoneLegend` | string[] | Zone keys; `zones` values index into it. Always all four. |
| `zones` | integer[] (`width*height`) \| `null` | Overworld: zone per tile. Dungeons: `null` (use `zone`). |
| `places` | array | Typed places (below), spawn point first, then links, bosses, monster spawns, braziers, buildings and townspeople. |

### Ground

| Key | Walkable |
|---|---|
| `grass` | yes |
| `path` | yes |
| `water` | no |
| `town_floor` | yes |
| `crypt_floor` | yes |
| `crypt_wall` | no |
| `planks` | yes (wooden floors indoors) |

Tiles painted with World Builder's general palette export as the closest game ground (water
tiles as `water`, dungeon floors as `crypt_floor`, other walkable land as `grass`, …); the check
warns when a map has any.

### Objects

Any object blocks walking. Stations, fishing spots, herbs, doors, stairs, the grate and the crypt
entrance are used from a neighbouring tile (any of the 8 around it).

| Index | Key | Notes |
|---|---|---|
| 0 | `""` | Nothing. |
| 1–3 | `tree`, `oak`, `willow` | Trees by species. |
| 4 | `boulder` | |
| 5 | `fence` | The town wall. |
| 6–8 | `copper_rock`, `tin_rock`, `iron_rock` | Ore. |
| 9–13 | `bank`, `shop`, `furnace`, `anvil`, `cooking_fire` | Stations. |
| 14–16 | `fishing_shrimp`, `fishing_trout`, `fishing_salmon` | Fishing spots (on water). |
| 17 | `crypt_entrance` | Overworld way down into the crypt. Needs a `link`. |
| 18, 19 | `stairs_down`, `stairs_up` | Need a `link`. |
| 20–24 | `herb_sunleaf`, `herb_silverweed`, `herb_thornberry`, `herb_nightshade`, `herb_emberbloom` | Herb patches. Once an overworld has any, the game uses just these and stops scattering its own. They grow in the Frontier (sunleaf, silverweed), the Wilderness (thornberry, nightshade) and the Deep (emberbloom). |
| 25 | `door` | A building's door (in its south or east wall), or the way out of an inside. Needs a `link`. |
| 26 | `sewer_grate` | A way down, like stairs: needs a `link` to a map with stairs up leading back. |
| 27–29 | `alchemy_table`, `sewing_table`, `fletching_bench` | Workshop stations. |
| 30–36 | `counter`, `bookshelf`, `table`, `bed`, `barrel`, `crate`, `lectern` | Furniture. Players talk to townspeople across a `counter`. Indoors, a `bookshelf` stands in the line of the wall. |

### Zones

| Key | Rules |
|---|---|
| `safe` | No PvP. You keep everything when you die. |
| `frontier` | No PvP. Keep 3 items. Only the owner can loot your grave. Graves last 8 min. |
| `wilderness` | PvP with laws: attacking an innocent player makes you a criminal, killing one is a murder. Keep 1 item (murderers keep nothing, anywhere). Anyone can loot graves. Graves last 6 min. |
| `deep` | PvP, no laws. Keep 0 items. Anyone can loot graves. Graves last 6 min. |

An overworld tile without a zone exports as `deep` (index 3); the check reports such tiles.

### Places

| `type` | Fields | Meaning |
|---|---|---|
| `spawn_point` | `x`, `y` | Where new players start. Exactly one, on the overworld, walkable, in the Safe zone. |
| `monster_spawn` | `x`, `y`, `kind`, `count` (≥ 1), `radius` (tiles, ≥ 0) | `count` monsters of `kind` live here. They roam up to `radius` tiles from home (chasing that far, idling within half of it). `radius` 0: they stay on their tile, and only fight players who come next to them. A new spawn starts at its monster's normal range (below). |
| `boss` | `x`, `y`, `kind` | A boss. |
| `brazier` | `x`, `y` | A light (crypt floors). |
| `link` | `x`, `y`, `toMap`, `toX`, `toY` | On a `crypt_entrance`, `stairs_down`, `stairs_up`, `door` or `sewer_grate` tile. Using it moves the player to tile (`toX`, `toY`) of map `toMap`, which is walkable. |
| `building` | `x`, `y`, `w`, `h`, `style`, `sign` (optional) | A house on the overworld: `w`×`h` tiles of wall with its north-west corner at (`x`, `y`), in `style` `timber`, `stone` or `tower`; `sign` is its name. Houses are 3 to 8 tiles a side, towers square and 3 to 5 (the sizes the game has art for). Its walls block walking, except where an object (its door) stands. |
| `npc` | `x`, `y`, `role` | A townsperson standing there all day: `banker`, or a shopkeeper (`general`, `smith`, `mage`, `alchemist`, `tailor`, `fletcher`, `inn`). A door's sign shows the trade of the first townsperson inside. |

Monster kinds, with their normal range in tiles: `rat` 6, `goblin` 7, `wolf` 8, `bandit` 8,
`troll` 7, `skeleton` 8, `giant_spider` 8, `ghoul` 8, `bone_king` 7, `sewer_rat` 6, `slime` 5,
`beetle` 7, `rat_king` 6. The game uses the normal range for a `monster_spawn` that has no `radius`.
Town guards and townspeople aren't monster kinds here: the game places guards at the town's gates
itself, and townspeople come from `npc` places.

Maps saved before radius 0 meant "stays put" (settings without `rpgdcPlaces: 2`) used 0 for the
normal range; World Builder writes the normal range into those spawns when the project is opened.

Links come in pairs: going down from map A to B (a link on A's entrance, stairs down or grate) is
matched by a link on one of B's stairs up back to A, and a door into B by a door on B back to A. Going down, the arrival tile is normally
just east (x + 1) of the stairs up; going up, a walkable tile beside the stairs down.

## The checks

**Check for game** reports each problem with its map and tile (tap one to jump there):

- exactly one spawn point, on the overworld, on walkable ground in the Safe zone;
- every station and fishing spot has a walkable neighbour reachable on foot from the spawn point
  (on dungeon floors: from where links arrive), moving in 8 directions without cutting corners
  past blocked tiles;
- every entrance, staircase, door and grate has a link to an existing map and a walkable target
  tile, and links come in pairs;
- every building is a size there's art for and has a door in its south or east wall (not a
  corner); every townsperson stands on open floor players can reach, or talk to across a counter;
- no monster spawn or boss in the Safe zone or on a tile you can't walk on;
- every overworld tile has a zone, and every dungeon floor and inside has its zone;
- there's one overworld, 128×128; dungeon floors are 16 to 64 tiles a side, insides 4 to 32;
- herb patches (warnings): out of their zones, unreachable, next to a blocked tile, or within 2
  tiles of a tree (which hides them in the game); and a reminder that the game then stops
  scattering its own;
- tiles using ground or objects the game doesn't have (a warning).

## Opening the game's maps

**Open…** also takes an RPG-DC maps file (the game's own `shared/maps/rpg-dc.maps.json`, or an
export from here) and makes a project of it: one map per game map, places and all. **⟳ Get the
game's maps** in the Map panel does the same with the maps the live game is playing
(`https://rpg-dc.onrender.com/maps/rpg-dc.maps.json`). Exporting the project again gives back the
same maps. Use it whenever maps were changed on the game's side, so the next export doesn't put
old maps back. Either replaces the project in this browser; the project keeps the id
`rpgdc-world`, so saving it to the cloud replaces the RPG-DC project there.

## Opening projects made from the game's first maps

Projects made by RPG-DC's `tools/world-builder/export-map.ts` (stand-in terrain plus the game's
tile ids in `layers.rpgdcTile`) are converted when opened: ground, objects and zones are filled
in from the game tiles (or from the terrain, where it was edited), markers become typed places,
and the stairs become paired links. The `rpgdcTile` layer is then removed, so a project is never
converted twice.
