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
const GAME_OBJECT_COUNT = 82;
/** Export order of objects; index = value in the exported `objects` layer (0 = nothing). */
export const OBJECT_LEGEND = OBJECTS.slice(0, GAME_OBJECT_COUNT).map((d) => d.key);
export const GAME_OBJECTS = OBJECTS.slice(1, GAME_OBJECT_COUNT);
/**
 * Farming's patches: the game gives them no tile of their own (its OBJECT_TILE null), so a patch's
 * cell is the ground's, walkable where the ground is, and a building's walls don't cover it.
 */
export const FARM_PATCHES = new Set<number>([O.PATCH_ALLOTMENT, O.PATCH_HERB, O.PATCH_TREE]);
/**
 * How each of the game's objects walks, by object index: BLOCKS (most), OPEN (the thicket, whose
 * tile is walkable wherever it stands) or GROUND (Farming's patches, walkable where the ground
 * under them is). In the game a cell with an object takes the object's tile, if it has one,
 * whatever the ground under it.
 */
const BLOCKS = 0;
const OPEN = 1;
const GROUND = 2;
const OBJECT_WALK = Uint8Array.from(OBJECT_LEGEND, (_, k) => (k === 0 || OBJECTS[k].blocks ? BLOCKS : FARM_PATCHES.has(k) ? GROUND : OPEN));

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

/**
 * Walkable in the game: walkable ground with nothing standing on it, and not inside a building's
 * walls; or a thicket, which you push through (wherever it stands, as in the game); or a Farming
 * patch on walkable ground (it lies flat on it).
 */
export function isWalkable(map: WorldMap, i: number, mask: Uint8Array = buildingMask(map)): boolean {
  const o = gameObject(map.layers.object[i]);
  if (o && OBJECT_WALK[o] !== GROUND) return OBJECT_WALK[o] === OPEN;
  return GROUND_WALKABLE[gameGround(map.layers.terrain[i])] && (o !== 0 || !mask[i]);
}

/** Whether each World Builder tile is ground the game walks on (by tile id), worked out once. */
const WALKABLE_TILE = TILES.map((t) => GROUND_WALKABLE[gameGround(t.id)]);

/** Whether a World Builder tile is ground the game walks on (with nothing standing on it). */
export function walkableGround(tileId: number): boolean {
  return WALKABLE_TILE[tileId] ?? GROUND_WALKABLE[gameGround(tileId)];
}

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
    const walk = o > 0 && o < objects ? OBJECT_WALK[o] : -1;
    if (walk === BLOCKS || walk === OPEN) {
      out[i] = walk;
      continue;
    }
    const ground = WALKABLE_TILE[t] ?? GROUND_WALKABLE[gameGround(t)];
    if (ground && (walk === GROUND || !mask[i])) out[i] = 1;
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
  { value: 'miller', label: 'Miller (Hob, in the windmill)' },
  // Gullhaven's harbourmaster, by the ferry, and the castaway out on Wrecker's Isle (they just talk).
  { value: 'harbourmaster', label: 'Harbourmaster (Bligh, by the ferry)' },
  { value: 'castaway', label: 'Castaway (Marooned Meg)' },
  // Farming: Martha sells seeds and compost at Giles's Farm (a shop, like the General Store).
  { value: 'seeds', label: "Seed seller (Martha, at Giles's Farm)" },
  // Land and houses: Pemberton sells plots of land, in town by the bank and in Gullhaven.
  { value: 'land_agent', label: 'Land agent (Pemberton, sells plots of land)' },
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
 * The tiles players can get through (`walk` as walkableTiles), with gates and locked doors open:
 * each player opens them for themselves, with their levers and keys, so the game's checks count
 * them as open (its reachableFrom). Monsters never pass them: for monsters, use `walk`.
 */
export function passableTiles(map: WorldMap, walk: Uint8Array = walkableTiles(map)): Uint8Array {
  const out = Uint8Array.from(walk);
  const object = map.layers.object;
  for (let i = 0; i < out.length; i++) if (object[i] === O.GATE || object[i] === O.LOCKED_DOOR) out[i] = 1;
  return out;
}

