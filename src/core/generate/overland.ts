/**
 * Overland generation (world → local scales): elevation, climate, biomes, lakes, rivers,
 * settlements, points of interest and roads. When an OverlandGuide is supplied (zooming in on
 * part of a parent map) the large-scale shape, rivers, roads and places are inherited from the
 * parent and only finer detail is invented.
 */
import { featureDef, SETTLEMENT_TYPES } from '../features';
import { CellRect, Grid, inRect } from '../grid';
import { Pt, link, linkPath, tracePolyline } from '../links';
import { featureName } from '../names';
import { Noise2D, clamp01, smoothstep } from '../noise';
import { MinHeap, findPath } from '../pathfinding';
import { Rng } from '../rng';
import { ScaleDef, getScale } from '../scales';
import { SettingsReader } from '../settings';
import { T, isSea, isWater, tile } from '../tiles';
import { Feature, MapLayers, MapSpec, SEA_LEVEL, WorldMap, emptyLayers, newId } from '../types';

export interface GuideFeature {
  type: string;
  name: string;
  x: number;
  y: number;
  tags?: string[];
  notes?: string;
}

export interface OverlandGuide {
  sample(x: number, y: number): { e: number; m: number; t: number; lake: number };
  rivers: { pts: Pt[]; size: number }[];
  roads: { pts: Pt[]; level: number }[];
  features: GuideFeature[];
}

export const SETTLEMENT_ORDER = ['capital', 'city', 'town', 'village', 'hamlet', 'farm'];
export const POI_ORDER = ['castle', 'dungeon', 'ruins', 'cave', 'tower', 'temple', 'shrine', 'mine', 'lair', 'camp', 'landmark'];

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function generateOverland(spec: MapSpec, guide?: OverlandGuide): WorldMap {
  const g = new Grid(spec.grid, spec.width, spec.height);
  const S = new SettingsReader(spec.settings, 'overland', spec.scaleId);
  const scale = getScale(spec.scaleId);
  const rng = new Rng(spec.seed);
  const L = emptyLayers(g.size);

  buildFields(g, L, S, scale, rng, guide);
  const drainage = computeDrainage(g, L.elevation);
  applyWater(g, L, S, scale, drainage, guide);
  classifyAll(g, L, S);

  const features: Feature[] = [];
  if (guide) {
    for (const r of guide.rivers) {
      const path = tracePolyline(g, r.pts);
      linkPath(g, L.river, path);
      for (const i of path) L.riverSize[i] = Math.max(L.riverSize[i], r.size);
    }
    if (S.bool('t_roads')) {
      for (const r of guide.roads) linkPath(g, L.road, tracePolyline(g, r.pts), L.roadLevel, r.level);
    }
    for (const gf of guide.features) {
      let cell = g.posToCellClamped(gf.x, gf.y);
      cell = nearestLand(g, L, cell);
      features.push({
        id: newId('f'),
        type: gf.type,
        name: gf.name,
        c: g.col(cell),
        r: g.row(cell),
        tags: gf.tags ? [...gf.tags] : undefined,
        notes: gf.notes,
      });
    }
  }

  features.push(...placeFeatures(g, L, S, scale, rng.fork('features'), features));
  if (S.bool('t_roads')) {
    buildRoadNetwork(g, L, features, S, rng.fork('roads'));
    features.push(...placeInns(g, L, S, scale, rng.fork('inns'), features));
  }

  return {
    ...spec,
    id: newId('map'),
    layers: L,
    features,
    children: [],
  };
}

// ---- fields -------------------------------------------------------------------------------

