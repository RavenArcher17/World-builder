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
  "maps": [ /* one entry per map: the overworld first, then dungeon floors by id */ ]
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
  "groundLegend": ["grass", "path", "water", "town_floor", "crypt_floor", "crypt_wall"],
  "ground": [0, 0, 1, ...],
  "objectLegend": ["", "tree", "oak", "willow", "boulder", "fence", "copper_rock", "tin_rock", "iron_rock", "bank", "shop", "furnace", "anvil", "cooking_fire", "fishing_shrimp", "fishing_trout", "fishing_salmon", "crypt_entrance", "stairs_down", "stairs_up"],
  "objects": [0, 4, 0, ...],
  "zoneLegend": ["safe", "frontier", "wilderness", "deep"],
  "zones": [0, 1, 1, ...],
  "places": [
    { "type": "spawn_point", "x": 64, "y": 65 },
    { "type": "monster_spawn", "x": 70, "y": 52, "kind": "goblin", "count": 1, "radius": 7 },
    { "type": "link", "x": 36, "y": 44, "toMap": "crypt1", "toX": 19, "toY": 7 }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The game's map id (`settings.rpgdcMapId`): `overworld`, `crypt1`, `crypt2`, `crypt3`, … |
| `name` | string | Display name. |
| `kind` | `"overworld"` \| `"dungeon"` | Dungeon floors use one zone for the whole map. |
| `width`, `height` | integers | Size in tiles. The game expects 128×128 for the overworld and 48×48 for crypt floors (the check warns otherwise). |
| `zone` | string \| `null` | Dungeons: the whole floor's zone key from `zoneLegend`. Overworld: `null`. |
| `groundLegend` | string[] | Ground kinds; `ground` values index into it. Always all six, even if unused. |
| `ground` | integer[] (`width*height`) | Ground per tile. |
| `objectLegend` | string[] | Objects; `objects` values index into it. Index 0 (`""`) means nothing. Always all twenty. |
| `objects` | integer[] (`width*height`) | What stands on each tile. |
| `zoneLegend` | string[] | Zone keys; `zones` values index into it. Always all four. |
| `zones` | integer[] (`width*height`) \| `null` | Overworld: zone per tile. Dungeons: `null` (use `zone`). |
| `places` | array | Typed places (below), spawn point first, then links, bosses, monster spawns and braziers. |

### Ground

| Key | Walkable |
|---|---|
| `grass` | yes |
| `path` | yes |
| `water` | no |
| `town_floor` | yes |
| `crypt_floor` | yes |
| `crypt_wall` | no |

Tiles painted with World Builder's general palette export as the closest game ground (water
tiles as `water`, dungeon floors as `crypt_floor`, other walkable land as `grass`, …); the check
warns when a map has any.

### Objects

Any object blocks walking. Stations, fishing spots, stairs and the crypt entrance are used from a
neighbouring tile (any of the 8 around it).

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

### Zones

| Key | Rules |
|---|---|
| `safe` | No PvP. You keep everything when you die. |
| `frontier` | No PvP. Keep 3 items. Only the owner can loot your grave. Graves last 8 min. |
| `wilderness` | PvP. Keep 1 item. Anyone can loot graves. Graves last 6 min. |
| `deep` | PvP. Keep 0 items. Anyone can loot graves. Graves last 6 min. |

An overworld tile without a zone exports as `deep` (index 3); the check reports such tiles.

### Places

| `type` | Fields | Meaning |
|---|---|---|
| `spawn_point` | `x`, `y` | Where new players start. Exactly one, on the overworld, walkable, in the Safe zone. |
| `monster_spawn` | `x`, `y`, `kind`, `count` (≥ 1), `radius` (tiles, ≥ 0) | `count` monsters of `kind` live here. They roam up to `radius` tiles from home (chasing that far, idling within half of it). `radius` 0: they stay on their tile, and only fight players who come next to them. A new spawn starts at its monster's normal range (below). |
| `boss` | `x`, `y`, `kind` | A boss. |
| `brazier` | `x`, `y` | A light (crypt floors). |
| `link` | `x`, `y`, `toMap`, `toX`, `toY` | On a `crypt_entrance`, `stairs_down` or `stairs_up` tile. Using it moves the player to tile (`toX`, `toY`) of map `toMap`, which is walkable. |

Monster kinds, with their normal range in tiles: `rat` 6, `goblin` 7, `wolf` 8, `bandit` 8,
`troll` 7, `skeleton` 8, `giant_spider` 8, `ghoul` 8, `bone_king` 7. The game uses the normal range
for a `monster_spawn` that has no `radius`.

Maps saved before radius 0 meant "stays put" (settings without `rpgdcPlaces: 2`) used 0 for the
normal range; World Builder writes the normal range into those spawns when the project is opened.

Links come in pairs: going down from map A to B (a link on A's entrance or stairs down) is
matched by a link on one of B's stairs up back to A. Going down, the arrival tile is normally
just east (x + 1) of the stairs up; going up, a walkable tile beside the stairs down.

## The checks

**Check for game** reports each problem with its map and tile (tap one to jump there):

- exactly one spawn point, on the overworld, on walkable ground in the Safe zone;
- every station and fishing spot has a walkable neighbour reachable on foot from the spawn point
  (on dungeon floors: from where links arrive), moving in 8 directions without cutting corners
  past blocked tiles;
- every entrance or staircase has a link to an existing map and a walkable target tile, and links
  come in pairs;
- no monster spawn or boss in the Safe zone or on a tile you can't walk on;
- every overworld tile has a zone, and every dungeon floor has its zone;
- the overworld is 128×128 and crypt floors are 48×48 (a warning);
- tiles using ground or objects the game doesn't have (a warning).

## Opening the game's own export

Projects made by RPG-DC's `tools/world-builder/export-map.ts` (stand-in terrain plus the game's
tile ids in `layers.rpgdcTile`) are converted when opened: ground, objects and zones are filled
in from the game tiles (or from the terrain, where it was edited), markers become typed places,
and the stairs become paired links. The `rpgdcTile` layer is then removed, so a project is never
converted twice.