/**
 * Tiles reachable on foot from `starts`: 8 directions, and no cutting a corner past a blocked
 * tile (the game's pathfinding rule). Gates and locked doors count as open, as in the game's
 * checks, unless `walk` says otherwise. From beside a boat you can sail where its ferry lands
 * (the game's reachableFrom), so an island counts as reached.
 */
export function reachable(map: WorldMap, starts: { x: number; y: number }[], walk: Uint8Array = passableTiles(map)): Uint8Array {
  const w = map.width;
  const h = map.height;
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const sails = ferryHops(map);
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
      // A boat beside this tile: where its ferries land is reached too.
      const landings = sails?.get(k);
      if (landings) {
        for (const t of landings) {
          if (!walk[t] || seen[t]) continue;
          seen[t] = 1;
          queue[tail++] = t;
        }
      }
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
 * come back after dying: 3 tiles out of a gate (or just outside it), the one nearest the spawn
 * point, so not another town's gate (Gullhaven's); null with no gate.
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
  const spawn = map.features.find((f) => f.type === 'spawn_point');
  const fromSpawn = (p: { x: number; y: number }) => Math.max(Math.abs(p.x - (spawn?.c ?? 0)), Math.abs(p.y - (spawn?.r ?? 0)));
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
        const there = open(far.x, far.y) && !safe(far.x, far.y) ? far : { x: ox, y: oy };
        if (!outside || fromSpawn(there) < fromSpawn(outside)) outside = there;
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
  { value: 'frost', label: 'Frozen Peaks (ice walls over snow; water is thin ice)' },
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
  // The Frozen Peaks (a dungeon of the frost theme): the Ice Warden carries the key to its locked
  // door, frost wraiths haunt it, and the Frost Giant is its boss.
  { key: 'ice_warden', name: 'Ice warden (Frozen Peaks)', range: 6 },
  { key: 'frost_wraith', name: 'Frost wraith (Frozen Peaks)', range: 8 },
  { key: 'frost_giant', name: 'Frost Giant (boss)', range: 7 },
  // Wrecker's Isle, out in the sea: giant crabs on its beaches, the pirates who lure ships onto its
  // rocks, and their captain (a boss, placed with a monster spawn).
  { key: 'giant_crab', name: "Giant crab (Wrecker's Isle)", range: 5 },
  { key: 'pirate', name: "Pirate (Wrecker's Isle)", range: 8 },
  { key: 'pirate_captain', name: 'Captain Redhook (pirate boss)', range: 7 },
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

export const PLACE_TYPES = ['spawn_point', 'monster_spawn', 'boss', 'brazier', 'link', 'building', 'npc', 'fort', 'merchant', 'landmark', 'lever', 'lock', 'ferry', 'plot'] as const;

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

// ---- dungeon puzzles: gates, levers and locked doors (the game's gates.ts) ----------------

/**
 * Keys the game has (items that open a `lock`), as far as World Builder knows. The game takes any
 * of its items as a key; it refuses a lock whose key isn't one.
 */
export const KEY_ITEMS = [{ value: 'frost_key', label: 'Frost key (the Ice Warden drops it)' }];
/** An item id as the game writes them: lower-case letters, digits and _. */
export const ITEM_ID = /^[a-z][a-z0-9_]*$/;

/** A lever place as the game reads it: the lever at (x, y) is wired to the gate at (toX, toY), on the same map. */
export interface GameLever {
  x: number;
  y: number;
  toX: number;
  toY: number;
  feature: Feature;
}

/** The lever places on a map, in the order the game reads them. */
export function leverWires(map: WorldMap): GameLever[] {
  return map.features
    .filter((f) => f.type === 'lever')
    .map((f) => {
      const p = placeProps(f);
      return { x: f.c, y: f.r, toX: Number(p.toX), toY: Number(p.toY), feature: f };
    });
}

/** A lock place: the locked door at (x, y), and the item that unlocks it (trimmed). */
export interface GameLock {
  x: number;
  y: number;
  key: string;
  feature: Feature;
}

/** The lock places on a map, in the order the game reads them. */
export function doorLocks(map: WorldMap): GameLock[] {
  return map.features
    .filter((f) => f.type === 'lock')
    .map((f) => ({ x: f.c, y: f.r, key: String(placeProps(f).key ?? '').trim(), feature: f }));
}

