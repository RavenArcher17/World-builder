/** Canvas rendering of maps: base image (terrain, water, roads), feature overlays and tilesets. */
import { featureDef } from '../core/features';
import { Grid, GridType } from '../core/grid';
import { extractPolylines } from '../core/links';
import { T, TILES, tile } from '../core/tiles';
import { SEA_LEVEL, WorldMap } from '../core/types';
import { TILESET_COLUMNS, tilePixels } from '../core/export/formats';
import { cellMetrics, drawObject, drawPattern, paintOrder } from './drawObjects';
import { drawGameArt, gameArtColours, gameArtReady, townGuards } from './gameArt';
import { gameKind, isRpgdc, placeProps } from '../core/rpgdc/game';
import { OVERVIEW_MIN_CELLS, cellsAbout, drawOverview, overviewWanted } from './overview';

export interface ViewOptions {
  grid: boolean;
  hillshade: boolean;
  rivers: boolean;
  roads: boolean;
  features: boolean;
  labels: boolean;
  objects: boolean;
  /** Tint cells by their rules zone (game maps). */
  zones: boolean;
  /** Draw game maps with the game's own art when it is loaded (see gameArt.ts). */
  gameArt: boolean;
}

export const DEFAULT_VIEW: ViewOptions = { grid: false, hillshade: true, rivers: true, roads: true, features: true, labels: true, objects: true, zones: false, gameArt: false };

/** Zone tint colours by zone layer value (1 = safe … 4 = deep). */
export const ZONE_TINT = ['', 'rgba(63,191,111,0.32)', 'rgba(224,192,64,0.32)', 'rgba(224,122,48,0.34)', 'rgba(192,58,74,0.36)'];

/** Pixels per render unit that give cells of similar on-screen size across grid types. */
export function baseUnitPx(grid: GridType): number {
  return grid === 'square' ? 14 : grid === 'iso' ? 11 : 8;
}

const rgbCache = new Map<string, [number, number, number]>();
function rgb(hex: string): [number, number, number] {
  let v = rgbCache.get(hex);
  if (!v) {
    const n = parseInt(hex.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, v);
  }
  return v;
}

function cellColor(map: WorldMap, g: Grid, i: number, hillshade: boolean): string {
  const t = map.layers.terrain[i];
  const e = map.layers.elevation[i];
  let [r, gg, b] = rgb(tile(t).color);
  if ((t === T.DEEP_OCEAN || t === T.OCEAN) && map.kind === 'overland') {
    // Depth tint.
    const k = Math.max(0, Math.min(1, e / SEA_LEVEL));
    const [r2, g2, b2] = rgb('#163256');
    const [r3, g3, b3] = rgb('#3d77b0');
    r = r2 + (r3 - r2) * k;
    gg = g2 + (g3 - g2) * k;
    b = b2 + (b3 - b2) * k;
  } else if (hillshade && map.kind === 'overland' && e >= SEA_LEVEL) {
    const [x, y] = g.pos(i);
    let gx = 0;
    let gy = 0;
    for (const n of g.neighbors(i, true)) {
      const [nx, ny] = g.pos(n);
      const de = map.layers.elevation[n] - e;
      gx += de * (nx - x);
      gy += de * (ny - y);
    }
    const s = Math.max(-0.35, Math.min(0.35, (gx + gy) * 4));
    const f = 1 + s;
    r *= f;
    gg *= f;
    b *= f;
  }
  return `rgb(${r | 0},${gg | 0},${b | 0})`;
}

function polygon(ctx: CanvasRenderingContext2D, pts: [number, number][], s: number): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * s, pts[0][1] * s);
  for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0] * s, pts[k][1] * s);
  ctx.closePath();
}

