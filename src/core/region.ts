/**
 * Regenerate part of a map: re-roll a rectangle with a new seed while keeping everything
 * outside it, then stitch rivers, roads, streets and corridors back together across the seam.
 */
import { SETTLEMENT_TYPES } from './features';
import { generateMap } from './generate';
import {
  Terminal,
  classifyCells,
  computeDrainage,
  connectTerminals,
  flowAccumulation,
  placeFeatures,
  riverThreshold,
} from './generate/overland';
import { CellRect, Grid, inRect, normalizeRect } from './grid';
import { link, linkedNeighbors, unlinkCell } from './links';
import { smoothstep } from './noise';
import { connectComponents } from './pathfinding';
import { Rng } from './rng';
import { getScale } from './scales';
import { SettingsReader } from './settings';
import { DUNGEON_PASSABLE, STREET_TILES, T, isWater } from './tiles';
import type { Project, WorldMap } from './types';
import { guideForMap } from './zoom';

export function cloneMap(m: WorldMap): WorldMap {
  return JSON.parse(JSON.stringify(m)) as WorldMap;
}

export function regenerateRegion(project: Project, map: WorldMap, rectIn: CellRect, seed: number): WorldMap {
  const rect = normalizeRect(rectIn);
  const g = new Grid(map.grid, map.width, map.height);
  const fresh = generateMap({ ...map, seed }, guideForMap(project, map));
  const out = cloneMap(map);
  const cells: number[] = [];
  for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) if (g.inBounds(c, r)) cells.push(g.idx(c, r));
  const inside = (i: number) => inRect(rect, g.col(i), g.row(i));

  // Features: drop unlinked ones inside the area, they get re-rolled below.
  out.features = out.features.filter((f) => !inRect(rect, f.c, f.r) || f.childMapId);

  if (map.kind === 'overland') regenOverland(g, out, fresh, rect, cells, inside, seed, !!guideForMap(project, map));
  else {
    const L = out.layers;
    const F = fresh.layers;
    const maxB = Math.max(0, ...L.building);
    for (const i of cells) {
      L.terrain[i] = F.terrain[i];
      L.building[i] = F.building[i] ? F.building[i] + maxB : 0;
    }
    out.features.push(...fresh.features.filter((f) => inRect(rect, f.c, f.r)));
    const rng = new Rng(seed).fork('stitch');
    if (map.kind === 'settlement') {
      connectComponents(
        g,
        (i) => STREET_TILES.has(L.terrain[i]),
        (i) => (isWater(L.terrain[i]) || L.terrain[i] === T.WALL || L.terrain[i] === T.KEEP ? Infinity : L.terrain[i] === T.BUILDING ? 6 : 1),
        (i) => {
          L.terrain[i] = T.STREET;
          L.building[i] = 0;
        },
        rng,
      );
    } else {
      const border = (i: number) => g.col(i) === 0 || g.row(i) === 0 || g.col(i) === g.width - 1 || g.row(i) === g.height - 1;
      connectComponents(
        g,
        (i) => DUNGEON_PASSABLE.has(L.terrain[i]),
        (i) => (border(i) ? Infinity : 1),
        (i) => (L.terrain[i] = T.CORRIDOR),
        rng,
      );
    }
  }
  return out;
}

function regenOverland(
  g: Grid,
  out: WorldMap,
  fresh: WorldMap,
  rect: CellRect,
  cells: number[],
  inside: (i: number) => boolean,
  seed: number,
  guided: boolean,
): void {
  const L = out.layers;
  const F = fresh.layers;
  const S = new SettingsReader(out.settings, 'overland', out.scaleId);
  const scale = getScale(out.scaleId);
  const feather = Math.max(1, Math.min(8, Math.floor(Math.min(rect.c1 - rect.c0, rect.r1 - rect.r0) / 3)));

  // Blend fields towards the fresh map with a feathered edge.
  const weight = new Map<number, number>();
  for (const i of cells) {
    const c = g.col(i);
    const r = g.row(i);
    const edge = Math.min(c - rect.c0, rect.c1 - c, r - rect.r0, rect.r1 - r) + 1;
    const w = smoothstep(0, 1, edge / (feather + 1));
    weight.set(i, w);
    L.elevation[i] = round3(L.elevation[i] + (F.elevation[i] - L.elevation[i]) * w);
    L.moisture[i] = round3(L.moisture[i] + (F.moisture[i] - L.moisture[i]) * w);
    L.temperature[i] = round3(L.temperature[i] + (F.temperature[i] - L.temperature[i]) * w);
  }

  // Remember where rivers and roads crossed the boundary, then clear the area.
  const riverEntries: [number, number][] = [];
  const roadEnds: Terminal[] = [];
  for (const i of cells) {
    for (const n of linkedNeighbors(g, L.river, i)) if (!inside(n)) riverEntries.push([n, i]);
    for (const n of linkedNeighbors(g, L.road, i)) if (!inside(n)) roadEnds.push({ cell: n, level: L.roadLevel[n] || 1 });
  }
  for (const i of cells) {
    unlinkCell(g, L.river, i);
    unlinkCell(g, L.road, i);
    L.riverSize[i] = 0;
    L.roadLevel[i] = 0;
  }

  // Water.
  const lakes = new Set<number>();
  for (const i of cells) {
    const w = weight.get(i) ?? 0;
    const wasLake = L.terrain[i] === T.LAKE;
    if (w >= 0.5 ? F.terrain[i] === T.LAKE : wasLake) lakes.add(i);
    L.terrain[i] = lakes.has(i) ? T.LAKE : T.GRASSLAND;
  }
  if (S.bool('t_rivers')) {
    const drainage = computeDrainage(g, L.elevation);
    const acc = flowAccumulation(drainage, L.moisture);
    const thr = riverThreshold(S, scale, guided);
    const starts = cells.filter((i) => !lakes.has(i) && L.elevation[i] >= 0.4 && acc[i] >= thr);
    for (const [o, k] of riverEntries) {
      link(g, L.river, o, k);
      starts.push(k);
    }
    const visited = new Set<number>();
    for (const s of starts) {
      let cur = s;
      for (let step = 0; step < g.size; step++) {
        L.riverSize[cur] = Math.max(L.riverSize[cur], Math.round(acc[cur]));
        const nxt = drainage.down[cur];
        if (nxt < 0) break;
        const wasRiver = L.river[nxt] !== 0;
        link(g, L.river, cur, nxt);
        if (isWater(L.terrain[nxt]) || (wasRiver && !inside(nxt)) || visited.has(nxt)) break;
        visited.add(nxt);
        cur = nxt;
      }
    }
  }
  classifyCells(g, L, S, cells);

  // New places inside the area.
  const rng = new Rng(seed);
  out.features.push(...placeFeatures(g, L, S, scale, rng.fork('features'), out.features, rect));

  // Roads: reconnect cut ends and new settlements.
  if (S.bool('t_roads')) {
    const terms: Terminal[] = [...roadEnds];
    for (const f of out.features) {
      if (!inRect(rect, f.c, f.r)) continue;
      if (SETTLEMENT_TYPES.has(f.type) || f.type === 'castle') terms.push({ cell: g.idx(f.c, f.r), feature: f });
    }
    connectTerminals(g, L, terms, S.num('roadLoops', 0.3) * 0.5, rng.fork('roads'));
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
