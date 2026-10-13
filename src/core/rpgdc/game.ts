/**
 * RPG-DC (github.com/RavenArcher17/RPG-DC) game rules. These switch on only for maps whose
 * settings carry `rpgdcMapId`; every other map behaves as plain World Builder.
 */
import { Grid } from '../grid';
import { O, OBJECTS, objectDef } from '../objects';
import { T, TILES, tile } from '../tiles';
import type { Feature, Project, WorldMap } from '../types';

export function isRpgdc(map: WorldMap | null | undefined): boolean {
  return !!map && typeof map.settings?.rpgdcMapId === 'string' && map.settings.rpgdcMapId !== '';
}

export function gameMapId(map: WorldMap): string {
  return String(map.settings.rpgdcMapId);
}

/** The game's kinds of map: the open world, a dungeon floor (dark), or a building's inside (lit). */
export type GameKind = 'overworld' | 'dungeon' | 'interior';

export function gameKind(map: WorldMap): GameKind {
  if (map.settings.rpgdcKind === 'interior') return 'interior';
  return map.kind === 'dungeon' ? 'dungeon' : 'overworld';
}

export function gameMaps(project: Project): WorldMap[] {
  const order = (m: WorldMap) => ['overworld', 'dungeon', 'interior'].indexOf(gameKind(m));
  return Object.values(project.maps)
    .filter((m) => isRpgdc(m))
    .sort((a, b) => order(a) - order(b) || gameMapId(a).localeCompare(gameMapId(b), 'en', { numeric: true }));
}

export function findGameMap(project: Project, id: unknown): WorldMap | undefined {
  return typeof id === 'string' ? gameMaps(project).find((m) => gameMapId(m) === id) : undefined;
}

// ---- ground and objects ------------------------------------------------------------------

/**
 * Export order of ground kinds (the game's GROUND_KINDS); index = value in the exported `ground`
 * layer. The last six are the new lands': sand, mud, snow, gravel ("stone") and ice are open ground
 * to the game, like grass, and bog is water; they change only how a tile looks.
 */
export const GROUND_LEGEND = ['grass', 'path', 'water', 'town_floor', 'crypt_floor', 'crypt_wall', 'planks', 'sand', 'mud', 'bog', 'snow', 'stone', 'ice'] as const;
export const GROUND_TILES = [T.GRASS, T.PATH, T.WATER, T.TOWN_FLOOR, T.CRYPT_FLOOR, T.CRYPT_WALL, T.PLANKS, T.SAND, T.MUD, T.BOG, T.SNOW, T.STONE, T.ICE];
const GROUND_WALKABLE = [true, true, false, true, true, false, true, true, true, false, true, true, true];
/** Grounds that are open land to the game, like grass: trees, rocks and herbs stand on them. */
export const OPEN_GROUND = new Set<number>([T.GRASS, T.SAND, T.MUD, T.SNOW, T.STONE, T.ICE]);

/** How many objects the game knows: World Builder's first ones, in the same order. */
const GAME_OBJECT_COUNT = 65;
/** Export order of objects; index = value in the exported `objects` layer (0 = nothing). */
export const OBJECT_LEGEND = OBJECTS.slice(0, GAME_OBJECT_COUNT).map((d) => d.key);
export const GAME_OBJECTS = OBJECTS.slice(1, GAME_OBJECT_COUNT);

/**
 * The game ground index for any World Builder tile. The game's own grounds map to themselves;
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

/** Walkable in the game: walkable ground with nothing standing on it, and not inside a building's walls. */
export function isWalkable(map: WorldMap, i: number, mask: Uint8Array = buildingMask(map)): boolean {
  return GROUND_WALKABLE[gameGround(map.layers.terrain[i])] && gameObject(map.layers.object[i]) === 0 && !mask[i];
}

/** Whether each World Builder tile is ground the game walks on (by tile id), worked out once. */
const WALKABLE_TILE = TILES.map((t) => GROUND_WALKABLE[gameGround(t.id)]);

