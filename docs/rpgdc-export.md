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
  "objectLegend": ["", "tree", "oak", "willow", "boulder", "fence", "copper_rock", "tin_rock", "iron_rock", "bank", "shop", "furnace", "anvil", "cooking_fire", "fishing_shrimp", "fishing_trout", "fishing_salmon", "crypt_entrance", "stairs_down", "stairs_up", "herb_sunleaf", "herb_silverweed", "herb_thornberry", "herb_nightshade", "herb_emberbloom", "door", "sewer_grate", "alchemy_table", "sewing_table", "fletching_bench", "counter", "bookshelf", "table", "bed", "barrel", "crate", "lectern", "well", "lamp_post", "market_stall", "flower_bed", "bench", "signpost", "notice_board", "gold_rock", "mithril_rock", "adamant_rock", "runite_rock", "essence_rock", "air_altar", "mind_altar", "water_altar", "earth_altar", "fire_altar", "chaos_altar", "law_altar", "cactus", "dead_tree", "yew", "fishing_eel", "fishing_lobster", "herb_duneflower", "herb_bogmyrtle", "herb_frostcap", "waystone", "cache", "thicket", "ruin", "gate", "lever", "locked_door", "boat", "palm", "wreck", "fishing_swordfish", "patch_allotment", "patch_herb", "patch_tree", "spinning_wheel", "millstones", "sawbench", "limestone_rock", "guild_chest"],
  "objects": [0, 4, 0, ...],
  "zoneLegend": ["safe", "frontier", "wilderness", "deep"],
  "zones": [0, 1, 1, ...],
  "places": [
    { "type": "spawn_point", "x": 384, "y": 385 },
    { "type": "monster_spawn", "x": 171, "y": 115, "kind": "yeti", "count": 1, "radius": 8 },
    { "type": "link", "x": 284, "y": 284, "toMap": "crypt1", "toX": 19, "toY": 7 },
    { "type": "building", "x": 375, "y": 376, "w": 6, "h": 5, "style": "stone", "sign": "Bank", "roof": "slate", "walls": "grey" },
    { "type": "landmark", "x": 386, "y": 456, "id": "fisher_lake", "name": "Moira's Lake", "radius": 16 },
    { "type": "ferry", "x": 36, "y": 360, "toX": 116, "toY": 624, "fare": 100, "name": "Wrecker's Isle" },
    { "type": "npc", "x": 349, "y": 404, "role": "seeds" },
    { "type": "plot", "x": 370, "y": 344, "id": "plot11", "size": 12 }
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
| `objectLegend` | string[] | Objects; `objects` values index into it. Index 0 (`""`) means nothing. Always the whole list below, `""` to `limestone_rock` (82 entries). |
| `objects` | integer[] (`width*height`) | What stands on each tile. |
| `zoneLegend` | string[] | Zone keys; `zones` values index into it. Always all four. |
| `zones` | integer[] (`width*height`) \| `null` | Overworld: zone per tile. Dungeons: `null` (use `zone`). |
| `places` | array | Typed places (below), spawn point first, then links, bosses, monster spawns, braziers, buildings, townspeople, forts, the merchant's spot, landmarks, levers, locks, ferries and plots. |

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

Any object blocks walking, except the `thicket`, which players push through, and Farming's
patches (`patch_allotment`, `patch_herb`, `patch_tree`), which lie flat on the ground: a patch's
tile walks like the ground under it. A `gate` or `locked_door` opens only for the players who open
it (monsters never pass one). Stations (the guild chest too), workbenches (the sawbench too), fishing spots, herbs,
altars, waystones, boats, caches, levers, Farming's patches, doors, stairs, the grate and the crypt
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
| 20–24 | `herb_sunleaf`, `herb_silverweed`, `herb_thornberry`, `herb_nightshade`, `herb_emberbloom` | Wild herbs. Once an overworld has any, the game uses just these and stops scattering its own. They grow on grass, in the Frontier (sunleaf, silverweed), the Wilderness (thornberry, nightshade) and the Deep (emberbloom). |
| 25 | `door` | A building's door (in its south or east wall), or the way out of an inside. Needs a `link`. |
| 26 | `sewer_grate` | A way down, like stairs: needs a `link` to a map with stairs up leading back. |
| 27–29 | `alchemy_table`, `sewing_table`, `fletching_bench` | Workshop stations. |
| 30–36 | `counter`, `bookshelf`, `table`, `bed`, `barrel`, `crate`, `lectern` | Furniture. Players talk to townspeople across a `counter`. Indoors, a `bookshelf` stands in the line of the wall. |
| 37–43 | `well`, `lamp_post`, `market_stall`, `flower_bed`, `bench`, `signpost`, `notice_board` | Things in the streets (indoors too, if you like). Tapping the `notice_board` in the game shows tips for new players. |
| 44–47 | `gold_rock`, `mithril_rock`, `adamant_rock`, `runite_rock` | The rarer ores (Mining 40, 50, 65, 80). The game has gold and mithril in the caverns' first two floors, adamant in the Wyrm's Lair, and runite out in the Deep. |
| 48 | `essence_rock` | Rune essence for Runecrafting (Mining 1). Never runs out, and holds no gems. The game has four in the Old Quarry west of town, by the air altar, and a cluster of three a short walk (30 to 40 tiles) from each other altar, in its zone. |
| 49–55 | `air_altar`, `mind_altar`, `water_altar`, `earth_altar`, `fire_altar`, `chaos_altar`, `law_altar` | Runecrafting altars, used from any of the 8 tiles around them: tap one with essence to bind it all into that rune. The game has air (in the Old Quarry), mind, water and earth in the Frontier, fire and chaos in the Wilderness, law in the Deep. |
| 56, 57 | `cactus`, `dead_tree` | The new lands' scenery: the desert's cacti and the swamp's dead trees. In the way like boulders. |
| 58 | `yew` | A tree you can chop (Woodcutting 45), in the mountains. |
| 59, 60 | `fishing_eel`, `fishing_lobster` | Fishing spots: eels in the swamp, lobsters off the coast. |
| 61–63 | `herb_duneflower`, `herb_bogmyrtle`, `herb_frostcap` | The new lands' wild herbs, each on its own land's ground anywhere out of town: duneflower on sand, bog myrtle in the mud, frostcap on snow. |
| 64 | `waystone` | Fast travel: a standing stone with glowing runes, used from any of the 8 tiles around it to travel to the waystone of any landmark the player has found. On the overworld only, inside a `landmark` place (below), one to a landmark, and not in the Deep. Free in town and the Frontier; travelling to one in the Wilderness costs coins. |
| 65 | `cache` | A secret: a hidden cache under a cairn of stones, used from any of the 8 tiles around it like a station. Each player can search each cache once, for coins and something useful, more the further out it is (by its zone). On any map: the overworld (off the paths, in hidden glades), dungeon floors and insides. The game draws it as a cairn (the `cairn` frame of the world, dungeon, cave or frost sheet), and its minimap as the ground under it. |
| 66 | `thicket` | A secret: a thicket that looks like the trees round it (the game draws it as the first tree west, north, east or south of it, a shade darker), but which players walk through: the way into a hidden glade. The one object that doesn't block walking: its cell is walkable whatever the ground under it. |
| 67 | `ruin` | Old stonework, the walls of a ruined chapel: in the way like a boulder, and joined up like the fence (towards a ruin to the north and to the west, or a lone pillar). |
| 68 | `gate` | A dungeon puzzle: an iron portcullis, shut until every lever wired to it (by `lever` places) is pulled. It then stays open for whoever pulled them, and their party on that floor, until they leave the floor; for everyone else it's shut until they pull the levers too. Monsters never pass it. Every gate needs a lever. |
| 69 | `lever` | A dungeon puzzle: pulled from any of the 8 tiles around it, like a station, to open the gates it's wired to (by `lever` places). Every lever is wired to a gate. |
| 70 | `locked_door` | A dungeon puzzle: an iron-bound door, shut until a player brings its key (named by a `lock` place). The key is used up, and the door stays unlocked for that player for good (saved). Every locked door needs a lock. |
| 71 | `boat` | A boat moored by a jetty, on the water: tapped from any of the 8 tiles around it, like a station, to sail where its `ferry` place (below) says, for its fare. Not walkable. Every boat needs a ferry. The game draws it lying along its jetty: `boat-y` (along y) when the tile west or east of it can be walked on, else `boat-x`. |
| 72, 73 | `palm`, `wreck` | Wrecker's Isle's scenery: palms, and wrecked hulls on its beaches. In the way like boulders. The game draws one of three palms (`palm/0` to `palm/2`) and two wrecks, picked by the tile. |
| 74 | `fishing_swordfish` | A fishing spot (on water): swordfish (Fishing 50), in the deep water off Wrecker's Isle. |
| 75–77 | `patch_allotment`, `patch_herb`, `patch_tree` | Farming's patches: beds of tilled soil each player grows their own crops in (vegetables, wheat and flax in an allotment, herbs in a herb patch, trees in a tree patch), tended from any of the 8 tiles around them. They have no tile of their own: players walk over them as over the ground under them (the game's are on the mud of the fenced field at Giles's Farm), so placing one never changes the way anywhere, and a building's walls don't cover one. A `patch_herb` isn't a wild herb: it doesn't count as one of the herbs that stop the game scattering its own. The game draws them flat on the ground, from the world sheet's `patch-allotment`, `patch-herb` and `patch-tree` frames. |
| 78, 79 | `spinning_wheel`, `millstones` | Farming's workbenches, used from any of the 8 tiles around them like the other workbenches: the spinning wheel spins flax into cloth (the game has one in the farmhouse and one at the Tailor's), the millstones grind wheat into flour (in the windmill). Not walkable. Drawn from the indoor sheet's `spinning_wheel` and `millstones` frames. |
| 80 | `sawbench` | Construction's workbench, used from any of the 8 tiles around it like the other workbenches: players saw logs into planks and limestone into stone blocks there, to build their houses with (the game's is in the carpenter's yard in town, east of the main street). Not walkable. Drawn from the indoor sheet's `sawbench` frame. |
| 81 | `limestone_rock` | Limestone, mined like ore (Mining 20) for the stone blocks houses are built of: the game's are in the Old Quarry. In the way like the ore rocks. Drawn from the world sheet's `ore-limestone` frame. |
| 82 | `guild_chest` | A guild chest, used from any of the 8 tiles around it like a bank chest: it opens the bank of the guild the player's in (anyone in the guild puts things in, its leader and officers take them out). The game has one beside the bank chest in each bank, in town and in Gullhaven; it makes a bank chest's tile, so swapping one for the other doesn't change a map's layout. Not walkable. Drawn from the indoor sheet's `guild_chest` frame (the guild chest in a guild's hall). |

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
| `monster_spawn` | `x`, `y`, `kind`, `count` (≥ 1), `radius` (tiles, ≥ 0; optional) | `count` monsters of `kind` live here. They roam up to `radius` tiles from home (chasing that far, idling within half of it). `radius` 0: they stay on their tile, and only fight players who come next to them. Without `radius` they roam their monster's normal range (below): World Builder shows that, and writes a spawn opened without one without one again, until its radius is changed. A new spawn starts at its monster's normal range. |
| `boss` | `x`, `y`, `kind` | A boss. |
| `brazier` | `x`, `y` | A light (crypt floors). |
| `link` | `x`, `y`, `toMap`, `toX`, `toY` | On a `crypt_entrance`, `stairs_down`, `stairs_up`, `door` or `sewer_grate` tile. Using it moves the player to tile (`toX`, `toY`) of map `toMap`, which is walkable. |
| `building` | `x`, `y`, `w`, `h`, `style`, `sign`, `roof`, `walls` (the last three optional) | A house on the overworld: `w`×`h` tiles of wall with its north-west corner at (`x`, `y`), in `style` `timber`, `stone` or `tower`; `sign` is its name. Houses are 3 to 8 tiles a side, towers square and 3 to 5 (the sizes the game has art for). Its walls block walking, except where an object (its door) stands. `roof` and `walls` colour it (below); without them it keeps its style's own colours. |
| `fort` | `x`, `y`, `id`, `name` | A guild fort, on its banner's tile (the overworld, in the Deep). Guilds take it by standing in its yard, 4 tiles round the banner; its chest stands just east of the banner, and its holders open it once a day. `id` is lower-case letters, digits and `_` (holders are saved by it, so keep it once players use the fort); `name` reads in a sentence ("has taken the Deep Keep"). The game draws the banner and chest; the palisade is fences round the yard, 5 tiles out, with a 3-tile gate in the middle of each side. |
| `merchant` | `x`, `y` | Where the travelling merchant stands when she visits town: one, on the overworld, on open Safe ground players can walk up to. |
| `landmark` | `x`, `y`, `id`, `name`, `radius` (optional) | A named place on the overworld, on its middle: the town, a lake, the crypt, a keep. Walking within `radius` tiles of (`x`, `y`) (a straight line: a circle, not a square) shows its `name`, and the first time counts as finding it. `id` is lower-case letters, digits and `_`, 2 to 31 of them, starting with a letter (players' finds are saved by it, so keep it once players have found the landmark), and unique; `name` is 1 to 40 letters ("Moira's Lake", "the Oasis"); `radius` is a whole number from 2 to 40, 10 when it's left out (World Builder always writes it). Its waystone is the `waystone` object that stands in it: within its radius, or, where landmarks overlap, in the one with the nearest middle. |
| `lever` | `x`, `y`, `toX`, `toY` | On a `lever` object: wires it to the `gate` at (`toX`, `toY`) on the same map. A gate opens (for whoever pulled them, and their party on that floor) once every lever wired to it is pulled. One place per lever and gate: a lever wired to two gates has two places, and a gate with two levers needs both pulled. |
| `lock` | `x`, `y`, `key` | On a `locked_door` object: `key` is the item that unlocks it, by the game's item id (`frost_key`). The key is used up and the door stays unlocked for that player. One lock to a door; the game refuses a key that isn't one of its items. |
| `ferry` | `x`, `y`, `toX`, `toY`, `fare`, `name` | On a `boat` object: players beside the boat sail to tile (`toX`, `toY`) on the same map, which is walkable, for `fare` coins (a whole number from 0 to 10000; 0 is free). `name` is where it goes, 1 to 40 letters ("Wrecker's Isle"), shown to players ("the ferry to Wrecker's Isle"). One ferry to a boat: the way back is another boat by the landing, with a ferry of its own (the game's two: Gullhaven to Wrecker's Isle for 100 coins, and back for nothing). The game won't load a ferry whose landing is off the map, whose fare or name isn't one of those, or a second ferry from one boat. |
| `plot` | `x`, `y`, `id`, `size` | A plot of land players buy from the land agent and build a house on: `size`×`size` tiles with its north-west corner at (`x`, `y`). `size` is 12, or 20 for a large one (room for a guild's hall). `id` is lower-case letters, digits and `_`, 2 to 31 of them, starting with a letter (owners are saved by it, so keep it once players own the plot), and unique. On the overworld only, out of the Safe zone, and all open ground: every tile walkable and reachable from the spawn point with nothing standing on it (no object at all), no link (door or stairs), townsperson, monster spawn, fort or the merchant's spot inside it, and not overlapping another plot. The game draws a faint outline round it on the ground and a signpost (the world sheet's `signpost`) in the middle of its south edge, its front, at (`x` + `size`/2 rounded down, `y` + `size` − 1); the house goes up at the back, its door facing the garden. The houses players build aren't in the map file (the game keeps them, and their walls block walking while it runs). The game won't load a plot with another size, a bad or repeated id, or one that runs off the map. |
| `npc` | `x`, `y`, `role` | A townsperson standing there all day: `banker`, a shopkeeper (`general`, `smith`, `mage`, `alchemist`, `tailor`, `fletcher`, `inn`, and `seeds`: Martha, who sells seeds and compost by the field at Giles's Farm), `land_agent` (Pemberton, who sells plots of land and keeps the Land register: the game has one in town by the bank and one in Gullhaven), `stablemaster` (Stablemaster Brann, who sells horses, in the stable east of town), `paddock_horse` (a horse in his paddock, tapped for a pat: the game draws it with its `mon/horse` art, not in clothes), or someone who just talks: `mayor` (tips for new players), `captain` (the laws, and a warning for criminals), `villager` (gossip), and outside town `hermit` (Old Ansel), `fisher` (Fisher Moira), `farmer` (Farmer Giles), `trapper` (Rook the trapper), `miner` (Dobbs, in the caverns) and `miller` (Hob the miller, in the windmill), and by the sea `harbourmaster` (Harbourmaster Bligh, in Gullhaven by the ferry) and `castaway` (Marooned Meg, on Wrecker's Isle); or `slayer`, the Slayer master, who gives Slayer tasks. The talkers give quests: villagers by the map they're in (`home1` to `home4`, so keep those map ids), the rest by their role (so keep one of each); the harbourmaster and the castaway just talk, and villagers in Gullhaven's cottages (maps whose id starts `port_`) talk about the sea. A door's sign shows the trade of the first townsperson inside (talkers have no sign). |

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
see-through) and `frost_giant` 7 (their boss); Wrecker's Isle's `giant_crab` 5, `pirate` 8 and
`pirate_captain` 7 (Captain Redhook, a boss placed with a `monster_spawn`); and the
Slayer monsters, which only players with the Slayer level can hurt: `cave_crawler` 6 (Slayer 10),
`banshee` 7 (25), `basilisk` 7 (45), `gargoyle` 6 (65). The game uses the normal range for a
`monster_spawn` that has no `radius`.
Town guards and townspeople aren't monster kinds here: townspeople come from `npc` places, and the
game posts guards itself, at each gate of the Safe zone: every walkable Safe tile beside a walkable
tile outside it (north, south, east or west) is a gate, its guard stands one step further in (if
that's open Safe ground), and there's only one guard within 2 tiles (so Gullhaven, a second Safe
town, has its own). Criminals and murderers who die come back 3 tiles out of a gate, or just
outside it: of those, the one nearest the spawn point (the home town's, not Gullhaven's).
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
under **Travel** in the object palette.

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

The sea. Gullhaven, a fishing port on the overworld's west coast (a second Safe town, out in the
Wilderness), has a jetty with a `boat` at its end; its `ferry` place sails to Wrecker's Isle, an
island out at sea in the Wilderness, where a second boat sails back. The island has palms,
wrecks, swordfish off its shores, giant crabs, pirates and Captain Redhook, and the castaway's hut
(`isle_hut`); Gullhaven's bank, store, inn and cottages are insides (`port_bank`, `port_store`,
`port_inn`, `port_home1`, `port_home2`). In World Builder the boat is under **Travel** in the
object palette (with the waystone), palms and wrecks under **Nature** with the rocks and scenery,
and the swordfish with the fishing spots; the Grove brush scatters palms too. A **Ferry →
landing** place goes on a boat: a new one lands beside the nearest other boat (named after the
landmark it lands in), **🎯 Pick the landing** then a tap on a tile moves where it lands, and
while it's selected (or its landing is tapped) a dashed line shows its route; its label on the map
is "Ferry → " and where it goes. With the game's art, palms and wrecks are drawn from the world
sheet's `palm/*` and `wreck/*` frames (picked by tile, like cacti) and a boat as `boat-x` or
`boat-y`, as the game lays it; as their plain symbols on a game server without that art. In 3D:
a leaning palm, a broken hull, and a sailing boat lying along its jetty.

Farming. Giles's Farm has a fenced field (around (338, 402) to (348, 412) on the overworld) with six
allotments, four herb patches and two tree patches (`patch_allotment`, `patch_herb`, `patch_tree`)
on its mud, and Martha (`npc` role `seeds`), who sells seeds and compost, just outside its gate.
Each player has their own crops in every patch, so nobody fights over space. The windmill's inside
has the `millstones`, and the farmhouse and the Tailor's each a `spinning_wheel`. In World Builder
the patches are under **Farming** in the object palette (**Allotment**, **Herb patch**, **Tree
patch**), drawn as beds of tilled soil (with seedlings, a herb or a sapling to tell them apart), and
the spinning wheel and the millstones are with the workbenches under **Town**. With the game's art,
the patches are drawn flat on the ground from the world sheet's `patch-allotment`, `patch-herb` and
`patch-tree` frames, and the workbenches from the indoor sheet's `spinning_wheel` and `millstones`;
each as its plain symbol on a game server without that art. In 3D: a low bed with ridges and what
grows in it, a spinning wheel on its bench, and two millstones under a hopper.

Land and houses. The overworld has 36 plots of land (`plot` places `plot1` to `plot36`, eight of
them 20×20 and the rest 12×12) out of town in the Frontier, the Wilderness and the Deep, in clusters
by roads, water and landmarks; Pemberton the land agent (`npc` role `land_agent`) sells them, in
town by the bank and in Gullhaven. Players build their houses with Construction: they mine
`limestone_rock` in the Old Quarry and saw it into stone blocks, and logs into planks, at the
`sawbench` in the carpenter's yard in town (with a crate and a barrel). In World Builder a **Plot of
land** place goes on a plot's north-west corner and is labelled with its id; a new one gets an id
no plot on the map has yet (`plot37`), and its fields set its id and its size (12 or 20). Every
plot is outlined over its tiles (in the game's gold for a plot for sale), the selected one, or the
one under a tapped tile, stronger and lightly filled; drag the place with **Place** to move the
plot, and **Delete** it from its panel. The status bar names the plot under your finger, and its
sign. The sawbench is with the workbenches under **Town** in the object palette, and limestone
with the ore under **Nature** (the Ore brush scatters it too). With the game's art, each plot has
its signpost in the middle of its south edge, the sawbench is drawn from the indoor sheet's
`sawbench` frame and limestone from the world sheet's `ore-limestone`; each as its plain symbol on
a game server without that art. In 3D: a sawhorse with a log and a saw (marked, like the
workbenches), a low heap of pale slabs, and a plot's signpost (its marker sits on its north-west
corner, with its `id` and `size`).

Guild halls (Phase 14d) are made by the game on guilds' plots, not in the map file; but the guild
bank has a `guild_chest` in each bank, beside the bank chest (town's Bank at (9, 4), the Gullhaven
bank at (7, 4)). It's with the stations under **Town** in the object palette, drawn from the indoor
sheet's `guild_chest` frame (its plain symbol, a shield, on a game server without that art); in 3D,
a dark wooden chest with three gold bands, marked like the stations.

Horses. The stable stands east of town, just north of the east road: a timber house 6×4 at
(408, 375) with a brown roof, its door at (410, 378) leading into the `stable` inside (9×6, a plank
floor with hay in barrels and crates along its walls), where Stablemaster Brann (`npc` role
`stablemaster`) stands at (4, 2) and sells horses. A horse is a character's for good, not an item:
they whistle for it anywhere on the overworld and ride it. East of the stable is his paddock, fenced
round x 416 to 426, y 374 to 381, with a gap for its gate at (416, 378), and two horses in it
(`npc` role `paddock_horse`, at (420, 377) and (423, 379)) that players tap for a pat. In World
Builder both are townspeople (**Who**: Stablemaster, Paddock horse). With the game's art, Brann is
in a brown coat, buff breeches and tall dark riding boots, and a paddock horse is drawn with the
game's `mon/horse` art, side-on, not as a townsperson (a brown deer stands in on a game server
without the horse, as in the game).