function buildFields(g: Grid, L: MapLayers, S: SettingsReader, scale: ScaleDef, rng: Rng, guide?: OverlandGuide): void {
  const { w: LW, h: LH } = g.logicalBounds();
  const f = 1 / scale.featureSize;
  const gain = 0.4 + S.num('roughness', 0.5) * 0.25;
  const mountains = S.bool('t_mountains') ? S.num('mountains', 0.5) : 0;
  const nE = new Noise2D(rng.fork('elev'));
  const nW = new Noise2D(rng.fork('warp'));
  const nR = new Noise2D(rng.fork('ridge'));
  const nM = new Noise2D(rng.fork('moist'));
  const nT = new Noise2D(rng.fork('temp'));
  const nD = new Noise2D(rng.fork('detail'));
  const angle = rng.fork('coast').next() * Math.PI * 2;
  const landform = S.str('landform', 'continents');
  const N = g.size;
  const E = L.elevation;
  const M = L.moisture;
  const Tm = L.temperature;

  if (guide) {
    for (let i = 0; i < N; i++) {
      const [x, y] = g.pos(i);
      const s = guide.sample(x, y);
      const detail = nD.fbm(x * f * 2, y * f * 2, 4, 2, gain) * scale.detail;
      const ridge = mountains * scale.detail * 1.6 * nR.ridged(x * f * 2.5, y * f * 2.5, 3) ** 2 * smoothstep(SEA_LEVEL + 0.12, SEA_LEVEL + 0.45, s.e);
      E[i] = clamp01(s.e + detail + ridge);
      M[i] = clamp01(s.m + nM.fbm(x * f * 2, y * f * 2, 3) * 0.06);
      Tm[i] = clamp01(s.t + nT.fbm(x * f, y * f, 2) * 0.03 - (E[i] - s.e) * 0.8);
    }
  } else {
    const raw = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const [x, y] = g.pos(i);
      const nx = x / LW;
      const ny = y / LH;
      const wx = x + nW.fbm(x * f * 0.7, y * f * 0.7, 3) * scale.featureSize * 0.35;
      const wy = y + nW.fbm(x * f * 0.7 + 50, y * f * 0.7 + 50, 3) * scale.featureSize * 0.35;
      let v = nE.fbm(wx * f, wy * f, 6, 2, gain);
      const edge = Math.min(nx, 1 - nx, ny, 1 - ny) * 2;
      switch (landform) {
        case 'continents':
          v += (Math.sqrt(edge) - 0.55) * 0.9;
          break;
        case 'islands':
          v = nE.fbm(wx * f * 2.2, wy * f * 2.2, 6, 2, gain) + (Math.sqrt(edge) - 0.55) * 0.6;
          break;
        case 'pangaea': {
          const d = Math.hypot(nx - 0.5, ny - 0.5) * 2;
          v = v * 0.7 + (0.6 - d) * 1.1;
          break;
        }
        case 'coastal': {
          const proj = (nx - 0.5) * Math.cos(angle) + (ny - 0.5) * Math.sin(angle);
          v = v * 0.8 - proj * 1.4;
          break;
        }
        default:
          break;
      }
      const land = smoothstep(-0.1, 0.4, v);
      v += mountains * 0.55 * nR.ridged(wx * f * 1.6, wy * f * 1.6, 5) ** 2 * land;
      raw[i] = v;
    }
    // Remap so exactly `waterLevel` of the map lies below SEA_LEVEL; keeps child maps consistent.
    const sorted = Array.from(raw).sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[N - 1];
    const wl = S.num('waterLevel', 0.45);
    const seaRaw = wl <= 0.001 ? min - 1e-6 : sorted[Math.min(N - 1, Math.floor(wl * N))];
    const exponent = 1.9 - mountains * 0.9;
    for (let i = 0; i < N; i++) {
      const v = raw[i];
      E[i] =
        v < seaRaw
          ? (SEA_LEVEL * (v - min)) / Math.max(1e-9, seaRaw - min)
          : SEA_LEVEL + (1 - SEA_LEVEL) * Math.pow((v - seaRaw) / Math.max(1e-9, max - seaRaw), exponent);
    }
    // Moisture: noise + proximity to the sea.
    const oceanDist = distanceFrom(g, (i) => E[i] < SEA_LEVEL);
    const moistShift = (S.num('moisture', 0.5) - 0.5) * 0.6;
    const tempShift = (S.num('temperature', 0.5) - 0.5) * 0.5;
    for (let i = 0; i < N; i++) {
      const [x, y] = g.pos(i);
      const ny = y / LH;
      let m = nM.fbm(x * f * 1.2, y * f * 1.2, 4) * 0.5 + 0.5;
      m = (m - 0.5) * 1.5 + 0.5 + moistShift;
      if (isFinite(oceanDist[i])) m += 0.18 * Math.exp(-oceanDist[i] / (scale.featureSize * 0.25));
      M[i] = clamp01(m);
      const base = scale.latitude ? 1.08 - Math.abs(ny - 0.5) * 2.1 : 0.62;
      Tm[i] = clamp01(base + nT.fbm(x * f * 0.8, y * f * 0.8, 3) * 0.12 + tempShift - Math.max(0, E[i] - SEA_LEVEL) * 0.8);
    }
  }

  if (!S.bool('t_mountains')) {
    const cap = SEA_LEVEL + (1 - SEA_LEVEL) * 0.3;
    for (let i = 0; i < N; i++) if (E[i] > cap) E[i] = cap - (E[i] - cap) * 0.1;
  }
  for (let i = 0; i < N; i++) {
    E[i] = round3(E[i]);
    M[i] = round3(M[i]);
    Tm[i] = round3(Tm[i]);
  }
}

