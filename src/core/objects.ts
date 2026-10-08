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
  group: 'tree' | 'rock' | 'ore' | 'wall' | 'station' | 'fishing' | 'stairs';
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
  | 'STAIRS_UP',
  number
>;

export function objectDef(id: number): ObjectDef | undefined {
  return id > 0 ? OBJECTS[id] : undefined;
}

export function objectByKey(key: string): ObjectDef | undefined {
  return OBJECTS.find((d) => d.id > 0 && d.key === key);
}
