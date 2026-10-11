/**
 * 3D props: the furniture, lights, loot and dressing of 3D maps (much of it after Underkeep's
 * map editor). Stored per cell in `layers3d.prop`, separate from the shared object layer so the
 * object ids games already rely on never move. Ids are stable: never renumber them, only append.
 */

export type PropGroup = 'building' | 'furniture' | 'decor' | 'light' | 'loot' | 'danger';

export interface PropDef {
  id: number;
  key: string;
  name: string;
  icon: string;
  color: string;
  group: PropGroup;
  /** Stops anyone walking onto its cell. */
  blocks: boolean;
  /** Has a front (the Turn tool and `layers3d.facing` matter). */
  facing: boolean;
  /** Stands against the wall behind it (bookshelf, banner, hearth). */
  wall?: boolean;
  /** Light radius in metres, for lights. */
  light?: number;
  /** A fire that keeps the dark away (hearth, campfire, bonfire). */
  sanctuary?: boolean;
}

const p = (
  id: number,
  key: string,
  name: string,
  icon: string,
  color: string,
  group: PropGroup,
  blocks: boolean,
  facing: boolean,
  extra: Partial<PropDef> = {},
): PropDef => ({ id, key, name, icon, color, group, blocks, facing, ...extra });

export const PROPS: PropDef[] = [
  p(0, '', 'Nothing', '∅', 'transparent', 'decor', false, false),
  // Building
  p(1, 'pillar', 'Pillar', '🏛️', '#b3aea4', 'building', true, false),
  p(2, 'statue', 'Statue', '🗿', '#a9a59c', 'building', true, true),
  p(3, 'rubble', 'Rubble', '🪨', '#7f7a72', 'building', true, false),
  p(4, 'locked_door', 'Locked door', '🔒', '#8a5a2a', 'building', true, true),
  // Furniture
  p(5, 'pew', 'Pew', '🪑', '#8a6440', 'furniture', true, true),
  p(6, 'chair', 'Chair', '🪑', '#8a6440', 'furniture', true, true),
  p(7, 'desk', 'Desk', '🕯️', '#7a5a3a', 'furniture', true, true, { light: 1.6 }),
  p(8, 'wardrobe', 'Wardrobe', '🚪', '#6a4a2a', 'furniture', true, true, { wall: true }),
  p(9, 'shelf', 'Shelf of jars', '🫙', '#7a5a3a', 'furniture', true, true, { wall: true }),
  // Decor
  p(10, 'altar', 'Altar', '🕯️', '#d8d0e8', 'decor', true, true, { light: 1.6 }),
  p(11, 'rug', 'Rug', '🟥', '#9a4a52', 'decor', false, false),
  p(12, 'banner', 'Banner', '🚩', '#9a3a42', 'decor', false, true, { wall: true }),
  p(13, 'training_dummy', 'Training dummy', '🎯', '#c8b070', 'decor', true, false),
  p(14, 'gravestone', 'Gravestone', '🪦', '#a8a8ac', 'decor', true, true),
  p(15, 'hay', 'Hay bales', '🌾', '#d8c060', 'decor', true, false),
  p(16, 'cauldron', 'Cauldron', '🫕', '#55555c', 'decor', true, false, { light: 1.5 }),
  p(17, 'fountain', 'Fountain', '⛲', '#7aa8c8', 'decor', true, false),
  p(18, 'great_bell', 'Great bell', '🔔', '#c89a3a', 'decor', true, false),
  // Light
  p(19, 'brazier', 'Brazier', '🔥', '#f09030', 'light', true, false, { light: 5 }),
  p(20, 'wall_torch', 'Torch (on the wall)', '🔦', '#f0a050', 'light', false, true, { light: 3, wall: true }),
  p(21, 'candelabra', 'Candelabra', '🕯️', '#f0c060', 'light', true, false, { light: 3 }),
  p(22, 'standing_torch', 'Standing torch', '🔦', '#f0a050', 'light', true, false, { light: 4 }),
  p(23, 'hearth', 'Hearth', '🔥', '#e06020', 'light', true, true, { light: 5, wall: true, sanctuary: true }),
  p(24, 'campfire', 'Campfire', '🔥', '#e07028', 'light', true, false, { light: 4, sanctuary: true }),
  p(25, 'bonfire', 'Bonfire', '🔥', '#e05018', 'light', true, false, { light: 7, sanctuary: true }),
  // Loot
  p(26, 'chest', 'Chest', '🧰', '#c89a3a', 'loot', true, true),
  p(27, 'pots', 'Pots', '🏺', '#c08a5a', 'loot', true, false),
  p(28, 'weapon_rack', 'Weapon rack', '⚔️', '#b8c0cc', 'loot', true, true, { wall: true }),
  // Danger
  p(29, 'spike_trap', 'Spike trap', '⚠️', '#d04a4a', 'danger', false, false),
];

export const PROP = Object.fromEntries(PROPS.slice(1).map((d) => [d.key.toUpperCase(), d.id])) as Record<string, number>;

export function propDef(id: number): PropDef | undefined {
  return id > 0 ? PROPS[id] : undefined;
}

export function propByKey(key: string): PropDef | undefined {
  return PROPS.find((d) => d.id > 0 && d.key === key);
}

export const PROP_GROUPS: [PropGroup, string][] = [
  ['light', 'Lights'],
  ['furniture', 'Furniture'],
  ['loot', 'Loot'],
  ['building', 'Building'],
  ['decor', 'Decor'],
  ['danger', 'Danger'],
];
