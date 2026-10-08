/**
 * The single tile registry shared by every map kind, so overland, town and dungeon maps can be
 * stitched together and exported with one legend. Tile ids are stable: never renumber them,
 * only append.
 */

export type TileCategory = 'water' | 'land' | 'urban' | 'dungeon';

/** Texture drawn over a tile's colour so similar colours stay distinguishable. */
export type TilePattern = 'blades' | 'dirt' | 'waves' | 'cobbles' | 'flags' | 'bricks';

export interface TileDef {
  id: number;
  key: string;
  name: string;
  color: string;
  category: TileCategory;
  walkable: boolean;
  /** Relative travel cost used for road and street routing (Infinity = impassable). */
  cost: number;
  pattern?: TilePattern;
}

export const T = {
  DEEP_OCEAN: 0,
  OCEAN: 1,
  LAKE: 2,
  BEACH: 3,
  GRASSLAND: 4,
  SAVANNA: 5,
  FOREST: 6,
  JUNGLE: 7,
  TAIGA: 8,
  SWAMP: 9,
  DESERT: 10,
  BADLANDS: 11,
  HILLS: 12,
  MOUNTAINS: 13,
  PEAKS: 14,
  TUNDRA: 15,
  GLACIER: 16,
  STREET: 17,
  MAIN_STREET: 18,
  PLAZA: 19,
  BUILDING: 20,
  KEEP: 21,
  WALL: 22,
  GATE: 23,
  BRIDGE: 24,
  DOCK: 25,
  FIELD: 26,
  GARDEN: 27,
  RUBBLE: 28,
  ROCK: 29,
  FLOOR: 30,
  CORRIDOR: 31,
  DOOR: 32,
  STAIRS_UP: 33,
  STAIRS_DOWN: 34,
  PIT: 35,
  POOL: 36,
  // Plain ground for hand-built game maps (things standing on it live in the object layer).
  GRASS: 37,
  PATH: 38,
  WATER: 39,
  TOWN_FLOOR: 40,
  CRYPT_FLOOR: 41,
  CRYPT_WALL: 42,
} as const;

const def = (
  id: number,
  key: string,
  name: string,
  color: string,
  category: TileCategory,
  walkable: boolean,
  cost: number,
  pattern?: TilePattern,
): TileDef => ({ id, key, name, color, category, walkable, cost, pattern });

