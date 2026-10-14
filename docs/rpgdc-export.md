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
  "width": 768,
  "height": 768,
  "zone": null,
  "groundLegend": ["grass", "path", "water", "town_floor", "crypt_floor", "crypt_wall", "planks", "sand", "mud", "bog", "snow", "stone", "ice"],
  "ground": [0, 0, 1, ...],
  "objectLegend": ["", "tree", "oak", "willow", "boulder", "fence", "copper_rock", "tin_rock", "iron_rock", "bank", "shop", "furnace", "anvil", "cooking_fire", "fishing_shrimp", "fishing_trout", "fishing_salmon", "crypt_entrance", "stairs_down", "stairs_up", "herb_sunleaf", "herb_silverweed", "herb_thornberry", "herb_nightshade", "herb_emberbloom", "door", "sewer_grate", "alchemy_table", "sewing_table", "fletching_bench", "counter", "bookshelf", "table", "bed", "barrel", "crate", "lectern", "well", "lamp_post", "market_stall", "flower_bed", "bench", "signpost", "notice_board", "gold_rock", "mithril_rock", "adamant_rock", "runite_rock", "essence_rock", "air_altar", "mind_altar", "water_altar", "earth_altar", "fire_altar", "chaos_altar", "law_altar", "cactus", "dead_tree", "yew", "fishing_eel", "fishing_lobster", "herb_duneflower", "herb_bogmyrtle", "herb_frostcap", "waystone", "cache", "thicket", "ruin", "gate", "lever", "locked_door"],
  "objects": [0, 4, 0, ...],
  "zoneLegend": ["safe", "frontier", "wilderness", "deep"],
  "zones": [0, 1, 1, ...],
  "places": [
    { "type": "spawn_point", "x": 384, "y": 385 },
    { "type": "monster_spawn", "x": 171, "y": 115, "kind": "yeti", "count": 1, "radius": 8 },
    { "type": "link", "x": 284, "y": 284, "toMap": "crypt1", "toX": 19, "toY": 7 },
    { "type": "building", "x": 375, "y": 376, "w": 6, "h": 5, "style": "stone", "sign": "Bank", "roof": "slate", "walls": "grey" },
    { "type": "landmark", "x": 386, "y": 456, "id": "fisher_lake", "name": "Moira's Lake", "radius": 16 }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The game's map id (`settings.rpgdcMapId`): `overworld`, `crypt1`, `sewer1`, `bank`, … |
| `name` | string | Display name ("You enter the Bank."). |
| `kind` | `"overworld"` \| `"dungeon"` \| `"interior"` | One overworld. Dungeon floors are dark (braziers light them); interiors are a building's inside, lit. Both use one zone for the whole map. In World Builder an interior is a dungeon-kind map with `settings.rpgdcKind` `"interior"`. |
| `width`, `height` | integers | Size in tiles. The game takes any square overworld from 128 to 1024 tiles a side (its own is 768×768, a continent in the ocean), 16 to 64 a side for dungeon floors and 4 to 32 for insides. |
| `zone` | string \| `null` | Dungeons and insides: the whole map's zone key from `zoneLegend`. Overworld: `null`. |
| `theme` | string, optional | Dungeon floors only: how the floor looks in the game. `crypt` (dressed stone), `sewer` (damp stone; water is sewer water), `cave` (rough rock; water is lava) or `frost` (the Frozen Peaks: ice walls over snow and ice; water is thin ice). Without it, a floor with water looks like the sewers, otherwise the crypt. In World Builder: `settings.rpgdcTheme`, set with **Looks like** in the Map panel; written only when chosen. |
| `groundLegend` | string[] | Ground kinds; `ground` values index into it. Always all thirteen, even if unused. (The game's own file lists just the ones each map uses, in any order; both read the same.) |
| `ground` | integer[] (`width*height`) | Ground per tile. |
| `objectLegend` | string[] | Objects; `objects` values index into it. Index 0 (`""`) means nothing. Always the whole list below, `""` to `locked_door` (71 entries). |
| `objects` | integer[] (`width*height`) | What stands on each tile. |
| `zoneLegend` | string[] | Zone keys; `zones` values index into it. Always all four. |
| `zones` | integer[] (`width*height`) \| `null` | Overworld: zone per tile. Dungeons: `null` (use `zone`). |
| `places` | array | Typed places (below), spawn point first, then links, bosses, monster spawns, braziers, buildings, townspeople, forts, the merchant's spot, landmarks, levers and locks. |

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
| `sand` | yes (the desert) |
| `mud` | yes (the swamp) |
| `bog` | no: bog water |
| `snow` | yes (the mountains) |
| `stone` | yes: bare rock and gravel |
| `ice` | yes |

The last six are the new lands'. To the game, sand, mud, snow, gravel and ice are open ground
just like grass, and bog is water; they only change how a tile looks. Where two grounds meet, one
creeps over the other's edge (snow over grass, grass over sand, sand over mud, any of them over
gravel, paths and floors), bogs get murky shores, and wild plants follow the ground: dry grass in
the desert, reeds in the swamp, little plants in the snow, lily pads on the bog. A tree on snow is
drawn as a snowy pine (a yew as a snowy yew) and a boulder as a snowy rock. In World Builder they
are tiles 45 to 50, **Sand**, **Mud**, **Bog water**, **Snow**, **Bare rock / gravel** and
**Ice**, under **New lands** in the ground palette of an RPG-DC map.

Tiles painted with World Builder's general palette export as the closest game ground (water
tiles as `water`, dungeon floors as `crypt_floor`, other walkable land as `grass`, …); the check
warns when a map has any.

