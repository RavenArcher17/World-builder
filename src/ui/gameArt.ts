/**
 * Optional preview of RPG-DC maps with the game's own art (Flare, CC BY-SA 3.0), loaded from the
 * game server. Mirrors how the game's client (client/src/scenes/WorldScene.ts) picks frames, so
 * the preview shows what players see. Needs the server to allow cross-origin requests.
 */
import { Grid } from '../core/grid';
import { O } from '../core/objects';
import { buildings, doorFace, gameKind, type GameBuilding } from '../core/rpgdc/game';
import { T } from '../core/tiles';
import type { WorldMap } from '../core/types';
import { paintOrder } from './drawObjects';

export const DEFAULT_ART_BASE = 'https://rpg-dc.onrender.com/art/';
export const ART_CREDITS_URL = 'https://rpg-dc.onrender.com/art/CREDITS.md';
/** Optional override of where the art lives (e.g. a local copy while testing). */
const ART_BASE_KEY = 'world-builder:rpgdc-art';

/** [page, x, y, width, height, anchor x, anchor y]; the anchor sits on the tile centre. */
type Frame = [number, number, number, number, number, number, number];
interface Sheet {
  pages: string[];
  frames: Record<string, Frame>;
  counts?: Record<string, number>;
}
interface GameArt {
  sheets: Record<string, Sheet>;
  images: Record<string, HTMLImageElement[]>;
}

let loaded: GameArt | null = null;
let loading: Promise<GameArt> | null = null;

export function artBase(): string {
  try {
    return localStorage.getItem(ART_BASE_KEY) || DEFAULT_ART_BASE;
  } catch {
    return DEFAULT_ART_BASE;
  }
}