function distanceFrom(g: Grid, isSource: (i: number) => boolean): Float64Array {
  const d = new Float64Array(g.size).fill(Infinity);
  const q: number[] = [];
  for (let i = 0; i < g.size; i++)
    if (isSource(i)) {
      d[i] = 0;
      q.push(i);
    }
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    for (const n of g.neighbors(cur, false)) {
      if (d[n] <= d[cur] + 1) continue;
      d[n] = d[cur] + 1;
      q.push(n);
    }
  }
  return d;
}

// ---- hydrology ----------------------------------------------------------------------------

export interface Drainage {
  filled: Float64Array;
  /** Downstream neighbour (-1 = drains into the sea or off the map edge). */
  down: Int32Array;
  /** Cells in order from sea level upwards (upstream cells come later). */
  order: number[];
}

/** Priority-flood depression filling; also yields a drainage tree that always reaches the sea. */
export function computeDrainage(g: Grid, E: number[]): Drainage {
  const N = g.size;
  const filled = new Float64Array(N);
  const down = new Int32Array(N).fill(-1);
  const seen = new Uint8Array(N);
  const heap = new MinHeap();
  const order: number[] = [];
  for (let i = 0; i < N; i++) {
    const c = g.col(i);
    const r = g.row(i);
    if (E[i] < SEA_LEVEL || c === 0 || r === 0 || c === g.width - 1 || r === g.height - 1) {
      seen[i] = 1;
      filled[i] = E[i];
      heap.push(i, E[i]);
    }
  }
  while (heap.size) {
    const cur = heap.pop();
    order.push(cur);
    for (const n of g.neighbors(cur, true)) {
      if (seen[n]) continue;
      seen[n] = 1;
      filled[n] = Math.max(E[n], filled[cur] + 1e-5);
      down[n] = cur;
      heap.push(n, filled[n]);
    }
  }
  return { filled, down, order };
}

export function flowAccumulation(drainage: Drainage, M: number[]): Float64Array {
  const acc = new Float64Array(M.length);
  for (let i = 0; i < M.length; i++) acc[i] = 0.4 + M[i];
  for (let k = drainage.order.length - 1; k >= 0; k--) {
    const i = drainage.order[k];
    const d = drainage.down[i];
    if (d >= 0) acc[d] += acc[i];
  }
  return acc;
}

export function riverThreshold(S: SettingsReader, scale: ScaleDef, guided: boolean): number {
  return scale.riverThreshold * (1.6 - S.num('riverAmount', 0.5) * 1.2) * (guided ? 1.8 : 1);
}

export const LAKE_DEPTH = 0.012;