/**
 * 1 for every tile you can walk on (as isWalkable), for the whole map at once: much quicker than
 * asking tile by tile on a big map.
 */
export function walkableTiles(map: WorldMap, mask: Uint8Array = buildingMask(map)): Uint8Array {
  const n = map.width * map.height;
  const out = new Uint8Array(n);
  const terrain = map.layers.terrain;
  const object = map.layers.object;
  const objects = OBJECT_LEGEND.length;
  for (let i = 0; i < n; i++) {
    const t = terrain[i];
    const o = object[i];
    const ground = WALKABLE_TILE[t] ?? GROUND_WALKABLE[gameGround(t)];
    if (ground && !(o > 0 && o < objects) && !mask[i]) out[i] = 1;
  }
  return out;
}

// ---- buildings ---------------------------------------------------------------------------

export interface GameBuilding {
  x: number;
  y: number;
  w: number;
  h: number;
  style: string;
  sign: string;
  /** Roof and wall colours (keys of ROOF_COLOURS and WALL_COLOURS); '' keeps the style's own. */
  roof: string;
  walls: string;
}

export const BUILDING_STYLES = [
  { value: 'timber', label: 'Timber and plaster' },
  { value: 'stone', label: 'Stone' },
  { value: 'tower', label: 'Tower' },
];

/** Roof colours the game knows, with the tint it multiplies the roof by (client and shared/src/map.ts). */
export const ROOF_COLOURS = [
  { value: 'brown', label: 'Brown thatch', hex: '#8c5e3d' },
  { value: 'red', label: 'Red tiles', hex: '#b8563c' },
  { value: 'slate', label: 'Slate', hex: '#4f5662' },
  { value: 'blue', label: 'Blue', hex: '#4c56a0' },
  { value: 'green', label: 'Green', hex: '#5f7a4a' },
  { value: 'dark', label: 'Dark', hex: '#3c3836' },
];
/** Wall colours: the plaster of timber houses, the stone of stone houses and towers. */
export const WALL_COLOURS = [
  { value: 'cream', label: 'Cream', hex: '#eedebd' },
  { value: 'white', label: 'White', hex: '#fbf8f2' },
  { value: 'ochre', label: 'Ochre', hex: '#e8c27e' },
  { value: 'rose', label: 'Rose', hex: '#ecc0b0' },
  { value: 'sage', label: 'Sage', hex: '#cfd8b8' },
  { value: 'grey', label: 'Grey', hex: '#ccc2b0' },
  { value: 'sand', label: 'Sand', hex: '#e6cfa0' },
  { value: 'dark', label: 'Dark', hex: '#8e8a84' },
  { value: 'brick', label: 'Brick', hex: '#c08870' },
];

/** The sizes there's art for: houses 3 to 8 tiles a side, towers square and 3 to 5. */
export const BUILDING_SIZES = { min: 3, max: 8, towerMin: 3, towerMax: 5 } as const;

export function buildingSizeOk(style: string, w: number, h: number): boolean {
  const { min, max, towerMin, towerMax } = BUILDING_SIZES;
  return style === 'tower' ? w === h && w >= towerMin && w <= towerMax : w >= min && w <= max && h >= min && h <= max;
}

/** The buildings placed on a map (their walls block walking in the game, except where an object stands). */
export function buildings(map: WorldMap): GameBuilding[] {
  return map.features
    .filter((f) => f.type === 'building')
    .map((f) => {
      const p = placeProps(f);
      return {
        x: f.c,
        y: f.r,
        w: Math.round(Number(p.w)),
        h: Math.round(Number(p.h)),
        style: String(p.style),
        sign: String(p.sign ?? ''),
        roof: String(p.roof ?? ''),
        walls: String(p.walls ?? ''),
      };
    });
}

