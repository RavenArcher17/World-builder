/**
 * The overview of a map: one pixel per cell, stretched onto the cells' shapes. Used when cells are
 * only a few pixels across (a big map zoomed out), or when so many are in view that drawing each
 * one would be slow on a phone; at that size it looks the same as drawing them one by one.
 */
import type { Grid } from '../core/grid';
import { objectDef } from '../core/objects';
import { T, TILES } from '../core/tiles';
import { SEA_LEVEL, type WorldMap } from '../core/types';
import type { ViewOptions } from './render';

/** A colour as 0xRRGGBB. */
export type Rgb = number;

/** Colours for the overview: the ground of a tile and what stands on it (null: the usual colours). */
export interface OverviewColours {
  ground(tileId: number): Rgb | null;
  object(objectId: number, tileId: number): Rgb | null;
}

const hexRgb = (hex: string): Rgb => (hex.startsWith('#') ? parseInt(hex.slice(1, 7), 16) : 0);
const TILE_RGB = TILES.map((t) => hexRgb(t.color));
const objectRgb = new Map<number, Rgb>();
function objectColour(id: number): Rgb {
  let c = objectRgb.get(id);
  if (c === undefined) {
    c = hexRgb(objectDef(id)?.color ?? '#000000');
    objectRgb.set(id, c);
  }
  return c;
}
/** Zone tints (see ZONE_TINT in render.ts) as [r, g, b, alpha]. */
const ZONE_RGBA: [number, number, number, number][] = [
  [0, 0, 0, 0],
  [63, 191, 111, 0.32],
  [224, 192, 64, 0.32],
  [224, 122, 48, 0.34],
  [192, 58, 74, 0.36],
];

const DEEP = [0x16, 0x32, 0x56];
const SHALLOW = [0x3d, 0x77, 0xb0];

/** Cells are shown this many pixels across or fewer: draw the overview. */
export const OVERVIEW_CELL_PX = 6;
/** With the game's art, below this many pixels a tile (its sprites are made for 96). */
export const OVERVIEW_ART_CELL_PX = 12;
/** At most this many cells are drawn one by one; more and the overview is drawn instead. */
export const CELL_BUDGET = 40_000;
export const ART_CELL_BUDGET = 25_000;

/** A cell's width in pixels at `s` pixels per render unit. */
export function cellPixels(g: Grid, s: number): number {
  return s * (g.type === 'iso' ? 2 : g.isHex ? Math.sqrt(3) : 1);
}

/** Roughly how many cells a region of the map (render units) holds. */
export function cellsAbout(g: Grid, area: number): number {
  const cellArea = g.type === 'iso' ? 1 : g.isHex ? 1.5 * Math.sqrt(3) : 1;
  return Math.min(g.size, Math.ceil(area / cellArea));
}

/** Maps up to this many cells (256×256) are always drawn cell by cell, as they always were. */
export const OVERVIEW_MIN_CELLS = 256 * 256;

/** Whether to draw the overview for this many cells at `s` pixels per unit. */
export function overviewWanted(g: Grid, s: number, cells: number, art: boolean): boolean {
  if (g.size <= OVERVIEW_MIN_CELLS) return false;
  const px = cellPixels(g, s);
  return art ? px < OVERVIEW_ART_CELL_PX || cells > ART_CELL_BUDGET : px < OVERVIEW_CELL_PX || cells > CELL_BUDGET;
}

/**
 * A cell's colour in the overview: its ground (hill-shaded on overland maps with relief), what
 * stands on it, its zone tint; -1 for none.
 */