function applyWater(g: Grid, L: MapLayers, S: SettingsReader, scale: ScaleDef, drainage: Drainage, guide?: OverlandGuide): void {
  const E = L.elevation;
  const lakes = S.bool('t_lakes');
  for (let i = 0; i < g.size; i++) {
    if (E[i] < SEA_LEVEL) continue;
    let lake = lakes && drainage.filled[i] - E[i] > LAKE_DEPTH;
    if (guide && lakes) {
      const [x, y] = g.pos(i);
      lake = guide.sample(x, y).lake > 0.5;
    }
    if (lake) L.terrain[i] = T.LAKE;
  }
  if (!S.bool('t_rivers')) return;
  const acc = flowAccumulation(drainage, L.moisture);
  const thr = riverThreshold(S, scale, !!guide);
  for (let i = 0; i < g.size; i++) {
    if (E[i] < SEA_LEVEL || L.terrain[i] === T.LAKE || acc[i] < thr) continue;
    const d = drainage.down[i];
    if (d >= 0) link(g, L.river, i, d);
    L.riverSize[i] = Math.round(acc[i]);
  }
}

// ---- biomes -------------------------------------------------------------------------------

export function classify(e: number, m: number, t: number, S: SettingsReader): number {
  if (e < SEA_LEVEL) return e < SEA_LEVEL - 0.1 ? T.DEEP_OCEAN : T.OCEAN;
  const h = (e - SEA_LEVEL) / (1 - SEA_LEVEL);
  const snow = S.bool('t_snow');
  const forests = S.bool('t_forests');
  const deserts = S.bool('t_deserts');
  const swamps = S.bool('t_swamps');
  if (t < 0.1) return snow ? T.GLACIER : T.TUNDRA;
  if (h > 0.72) return snow && t < 0.55 ? T.PEAKS : T.MOUNTAINS;
  if (h > 0.52) return T.MOUNTAINS;
  if (h > 0.36) return t < 0.25 ? T.TUNDRA : forests && m > 0.65 ? (t < 0.4 ? T.TAIGA : T.FOREST) : T.HILLS;
  if (t < 0.22) return T.TUNDRA;
  if (t < 0.38) return forests && m > 0.45 ? T.TAIGA : T.TUNDRA;
  if (m < 0.18) return deserts ? (t > 0.5 ? T.DESERT : T.BADLANDS) : T.SAVANNA;
  if (m < 0.32) return t > 0.62 ? (deserts && m < 0.24 ? T.DESERT : T.SAVANNA) : T.GRASSLAND;
  if (m < 0.55) return T.GRASSLAND;
  if (m < 0.78) return forests ? (t > 0.78 && m > 0.68 ? T.JUNGLE : T.FOREST) : T.GRASSLAND;
  if (swamps && h < 0.08) return T.SWAMP;
  return forests ? (t > 0.72 ? T.JUNGLE : T.FOREST) : T.GRASSLAND;
}

export function classifyCells(g: Grid, L: MapLayers, S: SettingsReader, cells: Iterable<number>): void {
  const list = Array.from(cells);
  for (const i of list) {
    if (L.terrain[i] === T.LAKE) continue;
    const m = L.river[i] ? Math.min(1, L.moisture[i] + 0.12) : L.moisture[i];
    L.terrain[i] = classify(L.elevation[i], m, L.temperature[i], S);
  }
  // Beaches where low land meets the sea.
  for (const i of list) {
    const t = L.terrain[i];
    if (isWater(t) || L.elevation[i] > SEA_LEVEL + 0.025 || t === T.GLACIER) continue;
    if (g.neighbors(i).some((n) => isSea(L.terrain[n]))) L.terrain[i] = T.BEACH;
  }
}

function classifyAll(g: Grid, L: MapLayers, S: SettingsReader): void {
  const all = Array.from({ length: g.size }, (_, i) => i);
  classifyCells(g, L, S, all);
}

function nearestLand(g: Grid, L: MapLayers, start: number): number {
  if (!isWater(L.terrain[start])) return start;
  const seen = new Set([start]);
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    for (const n of g.neighbors(q[h])) {
      if (seen.has(n)) continue;
      if (!isWater(L.terrain[n])) return n;
      seen.add(n);
      q.push(n);
    }
  }
  return start;
}

// ---- places -------------------------------------------------------------------------------