const masks = new WeakMap<WorldMap, { key: string; mask: Uint8Array }>();
/** 1 for every cell inside a building's walls with nothing standing on it. Cached per map. */
export function buildingMask(map: WorldMap): Uint8Array {
  const list = buildings(map);
  let key = `${map.width}x${map.height}`;
  for (const b of list) key += `|${b.x},${b.y},${b.w},${b.h}`;
  const cached = masks.get(map);
  if (cached && cached.key === key) return cached.mask;
  const mask = new Uint8Array(map.width * map.height);
  for (const b of list) {
    for (let y = b.y; y < b.y + b.h && y < map.height; y++) {
      for (let x = b.x; x < b.x + b.w && x < map.width; x++) {
        const i = y * map.width + x;
        if (!gameObject(map.layers.object[i])) mask[i] = 1;
      }
    }
  }
  masks.set(map, { key, mask });
  return mask;
}

/** Which wall a door at (x, y) is in: south or east (the walls the game's camera sees), or null. */
export function doorFace(b: GameBuilding, x: number, y: number): 's' | 'e' | null {
  const inX = x > b.x && x < b.x + b.w - 1;
  const inY = y > b.y && y < b.y + b.h - 1;
  if (y === b.y + b.h - 1 && inX) return 's';
  if (x === b.x + b.w - 1 && inY) return 'e';
  return null;
}

// ---- townspeople -------------------------------------------------------------------------

export const NPC_ROLES = [
  { value: 'banker', label: 'Banker' },
  { value: 'general', label: 'General Store keeper' },
  { value: 'smith', label: 'Blacksmith' },
  { value: 'mage', label: 'Wizard (Mage Tower)' },
  { value: 'alchemist', label: 'Alchemist' },
  { value: 'tailor', label: 'Tailor' },
  { value: 'fletcher', label: 'Fletcher' },
  { value: 'inn', label: 'Innkeeper' },
  { value: 'mayor', label: 'Mayor' },
  { value: 'captain', label: 'Guard captain' },
  { value: 'villager', label: 'Villager' },
  { value: 'slayer', label: 'Slayer master' },
  // The people outside town, who just talk (and give quests).
  { value: 'hermit', label: 'Hermit (Old Ansel)' },
  { value: 'fisher', label: 'Fisher (Moira)' },
  { value: 'farmer', label: 'Farmer (Giles)' },
  { value: 'trapper', label: 'Trapper (Rook)' },
  { value: 'miner', label: 'Miner (Dobbs)' },
];
/** Townspeople worth robbing, who keep a guard indoors with them (the game's `guarded` in thieving.ts). */
export const GUARDED_ROLES = new Set(['mayor']);

/** Whether someone at (fx, fy) can talk to a townsperson at (x, y): next to them, or across a counter. */
export function canTalkFrom(map: WorldMap, fx: number, fy: number, x: number, y: number): boolean {
  const dx = fx - x;
  const dy = fy - y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) <= 1) return true;
  if (!((Math.abs(dx) === 2 && dy === 0) || (Math.abs(dy) === 2 && dx === 0))) return false;
  return map.layers.object[(y + dy / 2) * map.width + x + dx / 2] === O.COUNTER;
}

/** The walkable tiles you can talk to a townsperson at (x, y) from. */
export function talkSpots(map: WorldMap, x: number, y: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let sy = y - 2; sy <= y + 2; sy++) {
    for (let sx = x - 2; sx <= x + 2; sx++) {
      if ((sx !== x || sy !== y) && isWalkableAt(map, sx, sy) && canTalkFrom(map, sx, sy, x, y)) out.push({ x: sx, y: sy });
    }
  }
  return out;
}

export function isWalkableAt(map: WorldMap, x: number, y: number, mask?: Uint8Array): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height && isWalkable(map, y * map.width + x, mask);
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
export function reachable(map: WorldMap, starts: { x: number; y: number }[], walk: Uint8Array = walkableTiles(map)): Uint8Array {
  const w = map.width;
  const h = map.height;
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let tail = 0;
  for (const s of starts) {
    if (s.x < 0 || s.y < 0 || s.x >= w || s.y >= h) continue;
    const i = s.y * w + s.x;
    if (!walk[i] || seen[i]) continue;
    seen[i] = 1;
    queue[tail++] = i;
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    const cx = i % w;
    const cy = (i - cx) / w;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (!walk[k] || seen[k]) continue;
      if (dx && dy && (!walk[cy * w + nx] || !walk[ny * w + cx])) continue;
      seen[k] = 1;
      queue[tail++] = k;
    }
  }
  return seen;
}

