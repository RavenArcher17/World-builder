/**
 * Things that stand on a cell, separate from the ground under it: trees, rocks, props, stations.
 * Stored per cell in `layers.object` (0 = nothing). Like tile ids, object ids are stable:
 * never renumber them, only append.
 */

/** How an object is drawn on the map. Small vector shapes stay crisp and fast for thousands of cells. */
export type ObjectShape = 'pine' | 'round' | 'willow' | 'boulder' | 'fence' | 'ore' | 'icon' | 'cairn' | 'thicket' | 'ruin' | 'gate' | 'lever' | 'lockdoor' | 'patch';

export interface ObjectDef {
  id: number;
  key: string;
  name: string;
  /** Main colour (canopy, rock, marker). */
  color: string;
  /** Emoji used in palettes, and on the map for `icon` shapes. */
  icon: string;
  shape: ObjectShape;
  /** Whether the object stops anyone walking onto its cell. */
  blocks: boolean;
  /** Used by standing next to it (a station, fishing spot or staircase) rather than on it. */
  useFromNeighbour: boolean;
  group: 'tree' | 'rock' | 'ore' | 'wall' | 'station' | 'fishing' | 'stairs' | 'herb' | 'door' | 'furniture' | 'street' | 'altar' | 'travel' | 'secret' | 'ruin' | 'puzzle' | 'farm';
}

const o = (
  id: number,
  key: string,
  name: string,
  color: string,
  icon: string,
  shape: ObjectShape,
  group: ObjectDef['group'],
  useFromNeighbour = false,
): ObjectDef => ({ id, key, name, color, icon, shape, blocks: true, useFromNeighbour, group });

