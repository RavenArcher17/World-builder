/**
 * Things that stand on a cell, separate from the ground under it: trees, rocks, props, stations.
 * Stored per cell in `layers.object` (0 = nothing). Like tile ids, object ids are stable:
 * never renumber them, only append.
 */

/** How an object is drawn on the map. Small vector shapes stay crisp and fast for thousands of cells. */
export type ObjectShape = 'pine' | 'round' | 'willow' | 'boulder' | 'fence' | 'ore' | 'icon';

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
  group: 'tree' | 'rock' | 'ore' | 'wall' | 'station' | 'fishing' | 'stairs' | 'herb' | 'door' | 'furniture' | 'street';
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
  // Herb patches, picked by hand from beside them.
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
  | 'NOTICE_BOARD',
  number
>;

export function objectDef(id: number): ObjectDef | undefined {
  return id > 0 ? OBJECTS[id] : undefined;
}

export function objectByKey(key: string): ObjectDef | undefined {
  return OBJECTS.find((d) => d.id > 0 && d.key === key);
}