// ---- town guards -------------------------------------------------------------------------

/**
 * Where the game posts its town guards, as its server does: at each gate of the Safe zone (a
 * walkable Safe tile beside a walkable tile outside it), one step further in where that's open
 * Safe ground too, and only one guard within 2 tiles. `outside` is where criminals and murderers
 * come back after dying: 3 tiles out of the first gate (or just outside it), or null with no gate.
 */
export function guardPosts(map: WorldMap, walk?: Uint8Array): { posts: { x: number; y: number }[]; outside: { x: number; y: number } | null } {
  const posts: { x: number; y: number }[] = [];
  let outside: { x: number; y: number } | null = null;
  if (gameKind(map) !== 'overworld') return { posts, outside };
  const w = map.width;
  const zone = map.layers.zone;
  const SAFE = ZONES.find((z) => z.key === 'safe')!.id;
  // Only the town is Safe: look at the open tiles there (the walkable tiles worked out just for it).
  let tiles = walk;
  if (!tiles) {
    let any = false;
    for (let i = 0; i < zone.length && !any; i++) any = zone[i] === SAFE;
    if (!any) return { posts, outside };
  }
  const mask = tiles ? null : buildingMask(map);
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < map.height && (tiles ? tiles[y * w + x] === 1 : isWalkable(map, y * w + x, mask!));
  const safe = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < map.height && zone[y * w + x] === SAFE;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      // The zone first: it's quick, and only the town is Safe, so this stays fast on a big overworld.
      if (!safe(x, y) || !open(x, y)) continue;
      for (const [dx, dy] of STRAIGHT) {
        const ox = x + dx;
        const oy = y + dy;
        if (!open(ox, oy) || safe(ox, oy)) continue;
        const post = open(x - dx, y - dy) && safe(x - dx, y - dy) ? { x: x - dx, y: y - dy } : { x, y };
        if (posts.some((p) => Math.max(Math.abs(p.x - post.x), Math.abs(p.y - post.y)) <= 2)) continue;
        posts.push(post);
        const far = { x: x + dx * 3, y: y + dy * 3 };
        outside ??= open(far.x, far.y) && !safe(far.x, far.y) ? far : { x: ox, y: oy };
      }
    }
  }
  return { posts, outside };
}
/** The game's order for the four straight neighbours when posting guards. */
const STRAIGHT = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * The guards the game keeps indoors, since the town's guards can't come in: in a building's inside,
 * one for each townsperson worth robbing (the mayor, in the Town Hall), two steps from them on the
 * first open floor tile, scanning rows from the north-west, where no other townsperson stands.
 */
export function houseGuards(map: WorldMap): { x: number; y: number }[] {
  const posts: { x: number; y: number }[] = [];
  if (gameKind(map) !== 'interior') return posts;
  const people = map.features.filter((f) => f.type === 'npc');
  for (const f of people) {
    if (!GUARDED_ROLES.has(String(placeProps(f).role))) continue;
    let post: { x: number; y: number } | null = null;
    for (let y = f.r - 2; y <= f.r + 2 && !post; y++) {
      for (let x = f.c - 2; x <= f.c + 2 && !post; x++) {
        if (Math.max(Math.abs(x - f.c), Math.abs(y - f.r)) === 2 && isWalkableAt(map, x, y) && !people.some((n) => n.c === x && n.r === y)) post = { x, y };
      }
    }
    if (post) posts.push(post);
  }
  return posts;
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
  {
    id: 3,
    key: 'wilderness',
    name: 'Wilderness',
    color: '#e07a30',
    rules: 'PvP with laws: attacking an innocent player makes you a criminal, killing one is a murder. Keep 1 item (murderers keep nothing, anywhere). Anyone can loot graves. Graves last 6 min.',
  },
  { id: 4, key: 'deep', name: 'Deep', color: '#c03a4a', rules: 'PvP, no laws. Keep 0 items. Anyone can loot graves. Graves last 6 min.' },
];
export const ZONE_LEGEND = ZONES.map((z) => z.key);