const SETTLE_SCORE: Partial<Record<number, number>> = {
  [T.GRASSLAND]: 1,
  [T.SAVANNA]: 0.8,
  [T.BEACH]: 0.6,
  [T.FOREST]: 0.55,
  [T.HILLS]: 0.55,
  [T.TAIGA]: 0.35,
  [T.TUNDRA]: 0.2,
  [T.DESERT]: 0.12,
  [T.BADLANDS]: 0.15,
  [T.SWAMP]: 0.15,
  [T.JUNGLE]: 0.25,
  [T.MOUNTAINS]: 0.05,
};

function poiScore(type: string, t: number): number {
  const L = (...ids: number[]) => ids.includes(t);
  switch (type) {
    case 'castle':
      return L(T.HILLS) ? 1 : L(T.GRASSLAND, T.SAVANNA, T.FOREST) ? 0.5 : L(T.MOUNTAINS) ? 0.4 : 0.1;
    case 'dungeon':
      return L(T.HILLS, T.MOUNTAINS) ? 1 : L(T.FOREST, T.SWAMP, T.JUNGLE, T.TAIGA) ? 0.7 : 0.3;
    case 'ruins':
      return L(T.DESERT, T.JUNGLE, T.BADLANDS) ? 1 : 0.6;
    case 'cave':
    case 'mine':
      return L(T.MOUNTAINS) ? 1 : L(T.HILLS) ? 0.8 : L(T.BADLANDS) ? 0.5 : 0.05;
    case 'tower':
      return L(T.HILLS) ? 1 : 0.5;
    case 'temple':
    case 'shrine':
      return L(T.MOUNTAINS, T.HILLS) ? 0.8 : 0.6;
    case 'lair':
      return L(T.MOUNTAINS, T.SWAMP, T.JUNGLE) ? 1 : L(T.FOREST, T.TAIGA, T.HILLS, T.GLACIER) ? 0.7 : 0.2;
    case 'camp':
      return L(T.FOREST, T.HILLS, T.TAIGA, T.SAVANNA) ? 1 : 0.4;
    default:
      return 0.6;
  }
}

/** Remote places prefer to be far from settlements; civic places prefer to be near. */
const REMOTENESS: Record<string, number> = { lair: 1, dungeon: 0.5, camp: 0.4, ruins: 0.3, tower: 0.3, cave: 0.2, temple: -0.3, castle: -0.4, mine: -0.1, shrine: 0, landmark: 0 };

/**
 * Place settlements and points of interest, respecting spacing to `existing`. When `area` is
 * given, new places are restricted to it and counts scale with its size.
 */
