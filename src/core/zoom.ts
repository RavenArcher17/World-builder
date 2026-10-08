/**
 * Zooming in: turn a rectangle of a parent map into a new, more detailed child map. Overland
 * children inherit the parent's terrain, rivers, roads and places; settlement and dungeon
 * children take their size, water and surroundings from what the parent shows there.
 */
import { DUNGEONISH_TYPES, SETTLEMENT_TYPES, featureDef } from './features';
import { generateMap } from './generate';
import type { GuideFeature, OverlandGuide } from './generate/overland';
import { CellRect, Grid, GridType, inRect, normalizeRect, rectLogicalBox } from './grid';
import { Pt, clipPolyline, linkedNeighbors, meander, segmentSeed } from './links';
import { getScale } from './scales';
import { defaultSettings } from './settings';
import { T, isSea } from './tiles';
import type { Project, Settings, WorldMap } from './types';

export interface ZoomOptions {
  scaleId: string;
  grid: GridType;
  width: number;
  height: number;
  seed: number;
  name: string;
  settings: Settings;
  featureId?: string;
}

/** Linear mapping between a parent rectangle and the whole child map (logical coordinates). */
export function makeMapper(pg: Grid, rect: CellRect, cg: Grid) {
  const box = rectLogicalBox(pg, rect);
  const cb = cg.logicalBounds();
  const sx = cb.w / (box.x1 - box.x0);
  const sy = cb.h / (box.y1 - box.y0);
  return {
    box,
    toChild: (x: number, y: number): Pt => [(x - box.x0) * sx, (y - box.y0) * sy],
    toParent: (x: number, y: number): Pt => [box.x0 + x / sx, box.y0 + y / sy],
  };
}

function sampleParent(pg: Grid, parent: WorldMap, x: number, y: number) {
  const L = parent.layers;
  const center = pg.posToCellClamped(x, y);
  const cells = [center, ...pg.neighbors(center, true)];
  let ws = 0;
  let e = 0;
  let m = 0;
  let t = 0;
  let lake = 0;
  for (const i of cells) {
    const [px, py] = pg.pos(i);
    const d = Math.hypot(px - x, py - y);
    const w = Math.max(0, 1.6 - d) ** 2;
    if (w <= 0) continue;
    ws += w;
    e += L.elevation[i] * w;
    m += L.moisture[i] * w;
    t += L.temperature[i] * w;
    lake += (L.terrain[i] === T.LAKE ? 1 : 0) * w;
  }
  if (ws === 0) return { e: L.elevation[center], m: L.moisture[center], t: L.temperature[center], lake: L.terrain[center] === T.LAKE ? 1 : 0 };
  return { e: e / ws, m: m / ws, t: t / ws, lake: lake / ws };
}

export function buildGuide(parent: WorldMap, rect: CellRect, cg: Grid): OverlandGuide {
  const pg = new Grid(parent.grid, parent.width, parent.height);
  const mapper = makeMapper(pg, rect, cg);
  const cb = cg.logicalBounds();
  const L = parent.layers;
  const grown: CellRect = { c0: rect.c0 - 1, r0: rect.r0 - 1, c1: rect.c1 + 1, r1: rect.r1 + 1 };
  const transfer = (layer: number[], salt: number, value: (i: number, j: number) => number) => {
    const out: { pts: Pt[]; value: number }[] = [];
    for (let i = 0; i < pg.size; i++) {
      if (!layer[i] || !inRect(grown, pg.col(i), pg.row(i))) continue;
      for (const j of linkedNeighbors(pg, layer, i)) {
        if (j < i && inRect(grown, pg.col(j), pg.row(j))) continue;
        const curve = meander(pg.pos(i), pg.pos(j), segmentSeed(i, j, salt)).map(([x, y]) => mapper.toChild(x, y));
        for (const piece of clipPolyline(curve, 0.01, 0.01, cb.w - 0.01, cb.h - 0.01)) out.push({ pts: piece, value: value(i, j) });
      }
    }
    return out;
  };
  const features: GuideFeature[] = [];
  for (const f of parent.features) {
    if (!inRect(rect, f.c, f.r)) continue;
    const [px, py] = pg.posCR(f.c, f.r);
    const [x, y] = mapper.toChild(px, py);
    features.push({ type: f.type, name: f.name, x, y, tags: f.tags, notes: f.notes });
  }
  return {
    sample: (x, y) => {
      const [px, py] = mapper.toParent(x, y);
      return sampleParent(pg, parent, px, py);
    },
    rivers: transfer(L.river, 1, (i, j) => Math.max(L.riverSize[i], L.riverSize[j])).map((r) => ({ pts: r.pts, size: r.value })),
    roads: transfer(L.road, 2, (i, j) => Math.max(1, Math.min(L.roadLevel[i] || 1, L.roadLevel[j] || 1))).map((r) => ({ pts: r.pts, level: r.value })),
    features,
  };
}

