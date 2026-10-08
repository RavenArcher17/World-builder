/**
 * Stitch several maps onto one larger board: place pieces at offsets, blend the gaps with
 * generated terrain, and optionally join their settlements with roads.
 */
import { SETTLEMENT_TYPES } from './features';
import { Terminal, classify, connectTerminals } from './generate/overland';
import { Grid, GridType } from './grid';
import { Noise2D, clamp01 } from './noise';
import { Rng } from './rng';
import { resampleMap } from './resample';
import { SettingsReader, defaultSettings } from './settings';
import { T, isSea, isWater } from './tiles';
import { Feature, Placement, Project, SEA_LEVEL, WorldMap, emptyLayers, newId } from './types';

export interface ComposeOptions {
  name: string;
  grid: GridType;
  width: number;
  height: number;
  seed: number;
  scaleId: string;
  placements: Placement[];
  fillGaps: boolean;
  connectRoads: boolean;
}

/** Hex rows/columns alternate, so offsets must keep parity to preserve each piece's shape. */
export function snapPlacement(grid: GridType, c: number, r: number): { c: number; r: number } {
  if (grid === 'hex-pointy') return { c, r: r - (((r % 2) + 2) % 2) };
  if (grid === 'hex-flat') return { c: c - (((c % 2) + 2) % 2), r };
  return { c, r };
}