export function zoneByKey(key: unknown): ZoneDef | undefined {
  return ZONES.find((z) => z.key === key);
}

// ---- dungeon looks ------------------------------------------------------------------------

/** How a dungeon floor can look in the game (its `theme`); stored in `settings.rpgdcTheme`. */
export const DUNGEON_THEMES = [
  { value: 'crypt', label: 'Crypt (dressed stone)' },
  { value: 'sewer', label: 'Sewers (damp stone; water is sewer water)' },
  { value: 'cave', label: 'Caverns (rough rock; water is lava)' },
];

/** A dungeon floor's chosen theme, if it has one. */
export function mapTheme(map: WorldMap): string | undefined {
  const t = map.settings.rpgdcTheme;
  return typeof t === 'string' && t !== '' ? t : undefined;
}

/** How a dungeon floor looks: its theme, or without one the sewers if it has water, else the crypt. */
export function dungeonTheme(map: WorldMap): string {
  return mapTheme(map) ?? (map.layers.terrain.includes(T.WATER) ? 'sewer' : 'crypt');
}

/** The whole-map zone of a dungeon floor. */
export function mapZone(map: WorldMap): ZoneDef | undefined {
  return zoneByKey(map.settings.rpgdcZone);
}

/** Zone of a cell: the map's zone on dungeon floors and insides, the zone layer on the overworld. */
export function zoneAt(map: WorldMap, i: number): ZoneDef | undefined {
  if (gameKind(map) !== 'overworld') return mapZone(map);
  return ZONES[map.layers.zone[i] - 1];
}

/**
 * Zone by distance from the town centre (larger of the column and row distance), as the game had
 * it before its bigger town (now: Safe to 14, Frontier to 30, Wilderness to 48). Only used to
 * convert projects made from its first, seed-generated maps.
 */
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
  { key: 'sewer_rat', name: 'Sewer rat', range: 6 },
  { key: 'slime', name: 'Slime', range: 5 },
  { key: 'beetle', name: 'Sewer beetle', range: 7 },
  { key: 'rat_king', name: 'Rat King', range: 6 },
  { key: 'fire_ant', name: 'Fire ant', range: 7 },
  { key: 'hobgoblin', name: 'Hobgoblin', range: 8 },
  { key: 'fire_wyvern', name: 'Fire wyvern', range: 8 },
  { key: 'cinder_wyrm', name: 'Cinder Wyrm', range: 7 },
  // The new lands: the desert, the swamp and the mountains (the first three nearer town).
  { key: 'scarab', name: 'Scarab (desert)', range: 7 },
  { key: 'bog_goblin', name: 'Bog goblin (swamp)', range: 7 },
  { key: 'frost_ant', name: 'Frost ant (mountains)', range: 7 },
  { key: 'mummy', name: 'Mummy (desert)', range: 7 },
  { key: 'drowned', name: 'Drowned one (swamp)', range: 7 },
  { key: 'yeti', name: 'Yeti (mountains)', range: 8 },
  { key: 'antlion', name: 'Antlion (desert)', range: 6 },
  { key: 'swamp_wyvern', name: 'Swamp wyvern', range: 8 },
  { key: 'ice_wyvern', name: 'Ice wyvern', range: 8 },
  // Only players with the Slayer level can hurt these.
  { key: 'cave_crawler', name: 'Cave crawler (Slayer 10)', range: 6 },
  { key: 'banshee', name: 'Banshee (Slayer 25)', range: 7 },
  { key: 'basilisk', name: 'Basilisk (Slayer 45)', range: 7 },
  { key: 'gargoyle', name: 'Gargoyle (Slayer 65)', range: 6 },
];

