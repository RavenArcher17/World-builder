/** Points of interest placed on maps (settlements, dungeons, shops, treasure, ...). */

/** `game` types only appear on maps made for a specific game (see rpgdc/). */
export type FeatureScope = 'overland' | 'settlement' | 'dungeon' | 'game';

export interface FeatureDef {
  type: string;
  label: string;
  icon: string;
  scope: FeatureScope;
  /** Higher = more important; used for label priority and road hierarchy. */
  rank: number;
}

const f = (type: string, label: string, icon: string, scope: FeatureScope, rank: number): FeatureDef => ({
  type,
  label,
  icon,
  scope,
  rank,
});

export const FEATURE_DEFS: FeatureDef[] = [
  // Overland
  f('capital', 'Capital', '👑', 'overland', 10),
  f('city', 'City', '🏙️', 'overland', 9),
  f('town', 'Town', '🏘️', 'overland', 7),
  f('village', 'Village', '🏡', 'overland', 5),
  f('hamlet', 'Hamlet', '🛖', 'overland', 3),
  f('castle', 'Castle', '🏰', 'overland', 6),
  f('dungeon', 'Dungeon', '💀', 'overland', 4),
  f('ruins', 'Ruins', '🏚️', 'overland', 3),
  f('cave', 'Cave', '🕳️', 'overland', 2),
  f('tower', 'Tower', '🗼', 'overland', 3),
  f('temple', 'Temple', '🛕', 'overland', 3),
  f('shrine', 'Shrine', '⛩️', 'overland', 1),
  f('mine', 'Mine', '⛏️', 'overland', 2),
  f('lair', 'Monster lair', '🐉', 'overland', 3),
  f('camp', 'Camp', '⛺', 'overland', 1),
  f('landmark', 'Landmark', '🗿', 'overland', 2),
  f('farm', 'Farmstead', '🌾', 'overland', 1),
  f('inn', 'Roadside inn', '🍺', 'overland', 2),
  // Settlement
  f('market', 'Market', '🛒', 'settlement', 6),
  f('keep', 'Keep', '🏰', 'settlement', 7),
  f('temple_bldg', 'Temple', '⛪', 'settlement', 5),
  f('tavern', 'Tavern', '🍺', 'settlement', 4),
  f('inn_bldg', 'Inn', '🛏️', 'settlement', 4),
  f('smithy', 'Smithy', '⚒️', 'settlement', 3),
  f('shop', 'Shop', '🏪', 'settlement', 3),
  f('stable', 'Stable', '🐴', 'settlement', 2),
  f('guildhall', 'Guildhall', '🏛️', 'settlement', 5),
  f('barracks', 'Barracks', '🛡️', 'settlement', 3),
  f('library', 'Library', '📚', 'settlement', 3),
  f('alchemist', 'Alchemist', '⚗️', 'settlement', 3),
  f('well', 'Well', '⛲', 'settlement', 1),
  f('docks', 'Docks', '⚓', 'settlement', 3),
  f('graveyard', 'Graveyard', '🪦', 'settlement', 2),
  // Dungeon
  f('entrance', 'Entrance', '🚪', 'dungeon', 6),
  f('stairs_down', 'Stairs down', '⬇️', 'dungeon', 5),
  f('boss', 'Boss', '👹', 'dungeon', 6),
  f('monster', 'Monsters', '👾', 'dungeon', 3),
  f('treasure', 'Treasure', '💰', 'dungeon', 4),
  f('trap', 'Trap', '⚠️', 'dungeon', 2),
  f('altar', 'Altar', '🕯️', 'dungeon', 3),
  f('secret', 'Secret door', '❓', 'dungeon', 2),
  // Game maps
  f('spawn_point', 'Spawn point', '🚩', 'game', 8),
  f('monster_spawn', 'Monster spawn', '⚔️', 'game', 4),
  f('brazier', 'Brazier', '🏮', 'game', 2),
  f('link', 'Stairs link', '🔗', 'game', 6),
];

const BY_TYPE = new Map(FEATURE_DEFS.map((d) => [d.type, d]));

export function featureDef(type: string): FeatureDef {
  return BY_TYPE.get(type) ?? { type, label: type, icon: '📍', scope: 'overland', rank: 1 };
}

export const SETTLEMENT_TYPES = new Set(['capital', 'city', 'town', 'village', 'hamlet']);
export const DUNGEONISH_TYPES = new Set(['dungeon', 'cave', 'lair', 'mine', 'ruins', 'tower', 'temple']);
