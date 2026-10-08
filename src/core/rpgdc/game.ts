/**
 * RPG-DC (github.com/RavenArcher17/RPG-DC) game rules. These switch on only for maps whose
 * settings carry `rpgdcMapId`; every other map behaves as plain World Builder.
 */
import { Grid } from '../grid';
import { O, OBJECTS, objectDef } from '../objects';
import { T, tile } from '../tiles';
import type { Feature, Project, WorldMap } from '../types';

export function isRpgdc(map: WorldMap | null | undefined): boolean {
  return !!map && typeof map.settings?.rpgdcMapId === 'string' && map.settings.rpgdcMapId !== '';
}

export function gameMapId(map: WorldMap): string {
  return String(map.settings.rpgdcMapId);
}

export function gameKind(map: WorldMap): 'overworld' | 'dungeon' {
  return map.kind === 'dungeon' ? 'dungeon' : 'overworld';
}

export function gameMaps(project: Project): WorldMap[] {
  const order = (m: WorldMap) => (gameKind(m) === 'overworld' ? 0 : 1);
  return Object.values(project.maps)
    .filter((m) => isRpgdc(m))
    .sort((a, b) => order(a) - order(b) || gameMapId(a).localeCompare(gameMapId(b), 'en', { numeric: true }));
}

export function findGameMap(project: Project, id: unknown): WorldMap | undefined {
  return typeof id === 'string' ? gameMaps(project).find((m) => gameMapId(m) === id) : undefined;
}

// ---- ground and objects ------------------------------------------------------------------

/** Export order of ground kinds; index = value in the exported `ground` layer. */
export const GROUND_LEGEND = ['grass', 'path', 'water', 'town_floor', 'crypt_floor', 'crypt_wall'] as const;
export const GROUND_TILES = [T.GRASS, T.PATH, T.WATER, T.TOWN_FLOOR, T.CRYPT_FLOOR, T.CRYPT_WALL];
const GROUND_WALKABLE = [true, true, false, true, true, false];

/** Export order of objects; index = value in the exported `objects` layer (0 = nothing). */
export const OBJECT_LEGEND = OBJECTS.slice(0, 20).map((d) => d.key);
export const GAME_OBJECTS = OBJECTS.slice(1, 20);

/**
 * The game ground index for any World Builder tile. The six game grounds map to themselves;
 * anything else (a tile painted with the general palette) maps to the closest game ground.
 */
export function gameGround(tileId: number): number {
  const k = GROUND_TILES.indexOf(tileId as (typeof GROUND_TILES)[number]);
  if (k >= 0) return k;
  const t = tile(tileId);
  if (t.category === 'water') return 2;
  if (t.category === 'dungeon') return t.walkable ? 4 : 5;
  if (t.category === 'urban' && t.walkable) return 3;
  return 0;
}

export function isGameGround(tileId: number): boolean {
  return GROUND_TILES.includes(tileId as (typeof GROUND_TILES)[number]);
}

/** Game object index (0 = nothing); objects the game doesn't know export as nothing. */
export function gameObject(objectId: number): number {
  return objectId > 0 && objectId < OBJECT_LEGEND.length ? objectId : 0;
}

/** Walkable in the game: walkable ground with nothing standing on it. */
export function isWalkable(map: WorldMap, i: number): boolean {
  return GROUND_WALKABLE[gameGround(map.layers.terrain[i])] && gameObject(map.layers.object[i]) === 0;
}

export function isWalkableAt(map: WorldMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height && isWalkable(map, y * map.width + x);
}

/** The order the game tries neighbouring tiles in (e.g. where you arrive beside stairs). */
export const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** The first walkable tile beside (x, y), in the game's order. */
export function besideTile(map: WorldMap, x: number, y: number): { x: number; y: number } | null {
  for (const [dx, dy] of NEIGHBOURS) if (isWalkableAt(map, x + dx, y + dy)) return { x: x + dx, y: y + dy };
  return null;
}

/**
 * Tiles reachable on foot from `starts`: 8 directions, and no cutting a corner past a blocked
 * tile (the game's pathfinding rule).
 */
export function reachable(map: WorldMap, starts: { x: number; y: number }[]): Uint8Array {
  const w = map.width;
  const seen = new Uint8Array(w * map.height);
  const queue: number[] = [];
  for (const s of starts) {
    if (!isWalkableAt(map, s.x, s.y)) continue;
    const i = s.y * w + s.x;
    if (!seen[i]) {
      seen[i] = 1;
      queue.push(i);
    }
  }
  for (let h = 0; h < queue.length; h++) {
    const cx = queue[h] % w;
    const cy = Math.floor(queue[h] / w);
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkableAt(map, nx, ny)) continue;
      if (dx && dy && (!isWalkableAt(map, cx + dx, cy) || !isWalkableAt(map, cx, cy + dy))) continue;
      const k = ny * w + nx;
      if (seen[k]) continue;
      seen[k] = 1;
      queue.push(k);
    }
  }
  return seen;
}

// ---- zones -------------------------------------------------------------------------------

export interface ZoneDef {
  /** Value stored in the zone layer. */
  id: number;
  key: 'safe' | 'frontier' | 'wilderness' | 'deep';
  name: string;
  color: string;
  rules: string;
}