/** The crypt wall's index among the game's grounds. */
const CRYPT_WALL = GROUND_LEGEND.indexOf('crypt_wall');

/**
 * Which way a gate or locked door at (x, y) runs, as the game's doorFacing picks its art: "x"
 * (across a passage running north–south) when the tile to its west or east is a wall, else "y".
 * A wall is crypt wall with nothing standing on it, as the game sees it.
 */
export function doorFacing(map: WorldMap, x: number, y: number): 'x' | 'y' {
  const wall = (wx: number) => {
    if (wx < 0 || wx >= map.width || y < 0 || y >= map.height) return false;
    const i = y * map.width + wx;
    return gameObject(map.layers.object[i]) === 0 && gameGround(map.layers.terrain[i]) === CRYPT_WALL;
  };
  return wall(x - 1) || wall(x + 1) ? 'x' : 'y';
}

/**
 * The object `o` nearest (x, y) on a map (a straight line; the first of those as near, scanning
 * rows), leaving out the one on (x, y) itself if `others`; null with none.
 */
function nearestObject(map: WorldMap, o: number, x: number, y: number, others = false): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  const object = map.layers.object;
  for (let i = 0; i < object.length; i++) {
    if (object[i] !== o) continue;
    const gx = i % map.width;
    const gy = Math.floor(i / map.width);
    if (others && gx === x && gy === y) continue;
    const d = Math.hypot(gx - x, gy - y);
    if (d < bestD) {
      best = { x: gx, y: gy };
      bestD = d;
    }
  }
  return best;
}

/** The gate nearest (x, y) on a map (a straight line; the first of those as near, scanning rows), or null with none. */
export function nearestGate(map: WorldMap, x: number, y: number): { x: number; y: number } | null {
  return nearestObject(map, O.GATE, x, y);
}

// ---- the sea: boats and their ferries (the game's WorldMap.ferries) ----------------------

/** What a ferry can cost, in whole coins, and how long the name of where it goes can be (the game refuses others). */
export const FERRY_FARE = { min: 0, max: 10000 } as const;
export const FERRY_NAME_MAX = 40;

/**
 * A ferry place as the game reads it: the boat at (x, y) sails to (toX, toY) on the same map, for
 * `fare` coins; `name` (trimmed) is where it goes ("Wrecker's Isle").
 */
export interface GameFerry {
  x: number;
  y: number;
  toX: number;
  toY: number;
  fare: number;
  name: string;
  feature: Feature;
}

/** The ferry places on a map, in the order the game reads them. */
export function ferries(map: WorldMap): GameFerry[] {
  return map.features
    .filter((f) => f.type === 'ferry')
    .map((f) => {
      const p = placeProps(f);
      return { x: f.c, y: f.r, toX: Number(p.toX), toY: Number(p.toY), fare: Number(p.fare), name: String(p.name ?? '').trim(), feature: f };
    });
}

/** Where each boat's ferries land, by the boat's cell (both on the map), or null with no ferry. */
function ferryHops(map: WorldMap): Map<number, number[]> | null {
  let hops: Map<number, number[]> | null = null;
  const inside = (x: number, y: number) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;
  for (const f of ferries(map)) {
    if (!inside(f.x, f.y) || !inside(f.toX, f.toY)) continue;
    hops ??= new Map();
    const k = f.y * map.width + f.x;
    hops.set(k, [...(hops.get(k) ?? []), f.toY * map.width + f.toX]);
  }
  return hops;
}

/**
 * Which way the game lays a boat at (x, y) in the water: along y (its `boat-y` art) when the jetty,
 * a tile you can walk on, is west or east of it; else along x (`boat-x`).
 */
export function boatFacing(map: WorldMap, x: number, y: number): 'x' | 'y' {
  return isWalkableAt(map, x - 1, y) || isWalkableAt(map, x + 1, y) ? 'y' : 'x';
}

// ---- land: plots players buy and build a house on (the game's land.ts) -------------------