function smoothLine(ctx: CanvasRenderingContext2D, pts: [number, number][]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 2) {
    ctx.lineTo(pts[1][0], pts[1][1]);
    return;
  }
  for (let k = 1; k < pts.length - 1; k++) {
    const mx = (pts[k][0] + pts[k + 1][0]) / 2;
    const my = (pts[k][1] + pts[k + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[k][0], pts[k][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

/** Part of a map, in render units (the map's own top-left corner is 0, 0). */
export interface RenderRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * How far what stands on a cell can reach from its centre, in render units: trees and houses
 * reach well above their cell and a little to each side.
 */
const REACH = { side: 9, up: 16, down: 2 };

/**
 * The cells to draw for a region, in the order they're painted (back to front): those whose
 * centre is in it or near enough that what stands on them can show in it. Only the cells near
 * the region are looked at, so this stays quick on a big map.
 */
export function cellsInRegion(g: Grid, r: RenderRegion): number[] {
  const X0 = r.x0 - REACH.side;
  const X1 = r.x1 + REACH.side;
  const Y0 = r.y0 - REACH.down;
  const Y1 = r.y1 + REACH.up;
  const out: number[] = [];
  const w = g.width;
  if (g.type === 'iso') {
    // Cell (c, row) has its centre at x = c - row + height, y = (c + row + 1) / 2, and is painted
    // in order of c + row (back to front), then c: walk the diagonals that cross the region.
    const H = g.height;
    const dMin = Math.ceil(X0 - H);
    const dMax = Math.floor(X1 - H);
    const sumMin = Math.max(0, Math.ceil(2 * Y0 - 1));
    const sumMax = Math.min(g.width + g.height - 2, Math.floor(2 * Y1 - 1));
    for (let sum = sumMin; sum <= sumMax; sum++) {
      const c0 = Math.max(0, sum - H + 1, Math.ceil((sum + dMin) / 2));
      const c1 = Math.min(w - 1, sum, Math.floor((sum + dMax) / 2));
      for (let c = c0; c <= c1; c++) out.push((sum - c) * w + c);
    }
    return out;
  }
  // Square and hex maps are painted in index order: the rows and columns around the region, each
  // cell checked exactly.
  const S3 = Math.sqrt(3);
  let cMin: number;
  let cMax: number;
  let rMin: number;
  let rMax: number;
  if (g.type === 'square') {
    [cMin, cMax, rMin, rMax] = [Math.ceil(X0 - 0.5), Math.floor(X1 - 0.5), Math.ceil(Y0 - 0.5), Math.floor(Y1 - 0.5)];
  } else if (g.type === 'hex-pointy') {
    [cMin, cMax, rMin, rMax] = [Math.floor(X0 / S3) - 1, Math.ceil(X1 / S3), Math.ceil((Y0 - 1) / 1.5), Math.floor((Y1 - 1) / 1.5)];
  } else {
    [cMin, cMax, rMin, rMax] = [Math.ceil((X0 - 1) / 1.5), Math.floor((X1 - 1) / 1.5), Math.floor(Y0 / S3) - 1, Math.ceil(Y1 / S3)];
  }
  cMin = Math.max(0, cMin);
  cMax = Math.min(w - 1, cMax);
  rMin = Math.max(0, rMin);
  rMax = Math.min(g.height - 1, rMax);
  for (let row = rMin; row <= rMax; row++) {
    for (let c = cMin; c <= cMax; c++) {
      const [x, y] = g.centerCR(c, row);
      if (x >= X0 && x <= X1 && y >= Y0 && y <= Y1) out.push(row * w + c);
    }
  }
  return out;
}

/**
 * The parts of a map image that change when these cells do: each cell with what stands on it
 * (see REACH), overlapping ones merged.
 */
export function regionAround(g: Grid, cells: number[]): RenderRegion[] {
  const out: RenderRegion[] = [];
  for (const i of cells) {
    if (i < 0 || i >= g.size) continue;
    const [x, y] = g.center(i);
    let r = { x0: x - REACH.side, y0: y - REACH.up, x1: x + REACH.side, y1: y + REACH.down };
    // Merge with any it overlaps (repeatedly, as a merged one can reach others).
    for (let k = 0; k < out.length; k++) {
      const o = out[k];
      if (o.x0 <= r.x1 && r.x0 <= o.x1 && o.y0 <= r.y1 && r.y0 <= o.y1) {
        r = { x0: Math.min(o.x0, r.x0), y0: Math.min(o.y0, r.y0), x1: Math.max(o.x1, r.x1), y1: Math.max(o.y1, r.y1) };
        out.splice(k, 1);
        k = -1;
      }
    }
    out.push(r);
  }
  return out;
}

/** How a map image is drawn: cell by cell, or as an overview (see overview.ts); `stamp` names the map's state, so work on it can be kept. */
export interface DrawOptions {
  overview?: boolean;
  stamp?: number;
}

/** Whether a map image of a region (or the whole map) at `s` pixels per unit is best drawn as an overview. */
export function wantsOverview(map: WorldMap, s: number, view: ViewOptions, region?: RenderRegion): boolean {
  const g = new Grid(map.grid, map.width, map.height);
  const cells = region ? cellsAbout(g, Math.max(0, region.x1 - region.x0) * Math.max(0, region.y1 - region.y0)) : g.size;
  return overviewWanted(g, s, cells, view.gameArt && map.grid === 'iso' && gameArtReady());
}

/**
 * Draw terrain, buildings, rivers, roads and grid into a context at `s` pixels per unit. With a
 * region, only what shows in it is drawn (the caller translates the context to it). As an
 * overview, each cell is one flat colour.
 */
export function drawBase(ctx: CanvasRenderingContext2D, map: WorldMap, s: number, view: ViewOptions, region?: RenderRegion, opts: DrawOptions = {}): void {
  const g = new Grid(map.grid, map.width, map.height);
  const L = map.layers;
  const cells = region ? cellsInRegion(g, region) : null;
  // Ground, tints and grid lines go down in index order (as for a whole map); what stands on the
  // cells in paint order.
  const byIndex = cells && g.type === 'iso' ? Int32Array.from(cells).sort() : cells;
  const each = (fn: (i: number) => void) => {
    if (byIndex) for (let k = 0; k < byIndex.length; k++) fn(byIndex[k]);
    else for (let i = 0; i < g.size; i++) fn(i);
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const { inner, flat } = cellMetrics(g, s);
  const art = view.gameArt && map.grid === 'iso' && gameArtReady();
  if (opts.overview) {
    drawOverview(ctx, map, g, s, view, cells, art ? gameArtColours(map) : null);
  } else {
    if (art && drawGameArt(ctx, map, s, cells, opts.stamp)) {
      drawZoneTint(ctx, g, map, s, view, each);
      if (view.grid) drawGridLines(ctx, g, s, each);
      return;
    }
    each((i) => {
      // "Nothing" (3D maps' open air) is left clear, so a storey below can show through.
      if (L.terrain[i] === T.VOID) return;
      const c = cellColor(map, g, i, view.hillshade);
      polygon(ctx, g.corners(i), s);
      ctx.fillStyle = c;
      ctx.strokeStyle = c;
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
      const pattern = tile(L.terrain[i]).pattern;
      if (pattern && inner >= 4) {
        const [x, y] = g.center(i);
        drawPattern(ctx, pattern, x * s, y * s, inner, flat, i);
      }
    });
    drawZoneTint(ctx, g, map, s, view, each);

    // Outlines between different buildings / walls so each structure reads as one shape.
    ctx.strokeStyle = 'rgba(40,24,16,0.85)';
    ctx.lineWidth = Math.max(1, s * 0.09);
    each((i) => {
      const t = L.terrain[i];
      if (t !== T.BUILDING && t !== T.KEEP) return;
      const pts = g.corners(i);
      const [cx, cy] = g.center(i);
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k];
        const b = pts[(k + 1) % pts.length];
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        const n = g.pixelToCell(cx + (mx - cx) * 1.4, cy + (my - cy) * 1.4);
        const same = n >= 0 && L.terrain[n] === t && L.building[n] === L.building[i];
        if (same) continue;
        ctx.beginPath();
        ctx.moveTo(a[0] * s, a[1] * s);
        ctx.lineTo(b[0] * s, b[1] * s);
        ctx.stroke();
      }
    });
  }

  if (view.rivers && hasAny(L.river)) {
    for (const line of extractPolylines(g, L.river)) {
      const size = line.reduce((m, i) => Math.max(m, L.riverSize[i]), 0);
      const w = Math.max(0.12, Math.min(0.55, 0.08 + Math.log10(Math.max(1, size)) * 0.13));
      ctx.strokeStyle = '#4a86c0';
      ctx.lineWidth = w * s * (g.isHex ? 1.6 : 1);
      smoothLine(ctx, line.map((i) => {
        const [x, y] = g.center(i);
        return [x * s, y * s];
      }));
      ctx.stroke();
    }
  }

  if (view.roads && hasAny(L.road)) {
    const lines = extractPolylines(g, L.road).map((line) => ({ line, level: Math.max(...line.map((i) => L.roadLevel[i] || 1)) }));
    lines.sort((a, b) => a.level - b.level);
    const k = g.isHex ? 1.6 : 1;
    for (const { line, level } of lines) {
      const pts = line.map((i): [number, number] => {
        const [x, y] = g.center(i);
        return [x * s, y * s];
      });
      if (level >= 3) {
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(60,35,15,0.7)';
        ctx.lineWidth = 0.34 * s * k;
        smoothLine(ctx, pts);
        ctx.stroke();
        ctx.strokeStyle = '#e8c27a';
        ctx.lineWidth = 0.2 * s * k;
      } else if (level === 2) {
        ctx.setLineDash([]);
        ctx.strokeStyle = '#7a4a24';
        ctx.lineWidth = 0.16 * s * k;
      } else {
        ctx.setLineDash([0.25 * s * k, 0.2 * s * k]);
        ctx.strokeStyle = '#6b4a2e';
        ctx.lineWidth = 0.1 * s * k;
      }
      smoothLine(ctx, pts);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  if (opts.overview) return;

  if (view.objects && hasAny(L.object)) {
    const u = g.type === 'iso' ? s * 0.5 : inner;
    for (const i of cells ?? paintOrder(g)) {
      if (!L.object[i]) continue;
      const [x, y] = g.center(i);
      drawObject(ctx, L.object[i], x * s, y * s, u);
    }
  }

  if (view.grid) drawGridLines(ctx, g, s, each);
}

/** Whether a layer has anything in it (a loop: quick, and it stops at the first). */
function hasAny(layer: number[]): boolean {
  for (let i = 0; i < layer.length; i++) if (layer[i]) return true;
  return false;
}

type EachCell = (fn: (i: number) => void) => void;

function drawZoneTint(ctx: CanvasRenderingContext2D, g: Grid, map: WorldMap, s: number, view: ViewOptions, each: EachCell): void {
  const L = map.layers;
  if (!view.zones || !hasAny(L.zone)) return;
  each((i) => {
    if (!L.zone[i]) return;
    polygon(ctx, g.corners(i), s);
    ctx.fillStyle = ZONE_TINT[L.zone[i]] ?? 'transparent';
    ctx.fill();
  });
}

function drawGridLines(ctx: CanvasRenderingContext2D, g: Grid, s: number, each: EachCell): void {
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  each((i) => {
    polygon(ctx, g.corners(i), s);
    ctx.stroke();
  });
}

/**
 * Render a map to a new canvas (used for the viewport cache and PNG export): the whole map, or
 * just a region of it (the canvas then starts at the region's top-left corner).
 */
export function renderMapCanvas(map: WorldMap, s: number, view: ViewOptions, withFeatures = false, background = true, region?: RenderRegion, opts: DrawOptions = {}): HTMLCanvasElement {
  const g = new Grid(map.grid, map.width, map.height);
  const b = g.renderBounds();
  const r = region ?? { x0: 0, y0: 0, x1: b.w, y1: b.h };
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((r.x1 - r.x0) * s));
  canvas.height = Math.max(1, Math.ceil((r.y1 - r.y0) * s));
  const ctx = canvas.getContext('2d')!;
  if (background) {
    ctx.fillStyle = '#1b1f27';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.translate(-r.x0 * s, -r.y0 * s);
  drawBase(ctx, map, s, view, region, { ...opts, overview: opts.overview ?? wantsOverview(map, s, view, region) });
  if (withFeatures) drawFeatures(ctx, map, s, 0, 0, view, null);
  return canvas;
}

/** Pixels a map image may have on screen-sized devices: well inside what phones allow a canvas. */
export const MAX_CACHE_PIXELS = 12_000_000;

/**
 * What to keep rendered of a map for the viewport, given what's on screen (`view`, in render
 * units) at `scale` pixels per unit. A map that makes a modest image is kept whole, with some
 * detail to spare for zooming in (`whole`). A bigger one is kept just around the view (a quarter
 * of a screen more each way, so a short pan needs no redraw), a little sharper than it's shown,
 * and rendered again when the view leaves it or zooms in past it.
 */
export function cacheRegion(map: WorldMap, view: RenderRegion, scale: number): { region: RenderRegion; s: number; whole: boolean } {
  const b = new Grid(map.grid, map.width, map.height).renderBounds();
  const wanted = Math.min(48, Math.max(baseUnitPx(map.grid), scale));
  if (b.w * b.h * wanted * wanted <= MAX_CACHE_PIXELS / 2) return { region: { x0: 0, y0: 0, x1: b.w, y1: b.h }, s: safeScale(map, wanted), whole: true };
  const vw = view.x1 - view.x0;
  const vh = view.y1 - view.y0;
  const region = {
    x0: Math.max(0, view.x0 - vw / 4),
    y0: Math.max(0, view.y0 - vh / 4),
    x1: Math.min(b.w, view.x1 + vw / 4),
    y1: Math.min(b.h, view.y1 + vh / 4),
  };
  const rw = Math.max(1, region.x1 - region.x0);
  const rh = Math.max(1, region.y1 - region.y0);
  // Big maps zoomed right out are drawn as an overview, which needs no more than a pixel a unit.
  const least = map.width * map.height > OVERVIEW_MIN_CELLS ? 1 : 2;
  const s = Math.max(1, Math.min(48, Math.max(least, scale * 1.2), Math.sqrt(MAX_CACHE_PIXELS / (rw * rh)), 8000 / rw, 8000 / rh));
  return { region, s, whole: false };
}

/**
 * Whether a part of a map kept by cacheRegion still serves the view: 'ok', 'outside' (the view
 * has left it) or 'detail' (zoomed in past its detail, unless it's as sharp as it gets, or out so
 * far that most of it is wasted).
 */
export function cacheFit(map: WorldMap, cache: { region: RenderRegion; s: number; whole: boolean }, view: RenderRegion, scale: number): 'ok' | 'outside' | 'detail' {
  if (cache.whole) return 'ok';
  const b = new Grid(map.grid, map.width, map.height).renderBounds();
  const r = cache.region;
  const covered = (view.x0 >= r.x0 || r.x0 <= 0) && (view.y0 >= r.y0 || r.y0 <= 0) && (view.x1 <= r.x1 || r.x1 >= b.w) && (view.y1 <= r.y1 || r.y1 >= b.h);
  if (!covered) return 'outside';
  return (scale <= cache.s * 1.05 || cache.s >= 47.5) && (scale >= cache.s / 4 || cache.s <= 2) ? 'ok' : 'detail';
}

/** Largest pixels-per-unit that keeps a canvas for this map within browser limits. */
export function safeScale(map: WorldMap, wanted: number, maxDim = 8000): number {
  const b = new Grid(map.grid, map.width, map.height).renderBounds();
  return Math.max(1, Math.min(wanted, maxDim / b.w, maxDim / b.h));
}

/**
 * Draw feature icons and labels. `s` is screen pixels per render unit, (ox, oy) the screen
 * position of render origin.
 */
export function drawFeatures(
  ctx: CanvasRenderingContext2D,
  map: WorldMap,
  s: number,
  ox: number,
  oy: number,
  view: ViewOptions,
  selectedId: string | null,
  stamp?: number,
): void {
  if (!view.features) return;
  const g = new Grid(map.grid, map.width, map.height);
  const cellPx = s * (g.isHex ? 1.7 : g.type === 'iso' ? 1.4 : 1);
  const size = Math.max(11, Math.min(30, cellPx * 1.05));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const game = isRpgdc(map);
  // A game's landmark is a named area (its name shows as players arrive): its name is labelled
  // like a building's, rather than a plain landmark's.
  const rankOf = (type: string) => (game && type === 'landmark' ? 7 : featureDef(type).rank);
  const sorted = [...map.features].sort((a, b) => rankOf(a.type) - rankOf(b.type));
  const labelMinRank = cellPx > 22 ? 0 : cellPx > 12 ? 3 : 5;
  if (game) drawLandmarkAreas(ctx, map, g, s, ox, oy, selectedId);
  // Labels are placed most-important first and skipped when they would overlap.
  const labels: { x: number; y: number; text: string; size: number; bold: boolean; selected?: boolean }[] = [];
  // The game's own town guards and where criminals come back, so moving a gate shows its guard;
  // indoors, the guard it keeps with a townsperson worth robbing (the mayor).
  if (isRpgdc(map) && gameKind(map) !== 'dungeon') {
    const { posts, outside } = townGuards(map, stamp);
    const marks = posts.map((p) => ({ ...p, icon: '💂', text: 'Guard' }));
    if (outside) marks.push({ ...outside, icon: '⛓️', text: 'Criminals return' });
    const fs = size * 0.8;
    ctx.globalAlpha = 0.85;
    ctx.font = `${fs}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    for (const m of marks) {
      const [x, y] = g.centerCR(m.x, m.y);
      ctx.fillText(m.icon, ox + x * s, oy + y * s);
      if (view.labels && labelMinRank <= 3) labels.push({ x: ox + x * s, y: oy + y * s + fs * 0.75 + 4, text: m.text, size: Math.max(10, fs * 0.5), bold: false });
    }
    ctx.globalAlpha = 1;
  }
  for (const f of sorted) {
    const def = featureDef(f.type);
    const rank = rankOf(f.type);
    const [x, y] = g.centerCR(f.c, f.r);
    const px = ox + x * s;
    const py = oy + y * s;
    const fs = size * (rank >= 7 ? 1.15 : rank <= 2 ? 0.8 : 1);
    if (f.id === selectedId) {
      ctx.beginPath();
      ctx.arc(px, py, fs * 0.75, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,230,120,0.55)';
      ctx.fill();
      ctx.strokeStyle = '#ffcc33';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.font = `${fs}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillText(def.icon, px, py);
    if (f.childMapId) {
      ctx.beginPath();
      ctx.arc(px + fs * 0.45, py - fs * 0.45, Math.max(3, fs * 0.15), 0, Math.PI * 2);
      ctx.fillStyle = '#ffcc33';
      ctx.fill();
    }
    if (view.labels && f.name && (rank >= labelMinRank || f.id === selectedId)) {
      const ls = Math.max(10, Math.min(16, fs * 0.55 + (rank >= 7 ? 2 : 0)));
      labels.push({ x: px, y: py + fs * 0.75 + ls * 0.4, text: f.name, size: ls, bold: rank >= 7, selected: f.id === selectedId });
    }
  }
  const placed: [number, number, number, number][] = [];
  // The selected place's label first, so it always shows; then the most important.
  labels.reverse().sort((a, b) => Number(!!b.selected) - Number(!!a.selected));
  for (const l of labels) {
    ctx.font = `${l.bold ? '600 ' : ''}${l.size}px Georgia, "Times New Roman", serif`;
    const w = ctx.measureText(l.text).width;
    const box: [number, number, number, number] = [l.x - w / 2 - 2, l.y - l.size / 2 - 1, l.x + w / 2 + 2, l.y + l.size / 2 + 1];
    if (placed.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue;
    placed.push(box);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,250,235,0.9)';
    ctx.strokeText(l.text, l.x, l.y);
    ctx.fillStyle = '#2a1d10';
    ctx.fillText(l.text, l.x, l.y);
  }
}

/**
 * Each landmark place's area on a game map, the circle of its radius round its middle (straight-line
 * distance, as the game measures it; an ellipse on the isometric grid): a faint outline, and the
 * selected one stronger and lightly filled.
 */
function drawLandmarkAreas(ctx: CanvasRenderingContext2D, map: WorldMap, g: Grid, s: number, ox: number, oy: number, selectedId: string | null): void {
  for (const f of map.features) {
    if (f.type !== 'landmark') continue;
    const radius = Number(placeProps(f).radius);
    if (!(radius > 0)) continue;
    const selected = f.id === selectedId;
    // Sides enough for a smooth curve at any zoom, without overdoing small ones.
    const [cx, cy] = g.centerCR(f.c, f.r);
    const [ex, ey] = g.centerCR(f.c + radius, f.r);
    const n = Math.max(24, Math.min(160, Math.round(Math.hypot(ex - cx, ey - cy) * s * 0.5)));
    ctx.beginPath();
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const [x, y] = g.centerCR(f.c + radius * Math.cos(a), f.r + radius * Math.sin(a));
      if (k) ctx.lineTo(ox + x * s, oy + y * s);
      else ctx.moveTo(ox + x * s, oy + y * s);
    }
    ctx.closePath();
    if (selected) {
      ctx.fillStyle = 'rgba(255,215,110,0.1)';
      ctx.fill();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(255,215,110,0.95)';
      ctx.lineWidth = 2;
    } else {
      // A light line with a dark edge, so it shows on snow and sand as well as grass.
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 2.75;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,245,220,0.55)';
      ctx.lineWidth = 1.25;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** A tileset image matching tilePixels(grid): one coloured tile shape per registry entry. */
export function renderTileset(grid: GridType): HTMLCanvasElement {
  const px = tilePixels(grid);
  const rows = Math.ceil(TILES.length / TILESET_COLUMNS);
  const canvas = document.createElement('canvas');
  canvas.width = px.tileWidth * TILESET_COLUMNS;
  canvas.height = px.tileHeight * rows;
  const ctx = canvas.getContext('2d')!;
  for (const t of TILES) {
    const x0 = (t.id % TILESET_COLUMNS) * px.tileWidth;
    const y0 = Math.floor(t.id / TILESET_COLUMNS) * px.tileHeight;
    const w = px.tileWidth;
    const h = px.tileHeight;
    let pts: [number, number][];
    if (grid === 'hex-pointy') pts = [[w / 2, 0], [w, h / 4], [w, (3 * h) / 4], [w / 2, h], [0, (3 * h) / 4], [0, h / 4]];
    else if (grid === 'hex-flat') pts = [[w / 4, 0], [(3 * w) / 4, 0], [w, h / 2], [(3 * w) / 4, h], [w / 4, h], [0, h / 2]];
    else if (grid === 'iso') pts = [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];
    else pts = [[0, 0], [w, 0], [w, h], [0, h]];
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x0 + x, y0 + y) : ctx.moveTo(x0 + x, y0 + y)));
    ctx.closePath();
    ctx.fillStyle = t.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.stroke();
  }
  return canvas;
}