/** Rebuild the guide for an existing child map (used when regenerating parts of it). */
export function guideForMap(project: Project, map: WorldMap): OverlandGuide | undefined {
  if (map.kind !== 'overland' || !map.parent) return undefined;
  const parent = project.maps[map.parent.mapId];
  if (!parent || parent.kind !== 'overland') return undefined;
  return buildGuide(parent, map.parent, new Grid(map.grid, map.width, map.height));
}

/** The most important feature inside a rectangle, optionally filtered. */
export function mainFeature(map: WorldMap, rect: CellRect, filter?: (type: string) => boolean) {
  return map.features
    .filter((f) => inRect(rect, f.c, f.r) && (!filter || filter(f.type)))
    .sort((a, b) => featureDef(b.type).rank - featureDef(a.type).rank)[0];
}

const SETTLEMENT_SCALE: Record<string, string> = { capital: 'city', city: 'city', town: 'town', village: 'village', hamlet: 'village', castle: 'town', ruins: 'town' };
const DUNGEON_SCALE: Record<string, string> = { dungeon: 'dungeon', tower: 'dungeon', temple: 'dungeon', cave: 'cave', lair: 'cave', mine: 'cave' };

/** Pick a sensible child scale, size and settings for a selection. */
export function suggestZoom(parent: WorldMap, rectIn: CellRect, scaleId?: string): ZoomOptions {
  const rect = normalizeRect(rectIn);
  const pScale = getScale(parent.scaleId);
  const small = rect.c1 - rect.c0 <= 4 && rect.r1 - rect.r0 <= 4;
  const town = mainFeature(parent, rect, (t) => SETTLEMENT_TYPES.has(t) || t === 'castle' || t === 'ruins');
  const dung = mainFeature(parent, rect, (t) => DUNGEONISH_TYPES.has(t));
  let target = scaleId;
  if (!target) {
    if (parent.kind === 'overland' && small && town && pScale.children.includes(SETTLEMENT_SCALE[town.type])) target = SETTLEMENT_SCALE[town.type];
    else if (parent.kind === 'overland' && small && dung && pScale.children.includes(DUNGEON_SCALE[dung.type] ?? 'dungeon')) target = DUNGEON_SCALE[dung.type] ?? 'dungeon';
    else target = pScale.children[0] ?? parent.scaleId;
  }
  const scale = getScale(target);
  const settings = defaultSettings(scale.kind, scale.id);
  let name = `${parent.name} detail`;
  let featureId: string | undefined;
  const pg = new Grid(parent.grid, parent.width, parent.height);

  if (scale.kind === 'overland') {
    if (parent.kind === 'overland') {
      for (const [k, v] of Object.entries(parent.settings)) if (k !== 'landform' && k !== 'waterLevel' && !k.startsWith('f_')) settings[k] = v;
    }
    const top = mainFeature(parent, rect);
    if (top) name = `${top.name} region`;
  } else if (scale.kind === 'settlement') {
    const f = town ?? mainFeature(parent, rect);
    if (f) {
      name = f.name;
      featureId = f.id;
      const size = f.type === 'capital' ? 'capital' : f.type === 'city' ? 'city' : f.type === 'town' || f.type === 'castle' || f.type === 'ruins' ? 'town' : f.type === 'hamlet' ? 'hamlet' : 'village';
      settings.sizeClass = size;
      settings.walls = size === 'town' || size === 'city' || size === 'capital';
      settings.castle = f.type === 'castle' || size === 'city' || size === 'capital';
      settings.ruined = f.type === 'ruins';
    }
    if (parent.kind === 'overland') {
      const L = parent.layers;
      const cells: number[] = [];
      for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) if (pg.inBounds(c, r)) cells.push(pg.idx(c, r));
      const around = new Set(cells);
      for (const i of cells) for (const n of pg.neighbors(i)) around.add(n);
      settings.river = cells.some((i) => L.river[i] !== 0) || [...around].some((i) => L.terrain[i] === T.LAKE);
      const sea = [...around].filter((i) => isSea(L.terrain[i]));
      settings.coast = sea.length > 0;
      if (sea.length) {
        const [cx, cy] = f ? pg.posCR(f.c, f.r) : pg.pos(cells[Math.floor(cells.length / 2)]);
        let sx = 0;
        let sy = 0;
        for (const i of sea) {
          const [x, y] = pg.pos(i);
          sx += x - cx;
          sy += y - cy;
        }
        settings.coastDir = Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? 'E' : 'W') : sy > 0 ? 'S' : 'N';
      }
      const base = f ? L.terrain[pg.idx(f.c, f.r)] : L.terrain[cells[0]];
      settings.baseTerrain =
        base === T.FOREST || base === T.JUNGLE || base === T.TAIGA
          ? 'forest'
          : base === T.DESERT || base === T.BADLANDS
            ? 'desert'
            : base === T.TUNDRA || base === T.GLACIER
              ? 'tundra'
              : base === T.SWAMP
                ? 'swamp'
                : base === T.HILLS || base === T.MOUNTAINS
                  ? 'hills'
                  : 'grassland';
    }
  } else {
    const f = dung ?? mainFeature(parent, rect);
    if (f) {
      name = f.name;
      featureId = f.id;
      settings.style = f.type === 'cave' || f.type === 'lair' ? 'caves' : f.type === 'mine' ? 'mixed' : 'rooms';
    } else if (parent.kind === 'settlement') {
      name = `${parent.name} undercity`;
    }
  }

  const { width, height } = suggestSize(pg, rect, parent.grid, scale.id);
  return { scaleId: scale.id, grid: parent.grid, width, height, seed: parent.seed ^ (rect.c0 * 73856093) ^ (rect.r0 * 19349663), name, settings, featureId };
}

