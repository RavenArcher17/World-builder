/**
 * Underkeep's map file (version 2), as its in-game map editor saves it under user://maps/ and
 * its level builder reads it (RavenArcher17/Underkeep, prototype/data/maps.gd). World Builder
 * writes and reads this format for maps with `settings.underkeep`; see docs/underkeep-export.md.
 */

export const UK = {
  /** Metres per height unit. */
  H_UNIT: 0.5,
  /** Height units from one storey's floor to the next (5 m). */
  PITCH: 10,
  /** Lowest height on the ground storey (pits); other storeys go no lower than 0. */
  H_MIN: -8,
  /** Highest height within a storey (just under the floor above). */
  H_MAX: 9,
  MAX_STOREYS: 6,
  /** A stair cell may rise at most 2 m. */
  MAX_STAIR_RISE: 4,
  /** Enemies step off ledges up to 3.5 m; the player may drop a storey. */
  MAX_DROP: 7,
  MAX_DROP_PLAYER: 14,
  /** A jump and a mantle get the player up 1.5 m. */
  MAX_CLIMB: 3,
  /** Map size the game's editor allows. */
  MIN_SIZE: 12,
  MAX_SIZE: 96,
} as const;

/** Floor tiles: stone, grass, wood and the four stairs. '#' is wall, ' ' is nothing. */
export const FLOOR_CHARS = '.,_^>v<';
/** Stairs by facing: index 0 north (^), 1 east (>), 2 south (v), 3 west (<). */
export const STAIR_CHARS = ['^', '>', 'v', '<'] as const;

export interface UkStorey {
  tiles: string[];
  roof: string[];
  height: number[][];
}

export interface UkObject {
  t: string;
  x: number;
  y: number;
  z: number;
  /** Quarter turns clockwise from north; a chest with −1 faces the most open floor. */
  r: number;
  /** −1: set by distance from the stair; 0..3 (3 = Champion for enemies, Treasure for chests). */
  tier: number;
}