/** How many tiles a side a plot can be: 12, or 20 for a large one (room for a guild's hall). The game refuses others. */
export const PLOT_SIZES = [12, 20] as const;
/** Plot ids, as the game takes them (its FORT_ID: owners are saved by id, so keep it once players own the plot). */
export const PLOT_ID = FORT_ID;

/**
 * A plot place as the game reads it: its id (trimmed), its north-west corner (x, y) and how many
 * tiles a side it is.
 */
export interface GamePlot {
  id: string;
  x: number;
  y: number;
  size: number;
  feature: Feature;
}

/** The plot places on a map, in the order the game reads them. */
export function plots(map: WorldMap): GamePlot[] {
  return map.features
    .filter((f) => f.type === 'plot')
    .map((f) => {
      const p = placeProps(f);
      return { id: String(p.id ?? '').trim(), x: f.c, y: f.r, size: Number(p.size), feature: f };
    });
}

/** Whether a plot's size is one the game takes (12 or 20). */
export const plotSizeOk = (size: number): boolean => (PLOT_SIZES as readonly number[]).includes(size);

/** The first plot (x, y) is on (the game's plotAt), or null. */
export function plotAt(list: readonly GamePlot[], x: number, y: number): GamePlot | null {
  return list.find((p) => x >= p.x && y >= p.y && x < p.x + p.size && y < p.y + p.size) ?? null;
}

/**
 * Where a plot's sign stands (the game's plotSign): in the middle of its south edge, its front,
 * where it says it's for sale and its owner taps to build. The house goes up at the back.
 */
export function plotSign(p: { x: number; y: number; size: number }): { x: number; y: number } {
  return { x: p.x + Math.floor(p.size / 2), y: p.y + p.size - 1 };
}

/**
 * Fields for a new place on `map` (at `at`, when it's known): the defaults; for a landmark an id
 * and a name not used on the map yet (landmark_2, "Landmark 2"), to change in its fields; for a
 * lever, wired to the nearest gate; for a ferry, landing beside the nearest other boat (the way
 * back is usually its pair), named after the landmark it lands in; for a plot, an id not used on
 * the map yet (plot37).
 */
export function newPlaceProps(map: WorldMap, type: string, at?: { x: number; y: number }): Record<string, string | number> | undefined {
  const props = defaultProps(type);
  if (type === 'landmark' && props) {
    const taken = new Set(landmarks(map).map((l) => l.id));
    let n = taken.size + 1;
    while (taken.has(`landmark_${n}`)) n++;
    props.id = `landmark_${n}`;
    props.name = `Landmark ${n}`;
  }
  if (type === 'lever' && props && at) {
    const gate = nearestGate(map, at.x, at.y);
    if (gate) {
      props.toX = gate.x;
      props.toY = gate.y;
    }
  }
  if (type === 'ferry' && props && at) {
    const boat = nearestObject(map, O.BOAT, at.x, at.y, true);
    const landing = boat && besideTile(map, boat.x, boat.y);
    if (landing) {
      props.toX = landing.x;
      props.toY = landing.y;
      props.name = landmarkAt(landmarks(map), landing.x, landing.y)?.name ?? '';
    }
  }
  if (type === 'plot' && props) {
    const taken = new Set(plots(map).map((p) => p.id));
    let n = taken.size + 1;
    while (taken.has(`plot${n}`)) n++;
    props.id = `plot${n}`;
  }
  return props;
}

/** Places whose `name` field gives their label on the map (the editor keeps the two together). */
export const NAMED_PLACES = new Set(['fort', 'landmark', 'ferry']);

/**
 * The label a named place shows on the map, from its name: a fort's or a landmark's name, and
 * "Ferry → Wrecker's Isle" for a ferry. Null without a name, or for other places.
 */
export function namedLabel(type: string, name: unknown): string | null {
  const n = String(name ?? '').trim();
  if (!n || !NAMED_PLACES.has(type)) return null;
  return type === 'ferry' ? `Ferry → ${n}` : n;
}

/** The field each labelled place's label comes from: a fort's, landmark's or ferry's name, a plot's id. */
export const LABEL_FIELD: Record<string, string> = { fort: 'name', landmark: 'name', ferry: 'name', plot: 'id' };