export const TILES: TileDef[] = [
  def(T.DEEP_OCEAN, 'deep_ocean', 'Deep ocean', '#1f3f6b', 'water', false, Infinity),
  def(T.OCEAN, 'ocean', 'Shallow sea', '#2f6299', 'water', false, Infinity),
  def(T.LAKE, 'lake', 'Lake / river water', '#4a86c0', 'water', false, Infinity),
  def(T.BEACH, 'beach', 'Beach', '#e4d6a2', 'land', true, 1.3),
  def(T.GRASSLAND, 'grassland', 'Grassland', '#8fbc5c', 'land', true, 1),
  def(T.SAVANNA, 'savanna', 'Savanna / plains', '#c2c66e', 'land', true, 1),
  def(T.FOREST, 'forest', 'Forest', '#3e7d3a', 'land', true, 2),
  def(T.JUNGLE, 'jungle', 'Jungle', '#22612b', 'land', true, 3.5),
  def(T.TAIGA, 'taiga', 'Taiga / pine forest', '#4f7056', 'land', true, 2.2),
  def(T.SWAMP, 'swamp', 'Swamp', '#5f7a55', 'land', true, 4),
  def(T.DESERT, 'desert', 'Desert', '#e3c47e', 'land', true, 2),
  def(T.BADLANDS, 'badlands', 'Badlands', '#b97c4f', 'land', true, 2.5),
  def(T.HILLS, 'hills', 'Hills', '#a3a56b', 'land', true, 2.5),
  def(T.MOUNTAINS, 'mountains', 'Mountains', '#8b8076', 'land', true, 7),
  def(T.PEAKS, 'peaks', 'Snowy peaks', '#eef0f4', 'land', false, Infinity),
  def(T.TUNDRA, 'tundra', 'Tundra', '#b8c4b2', 'land', true, 1.8),
  def(T.GLACIER, 'glacier', 'Glacier / ice', '#dbe8f5', 'land', true, 5),
  def(T.STREET, 'street', 'Street', '#b3a287', 'urban', true, 0.6),
  def(T.MAIN_STREET, 'main_street', 'Main road', '#cdb98f', 'urban', true, 0.4),
  def(T.PLAZA, 'plaza', 'Plaza / square', '#dccda6', 'urban', true, 0.5),
  def(T.BUILDING, 'building', 'Building', '#9a5b3b', 'urban', false, 20),
  def(T.KEEP, 'keep', 'Keep / castle', '#6f6f7c', 'urban', false, 40),
  def(T.WALL, 'wall', 'Wall', '#4d4d58', 'urban', false, Infinity),
  def(T.GATE, 'gate', 'Gate', '#7b6447', 'urban', true, 0.6),
  def(T.BRIDGE, 'bridge', 'Bridge', '#9b7b52', 'urban', true, 0.6),
  def(T.DOCK, 'dock', 'Dock / pier', '#7d5e3c', 'urban', true, 1),
  def(T.FIELD, 'field', 'Farm field', '#d8c56e', 'land', true, 1.5),
  def(T.GARDEN, 'garden', 'Garden / yard', '#74b052', 'land', true, 1.5),
  def(T.RUBBLE, 'rubble', 'Rubble / ruin', '#8d8781', 'urban', true, 3),
  def(T.ROCK, 'rock', 'Solid rock', '#2b2a33', 'dungeon', false, Infinity),
  def(T.FLOOR, 'floor', 'Room floor', '#cbc4b4', 'dungeon', true, 1),
  def(T.CORRIDOR, 'corridor', 'Corridor', '#a9a191', 'dungeon', true, 1),
  def(T.DOOR, 'door', 'Door', '#9c6b30', 'dungeon', true, 1),
  def(T.STAIRS_UP, 'stairs_up', 'Stairs up', '#6fa8dc', 'dungeon', true, 1),
  def(T.STAIRS_DOWN, 'stairs_down', 'Stairs down', '#c27ba0', 'dungeon', true, 1),
  def(T.PIT, 'pit', 'Pit / chasm', '#121216', 'dungeon', false, Infinity),
  def(T.POOL, 'pool', 'Underground pool', '#3d6fa0', 'water', false, Infinity),
  def(T.GRASS, 'grass', 'Grass', '#7cad4c', 'land', true, 1, 'blades'),
  def(T.PATH, 'path', 'Dirt path', '#c8a46a', 'land', true, 0.5, 'dirt'),
  def(T.WATER, 'water', 'Water', '#3b78bd', 'water', false, Infinity, 'waves'),
  def(T.TOWN_FLOOR, 'town_floor', 'Town cobbles', '#b9b2a2', 'urban', true, 0.5, 'cobbles'),
  def(T.CRYPT_FLOOR, 'crypt_floor', 'Crypt floor', '#8f877a', 'dungeon', true, 1, 'flags'),
  def(T.CRYPT_WALL, 'crypt_wall', 'Crypt wall', '#3b3640', 'dungeon', false, Infinity, 'bricks'),
];

export function tile(id: number): TileDef {
  return TILES[id] ?? TILES[T.GRASSLAND];
}

export function isWater(id: number): boolean {
  return id === T.DEEP_OCEAN || id === T.OCEAN || id === T.LAKE || id === T.POOL || id === T.WATER;
}

export function isSea(id: number): boolean {
  return id === T.DEEP_OCEAN || id === T.OCEAN;
}

export const STREET_TILES = new Set<number>([T.STREET, T.MAIN_STREET, T.PLAZA, T.GATE, T.BRIDGE]);
export const DUNGEON_PASSABLE = new Set<number>([T.FLOOR, T.CORRIDOR, T.DOOR, T.STAIRS_UP, T.STAIRS_DOWN]);