Links come in pairs: going down from map A to B (a link on A's entrance, stairs down or grate) is
matched by a link on one of B's stairs up back to A, and a door into B by a door on B back to A. Going down, the arrival tile is normally
just east (x + 1) of the stairs up; going up, a walkable tile beside the stairs down.

## The checks

**Check for game** reports each problem with its map and tile (tap one to jump there):

- exactly one spawn point, on the overworld, on walkable ground in the Safe zone;
- every station and workbench (the guild chest, the spinning wheel, the millstones and the sawbench too), altar, waystone, boat,
  cache, lever, fishing spot and Farming patch has a walkable neighbour reachable on foot from the spawn point
  (on dungeon floors: from where links arrive), moving in 8 directions without cutting corners
  past blocked tiles (thickets are walked through, so a glade behind one counts, as are patches on
  walkable ground, and gates and
  locked doors count as open, since players open them); from a tile beside a boat, players sail
  to its ferry's landing, so an island counts as reached;
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
- wild herbs (warnings; not Farming's herb patches): out of their zones or off their ground, unreachable, next to a blocked
  tile, or within 2 tiles of a tree or a palm (which hides them in the game); and a reminder that the game
  then stops scattering its own;
- tiles using ground or objects the game doesn't have (a warning);
- a look (theme) only on dungeon floors, and one of `crypt`, `sewer`, `cave` or `frost`;
- a Safe zone with no gate, so no town guards (a warning);
- altars and essence rocks (warnings): an altar in the Safe zone, or either within 2 tiles of a
  tree (or a thicket, which the game draws as one, or a palm), which can hide it and take the taps
  meant for it; and runite outside the Deep.
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
  but `frost_key`, is a warning);
- ferries: every ferry place on a boat (one to a boat), landing on a tile of its map players can
  walk on, with a fare of 0 to 10000 whole coins and a name of 1 to 40 letters; and every boat
  with a ferry place;
- plots of land: on the overworld, with an id of lower-case letters, digits and `_` used by no
  other plot, a size of 12 or 20, and not running off the map (the game won't load them
  otherwise); and, as the game's checks, the first thing wrong with each, scanning its tiles from
  the north-west: a tile in the Safe zone, anything standing on a tile (any object, Farming's patches
  too), ground you can't walk on (a building's walls too), a tile that can't be reached from the
  spawn point, a link (door or stairs), townsperson, monster spawn, fort or the merchant's spot on
  it, or another plot overlapping it.

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