/** A monster's normal roaming range in tiles: the radius a new spawn of it starts with. */
export function normalRange(kind: unknown): number {
  return MONSTER_KINDS.find((k) => k.key === kind)?.range ?? 8;
}

export interface PlaceField {
  key: string;
  label: string;
  type: 'select' | 'number' | 'map' | 'text';
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

export const PLACE_TYPES = ['spawn_point', 'monster_spawn', 'boss', 'brazier', 'link', 'building', 'npc', 'fort', 'merchant', 'landmark'] as const;

/** A guild fort's yard: this far round its banner (the game's FORT_RADIUS); its palisade is one further out. */
export const FORT_RADIUS = 4;
/** Fort ids, as the game takes them (holders are saved by id, so keep it once players use the fort). */
export const FORT_ID = /^[a-z][a-z0-9_]{1,30}$/;
/** Where a fort's chest stands: just east of its banner. */
export const fortChest = (x: number, y: number) => ({ x: x + 1, y });
/** The game's Duel Arena map: every place you can stand there that can't be walked to from its door is a pit. */
export const ARENA_MAP_ID = 'arena';

/** Landmark ids, as the game takes them (LANDMARK_ID in its landmarks.ts; players' finds are saved by id). */
export const LANDMARK_ID = /^[a-z][a-z0-9_]{1,30}$/;
/** How big a landmark can be (tiles from its middle), and how big one is when its place doesn't say. */
export const LANDMARK_RADIUS = { min: 2, max: 40, default: 10 } as const;
/** A landmark's name is up to this many letters. */
export const LANDMARK_NAME_MAX = 40;

/** A landmark place as the game reads it: its id and name (trimmed), middle and radius. */
export interface GameLandmark {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  feature: Feature;
}

/** The landmark places on a map, in the order the game reads them. */
export function landmarks(map: WorldMap): GameLandmark[] {
  return map.features
    .filter((f) => f.type === 'landmark')
    .map((f) => {
      const p = placeProps(f);
      return { id: String(p.id).trim(), name: String(p.name).trim(), x: f.c, y: f.r, radius: Number(p.radius), feature: f };
    });
}

/**
 * The landmark tile (x, y) is in, as the game finds it (landmarkAt in its landmarks.ts): within a
 * landmark's radius of its middle (straight-line distance), the nearest middle where several
 * overlap, the first of those at the same distance. Null when it's in none.
 */
export function landmarkAt(list: readonly GameLandmark[], x: number, y: number): GameLandmark | null {
  let best: GameLandmark | null = null;
  let bestD = Infinity;
  for (const l of list) {
    const d = Math.hypot(l.x - x, l.y - y);
    if (d > l.radius) continue;
    if (!best || d < bestD) {
      best = l;
      bestD = d;
    }
  }
  return best;
}

/**
 * Fields for a new place on `map`: the defaults, and for a landmark an id and a name not used on
 * the map yet (landmark_2, "Landmark 2"), to change in its fields.
 */
export function newPlaceProps(map: WorldMap, type: string): Record<string, string | number> | undefined {
  const props = defaultProps(type);
  if (type === 'landmark' && props) {
    const taken = new Set(landmarks(map).map((l) => l.id));
    let n = taken.size + 1;
    while (taken.has(`landmark_${n}`)) n++;
    props.id = `landmark_${n}`;
    props.name = `Landmark ${n}`;
  }
  return props;
}

/** Places whose `name` field is what the map shows as their label (the editor keeps the two together). */
export const NAMED_PLACES = new Set(['fort', 'landmark']);

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
  building: [
    { key: 'style', label: 'Style', type: 'select', options: BUILDING_STYLES, default: 'timber' },
    { key: 'w', label: 'Width (tiles, along x)', type: 'number', min: BUILDING_SIZES.min, max: BUILDING_SIZES.max, default: 5 },
    { key: 'h', label: 'Depth (tiles, along y)', type: 'number', min: BUILDING_SIZES.min, max: BUILDING_SIZES.max, default: 4 },
    { key: 'sign', label: 'Name (on its sign)', type: 'text', default: '' },
    { key: 'roof', label: 'Roof colour', type: 'select', options: [{ value: '', label: "The style's own" }, ...ROOF_COLOURS], default: '' },
    { key: 'walls', label: 'Wall colour', type: 'select', options: [{ value: '', label: "The style's own" }, ...WALL_COLOURS], default: '' },
  ],
  npc: [{ key: 'role', label: 'Who', type: 'select', options: NPC_ROLES, default: 'general' }],
  fort: [
    { key: 'id', label: 'Id (letters, digits, _; keep it once players use the fort)', type: 'text', default: '' },
    { key: 'name', label: 'Name (as in "taken the Deep Keep")', type: 'text', default: '' },
  ],
  merchant: [],
  landmark: [
    { key: 'id', label: 'Id (letters, digits, _; keep it once players have found it)', type: 'text', default: '' },
    { key: 'name', label: "Name (shown as players arrive, like Moira's Lake)", type: 'text', default: '' },
    { key: 'radius', label: 'Radius (tiles from here)', type: 'number', min: LANDMARK_RADIUS.min, max: LANDMARK_RADIUS.max, default: LANDMARK_RADIUS.default },
  ],
};

