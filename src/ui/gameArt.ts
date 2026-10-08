/**
 * Optional preview of RPG-DC maps with the game's own art (Flare, CC BY-SA 3.0), loaded from the
 * game server. Mirrors how the game's client (client/src/scenes/WorldScene.ts) picks frames, so
 * the preview shows what players see. Needs the server to allow cross-origin requests.
 */
import { Grid } from '../core/grid';
import { O } from '../core/objects';
import { gameKind } from '../core/rpgdc/game';
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
      for (const name of ['world', 'dungeon']) {
        const sheet = index.sheets[name];
        if (!sheet) throw new Error(`The art has no "${name}" sheet`);
        images[name] = await Promise.all(sheet.pages.map((p) => loadImage(base + p)));
      }
      loaded = { sheets: index.sheets, images };
      return loaded;
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
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
const GROUND_OF: Partial<Record<number, Ground>> = { [T.PATH]: 'path', [T.WATER]: 'water', [T.TOWN_FLOOR]: 'floor', [T.CRYPT_FLOOR]: 'floor' };
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
};
const FISHING = new Set<number>([O.FISHING_SHRIMP, O.FISHING_TROUT, O.FISHING_SALMON]);

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
  const dungeon = gameKind(map) === 'dungeon';
  const sheetName = dungeon ? 'dungeon' : 'world';
  const sheet = art.sheets[sheetName];
  const put = (frame: string, i: number) => {
    const f = sheet.frames[frame];
    if (!f) return;
    const [cx, cy] = g.center(i);
    ctx.drawImage(art.images[sheetName][f[0]], f[1], f[2], f[3], f[4], cx * s - f[5] * k, cy * s - f[6] * k, f[3] * k, f[4] * k);
  };
  const variant = (what: string, x: number, y: number, salt = 0) => `${what}/${Math.floor(tileHash(x, y, salt) * (sheet.counts?.[what] ?? 1))}`;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < map.height ? y * w + x : -1);
  const order = paintOrder(g);

  if (dungeon) {
    const isWall = (x: number, y: number) => {
      const i = at(x, y);
      return i < 0 || L.terrain[i] === T.CRYPT_WALL;
    };
    const lights = new Set(map.features.filter((f) => f.type === 'brazier').map((f) => f.r * w + f.c));
    const pieces = new Map<number, string>();
    // Ground: floor everywhere players can see, including under the walls that face a room.
    for (const i of order) {
      const x = i % w;
      const y = Math.floor(i / w);
      if (isWall(x, y)) {
        const piece = wallPiece((dx, dy) => !isWall(x + dx, y + dy));
        if (!piece) continue;
        pieces.set(i, piece);
      }
      put(tileHash(x, y, 2) < 0.2 ? variant('cobble', x, y) : variant('floor', x, y), i);
      if (L.object[i] === O.STAIRS_DOWN) put('stairs-down', i);
      else if (!pieces.has(i) && !L.object[i] && !lights.has(i) && tileHash(x, y, 6) < 0.035) put(variant('bones', x, y, 7), i);
    }
    for (const i of order) {
      const x = i % w;
      const y = Math.floor(i / w);
      const piece = pieces.get(i);
      if (piece) {
        const deco = (piece === 'e' || piece === 's') && tileHash(x, y, 4) < 0.12;
        put(variant(deco ? `wall-${piece}-deco` : `wall-${piece}`, x, y, 5), i);
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
    if (FISHING.has(L.object[i])) fishRing(ctx, g, i, s);
  }
  const fence = (x: number, y: number) => at(x, y) >= 0 && L.object[at(x, y)] === O.FENCE;
  for (const i of order) {
    const x = i % w;
    const y = Math.floor(i / w);
    const o = L.object[i];
    if (TREES[o]) put(variant(TREES[o]!, x, y, 3), i);
    else if (o === O.BOULDER) put(variant('rock', x, y), i);
    else if (ART_FOR[o]) put(ART_FOR[o]!, i);
    else if (o === O.FENCE) {
      if (fence(x, y - 1)) put('fence-n', i);
      if (fence(x - 1, y)) put('fence-w', i);
      if (!fence(x, y - 1) && !fence(x - 1, y)) put('fence-post', i);
    } else if (!o && L.terrain[i] === T.GRASS && tileHash(x, y, 9) < 0.06) put(variant('plant', x, y, 10), i);
  }
  return true;
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