export const OBJECTS: ObjectDef[] = [
  { id: 0, key: '', name: 'Nothing', color: 'transparent', icon: '∅', shape: 'icon', blocks: false, useFromNeighbour: false, group: 'rock' },
  o(1, 'tree', 'Tree', '#2f6b34', '🌲', 'pine', 'tree'),
  o(2, 'oak', 'Oak', '#3f8a35', '🌳', 'round', 'tree'),
  o(3, 'willow', 'Willow', '#7aa35a', '🌿', 'willow', 'tree'),
  o(4, 'boulder', 'Boulder', '#7d7770', '🪨', 'boulder', 'rock'),
  o(5, 'fence', 'Fence / town wall', '#6b4a2b', '🧱', 'fence', 'wall'),
  o(6, 'copper_rock', 'Copper rock', '#c8743a', '🟠', 'ore', 'ore'),
  o(7, 'tin_rock', 'Tin rock', '#b9c2c9', '⚪', 'ore', 'ore'),
  o(8, 'iron_rock', 'Iron rock', '#8a4b3c', '🟤', 'ore', 'ore'),
  o(9, 'bank', 'Bank', '#d8b13a', '🏦', 'icon', 'station', true),
  o(10, 'shop', 'Shop', '#c9643c', '🏪', 'icon', 'station', true),
  o(11, 'furnace', 'Furnace', '#b5482e', '🏭', 'icon', 'station', true),
  o(12, 'anvil', 'Anvil', '#5d6670', '⚒️', 'icon', 'station', true),
  o(13, 'cooking_fire', 'Cooking fire', '#e0752d', '🔥', 'icon', 'station', true),
  o(14, 'fishing_shrimp', 'Fishing spot: shrimp', '#f08a8a', '🦐', 'icon', 'fishing', true),
  o(15, 'fishing_trout', 'Fishing spot: trout', '#9ac46a', '🐟', 'icon', 'fishing', true),
  o(16, 'fishing_salmon', 'Fishing spot: salmon', '#f0a060', '🐠', 'icon', 'fishing', true),
  o(17, 'crypt_entrance', 'Crypt entrance', '#2a2230', '🕳️', 'icon', 'stairs', true),
  o(18, 'stairs_down', 'Stairs down', '#7a5c96', '⬇️', 'icon', 'stairs', true),
  o(19, 'stairs_up', 'Stairs up', '#4f7fae', '⬆️', 'icon', 'stairs', true),
  // Wild herbs, picked by hand from beside them.
  o(20, 'herb_sunleaf', 'Herb: sunleaf', '#c8e86a', '🌿', 'icon', 'herb', true),
  o(21, 'herb_silverweed', 'Herb: silverweed', '#c8d8e8', '🌾', 'icon', 'herb', true),
  o(22, 'herb_thornberry', 'Herb: thornberry', '#d86a5a', '🍓', 'icon', 'herb', true),
  o(23, 'herb_nightshade', 'Herb: nightshade', '#6a4a8a', '🍇', 'icon', 'herb', true),
  o(24, 'herb_emberbloom', 'Herb: emberbloom', '#e8843a', '🌺', 'icon', 'herb', true),
  // Town: doors into buildings, the way into the sewers, workshop benches and furniture.
  o(25, 'door', 'Door', '#8a5a2a', '🚪', 'icon', 'door', true),
  o(26, 'sewer_grate', 'Sewer grate', '#4a4a50', '🕳️', 'icon', 'stairs', true),
  o(27, 'alchemy_table', 'Alchemy table', '#5aa85a', '⚗️', 'icon', 'station', true),
  o(28, 'sewing_table', 'Sewing table', '#c04a7a', '🧵', 'icon', 'station', true),
  o(29, 'fletching_bench', 'Fletching bench', '#8a6a3a', '🏹', 'icon', 'station', true),
  o(30, 'counter', 'Counter', '#9a6a3a', '🟫', 'icon', 'furniture'),
  o(31, 'bookshelf', 'Bookshelf', '#6a4a2a', '📚', 'icon', 'furniture'),
  o(32, 'table', 'Table', '#8a7a6a', '🍽️', 'icon', 'furniture'),
  o(33, 'bed', 'Bed', '#4a6a4a', '🛏️', 'icon', 'furniture'),
  o(34, 'barrel', 'Barrel', '#8a5a2a', '🛢️', 'icon', 'furniture'),
  o(35, 'crate', 'Crate', '#a87a4a', '📦', 'icon', 'furniture'),
  o(36, 'lectern', 'Lectern', '#7a5a3a', '📖', 'icon', 'furniture'),
  // Things in the streets.
  o(37, 'well', 'Well', '#7a8a9a', '⛲', 'icon', 'street'),
  o(38, 'lamp_post', 'Lamp post', '#3a3a3a', '🏮', 'icon', 'street'),
  o(39, 'market_stall', 'Market stall', '#c04a4a', '🎪', 'icon', 'street'),
  o(40, 'flower_bed', 'Flower bed', '#d86aa0', '🌷', 'icon', 'street'),
  o(41, 'bench', 'Bench', '#8a6a3a', '🪑', 'icon', 'street'),
  o(42, 'signpost', 'Signpost', '#9a7a4a', '🪧', 'icon', 'street'),
  o(43, 'notice_board', 'Notice board', '#a88a5a', '📜', 'icon', 'street'),
  // The rarer ores (RPG-DC: gold and mithril in the caverns, adamant in the Wyrm's Lair, runite in the Deep).
  o(44, 'gold_rock', 'Gold rock', '#e0b840', '🟡', 'ore', 'ore'),
  o(45, 'mithril_rock', 'Mithril rock', '#7f9fe0', '🔵', 'ore', 'ore'),
  o(46, 'adamant_rock', 'Adamant rock', '#4f9a5f', '🟢', 'ore', 'ore'),
  o(47, 'runite_rock', 'Runite rock', '#3fb4c8', '💠', 'ore', 'ore'),
  // Runecrafting: essence that never runs out, and altars that bind it into runes, used from beside them.
  o(48, 'essence_rock', 'Essence rock', '#d6a8ff', '🟣', 'ore', 'ore'),
  o(49, 'air_altar', 'Altar: air', '#dfeaf2', '🌀', 'icon', 'altar', true),
  o(50, 'mind_altar', 'Altar: mind', '#e8a040', '🧠', 'icon', 'altar', true),
  o(51, 'water_altar', 'Altar: water', '#4a8fd8', '💧', 'icon', 'altar', true),
  o(52, 'earth_altar', 'Altar: earth', '#a07a40', '⛰️', 'icon', 'altar', true),
  o(53, 'fire_altar', 'Altar: fire', '#e0552e', '☄️', 'icon', 'altar', true),
  o(54, 'chaos_altar', 'Altar: chaos', '#c040c0', '💥', 'icon', 'altar', true),
  o(55, 'law_altar', 'Altar: law', '#4060e0', '⚖️', 'icon', 'altar', true),
  // RPG-DC's new lands: scenery in the way like boulders (the desert's cacti, the swamp's dead trees),
  // yews in the mountains, eels in the swamp, lobsters off the coast, and a herb for each land.
  o(56, 'cactus', 'Cactus', '#5a9a4a', '🌵', 'icon', 'rock'),
  o(57, 'dead_tree', 'Dead tree', '#7a6a58', '🪵', 'icon', 'rock'),
  o(58, 'yew', 'Yew', '#24503a', '🌲', 'pine', 'tree'),
  o(59, 'fishing_eel', 'Fishing spot: eel', '#8a9a5a', '🐍', 'icon', 'fishing', true),
  o(60, 'fishing_lobster', 'Fishing spot: lobster', '#e04a3a', '🦞', 'icon', 'fishing', true),
  o(61, 'herb_duneflower', 'Herb: duneflower', '#f0b840', '🌼', 'icon', 'herb', true),
  o(62, 'herb_bogmyrtle', 'Herb: bog myrtle', '#8a5aa0', '🪻', 'icon', 'herb', true),
  o(63, 'herb_frostcap', 'Herb: frostcap', '#a8e0f8', '🍃', 'icon', 'herb', true),
  // RPG-DC's fast travel: a standing stone with glowing runes, tapped from beside it to travel to
  // another (each stands in a landmark place).
  o(64, 'waystone', 'Waystone', '#7fb2e5', '🧭', 'icon', 'travel', true),
  // RPG-DC's secrets: a cache hidden under a cairn of stones, searched from beside it, and a thicket
  // that looks like the trees round it but can be walked through (the way into a hidden glade).
  o(65, 'cache', 'Hidden cache', '#a39d92', '💰', 'cairn', 'secret', true),
  { ...o(66, 'thicket', 'Thicket (walk-through)', '#2d5527', '🌱', 'thicket', 'secret'), blocks: false },
  // Old stonework, in the way like a boulder and joined up like a fence: a ruined chapel's walls.
  o(67, 'ruin', 'Ruined wall', '#8f8a80', '🏚️', 'ruin', 'ruin'),
  // RPG-DC's dungeon puzzles: an iron gate (a portcullis) that opens once every lever wired to it
  // is pulled (lever places), a lever pulled from beside it, and a door locked until a player
  // brings its key (a lock place). All three are in the way: each player opens gates and doors
  // for themselves, and monsters never pass them.
  o(68, 'gate', 'Gate (opened by levers)', '#5a5e66', '🚧', 'gate', 'puzzle'),
  o(69, 'lever', 'Lever', '#d8a84a', '🕹️', 'lever', 'puzzle', true),
  o(70, 'locked_door', 'Locked door (needs a key)', '#7a4a22', '🔒', 'lockdoor', 'puzzle'),
  // RPG-DC's sea: a boat moored by a jetty, used from beside it to sail where its ferry place says
  // (to an island and back), the island's palms and the wrecks on its beaches (in the way like
  // boulders), and the swordfish off its shores.
  o(71, 'boat', 'Ferry boat', '#3a6a9a', '⛵', 'icon', 'travel', true),
  o(72, 'palm', 'Palm', '#4f9a3f', '🌴', 'icon', 'rock'),
  o(73, 'wreck', 'Wreck', '#7a5a3a', '🛶', 'icon', 'rock'),
  o(74, 'fishing_swordfish', 'Fishing spot: swordfish', '#6a7aa8', '🦈', 'icon', 'fishing', true),
  // RPG-DC's Farming: beds of tilled soil that players grow crops in, tended from beside them, and
  // which anyone can walk over (they lie flat on the ground); and two workbenches, a spinning wheel
  // (flax into cloth) and the windmill's millstones (wheat into flour), used from beside them.
  { ...o(75, 'patch_allotment', 'Allotment', '#8c5c34', '🥕', 'patch', 'farm', true), blocks: false },
  { ...o(76, 'patch_herb', 'Herb patch', '#84583a', '🪴', 'patch', 'farm', true), blocks: false },
  { ...o(77, 'patch_tree', 'Tree patch', '#7c5438', '🌰', 'patch', 'farm', true), blocks: false },
  o(78, 'spinning_wheel', 'Spinning wheel', '#a87a4a', '🧶', 'icon', 'station', true),
  o(79, 'millstones', 'Millstones', '#9a948a', '⚙️', 'icon', 'station', true),
  // RPG-DC's Construction: the sawbench, a workbench used from beside it (logs into planks,
  // limestone into stone blocks), and limestone, mined like ore (Mining 20) in the Old Quarry.
  o(80, 'sawbench', 'Sawbench', '#b08850', '🪚', 'icon', 'station', true),
  o(81, 'limestone_rock', 'Limestone rock', '#e8e0c8', '⬜', 'ore', 'ore'),
  // RPG-DC's guild halls: a guild chest, used from beside it like a bank chest, which opens the bank
  // of the guild you're in (one stands beside the bank chest in each of the game's banks).
  o(82, 'guild_chest', 'Guild chest', '#c8902a', '🛡️', 'icon', 'station', true),
];