function cellRgb(map: WorldMap, g: Grid, i: number, view: ViewOptions, colours: OverviewColours | null, relief: boolean): number {
  const L = map.layers;
  const t = L.terrain[i];
  if (t === T.VOID) return -1;
  const own = colours?.ground(t);
  let c = own ?? TILE_RGB[t] ?? TILE_RGB[T.GRASSLAND];
  let r = (c >> 16) & 255;
  let gg = (c >> 8) & 255;
  let b = c & 255;
  if (own == null && relief) {
    const e = L.elevation[i];
    if (t === T.DEEP_OCEAN || t === T.OCEAN) {
      const k = Math.max(0, Math.min(1, e / SEA_LEVEL));
      r = DEEP[0] + (SHALLOW[0] - DEEP[0]) * k;
      gg = DEEP[1] + (SHALLOW[1] - DEEP[1]) * k;
      b = DEEP[2] + (SHALLOW[2] - DEEP[2]) * k;
    } else if (view.hillshade && e >= SEA_LEVEL) {
      const [x, y] = g.pos(i);
      let gx = 0;
      let gy = 0;
      for (const n of g.neighbors(i, true)) {
        const [nx, ny] = g.pos(n);
        const de = L.elevation[n] - e;
        gx += de * (nx - x);
        gy += de * (ny - y);
      }
      const f = 1 + Math.max(-0.35, Math.min(0.35, (gx + gy) * 4));
      r *= f;
      gg *= f;
      b *= f;
    }
  }
  const o = L.object[i];
  if (view.objects && o) {
    c = colours?.object(o, t) ?? objectColour(o);
    r = r * 0.35 + ((c >> 16) & 255) * 0.65;
    gg = gg * 0.35 + ((c >> 8) & 255) * 0.65;
    b = b * 0.35 + (c & 255) * 0.65;
  }
  const z = view.zones ? ZONE_RGBA[L.zone[i]] : undefined;
  if (z && z[3]) {
    r += (z[0] - r) * z[3];
    gg += (z[1] - gg) * z[3];
    b += (z[2] - b) * z[3];
  }
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
  return (clamp(r) << 16) | (clamp(gg) << 8) | clamp(b);
}

/**
 * Draw the overview of the given cells (all of them without a list) into a context set up for
 * render units at `s` pixels each, as drawBase is.
 */
export function drawOverview(ctx: CanvasRenderingContext2D, map: WorldMap, g: Grid, s: number, view: ViewOptions, cells: ArrayLike<number> | null, colours: OverviewColours | null): void {
  const w = g.width;
  const n = cells ? cells.length : g.size;
  if (!n) return;
  let c0 = w;
  let c1 = -1;
  let r0 = g.height;
  let r1 = -1;
  if (cells) {
    for (let k = 0; k < n; k++) {
      const i = cells[k];
      const c = i % w;
      const r = (i - c) / w;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
    }
  } else {
    [c0, c1, r0, r1] = [0, w - 1, 0, g.height - 1];
  }
  const cols = c1 - c0 + 1;
  const rows = r1 - r0 + 1;
  // Ground the game draws flat (its maps) has no relief to shade.
  let relief = map.kind === 'overland';
  if (relief) {
    const e = map.layers.elevation;
    relief = false;
    for (let i = 1; i < e.length && !relief; i++) relief = e[i] !== e[0];
  }
  const img = new ImageData(cols, rows);
  const px = new Uint32Array(img.data.buffer);
  // ImageData is RGBA in memory; on little-endian machines (all phones and PCs) a pixel read as a
  // 32-bit number is 0xAABBGGRR.
  const put = (i: number) => {
    const rgb = cellRgb(map, g, i, view, colours, relief);
    if (rgb < 0) return;
    const c = i % w;
    const r = (i - c) / w;
    px[(r - r0) * cols + (c - c0)] = 0xff000000 | ((rgb & 255) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 255);
  };
  if (cells) for (let k = 0; k < n; k++) put(cells[k]);
  else for (let i = 0; i < n; i++) put(i);
  const off = document.createElement('canvas');
  off.width = cols;
  off.height = rows;
  off.getContext('2d')!.putImageData(img, 0, 0);

  ctx.save();
  // Crisp cell edges once cells are a few pixels across; smoothed below that.
  ctx.imageSmoothingEnabled = cellPixels(g, s) < 3;
  if (g.type === 'iso') {
    // Cell (c, r) is the unit square at (c, r) in the image; the iso projection is linear:
    // x = c - r + height, y = (c + r) / 2.
    ctx.transform(s, s / 2, -s, s / 2, g.height * s, 0);
    ctx.drawImage(off, c0, r0);
  } else if (g.type === 'square') {
    ctx.transform(s, 0, 0, s, 0, 0);
    ctx.drawImage(off, c0, r0);
  } else if (g.type === 'hex-pointy') {
    // A strip per row (odd rows sit half a cell to the right), each cell √3 wide and 1.5 high.
    const k = Math.sqrt(3);
    for (let r = r0; r <= r1; r++) ctx.drawImage(off, 0, r - r0, cols, 1, k * (c0 + 0.5 * (r & 1)) * s, (1.5 * r + 0.25) * s, cols * k * s, 1.5 * s);
  } else {
    // hex-flat: a strip per column (odd columns sit half a cell lower), each cell 1.5 wide and √3 high.
    const k = Math.sqrt(3);
    for (let c = c0; c <= c1; c++) ctx.drawImage(off, c - c0, 0, 1, rows, (1.5 * c + 0.25) * s, k * (r0 + 0.5 * (c & 1)) * s, 1.5 * s, rows * k * s);
  }
  ctx.restore();
}