/**
 * The label a place shows on the map, from its fields: a named place's (namedLabel), and a plot's
 * id ("plot11"). Null when that field is empty, or for other places.
 */
export function placeLabel(type: string, props: Record<string, unknown> | undefined): string | null {
  if (type !== 'plot') return namedLabel(type, props?.name);
  return String(props?.id ?? '').trim() || null;
}

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
  lever: [
    { key: 'toX', label: 'Opens the gate at x (column)', type: 'number', min: 0, max: 1023, default: 0 },
    { key: 'toY', label: 'Opens the gate at y (row)', type: 'number', min: 0, max: 1023, default: 0 },
  ],
  lock: [{ key: 'key', label: 'Key (the item that unlocks it)', type: 'text', options: KEY_ITEMS, default: KEY_ITEMS[0].value }],
  ferry: [
    { key: 'toX', label: 'Lands at x (column)', type: 'number', min: 0, max: 1023, default: 0 },
    { key: 'toY', label: 'Lands at y (row)', type: 'number', min: 0, max: 1023, default: 0 },
    { key: 'fare', label: 'Fare (coins; 0 is free)', type: 'number', min: FERRY_FARE.min, max: FERRY_FARE.max, default: 0 },
    { key: 'name', label: "Where it goes (shown to players, like Wrecker's Isle)", type: 'text', default: '' },
  ],
  plot: [
    { key: 'id', label: 'Id (letters, digits, _; keep it once players own the plot)', type: 'text', default: '' },
    {
      key: 'size',
      label: 'Size (tiles a side)',
      type: 'select',
      options: [
        { value: '12', label: '12 × 12' },
        { value: '20', label: "20 × 20 (large: room for a guild's hall)" },
      ],
      default: 12,
    },
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
  lever: 'On a Lever object: wires it to a Gate on this map (tap 🎯 Pick the gate, then the gate). A gate opens, for whoever pulled them and their party on that floor, once every lever wired to it is pulled; one place per lever and gate, so a lever can open several gates and a gate can need several levers. Monsters never pass a gate.',
  lock: "On a Locked door object: the item that unlocks it (the game's item id, like frost_key). A player who brings the key uses it up, and the door stays unlocked for them for good.",
  ferry: `On a Ferry boat object, moored by a jetty: players beside the boat tap it to sail to the landing tile on this map (tap 🎯 Pick the landing, then the tile) for its fare, ${FERRY_FARE.min} to ${FERRY_FARE.max} coins (0 is free). Its name is where it goes, shown to players ("the ferry to Wrecker's Isle"). One ferry per boat: for the way back, moor a boat by the landing with a ferry of its own. What players can reach from the landing counts as reached from beside the boat.`,
  plot: "A plot of land players buy from the land agent and build a house on: this tile is its north-west (top) corner, and it's 12 × 12 tiles, or 20 × 20 for a large one (the line on the map). On the overworld, out of the Safe zone, and all open ground players can walk to: nothing standing on it (no objects at all), no doors or stairs, townspeople, monster spawns, forts or the merchant, and not overlapping another plot. Its sign stands in the middle of its south edge, its front; the house goes up at the back. Keep its id once players own it.",
  npc: "A townsperson who stands here all day: tap them in the game to bank or trade (Martha, the seed seller, sells seeds and compost by the farm's field; Pemberton, the land agent, sells plots of land). The mayor (tips for new players), guard captain (the laws) and villagers (gossip) just talk, as do the people outside town (the hermit, fisher, farmer, trapper, miner and miller), Gullhaven's harbourmaster and the castaway on Wrecker's Isle; the Slayer master gives Slayer tasks. Talkers give quests: villagers by the map they're in (home1 to home4), the rest by their role, so keep those map ids and one of each role. Put a Counter in front of a banker or shopkeeper; players talk across it.",
};

/**
 * A place's props with defaults filled in. A monster spawn without a radius (the game's file leaves
 * some out) roams its monster's normal range, as in the game.
 */
export function placeProps(f: Feature): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const field of PLACE_FIELDS[f.type] ?? []) out[field.key] = f.props?.[field.key] ?? field.default;
  if (f.type === 'monster_spawn' && f.props?.radius === undefined) out.radius = normalRange(out.kind);
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