export function placeFeatures(
  g: Grid,
  L: MapLayers,
  S: SettingsReader,
  scale: ScaleDef,
  rng: Rng,
  existing: Feature[],
  area?: CellRect,
): Feature[] {
  const out: Feature[] = [];
  const all = () => [...existing, ...out];
  const cells: number[] = [];
  for (let i = 0; i < g.size; i++) {
    if (area && !inRect(area, g.col(i), g.row(i))) continue;
    const t = L.terrain[i];
    if (isWater(t) || !tile(t).walkable) continue;
    cells.push(i);
  }
  const areaCells = area ? (area.c1 - area.c0 + 1) * (area.r1 - area.r0 + 1) : g.size;
  const count = (type: string, density: number) => {
    const x = ((scale.rates[type] ?? 0) * areaCells * density) / 1000;
    return Math.floor(x) + (rng.next() < x - Math.floor(x) ? 1 : 0);
  };
  const totalSettle = SETTLEMENT_ORDER.reduce((s, t) => s + (scale.rates[t] ?? 0), 0) * (g.size / 1000) * Math.max(0.3, S.num('settlementDensity', 1));
  const base = Math.sqrt(g.size / Math.max(1, totalSettle));
  const spacing: Record<string, number> = { capital: 1.3, city: 1.1, town: 0.85, village: 0.6, hamlet: 0.5, farm: 0.35 };
  const nameRng = rng.fork('names');
  const coastal = (i: number) => g.neighbors(i).some((n) => isSea(L.terrain[n]));
  const riverside = (i: number) => L.river[i] !== 0 || g.neighbors(i).some((n) => L.terrain[n] === T.LAKE);
  const tooClose = (i: number, minD: number) => {
    const [x, y] = g.pos(i);
    return all().some((f) => {
      const [fx, fy] = g.posCR(f.c, f.r);
      return Math.hypot(fx - x, fy - y) < minD;
    });
  };
  const add = (type: string, i: number) => {
    const hints = { river: riverside(i), coast: coastal(i), hills: L.terrain[i] === T.HILLS, forest: L.terrain[i] === T.FOREST };
    const feat: Feature = { id: newId('f'), type, name: featureName(nameRng, type, hints), c: g.col(i), r: g.row(i) };
    if (SETTLEMENT_TYPES.has(type) && hints.coast && S.bool('ports') && featureDef(type).rank >= 5) feat.tags = ['port'];
    out.push(feat);
  };

  // Settlements: good land, rivers and coasts.
  const sd = S.num('settlementDensity', 1);
  const jitter = rng.fork('jitter');
  const settleScore = new Map<number, number>();
  for (const i of cells) {
    let s = SETTLE_SCORE[L.terrain[i]] ?? 0;
    if (s <= 0) continue;
    if (riverside(i)) s += 0.6;
    if (coastal(i)) s += 0.45;
    settleScore.set(i, s * (0.6 + jitter.next() * 0.8));
  }
  const ranked = [...settleScore.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i);
  for (const type of SETTLEMENT_ORDER) {
    if (!S.bool(`f_${type}`)) continue;
    let n = count(type, sd);
    const minD = base * spacing[type];
    for (const i of ranked) {
      if (n <= 0) break;
      if (tooClose(i, minD)) continue;
      add(type, i);
      n--;
    }
  }

  // Points of interest.
  const pd = S.num('poiDensity', 1);
  const settlements = () => all().filter((f) => SETTLEMENT_TYPES.has(f.type));
  const poiSpacing = Math.max(2, base * 0.35);
  for (const type of POI_ORDER) {
    if (!S.bool(`f_${type}`)) continue;
    let n = count(type, pd);
    if (n <= 0) continue;
    const towns = settlements();
    const remote = REMOTENESS[type] ?? 0;
    const pr = rng.fork(type);
    const scored = cells
      .map((i) => {
        let s = poiScore(type, L.terrain[i]);
        if (remote !== 0 && towns.length) {
          const [x, y] = g.pos(i);
          let nearest = Infinity;
          for (const f of towns) {
            const [fx, fy] = g.posCR(f.c, f.r);
            nearest = Math.min(nearest, Math.hypot(fx - x, fy - y));
          }
          const norm = Math.min(1, nearest / (base * 1.2));
          s *= remote > 0 ? 1 - remote + remote * norm : 1 + remote * norm;
        }
        return [i, s * (0.3 + pr.next())] as [number, number];
      })
      .sort((a, b) => b[1] - a[1]);
    for (const [i] of scored) {
      if (n <= 0) break;
      if (tooClose(i, poiSpacing)) continue;
      add(type, i);
      n--;
    }
  }
  return out;
}

function placeInns(g: Grid, L: MapLayers, S: SettingsReader, scale: ScaleDef, rng: Rng, existing: Feature[]): Feature[] {
  if (!S.bool('f_inn')) return [];
  const x = ((scale.rates.inn ?? 0) * g.size * S.num('poiDensity', 1)) / 1000;
  let n = Math.round(x);
  const out: Feature[] = [];
  const candidates = rng.shuffle(Array.from({ length: g.size }, (_, i) => i).filter((i) => L.roadLevel[i] >= 2));
  for (const i of candidates) {
    if (n <= 0) break;
    const [x0, y0] = g.pos(i);
    const near = [...existing, ...out].some((f) => {
      const [fx, fy] = g.posCR(f.c, f.r);
      return Math.hypot(fx - x0, fy - y0) < 4;
    });
    if (near) continue;
    out.push({ id: newId('f'), type: 'inn', name: featureName(rng, 'inn'), c: g.col(i), r: g.row(i) });
    n--;
  }
  return out;
}