export interface UkRegion {
  name: string;
  z: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface UkMap {
  version: 2;
  name: string;
  w: number;
  h: number;
  storeys: UkStorey[];
  objects: UkObject[];
  regions?: UkRegion[];
  bands?: number[];
  notes?: string;
}

export type UkCat = 'Exits' | 'Building' | 'Furniture' | 'Decor' | 'Light' | 'Loot' | 'Danger';

/** Every object the game knows, with its label and editor category. */
export const UK_TYPES: Record<string, { label: string; cat: UkCat }> = {
  stair: { label: 'Great Stair (entry and exit)', cat: 'Exits' },
  rope: { label: 'Well rope (not when Overburdened)', cat: 'Exits' },
  grate: { label: 'Drain grate', cat: 'Exits' },
  lift: { label: 'Chapel lift (only while its brazier burns)', cat: 'Exits' },
  postern: { label: 'Postern (stand a locked door before it)', cat: 'Exits' },
  door: { label: 'Doorway (lintel + torch)', cat: 'Building' },
  locked_door: { label: 'Locked door', cat: 'Building' },
  pillar: { label: 'Pillar', cat: 'Building' },
  statue: { label: 'Statue', cat: 'Building' },
  table: { label: 'Table', cat: 'Building' },
  rubble: { label: 'Rubble', cat: 'Building' },
  tree: { label: 'Tree', cat: 'Building' },
  bed: { label: 'Bed', cat: 'Furniture' },
  pew: { label: 'Pew', cat: 'Furniture' },
  bench: { label: 'Bench', cat: 'Furniture' },
  chair: { label: 'Chair', cat: 'Furniture' },
  desk: { label: 'Desk', cat: 'Furniture' },
  bookshelf: { label: 'Bookshelf', cat: 'Furniture' },
  wardrobe: { label: 'Wardrobe', cat: 'Furniture' },
  shelf: { label: 'Shelf of jars', cat: 'Furniture' },
  altar: { label: 'Altar', cat: 'Decor' },
  rug: { label: 'Rug', cat: 'Decor' },
  banner: { label: 'Banner', cat: 'Decor' },
  dummy: { label: 'Training dummy', cat: 'Decor' },
  gravestone: { label: 'Gravestone', cat: 'Decor' },
  hay: { label: 'Hay bales', cat: 'Decor' },
  cauldron: { label: 'Cauldron', cat: 'Decor' },
  fountain: { label: 'Fountain', cat: 'Decor' },
  great_bell: { label: 'Great bell', cat: 'Decor' },
  brazier: { label: 'Brazier', cat: 'Light' },
  torch: { label: 'Torch', cat: 'Light' },
  candelabra: { label: 'Candelabra', cat: 'Light' },
  standing_torch: { label: 'Standing torch', cat: 'Light' },
  hearth: { label: 'Hearth', cat: 'Light' },
  campfire: { label: 'Campfire', cat: 'Light' },
  bonfire: { label: 'Bonfire', cat: 'Light' },
  chest: { label: 'Chest', cat: 'Loot' },
  pot: { label: 'Pots', cat: 'Loot' },
  crate: { label: 'Crate', cat: 'Loot' },
  barrel: { label: 'Barrel', cat: 'Loot' },
  rack: { label: 'Armoury rack', cat: 'Loot' },
  clapper: { label: "The great bell's clapper", cat: 'Loot' },
  trap: { label: 'Spike trap', cat: 'Danger' },
  shieldman: { label: 'Shieldman', cat: 'Danger' },
  halberdier: { label: 'Halberdier', cat: 'Danger' },
  sexton: { label: 'Sexton', cat: 'Danger' },
  bellwarden: { label: 'Bellwarden', cat: 'Danger' },
  rats: { label: 'Rat pack', cat: 'Danger' },
  hound: { label: 'Barrow hound', cat: 'Danger' },
  crawler: { label: 'Carrion crawler', cat: 'Danger' },
  swarm: { label: 'Ossuary swarm', cat: 'Danger' },
  castellan: { label: 'The Castellan (boss)', cat: 'Danger' },
  sacristan: { label: 'The Sacristan (boss)', cat: 'Danger' },
  warden: { label: 'The Warden (boss)', cat: 'Danger' },
  kennel_master: { label: 'The Kennel-master (boss)', cat: 'Danger' },
};

export const EXIT_TYPES = ['stair', 'rope', 'grate', 'lift', 'postern'];
export const ENEMY_TYPES = ['shieldman', 'halberdier', 'sexton', 'rats', 'bellwarden', 'hound', 'crawler', 'swarm', 'castellan', 'sacristan', 'warden', 'kennel_master'];
export const BOSS_TYPES = ['castellan', 'sacristan', 'warden', 'kennel_master'];
/** Things the game counts as lights. */
export const LIGHT_TYPES = ['brazier', 'torch', 'door', 'candelabra', 'hearth', 'altar', 'desk', 'cauldron', 'standing_torch', 'campfire', 'bonfire'];
/** Fires that keep the dark-born away. */
export const FIRE_TYPES = ['hearth', 'campfire', 'bonfire'];

/** World Builder 3D props and their Underkeep object (every prop has one). */
export const PROP_TO_UK: Record<string, string> = {
  pillar: 'pillar',
  statue: 'statue',
  rubble: 'rubble',
  locked_door: 'locked_door',
  pew: 'pew',
  chair: 'chair',
  desk: 'desk',
  wardrobe: 'wardrobe',
  shelf: 'shelf',
  altar: 'altar',
  rug: 'rug',
  banner: 'banner',
  training_dummy: 'dummy',
  gravestone: 'gravestone',
  hay: 'hay',
  cauldron: 'cauldron',
  fountain: 'fountain',
  great_bell: 'great_bell',
  brazier: 'brazier',
  wall_torch: 'torch',
  candelabra: 'candelabra',
  standing_torch: 'standing_torch',
  hearth: 'hearth',
  campfire: 'campfire',
  bonfire: 'bonfire',
  chest: 'chest',
  pots: 'pot',
  weapon_rack: 'rack',
  spike_trap: 'trap',
};

/** World Builder objects with an Underkeep equivalent. */
export const OBJECT_TO_UK: Record<string, string> = {
  door: 'door',
  table: 'table',
  counter: 'table',
  bed: 'bed',
  bench: 'bench',
  bookshelf: 'bookshelf',
  barrel: 'barrel',
  crate: 'crate',
  lectern: 'desk',
  tree: 'tree',
  oak: 'tree',
  willow: 'tree',
  boulder: 'rubble',
  well: 'fountain',
  lamp_post: 'standing_torch',
  cooking_fire: 'campfire',
};

/** Underkeep objects that come back into World Builder as objects (the rest are props or places). */
export const UK_TO_OBJECT: Record<string, string> = {
  door: 'door',
  table: 'table',
  bed: 'bed',
  bench: 'bench',
  bookshelf: 'bookshelf',
  barrel: 'barrel',
  crate: 'crate',
  tree: 'tree',
};

/** Underkeep's own places in World Builder (feature types). */
export const UK_PLACE = {
  stair: 'uk_stair',
  exit: 'uk_exit',
  enemy: 'uk_enemy',
  clapper: 'uk_clapper',
} as const;
export const UK_PLACE_TYPES: string[] = Object.values(UK_PLACE);

/** General dungeon places and what they become in Underkeep (so generated dungeons export). */
export const PLACE_TO_UK: Record<string, string> = {
  entrance: 'stair',
  monster: 'shieldman',
  boss: 'castellan',
  treasure: 'chest',
  trap: 'trap',
  altar: 'altar',
};

export const TIER_LABELS = ['Auto (by distance)', '0 Near', '1 Veteran / better loot', '2 Elite / best loot', '3 Champion / Treasure'];