export const O = Object.fromEntries(OBJECTS.slice(1).map((d) => [d.key.toUpperCase(), d.id])) as Record<
  | 'TREE'
  | 'OAK'
  | 'WILLOW'
  | 'BOULDER'
  | 'FENCE'
  | 'COPPER_ROCK'
  | 'TIN_ROCK'
  | 'IRON_ROCK'
  | 'BANK'
  | 'SHOP'
  | 'FURNACE'
  | 'ANVIL'
  | 'COOKING_FIRE'
  | 'FISHING_SHRIMP'
  | 'FISHING_TROUT'
  | 'FISHING_SALMON'
  | 'CRYPT_ENTRANCE'
  | 'STAIRS_DOWN'
  | 'STAIRS_UP'
  | 'HERB_SUNLEAF'
  | 'HERB_SILVERWEED'
  | 'HERB_THORNBERRY'
  | 'HERB_NIGHTSHADE'
  | 'HERB_EMBERBLOOM'
  | 'DOOR'
  | 'SEWER_GRATE'
  | 'ALCHEMY_TABLE'
  | 'SEWING_TABLE'
  | 'FLETCHING_BENCH'
  | 'COUNTER'
  | 'BOOKSHELF'
  | 'TABLE'
  | 'BED'
  | 'BARREL'
  | 'CRATE'
  | 'LECTERN'
  | 'WELL'
  | 'LAMP_POST'
  | 'MARKET_STALL'
  | 'FLOWER_BED'
  | 'BENCH'
  | 'SIGNPOST'
  | 'NOTICE_BOARD'
  | 'GOLD_ROCK'
  | 'MITHRIL_ROCK'
  | 'ADAMANT_ROCK'
  | 'RUNITE_ROCK'
  | 'ESSENCE_ROCK'
  | 'AIR_ALTAR'
  | 'MIND_ALTAR'
  | 'WATER_ALTAR'
  | 'EARTH_ALTAR'
  | 'FIRE_ALTAR'
  | 'CHAOS_ALTAR'
  | 'LAW_ALTAR'
  | 'CACTUS'
  | 'DEAD_TREE'
  | 'YEW'
  | 'FISHING_EEL'
  | 'FISHING_LOBSTER'
  | 'HERB_DUNEFLOWER'
  | 'HERB_BOGMYRTLE'
  | 'HERB_FROSTCAP'
  | 'WAYSTONE'
  | 'CACHE'
  | 'THICKET'
  | 'RUIN'
  | 'GATE'
  | 'LEVER'
  | 'LOCKED_DOOR'
  | 'BOAT'
  | 'PALM'
  | 'WRECK'
  | 'FISHING_SWORDFISH'
  | 'PATCH_ALLOTMENT'
  | 'PATCH_HERB'
  | 'PATCH_TREE'
  | 'SPINNING_WHEEL'
  | 'MILLSTONES'
  | 'SAWBENCH'
  | 'LIMESTONE_ROCK'
  | 'GUILD_CHEST',
  number
>;

export function objectDef(id: number): ObjectDef | undefined {
  return id > 0 ? OBJECTS[id] : undefined;
}

export function objectByKey(key: string): ObjectDef | undefined {
  return OBJECTS.find((d) => d.id > 0 && d.key === key);
}