// ---- roads --------------------------------------------------------------------------------

export function roadCost(L: MapLayers, i: number): number {
  const t = L.terrain[i];
  let c = tile(t).cost;
  if (!isFinite(c)) return Infinity;
  if (L.road[i]) c = Math.min(c, 0.3 + c * 0.1);
  if (L.river[i] && !L.road[i]) c += 3;
  return c;
}

function roadLevelFor(a: Feature, b: Feature): number {
  const r = Math.min(featureDef(a.type).rank, featureDef(b.type).rank);
  return r >= 9 ? 3 : r >= 7 ? 2 : 1;
}

/** Connect settlements with a minimum spanning tree of roads (plus some loops). */
export function buildRoadNetwork(g: Grid, L: MapLayers, features: Feature[], S: SettingsReader, rng: Rng): void {
  const nodes = features.filter((f) => SETTLEMENT_TYPES.has(f.type) || f.type === 'castle');
  connectTerminals(
    g,
    L,
    nodes.map((f) => ({ cell: g.idx(f.c, f.r), feature: f })),
    S.num('roadLoops', 0.3),
    rng,
  );
  // Spurs to civic points of interest.
  for (const f of features) {
    if (!['temple', 'mine', 'tower', 'farm'].includes(f.type)) continue;
    const start = g.idx(f.c, f.r);
    const path = findPath(g, [start], (i) => i !== start && L.road[i] !== 0, {
      cost: (to) => roadCost(L, to),
      maxCost: 25,
    });
    if (path) linkPath(g, L.road, path, L.roadLevel, 1);
  }
}

export interface Terminal {
  cell: number;
  feature?: Feature;
  level?: number;
}

export function connectTerminals(g: Grid, L: MapLayers, terms: Terminal[], loops: number, rng: Rng): void {
  if (terms.length < 2) return;
  const pos = terms.map((t) => g.pos(t.cell));
  const d = (a: number, b: number) => Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]);
  // Prim's MST.
  const inTree = new Uint8Array(terms.length);
  const best = new Float64Array(terms.length).fill(Infinity);
  const from = new Int32Array(terms.length).fill(-1);
  const edges: [number, number][] = [];
  best[0] = 0;
  for (let k = 0; k < terms.length; k++) {
    let u = -1;
    for (let i = 0; i < terms.length; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
    inTree[u] = 1;
    if (from[u] >= 0) edges.push([from[u], u]);
    for (let v = 0; v < terms.length; v++) {
      if (!inTree[v] && d(u, v) < best[v]) {
        best[v] = d(u, v);
        from[v] = u;
      }
    }
  }
  const has = new Set(edges.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
  for (let i = 0; i < terms.length; i++) {
    if (!rng.chance(loops)) continue;
    const near = terms
      .map((_, j) => j)
      .filter((j) => j !== i)
      .sort((a, b) => d(i, a) - d(i, b))
      .slice(0, 3);
    for (const j of near) {
      const k = `${Math.min(i, j)}-${Math.max(i, j)}`;
      if (has.has(k)) continue;
      has.add(k);
      edges.push([i, j]);
      break;
    }
  }
  const level = (a: Terminal, b: Terminal) =>
    a.feature && b.feature ? roadLevelFor(a.feature, b.feature) : Math.max(1, Math.min(a.level ?? 2, b.level ?? 2));
  edges.sort((x, y) => level(terms[y[0]], terms[y[1]]) - level(terms[x[0]], terms[x[1]]));
  for (const [a, b] of edges) {
    const goal = terms[b].cell;
    const [gx, gy] = g.pos(goal);
    const path = findPath(g, [terms[a].cell], (i) => i === goal, {
      cost: (to) => roadCost(L, to),
      heuristic: (i) => {
        const [x, y] = g.pos(i);
        return Math.hypot(x - gx, y - gy) * 0.3;
      },
    });
    if (path) linkPath(g, L.road, path, L.roadLevel, level(terms[a], terms[b]));
  }
}