export const PLACE_HELP: Record<string, string> = {
  spawn_point: 'Where new players start. Exactly one, on the overworld, in the Safe zone.',
  monster_spawn:
    'Monsters of one kind live here. Radius: how far they roam from here (they chase you that far). 0: they stay on their tile and only fight what comes next to them. Picking a monster sets its normal range.',
  boss: 'A boss fight.',
  brazier: 'A light in the crypt.',
  link: 'Put it on a crypt entrance, stairs, a door or a sewer grate. Players using it arrive on the chosen tile of the target map. Stairs down (and grates) need stairs up leading back; a door needs a door back.',
  building:
    'A house: this tile is its north-west (top) corner, and its walls fill Width × Depth tiles. Houses are 3 to 8 tiles a side; towers are square, 3 to 5. Put a Door object in its south or east wall (not a corner) and a link on the door to the inside.',
  fort: `A guild fort, on its banner's tile: guilds take it by standing in its yard (${FORT_RADIUS} tiles round the banner) and its chest (just east of the banner) gives the holders a reward each day. Put it in the Deep, with a palisade of fences round the yard and a gate in each side.`,
  merchant: 'Where the travelling merchant stands when she visits (one, on the overworld, in the Safe zone, where players can walk up to her).',
  landmark: `A named place on the overworld (the town, a lake, a keep), on its middle: walking within its radius (${LANDMARK_RADIUS.min} to ${LANDMARK_RADIUS.max} tiles, a circle) shows its name, and the first time counts as finding it. Put one Waystone object inside it (not in the Deep) for fast travel between the landmarks players have found.`,
  npc: "A townsperson who stands here all day: tap them in the game to bank or trade. The mayor (tips for new players), guard captain (the laws) and villagers (gossip) just talk, as do the people outside town (the hermit, fisher, farmer, trapper and miner); the Slayer master gives Slayer tasks. Talkers give quests: villagers by the map they're in (home1 to home4), the rest by their role, so keep those map ids and one of each role. Put a Counter in front of a banker or shopkeeper; players talk across it.",
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

/** What a link stands on: a way down (entrance, stairs, the sewer grate), up, or a door. */
export function stairsDirection(objectId: number): 'down' | 'up' | 'door' | null {
  if (objectId === O.CRYPT_ENTRANCE || objectId === O.STAIRS_DOWN || objectId === O.SEWER_GRATE) return 'down';
  if (objectId === O.STAIRS_UP) return 'up';
  if (objectId === O.DOOR) return 'door';
  return null;
}

/** Which way a link must lead back. */
export const BACK = { down: 'up', up: 'down', door: 'door' } as const;

export function gridOf(map: WorldMap): Grid {
  return new Grid(map.grid, map.width, map.height);
}