/** Lay pieces left-to-right in rows, returning placements and the board size needed. */
export function autoArrange(maps: WorldMap[], grid: GridType, gap = 2, maxWidth = 256): { placements: Placement[]; width: number; height: number } {
  const placements: Placement[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let width = 0;
  for (const m of maps) {
    if (x > 0 && x + m.width > maxWidth) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    const p = snapPlacement(grid, x, y);
    placements.push({ mapId: m.id, c: p.c, r: p.r });
    x = p.c + m.width + gap;
    rowH = Math.max(rowH, m.height + (p.r - y));
    width = Math.max(width, p.c + m.width);
  }
  return { placements, width: Math.max(8, width), height: Math.max(8, y + rowH) };
}

export function composeMaps(project: Project, opts: ComposeOptions): WorldMap {
  const g = new Grid(opts.grid, opts.width, opts.height);
  const L = emptyLayers(g.size);
  const filled = new Uint8Array(g.size);
  const features: Feature[] = [];
  let buildingOffset = 0;
  const placements: Placement[] = [];

  for (const pl of opts.placements) {
    let src = project.maps[pl.mapId];
    if (!src) continue;
    if (src.grid !== opts.grid) src = resampleMap(src, opts.grid);
    const { c: dc, r: dr } = snapPlacement(opts.grid, pl.c, pl.r);
    placements.push({ mapId: pl.mapId, c: dc, r: dr });
    const sg = new Grid(src.grid, src.width, src.height);
    const S = src.layers;
    const toDst = (i: number) => {
      const c = sg.col(i) + dc;
      const r = sg.row(i) + dr;
      return g.inBounds(c, r) ? g.idx(c, r) : -1;
    };
    let maxB = 0;
    for (let i = 0; i < sg.size; i++) {
      const j = toDst(i);
      if (j < 0) continue;
      filled[j] = 1;
      L.terrain[j] = S.terrain[i];
      L.elevation[j] = src.kind === 'overland' ? S.elevation[i] : isWater(S.terrain[i]) ? SEA_LEVEL - 0.02 : SEA_LEVEL + 0.06;
      L.moisture[j] = S.moisture[i];
      L.temperature[j] = S.temperature[i];
      L.building[j] = S.building[i] ? S.building[i] + buildingOffset : 0;
      maxB = Math.max(maxB, S.building[i]);
      L.roadLevel[j] = S.roadLevel[i];
      L.riverSize[j] = S.riverSize[i];
      L.object[j] = S.object[i];
      L.zone[j] = S.zone[i];
      // Keep only connections that stay inside the piece; the same offset keeps directions valid.
      for (let d = 0; d < sg.dirCount; d++) {
        const n = sg.neighbor(i, d);
        if (n < 0 || toDst(n) < 0) continue;
        if (S.road[i] & (1 << d)) L.road[j] |= 1 << d;
        if (S.river[i] & (1 << d)) L.river[j] |= 1 << d;
      }
    }
    buildingOffset += maxB;
    for (const f of src.features) {
      const c = f.c + dc;
      const r = f.r + dr;
      if (g.inBounds(c, r)) features.push({ ...f, c, r, tags: f.tags ? [...f.tags] : undefined });
    }
  }

  if (opts.fillGaps) fillGaps(g, L, filled, opts.seed);
  else for (let i = 0; i < g.size; i++) if (!filled[i]) L.terrain[i] = T.DEEP_OCEAN;

  const map: WorldMap = {
    id: newId('map'),
    name: opts.name,
    kind: 'overland',
    scaleId: opts.scaleId,
    grid: opts.grid,
    width: opts.width,
    height: opts.height,
    seed: opts.seed,
    settings: defaultSettings('overland', opts.scaleId),
    layers: L,
    features,
    children: [],
    composedFrom: placements,
  };

  if (opts.connectRoads) {
    const terms: Terminal[] = features
      .filter((f) => SETTLEMENT_TYPES.has(f.type) || f.type === 'castle' || f.type === 'market' || f.type === 'keep')
      .map((f) => ({ cell: g.idx(f.c, f.r), feature: f }));
    connectTerminals(g, L, terms, 0.1, new Rng(opts.seed).fork('roads'));
  }
  return map;
}

/** Fill unplaced cells with noise terrain that blends smoothly into the placed pieces. */
function fillGaps(g: Grid, L: ReturnType<typeof emptyLayers>, filled: Uint8Array, seed: number): void {
  const rng = new Rng(seed);
  const nE = new Noise2D(rng.fork('gap-elev'));
  const nM = new Noise2D(rng.fork('gap-moist'));
  const base = new Float64Array(g.size);
  const baseM = new Float64Array(g.size);
  const gaps: number[] = [];
  for (let i = 0; i < g.size; i++) {
    if (filled[i]) continue;
    gaps.push(i);
    const [x, y] = g.pos(i);
    base[i] = SEA_LEVEL + 0.12 + nE.fbm(x * 0.035, y * 0.035, 5) * 0.22;
    baseM[i] = clamp01(0.5 + nM.fbm(x * 0.05, y * 0.05, 4) * 0.4);
    L.elevation[i] = base[i];
    L.moisture[i] = baseM[i];
    L.temperature[i] = 0.6;
  }
  if (!gaps.length) return;
  // Relax towards neighbours so seams disappear, while keeping some noise.
  for (let it = 0; it < 40; it++) {
    for (const i of gaps) {
      let se = 0;
      let sm = 0;
      let st = 0;
      const nb = g.neighbors(i, true);
      for (const n of nb) {
        se += L.elevation[n];
        sm += L.moisture[n];
        st += L.temperature[n];
      }
      const k = nb.length || 1;
      L.elevation[i] = (se / k) * 0.85 + base[i] * 0.15;
      L.moisture[i] = (sm / k) * 0.85 + baseM[i] * 0.15;
      L.temperature[i] = (st / k) * 0.9 + 0.6 * 0.1;
    }
  }
  const S = new SettingsReader({}, 'overland', 'kingdom');
  for (const i of gaps) {
    L.elevation[i] = Math.round(L.elevation[i] * 1000) / 1000;
    L.moisture[i] = Math.round(L.moisture[i] * 1000) / 1000;
    L.temperature[i] = Math.round(L.temperature[i] * 1000) / 1000;
    L.terrain[i] = classify(L.elevation[i], L.moisture[i], L.temperature[i], S);
  }
  for (const i of gaps) {
    if (isWater(L.terrain[i]) || L.elevation[i] > SEA_LEVEL + 0.025) continue;
    if (g.neighbors(i).some((n) => isSea(L.terrain[n]))) L.terrain[i] = T.BEACH;
  }
}