/** Child dimensions matching the selection's aspect ratio (overland) or the scale default. */
export function suggestSize(pg: Grid, rect: CellRect, grid: GridType, scaleId: string): { width: number; height: number } {
  const scale = getScale(scaleId);
  if (scale.kind !== 'overland') return { width: scale.width, height: scale.height };
  const box = rectLogicalBox(pg, normalizeRect(rect));
  const aspect = (box.x1 - box.x0) / (box.y1 - box.y0);
  const area = scale.width * scale.height;
  const k = grid === 'hex-pointy' ? Math.sqrt(3) / 2 : grid === 'hex-flat' ? 2 / Math.sqrt(3) : 1;
  const w = Math.sqrt(area * aspect * k);
  const clampN = (v: number) => Math.max(8, Math.min(256, Math.round(v)));
  return { width: clampN(w), height: clampN(area / w) };
}

/** Generate the child map, register it in the project and link it to its parent. */
export function createChildMap(project: Project, parentId: string, rectIn: CellRect, opts: ZoomOptions): WorldMap {
  const parent = project.maps[parentId];
  if (!parent) throw new Error('Parent map not found');
  const rect = normalizeRect(rectIn);
  const scale = getScale(opts.scaleId);
  const cg = new Grid(opts.grid, opts.width, opts.height);
  const spec = {
    name: opts.name,
    kind: scale.kind,
    scaleId: scale.id,
    grid: opts.grid,
    width: opts.width,
    height: opts.height,
    seed: opts.seed >>> 0,
    settings: { ...opts.settings },
  };
  const guide = scale.kind === 'overland' && parent.kind === 'overland' ? buildGuide(parent, rect, cg) : undefined;
  const child = generateMap(spec, guide);
  child.parent = { mapId: parent.id, ...rect, featureId: opts.featureId };
  project.maps[child.id] = child;
  parent.children.push(child.id);
  if (opts.featureId) {
    const f = parent.features.find((x) => x.id === opts.featureId);
    if (f) f.childMapId = child.id;
  }
  return child;
}