export function gameArtReady(): boolean {
  return loaded !== null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Anonymous CORS keeps the map canvas untainted, so PNG export still works.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load ${src}`));
    img.src = src;
  });
}

/** Load the art index and the scenery sheets once; later calls share the same promise. */
export function loadGameArt(): Promise<GameArt> {
  if (loaded) return Promise.resolve(loaded);
  if (!loading) {
    const base = artBase();
    loading = (async () => {
      const res = await fetch(`${base}art.json`, { mode: 'cors' });
      if (!res.ok) throw new Error(`The art index answered ${res.status}`);
      const index = (await res.json()) as { sheets: Record<string, Sheet> };
      const images: Record<string, HTMLImageElement[]> = {};
      for (const name of ['world', 'dungeon', 'indoor']) {
        const sheet = index.sheets[name];
        if (!sheet) {
          // Older game servers have no indoor sheet: insides are drawn without furniture.
          if (name === 'indoor') continue;
          throw new Error(`The art has no "${name}" sheet`);
        }
        images[name] = await Promise.all(sheet.pages.map((p) => loadImage(base + p)));
      }
      loaded = { sheets: index.sheets, images };
      return loaded;
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
}

let onChange: (() => void) | null = null;
/** Called when more art arrives (houses load as maps need them), so the map can be redrawn. */
export function onGameArtChange(fn: () => void): void {
  onChange = fn;
}

const sheetLoads = new Set<string>();
/** Whether a sheet is loaded; if not, starts loading it and redraws when it's in. */
function haveSheet(name: string): boolean {
  const art = loaded;
  if (!art?.sheets[name]) return false;
  if (art.images[name]) return true;
  if (!sheetLoads.has(name)) {
    sheetLoads.add(name);
    const base = artBase();
    Promise.all(art.sheets[name].pages.map((p) => loadImage(base + p)))
      .then((imgs) => {
        art.images[name] = imgs;
        onChange?.();
      })
      .catch(() => sheetLoads.delete(name));
  }
  return false;
}

/** The game's stable per-tile hash (client/src/art.ts), so variants match the game. */
function tileHash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** West, north, east, south: the order of the game's `edge/*` and `shore/*` frames. */
const EDGE_NEIGHBOURS = [[-1, 0], [0, -1], [1, 0], [0, 1]] as const;

type Ground = 'grass' | 'path' | 'floor' | 'water';
const GROUND_OF: Partial<Record<number, Ground>> = { [T.PATH]: 'path', [T.WATER]: 'water', [T.TOWN_FLOOR]: 'floor', [T.CRYPT_FLOOR]: 'floor', [T.PLANKS]: 'floor' };
const TREES: Partial<Record<number, string>> = { [O.TREE]: 'tree', [O.OAK]: 'oak', [O.WILLOW]: 'willow' };
const ART_FOR: Partial<Record<number, string>> = {
  [O.COPPER_ROCK]: 'ore-copper',
  [O.TIN_ROCK]: 'ore-tin',
  [O.IRON_ROCK]: 'ore-iron',
  [O.BANK]: 'bank',
  [O.SHOP]: 'shop',
  [O.FURNACE]: 'furnace',
  [O.ANVIL]: 'anvil',
  [O.COOKING_FIRE]: 'range',
  [O.SEWER_GRATE]: 'sewer-grate',
};
/** Stations, workbenches and furniture from the indoor sheet (the game draws them so outside too). */
const INDOOR_ART: Partial<Record<number, string>> = {
  [O.BANK]: 'bank',
  [O.SHOP]: 'shop',
  [O.FURNACE]: 'furnace',
  [O.ANVIL]: 'anvil',
  [O.COOKING_FIRE]: 'hearth',
  [O.ALCHEMY_TABLE]: 'alchemy_table',
  [O.SEWING_TABLE]: 'sewing_table',
  [O.FLETCHING_BENCH]: 'fletching_bench',
  [O.COUNTER]: 'counter',
  [O.TABLE]: 'table',
  [O.BED]: 'bed',
  [O.BARREL]: 'barrel',
  [O.CRATE]: 'crate',
  [O.LECTERN]: 'lectern',
  [O.BOOKSHELF]: 'crate',
};
/** Herb patches: the game's leafier plants, tinted per herb and drawn a little larger. */
const HERB_ART: Partial<Record<number, { frame: string; tint: string }>> = {
  [O.HERB_SUNLEAF]: { frame: 'plant/6', tint: '#e8ff9a' },
  [O.HERB_SILVERWEED]: { frame: 'plant/10', tint: '#e0f0ff' },
  [O.HERB_THORNBERRY]: { frame: 'plant/12', tint: '#ff9a8a' },
  [O.HERB_NIGHTSHADE]: { frame: 'plant/8', tint: '#ffffff' },
  [O.HERB_EMBERBLOOM]: { frame: 'plant/9', tint: '#ffa060' },
};
/** Scenery plants are the first six (dry grass and yellow bushes); the rest are kept for herbs. */
const SCENERY_PLANTS = 6;
const FISHING = new Set<number>([O.FISHING_SHRIMP, O.FISHING_TROUT, O.FISHING_SALMON]);

/** A frame tinted like Phaser's setTint (multiplied), cached. */
const tinted = new Map<string, HTMLCanvasElement>();
function tintedFrame(img: HTMLImageElement, f: Frame, tint: string): HTMLCanvasElement {
  const key = `${img.src}|${f.join(',')}|${tint}`;
  let c = tinted.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = f[3];
  c.height = f[4];
  const x = c.getContext('2d')!;
  x.drawImage(img, f[1], f[2], f[3], f[4], 0, 0, f[3], f[4]);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = tint;
  x.fillRect(0, 0, f[3], f[4]);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(img, f[1], f[2], f[3], f[4], 0, 0, f[3], f[4]);
  tinted.set(key, c);
  return c;
}

/**
 * Draw the map with the game's art at `s` pixels per render unit. Returns false (and draws
 * nothing) when the art isn't loaded or the map isn't an isometric game map.
 */
export function drawGameArt(ctx: CanvasRenderingContext2D, map: WorldMap, s: number): boolean {
  const art = loaded;
  if (!art || map.grid !== 'iso') return false;
  const g = new Grid(map.grid, map.width, map.height);
  const L = map.layers;
  const w = map.width;
  // Frames are drawn for 96-pixel-wide tiles; an iso cell here is 2 units wide.
  const k = (2 * s) / 96;
  const kind = gameKind(map);
  const home = kind === 'overworld' ? 'world' : 'dungeon';
  /** Draws a frame of a sheet with its anchor on point (cx, cy) in render units. */
  const drawAt = (sheetName: string, frame: string, cx: number, cy: number, opts: { tint?: string; scale?: number } = {}) => {
    const f = art.sheets[sheetName]?.frames[frame];
    const img = f && art.images[sheetName]?.[f[0]];
    if (!f || !img) return;
    const z = k * (opts.scale ?? 1);
    const x = cx * s - f[5] * z;
    const y = cy * s - f[6] * z;
    if (opts.tint) ctx.drawImage(tintedFrame(img, f, opts.tint), x, y, f[3] * z, f[4] * z);
    else ctx.drawImage(img, f[1], f[2], f[3], f[4], x, y, f[3] * z, f[4] * z);
  };
  const putFrom = (sheetName: string, frame: string, i: number, opts?: { tint?: string; scale?: number }) => {
    const [cx, cy] = g.center(i);
    drawAt(sheetName, frame, cx, cy, opts);
  };
  const put = (frame: string, i: number) => putFrom(home, frame, i);
  const count = (sheetName: string, what: string) => art.sheets[sheetName]?.counts?.[what] ?? 1;
  const variant = (what: string, x: number, y: number, salt = 0, sheetName = home) => `${what}/${Math.floor(tileHash(x, y, salt) * count(sheetName, what))}`;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < map.height ? y * w + x : -1);
  const order = paintOrder(g);

  if (kind !== 'overworld') {
    const inside = kind === 'interior';
    // Indoors, doors and bookshelves stand in the line of the walls.
    const isWall = (x: number, y: number) => {
      const i = at(x, y);
      return i < 0 || L.terrain[i] === T.CRYPT_WALL || (inside && (L.object[i] === O.DOOR || L.object[i] === O.BOOKSHELF));
    };
    const lights = new Set(map.features.filter((f) => f.type === 'brazier').map((f) => f.r * w + f.c));
    const pieces = new Map<number, string>();
    const anyPlanks = L.terrain.includes(T.PLANKS);
    const floor = (i: number, x: number, y: number) => {
      if (!inside) return put(tileHash(x, y, 2) < 0.2 ? variant('cobble', x, y) : variant('floor', x, y), i);
      const near = [at(x - 1, y), at(x, y - 1), at(x + 1, y), at(x, y + 1)].map((n) => (n < 0 ? -1 : L.terrain[n]));
      const t = L.terrain[i];
      const kindOf = t === T.PLANKS ? 'planks' : t === T.TOWN_FLOOR ? 'stone' : near.includes(T.PLANKS) || anyPlanks ? 'planks' : 'stone';
      putFrom('indoor', `${kindOf}/${Math.floor(tileHash(x, y, 2) * 4)}`, i);
    };
    // Ground: floor everywhere players can see, including under the walls that face a room.
    for (const i of order) {
      const x = i % w;
      const y = Math.floor(i / w);
      const wall = isWall(x, y) && L.object[i] !== O.DOOR;
      if (wall) {
        const piece = wallPiece((dx, dy) => !isWall(x + dx, y + dy));
        if (!piece) continue;
        pieces.set(i, piece);
      }
      if (!wall && L.terrain[i] === T.WATER) {
        // Sewer water, with scum where it meets the walkway.
        put(variant('muck', x, y), i);
        EDGE_NEIGHBOURS.forEach(([dx, dy], e) => {
          const n = at(x + dx, y + dy);
          if (n >= 0 && L.terrain[n] !== T.WATER && L.terrain[n] !== T.CRYPT_WALL) put(`muck-edge/${e}`, i);
        });
        continue;
      }
      floor(i, x, y);
      if (L.object[i] === O.STAIRS_DOWN) put('stairs-down', i);
      else if (L.object[i] === O.DOOR) putFrom('indoor', 'doormat', i);
      else if (!inside && !pieces.has(i) && !L.object[i] && !lights.has(i) && tileHash(x, y, 6) < 0.035) put(variant('bones', x, y, 7), i);
    }
    for (const i of order) {
      const x = i % w;
      const y = Math.floor(i / w);
      const piece = pieces.get(i);
      if (piece) {
        const face = piece === 'e' || piece === 's';
        if (face && L.object[i] === O.BOOKSHELF) putFrom('indoor', `wall-${piece}-books`, i);
        else if (face && inside && tileHash(x, y, 4) < 0.2) putFrom('indoor', `wall-${piece}-hanging`, i);
        else put(variant(face && !inside && tileHash(x, y, 4) < 0.12 ? `wall-${piece}-deco` : `wall-${piece}`, x, y, 5), i);
      } else if (L.object[i] !== O.DOOR && INDOOR_ART[L.object[i]]) {
        putFrom('indoor', INDOOR_ART[L.object[i]]!, i);
      }
      if (L.object[i] === O.STAIRS_UP) put('stairs-up', i);
      if (lights.has(i)) put('brazier', i);
    }
    return true;
  }

  const groundAt = (x: number, y: number): Ground | null => {
    const i = at(x, y);
    return i < 0 ? null : GROUND_OF[L.terrain[i]] ?? 'grass';
  };
  for (const i of order) {
    const x = i % w;
    const y = Math.floor(i / w);
    const ground = groundAt(x, y)!;
    put(variant(ground, x, y), i);
    EDGE_NEIGHBOURS.forEach(([dx, dy], e) => {
      const n = groundAt(x + dx, y + dy);
      if (ground === 'water' && n && n !== 'water') put(`shore/${e}`, i);
      if ((ground === 'path' || ground === 'floor') && n === 'grass') put(`edge/${e}`, i);
    });
    if (L.object[i] === O.CRYPT_ENTRANCE) put('entrance', i);
    if (L.object[i] === O.SEWER_GRATE) put('sewer-grate', i);
    if (FISHING.has(L.object[i])) fishRing(ctx, g, i, s);
  }
  // Houses are drawn when the loop reaches their front corner, with their doors over them.
  const houses = new Map<number, GameBuilding>();
  for (const b of buildings(map)) {
    const corner = at(Math.min(w - 1, b.x + b.w - 1), Math.min(map.height - 1, b.y + b.h - 1));
    if (corner >= 0) houses.set(corner, b);
  }
  const inHouse = (x: number, y: number) => [...houses.values()].find((b) => x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h);
  const fence = (x: number, y: number) => at(x, y) >= 0 && L.object[at(x, y)] === O.FENCE;
  for (const i of order) {
    const x = i % w;
    const y = Math.floor(i / w);
    const o = L.object[i];
    if (TREES[o]) put(variant(TREES[o]!, x, y, 3), i);
    else if (o === O.BOULDER) put(variant('rock', x, y), i);
    else if (HERB_ART[o]) putFrom('world', HERB_ART[o]!.frame, i, { tint: HERB_ART[o]!.tint, scale: 1.3 });
    else if (o === O.DOOR) {
      if (!inHouse(x, y)) put('door-timber-s', i);
    } else if (o !== O.SEWER_GRATE && ART_FOR[o]) put(ART_FOR[o]!, i);
    else if (INDOOR_ART[o]) putFrom('indoor', INDOOR_ART[o]!, i);
    else if (o === O.FENCE) {
      if (fence(x, y - 1)) put('fence-n', i);
      if (fence(x - 1, y)) put('fence-w', i);
      if (!fence(x, y - 1) && !fence(x - 1, y)) put('fence-post', i);
    } else if (!o && L.terrain[i] === T.GRASS && !inHouse(x, y) && tileHash(x, y, 9) < 0.06) put(`plant/${Math.floor(tileHash(x, y, 10) * SCENERY_PLANTS)}`, i);
    const b = houses.get(i);
    if (b) drawHouse(b);
  }
  return true;

  function drawHouse(b: GameBuilding) {
    const sheet = `house/${b.style}-${b.w}x${b.h}`;
    if (haveSheet(sheet)) {
      const [ax, ay] = g.center(b.y * w + b.x);
      const [bx, by] = g.center((b.y + b.h - 1) * w + b.x + b.w - 1);
      drawAt(sheet, 'house', (ax + bx) / 2, (ay + by) / 2);
    }
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const i = at(x, y);
        if (i < 0 || L.object[i] !== O.DOOR) continue;
        put(`door-${b.style}-${doorFace(b, x, y) ?? 's'}`, i);
      }
    }
  }
}

/** The game draws fishing spots as a pale ring on the water. */
function fishRing(ctx: CanvasRenderingContext2D, g: Grid, i: number, s: number): void {
  const [cx, cy] = g.center(i);
  ctx.save();
  ctx.strokeStyle = 'rgba(235,248,255,0.85)';
  ctx.lineWidth = Math.max(1, s * 0.08);
  ctx.beginPath();
  ctx.ellipse(cx * s, cy * s, s * 0.55, s * 0.27, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Which wall piece fits a crypt wall cell, from where the floor is (client/src/walls.ts). */
function wallPiece(floor: (dx: number, dy: number) => boolean): string | null {
  const n = floor(0, -1);
  const e = floor(1, 0);
  const s = floor(0, 1);
  const w = floor(-1, 0);
  if (e && s) return 'es';
  if (n && e) return 'ne';
  if (s && w) return 'sw';
  if (n && w) return 'nw';
  if (e) return 'e';
  if (s) return 's';
  if (w) return 'w';
  if (n) return 'n';
  if (floor(1, 1)) return 'd-se';
  if (floor(1, -1)) return 'd-ne';
  if (floor(-1, 1)) return 'd-sw';
  if (floor(-1, -1)) return 'd-nw';
  return null;
}