### Objects

Any object blocks walking, except the `thicket`, which players push through; a `gate` or
`locked_door` opens only for the players who open it (monsters never pass one). Stations, fishing
spots, herbs, altars, waystones, caches, levers, doors, stairs, the grate and the crypt entrance
are used from a neighbouring tile (any of the 8 around it).

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
| 20–24 | `herb_sunleaf`, `herb_silverweed`, `herb_thornberry`, `herb_nightshade`, `herb_emberbloom` | Herb patches. Once an overworld has any, the game uses just these and stops scattering its own. They grow on grass, in the Frontier (sunleaf, silverweed), the Wilderness (thornberry, nightshade) and the Deep (emberbloom). |
| 25 | `door` | A building's door (in its south or east wall), or the way out of an inside. Needs a `link`. |
| 26 | `sewer_grate` | A way down, like stairs: needs a `link` to a map with stairs up leading back. |
| 27–29 | `alchemy_table`, `sewing_table`, `fletching_bench` | Workshop stations. |
| 30–36 | `counter`, `bookshelf`, `table`, `bed`, `barrel`, `crate`, `lectern` | Furniture. Players talk to townspeople across a `counter`. Indoors, a `bookshelf` stands in the line of the wall. |
| 37–43 | `well`, `lamp_post`, `market_stall`, `flower_bed`, `bench`, `signpost`, `notice_board` | Things in the streets (indoors too, if you like). Tapping the `notice_board` in the game shows tips for new players. |
| 44–47 | `gold_rock`, `mithril_rock`, `adamant_rock`, `runite_rock` | The rarer ores (Mining 40, 50, 65, 80). The game has gold and mithril in the caverns' first two floors, adamant in the Wyrm's Lair, and runite out in the Deep. |
| 48 | `essence_rock` | Rune essence for Runecrafting (Mining 1). Never runs out, and holds no gems. |
| 49–55 | `air_altar`, `mind_altar`, `water_altar`, `earth_altar`, `fire_altar`, `chaos_altar`, `law_altar` | Runecrafting altars, used from any of the 8 tiles around them: tap one with essence to bind it all into that rune. The game has air, mind, water and earth in the Frontier, fire and chaos in the Wilderness, law in the Deep. |
| 56, 57 | `cactus`, `dead_tree` | The new lands' scenery: the desert's cacti and the swamp's dead trees. In the way like boulders. |
| 58 | `yew` | A tree you can chop (Woodcutting 45), in the mountains. |
| 59, 60 | `fishing_eel`, `fishing_lobster` | Fishing spots: eels in the swamp, lobsters off the coast. |
| 61–63 | `herb_duneflower`, `herb_bogmyrtle`, `herb_frostcap` | The new lands' herb patches, each on its own land's ground anywhere out of town: duneflower on sand, bog myrtle in the mud, frostcap on snow. |
| 64 | `waystone` | Fast travel: a standing stone with glowing runes, used from any of the 8 tiles around it to travel to the waystone of any landmark the player has found. On the overworld only, inside a `landmark` place (below), one to a landmark, and not in the Deep. Free in town and the Frontier; travelling to one in the Wilderness costs coins. |
| 65 | `cache` | A secret: a hidden cache under a cairn of stones, used from any of the 8 tiles around it like a station. Each player can search each cache once, for coins and something useful, more the further out it is (by its zone). On any map: the overworld (off the paths, in hidden glades), dungeon floors and insides. The game draws it as a cairn (the `cairn` frame of the world, dungeon, cave or frost sheet), and its minimap as the ground under it. |
| 66 | `thicket` | A secret: a thicket that looks like the trees round it (the game draws it as the first tree west, north, east or south of it, a shade darker), but which players walk through: the way into a hidden glade. The one object that doesn't block walking: its cell is walkable whatever the ground under it. |
| 67 | `ruin` | Old stonework, the walls of a ruined chapel: in the way like a boulder, and joined up like the fence (towards a ruin to the north and to the west, or a lone pillar). |
| 68 | `gate` | A dungeon puzzle: an iron portcullis, shut until every lever wired to it (by `lever` places) is pulled. It then stays open for whoever pulled them, and their party on that floor, until they leave the floor; for everyone else it's shut until they pull the levers too. Monsters never pass it. Every gate needs a lever. |
| 69 | `lever` | A dungeon puzzle: pulled from any of the 8 tiles around it, like a station, to open the gates it's wired to (by `lever` places). Every lever is wired to a gate. |
| 70 | `locked_door` | A dungeon puzzle: an iron-bound door, shut until a player brings its key (named by a `lock` place). The key is used up, and the door stays unlocked for that player for good (saved). Every locked door needs a lock. |

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
| `building` | `x`, `y`, `w`, `h`, `style`, `sign`, `roof`, `walls` (the last three optional) | A house on the overworld: `w`×`h` tiles of wall with its north-west corner at (`x`, `y`), in `style` `timber`, `stone` or `tower`; `sign` is its name. Houses are 3 to 8 tiles a side, towers square and 3 to 5 (the sizes the game has art for). Its walls block walking, except where an object (its door) stands. `roof` and `walls` colour it (below); without them it keeps its style's own colours. |
| `fort` | `x`, `y`, `id`, `name` | A guild fort, on its banner's tile (the overworld, in the Deep). Guilds take it by standing in its yard, 4 tiles round the banner; its chest stands just east of the banner, and its holders open it once a day. `id` is lower-case letters, digits and `_` (holders are saved by it, so keep it once players use the fort); `name` reads in a sentence ("has taken the Deep Keep"). The game draws the banner and chest; the palisade is fences round the yard, 5 tiles out, with a 3-tile gate in the middle of each side. |
| `merchant` | `x`, `y` | Where the travelling merchant stands when she visits town: one, on the overworld, on open Safe ground players can walk up to. |
| `landmark` | `x`, `y`, `id`, `name`, `radius` (optional) | A named place on the overworld, on its middle: the town, a lake, the crypt, a keep. Walking within `radius` tiles of (`x`, `y`) (a straight line: a circle, not a square) shows its `name`, and the first time counts as finding it. `id` is lower-case letters, digits and `_`, 2 to 31 of them, starting with a letter (players' finds are saved by it, so keep it once players have found the landmark), and unique; `name` is 1 to 40 letters ("Moira's Lake", "the Oasis"); `radius` is a whole number from 2 to 40, 10 when it's left out (World Builder always writes it). Its waystone is the `waystone` object that stands in it: within its radius, or, where landmarks overlap, in the one with the nearest middle. |
| `lever` | `x`, `y`, `toX`, `toY` | On a `lever` object: wires it to the `gate` at (`toX`, `toY`) on the same map. A gate opens (for whoever pulled them, and their party on that floor) once every lever wired to it is pulled. One place per lever and gate: a lever wired to two gates has two places, and a gate with two levers needs both pulled. |
| `lock` | `x`, `y`, `key` | On a `locked_door` object: `key` is the item that unlocks it, by the game's item id (`frost_key`). The key is used up and the door stays unlocked for that player. One lock to a door; the game refuses a key that isn't one of its items. |
| `npc` | `x`, `y`, `role` | A townsperson standing there all day: `banker`, a shopkeeper (`general`, `smith`, `mage`, `alchemist`, `tailor`, `fletcher`, `inn`), or someone who just talks: `mayor` (tips for new players), `captain` (the laws, and a warning for criminals), `villager` (gossip), and outside town `hermit` (Old Ansel), `fisher` (Fisher Moira), `farmer` (Farmer Giles), `trapper` (Rook the trapper), `miner` (Dobbs, in the caverns) and `miller` (Hob the miller, in the windmill); or `slayer`, the Slayer master, who gives Slayer tasks. The talkers give quests: villagers by the map they're in (`home1` to `home4`, so keep those map ids), the rest by their role (so keep one of each). A door's sign shows the trade of the first townsperson inside (talkers have no sign). |

Building colours. The game draws the roof, and the walls (the plaster of a timber house, the stone of
a stone house or tower), again over the house, multiplied by the colour:

| `roof` | `brown` `#8c5e3d`, `red` `#b8563c`, `slate` `#4f5662`, `blue` `#4c56a0`, `green` `#5f7a4a`, `dark` `#3c3836` |
|---|---|
| **`walls`** | `cream` `#eedebd`, `white` `#fbf8f2`, `ochre` `#e8c27e`, `rose` `#ecc0b0`, `sage` `#cfd8b8`, `grey` `#ccc2b0`, `sand` `#e6cfa0`, `dark` `#8e8a84`, `brick` `#c08870` |

Monster kinds, with their normal range in tiles: `rat` 6, `goblin` 7, `wolf` 8, `bandit` 8,
`troll` 7, `skeleton` 8, `giant_spider` 8, `ghoul` 8, `bone_king` 7, `sewer_rat` 6, `slime` 5,
`beetle` 7, `rat_king` 6, `fire_ant` 7, `hobgoblin` 8, `fire_wyvern` 8, `cinder_wyrm` 7; the new
lands' `scarab` 7, `mummy` 7 and `antlion` 6 (the desert), `bog_goblin` 7, `drowned` 7 and
`swamp_wyvern` 8 (the swamp), `frost_ant` 7, `yeti` 8 and `ice_wyvern` 8 (the mountains); the
Frozen Peaks' `ice_warden` 6 (it carries the key to the peaks' locked door), `frost_wraith` 8 (drawn
see-through) and `frost_giant` 7 (their boss); and the
Slayer monsters, which only players with the Slayer level can hurt: `cave_crawler` 6 (Slayer 10),
`banshee` 7 (25), `basilisk` 7 (45), `gargoyle` 6 (65). The game uses the normal range for a
`monster_spawn` that has no `radius`.
Town guards and townspeople aren't monster kinds here: townspeople come from `npc` places, and the
game posts guards itself, at each gate of the Safe zone: every walkable Safe tile beside a walkable
tile outside it (north, south, east or west) is a gate, its guard stands one step further in (if
that's open Safe ground), and there's only one guard within 2 tiles. Criminals and murderers who
die come back 3 tiles out of the first gate found (scanning rows from the top), or just outside it.
Indoors, the game keeps a guard with each townsperson worth robbing (the mayor, in the Town Hall),
since the town's guards can't come in: two steps from them, on the first open floor tile scanning
rows from the north-west, where no other townsperson stands. World Builder shows the guards (💂)
and that spot (⛓️), so moving a gate (or the mayor) shows where the guard goes.

Maps saved before radius 0 meant "stays put" (settings without `rpgdcPlaces: 2`) used 0 for the
normal range; World Builder writes the normal range into those spawns when the project is opened.

The Duel Arena is the map with id `arena`: duellists fight in its pits, which the game finds by
itself: every place you can stand there that can't be walked to from the arena's door is part of a
pit (fence or wall a space off), and two duellists start in its opposite corners.

Landmarks and waystones. Most landmarks outside the Deep have a waystone, a `waystone` object
standing inside them; tapping one shows every landmark the player has found that has one, to
travel to. The game uses the first waystone in each landmark (scanning rows from the top) and
ignores waystones in the Deep. In World Builder, a landmark is a **Landmark** place (label: its
name; a faint circle shows its radius, a stronger one when it's selected), and the waystone is
under **Fast travel** in the object palette.

Secrets and ruins. A `cache` hides under a cairn of stones off the paths, in hidden glades and down
in the places outside town; a hidden glade is a ring of trees round a cache, with a `thicket`
(two, side by side, in the game's map) as the way in. In World Builder both are under **Secrets**
in the object palette: a cache is drawn as a cairn, and a thicket as a tree with a dashed outline
(with the game's art, as the game draws it, with a dashed ring round its foot), so it can be told
from the trees.
Ruined walls are under **Ruins**. A tower whose sign says "Mill" (any case) is a windmill: the game
turns four sails on its east wall, which World Builder's art preview shows too.

Dungeon puzzles. The Frozen Peaks (dungeon floors with the `frost` look) have the first: gates
opened by levers, and a locked door. In World Builder the `gate`, `lever` and `locked_door` are
under **Dungeon puzzles** in the object palette, drawn with the game's art (the dungeon sheet's
`gate-x` or `gate-y`, `lockdoor-x` or `lockdoor-y` and `lever` frames, shut and not pulled, in
dungeons of any look and in insides; `-x` when the tile west or east of it is a wall, as the game
picks them), as a portcullis, an iron-bound door and a lever on a block without it, and in 3D.
The game draws none of them on the overworld. A **Lever → gate** place goes on a lever: a new one
is wired to the nearest gate, **🎯 Pick the gate** then a tap on a gate rewires it, and while it's
selected a line joins the lever to its gate (and dashed lines the gate's other levers); tapping a
gate shows its levers' lines too. A **Lock** place goes on a locked door and names its key.

Links come in pairs: going down from map A to B (a link on A's entrance, stairs down or grate) is
matched by a link on one of B's stairs up back to A, and a door into B by a door on B back to A. Going down, the arrival tile is normally
just east (x + 1) of the stairs up; going up, a walkable tile beside the stairs down.

## The checks

**Check for game** reports each problem with its map and tile (tap one to jump there):

- exactly one spawn point, on the overworld, on walkable ground in the Safe zone;
- every station, altar, waystone, cache, lever and fishing spot has a walkable neighbour reachable on foot from the spawn point
  (on dungeon floors: from where links arrive), moving in 8 directions without cutting corners
  past blocked tiles (thickets are walked through, so a glade behind one counts, and gates and
  locked doors count as open, since players open them);
- every entrance, staircase, door and grate has a link to an existing map and a walkable target
  tile, and links come in pairs;
- no stairs on a dungeon floor with a wall just east, south or south-east of them: the game draws
  stairs on the floor, so that wall hides them (the game's own tests refuse it);
- every building is a size there's art for, in colours the game has, and has a door in its south
  or east wall (not a corner); every townsperson stands on open floor players can reach, or talk to across a counter;
- no monster spawn or boss in the Safe zone or on a tile you can't walk on;
- every overworld tile has a zone, and every dungeon floor and inside has its zone;
- there's one overworld, square and 128 to 1024 tiles a side; dungeon floors are 16 to 64 tiles a
  side, insides 4 to 32;
- herb patches (warnings): out of their zones or off their ground, unreachable, next to a blocked
  tile, or within 2 tiles of a tree (which hides them in the game); and a reminder that the game
  then stops scattering its own;
- tiles using ground or objects the game doesn't have (a warning);
- a look (theme) only on dungeon floors, and one of `crypt`, `sewer`, `cave` or `frost`;
- a Safe zone with no gate, so no town guards (a warning);
- altars and essence rocks (warnings): an altar in the Safe zone, or either within 2 tiles of a
  tree (or a thicket, which the game draws as one), which can hide it and take the taps meant for
  it; and runite outside the Deep.
- guild forts: on the overworld, with an id and a name, their whole yard in the Deep, and the
  banner and chest on open ground reachable from the spawn point; a gap in the palisade is a warning;
- the travelling merchant: one spot, on the overworld, on open Safe ground players can reach;
- the Duel Arena (warnings): no pit, or a pit with room for only one;
- landmarks: on the overworld, with an id of lower-case letters, digits and `_` used by no other
  landmark, a name of 1 to 40 letters, and a radius from 2 to 40 (the game refuses a file without);
- waystones: on the overworld, each in a landmark (within its radius of the middle; where several
  hold it, the one with the nearest middle), at most one in a landmark, and not in the Deep;
- thickets (a warning): one on water or a wall, which players could then walk across;
- gates, levers and locked doors: every lever place on a lever and wired to a gate on its map (not
  twice to the same one), every gate wired to a lever, every lever object to a gate, every locked
  door with a lock, and every lock on a locked door (one to a door) with a key: an item id (the
  game refuses a key that isn't one of its items; a key World Builder doesn't know, which is any
  but `frost_key`, is a warning).

## Opening the game's maps

**Open…** also takes an RPG-DC maps file (the game's own `shared/maps/rpg-dc.maps.json`, or an
export from here) and makes a project of it: one map per game map, places and all. **⟳ Get the
game's maps** in the Map panel does the same with the maps the live game is playing
(`https://rpg-dc.onrender.com/maps/rpg-dc.maps.json`). Exporting the project again gives back the
same maps. Use it whenever maps were changed on the game's side, so the next export doesn't put
old maps back. Either replaces the project in this browser; the project keeps the id
`rpgdc-world`, so saving it to the cloud replaces the RPG-DC project there.

The game's 768-tile overworld is a big map: about 18 MB as a project file (well under 1 MB
gzipped, which is what a cloud save stores) and 590,000 tiles. World Builder draws it zoomed out
as an overview (a pixel per tile) and cell by cell, or with the game's art, only around what's on
screen; painting redraws just around the brush. It's autosaved in the browser's database
(IndexedDB) like any project. It works on a phone, but it's best edited on a computer.

## Opening projects made from the game's first maps

Projects made by RPG-DC's `tools/world-builder/export-map.ts` (stand-in terrain plus the game's
tile ids in `layers.rpgdcTile`) are converted when opened: ground, objects and zones are filled
in from the game tiles (or from the terrain, where it was edited), markers become typed places,
and the stairs become paired links. The `rpgdcTile` layer is then removed, so a project is never
converted twice.