export const ZONES: ZoneDef[] = [
  { id: 1, key: 'safe', name: 'Safe', color: '#3fbf6f', rules: 'No PvP. You keep everything when you die.' },
  { id: 2, key: 'frontier', name: 'Frontier', color: '#e0c040', rules: 'No PvP. Keep 3 items. Only the owner can loot your grave. Graves last 8 min.' },
  { id: 3, key: 'wilderness', name: 'Wilderness', color: '#e07a30', rules: 'PvP. Keep 1 item. Anyone can loot graves. Graves last 6 min.' },
  { id: 4, key: 'deep', name: 'Deep', color: '#c03a4a', rules: 'PvP. Keep 0 items. Anyone can loot graves. Graves last 6 min.' },
];
export const ZONE_LEGEND = ZONES.map((z) => z.key);

export function zoneByKey(key: unknown): ZoneDef | undefined {
  return ZONES.find((z) => z.key === key);
}

/** The whole-map zone of a dungeon floor. */
export function mapZone(map: WorldMap): ZoneDef | undefined {
  return zoneByKey(map.settings.rpgdcZone);
}

/** Zone of a cell: the map's zone on dungeon floors, the zone layer elsewhere. */
export function zoneAt(map: WorldMap, i: number): ZoneDef | undefined {
  if (gameKind(map) === 'dungeon') return mapZone(map);
  return ZONES[map.layers.zone[i] - 1];
}

/** Zone by distance from the town centre (larger of the column and row distance), as the game had it. */
export function zoneByDistance(d: number): number {
  return d <= 6 ? 1 : d <= 24 ? 2 : d <= 44 ? 3 : 4;
}

// ---- places ------------------------------------------------------------------------------

/** The game's monsters, with how far each normally roams from its spawn (its leash in RPG-DC). */
export const MONSTER_KINDS: { key: string; name: string; range: number }[] = [
  { key: 'rat', name: 'Rat', range: 6 },
  { key: 'goblin', name: 'Goblin', range: 7 },
  { key: 'wolf', name: 'Wolf', range: 8 },
  { key: 'bandit', name: 'Bandit', range: 8 },
  { key: 'troll', name: 'Troll', range: 7 },
  { key: 'skeleton', name: 'Skeleton', range: 8 },
  { key: 'giant_spider', name: 'Giant spider', range: 8 },
  { key: 'ghoul', name: 'Ghoul', range: 8 },
  { key: 'bone_king', name: 'Bone King', range: 7 },
];

/** A monster's normal roaming range in tiles: the radius a new spawn of it starts with. */
export function normalRange(kind: unknown): number {
  return MONSTER_KINDS.find((k) => k.key === kind)?.range ?? 8;
}

export interface PlaceField {
  key: string;
  label: string;
  type: 'select' | 'number' | 'map';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  default: string | number;
}

const kindField = (def: string): PlaceField => ({
  key: 'kind',
  label: 'Monster',
  type: 'select',
  options: MONSTER_KINDS.map((k) => ({ value: k.key, label: k.name })),
  default: def,
});

export const PLACE_TYPES = ['spawn_point', 'monster_spawn', 'boss', 'brazier', 'link'] as const;

export const PLACE_FIELDS: Record<string, PlaceField[]> = {
  spawn_point: [],
  monster_spawn: [
    kindField('rat'),
    { key: 'count', label: 'Count', type: 'number', min: 1, max: 50, default: 1 },
    { key: 'radius', label: 'Radius (tiles, 0 = stays put)', type: 'number', min: 0, max: 30, default: normalRange('rat') },
  ],
  boss: [kindField('bone_king')],
  brazier: [],
  link: [
    { key: 'toMap', label: 'Goes to map', type: 'map', default: '' },
    { key: 'toX', label: 'Arrive at x (column)', type: 'number', min: 0, max: 1023, default: 0 },
    { key: 'toY', label: 'Arrive at y (row)', type: 'number', min: 0, max: 1023, default: 0 },
  ],
};

export const PLACE_HELP: Record<string, string> = {
  spawn_point: 'Where new players start. Exactly one, on the overworld, in the Safe zone.',
  monster_spawn:
    'Monsters of one kind live here. Radius: how far they roam from here (they chase you that far). 0: they stay on their tile and only fight what comes next to them. Picking a monster sets its normal range.',
  boss: 'A boss fight.',
  brazier: 'A light in the crypt.',
  link: 'Put it on a crypt entrance or stairs. Players taking them arrive on the chosen tile of the target map.',
};

/** A place's props with defaults filled in. */
export function placeProps(f: Feature): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const field of PLACE_FIELDS[f.type] ?? []) out[field.key] = f.props?.[field.key] ?? field.default;
  return out;
}

/**
 * A place's props after setting one field. Picking another monster moves a radius that was at the
 * old monster's normal range to the new one's; a radius chosen by hand stays.
 */
export function withProp(f: Feature, key: string, value: string | number): Record<string, string | number | boolean> {
  const before = placeProps(f);
  const props = { ...before, [key]: value };
  if (f.type === 'monster_spawn' && key === 'kind' && Number(before.radius) === normalRange(before.kind)) props.radius = normalRange(value);
  return props;
}

export function defaultProps(type: string): Record<string, string | number> | undefined {
  const fields = PLACE_FIELDS[type];
  if (!fields?.length) return undefined;
  return Object.fromEntries(fields.map((f) => [f.key, f.default]));
}

export function objectAt(map: WorldMap, x: number, y: number) {
  return objectDef(map.layers.object[y * map.width + x]);
}

export function stairsDirection(objectId: number): 'down' | 'up' | null {
  if (objectId === O.CRYPT_ENTRANCE || objectId === O.STAIRS_DOWN) return 'down';
  if (objectId === O.STAIRS_UP) return 'up';
  return null;
}

export function gridOf(map: WorldMap): Grid {
  return new Grid(map.grid, map.width, map.height);
}
