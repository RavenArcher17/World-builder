/** Canvas rendering of maps: base image (terrain, water, roads), feature overlays and tilesets. */
import { featureDef } from '../core/features';
import { Grid, GridType } from '../core/grid';
import { extractPolylines } from '../core/links';
import { T, TILES, tile } from '../core/tiles';
import { SEA_LEVEL, WorldMap } from '../core/types';
import { TILESET_COLUMNS, tilePixels } from '../core/export/formats';
import { cellMetrics, drawObject, drawPattern, paintOrder } from './drawObjects';
import { drawGameArt } from './gameArt';
import { gameKind, guardPosts, houseGuards, isRpgdc } from '../core/rpgdc/game';

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
 * The cells to draw for a region: those whose centre is in it or near enough that what stands on
 * them can show in it. Trees and houses reach well above their cell, so more is taken below.
 */
export function cellsInRegion(g: Grid, r: RenderRegion): Uint8Array {
  const mask = new Uint8Array(g.size);
  for (let i = 0; i < g.size; i++) {
    const [x, y] = g.center(i);
    if (x >= r.x0 - 9 && x <= r.x1 + 9 && y >= r.y0 - 2 && y <= r.y1 + 16) mask[i] = 1;
  }
  return mask;
}

/**
 * Draw terrain, buildings, rivers, roads and grid into a context at `s` pixels per unit. With a
 * region, only what shows in it is drawn (the caller translates the context to it).
 */
export function drawBase(ctx: CanvasRenderingContext2D, map: WorldMap, s: number, view: ViewOptions, region?: RenderRegion): void {
  const g = new Grid(map.grid, map.width, map.height);
  const L = map.layers;
  const mask = region ? cellsInRegion(g, region) : null;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const { inner, flat } = cellMetrics(g, s);
  if (view.gameArt && drawGameArt(ctx, map, s, mask)) {
    drawZoneTint(ctx, g, map, s, view, mask);
    if (view.grid) drawGridLines(ctx, g, s, mask);
    return;
  }
  for (let i = 0; i < g.size; i++) {
    if (mask && !mask[i]) continue;
    // "Nothing" (3D maps' open air) is left clear, so a storey below can show through.
    if (L.terrain[i] === T.VOID) continue;
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
  }
  drawZoneTint(ctx, g, map, s, view, mask);

  // Outlines between different buildings / walls so each structure reads as one shape.
  ctx.strokeStyle = 'rgba(40,24,16,0.85)';
  ctx.lineWidth = Math.max(1, s * 0.09);
  for (let i = 0; i < g.size; i++) {
    if (mask && !mask[i]) continue;
    const t = L.terrain[i];
    if (t !== T.BUILDING && t !== T.KEEP) continue;
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
  }

  if (view.rivers) {
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

  if (view.roads) {
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

  if (view.objects && L.object.some(Boolean)) {
    const u = g.type === 'iso' ? s * 0.5 : inner;
    for (const i of paintOrder(g)) {
      if (!L.object[i] || (mask && !mask[i])) continue;
      const [x, y] = g.center(i);
      drawObject(ctx, L.object[i], x * s, y * s, u);
    }
  }

  if (view.grid) drawGridLines(ctx, g, s, mask);
}

function drawZoneTint(ctx: CanvasRenderingContext2D, g: Grid, map: WorldMap, s: number, view: ViewOptions, mask: Uint8Array | null): void {
  const L = map.layers;
  if (!view.zones || !L.zone.some(Boolean)) return;
  for (let i = 0; i < g.size; i++) {
    if (!L.zone[i] || (mask && !mask[i])) continue;
    polygon(ctx, g.corners(i), s);
    ctx.fillStyle = ZONE_TINT[L.zone[i]] ?? 'transparent';
    ctx.fill();
  }
}

function drawGridLines(ctx: CanvasRenderingContext2D, g: Grid, s: number, mask: Uint8Array | null = null): void {
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  for (let i = 0; i < g.size; i++) {
    if (mask && !mask[i]) continue;
    polygon(ctx, g.corners(i), s);
    ctx.stroke();
  }
}

/**
 * Render a map to a new canvas (used for the viewport cache and PNG export): the whole map, or
 * just a region of it (the canvas then starts at the region's top-left corner).
 */
export function renderMapCanvas(map: WorldMap, s: number, view: ViewOptions, withFeatures = false, background = true, region?: RenderRegion): HTMLCanvasElement {
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
  drawBase(ctx, map, s, view, region);
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
  const s = Math.max(1, Math.min(48, Math.max(2, scale * 1.2), Math.sqrt(MAX_CACHE_PIXELS / (rw * rh)), 8000 / rw, 8000 / rh));
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
): void {
  if (!view.features) return;
  const g = new Grid(map.grid, map.width, map.height);
  const cellPx = s * (g.isHex ? 1.7 : g.type === 'iso' ? 1.4 : 1);
  const size = Math.max(11, Math.min(30, cellPx * 1.05));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const sorted = [...map.features].sort((a, b) => featureDef(a.type).rank - featureDef(b.type).rank);
  const labelMinRank = cellPx > 22 ? 0 : cellPx > 12 ? 3 : 5;
  // Labels are placed most-important first and skipped when they would overlap.
  const labels: { x: number; y: number; text: string; size: number; bold: boolean }[] = [];
  // The game's own town guards and where criminals come back, so moving a gate shows its guard;
  // indoors, the guard it keeps with a townsperson worth robbing (the mayor).
  if (isRpgdc(map) && gameKind(map) !== 'dungeon') {
    const { posts, outside } = gameKind(map) === 'overworld' ? guardPosts(map) : { posts: houseGuards(map), outside: null };
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
    const [x, y] = g.centerCR(f.c, f.r);
    const px = ox + x * s;
    const py = oy + y * s;
    const fs = size * (def.rank >= 7 ? 1.15 : def.rank <= 2 ? 0.8 : 1);
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
    if (view.labels && f.name && (def.rank >= labelMinRank || f.id === selectedId)) {
      const ls = Math.max(10, Math.min(16, fs * 0.55 + (def.rank >= 7 ? 2 : 0)));
      labels.push({ x: px, y: py + fs * 0.75 + ls * 0.4, text: f.name, size: ls, bold: def.rank >= 7 });
    }
  }
  const placed: [number, number, number, number][] = [];
  for (const l of labels.reverse()) {
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
