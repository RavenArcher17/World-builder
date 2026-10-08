import { generateMap } from '../src/core/generate';
import { Grid, GridType } from '../src/core/grid';
import { getScale } from '../src/core/scales';
import { defaultSettings } from '../src/core/settings';
import type { WorldMap } from '../src/core/types';

export const GRIDS: GridType[] = ['square', 'hex-pointy', 'hex-flat', 'iso'];

export function make(scaleId: string, grid: GridType = 'hex-pointy', seed = 1234, size?: [number, number]): WorldMap {
  const s = getScale(scaleId);
  return generateMap({
    name: s.label,
    kind: s.kind,
    scaleId,
    grid,
    width: size?.[0] ?? s.width,
    height: size?.[1] ?? s.height,
    seed,
    settings: defaultSettings(s.kind, scaleId),
  });
}

/** Every connection bit must be mirrored by the neighbour's opposite bit. */
export function bitmaskProblems(map: WorldMap, layer: number[]): number {
  const g = new Grid(map.grid, map.width, map.height);
  let bad = 0;
  for (let i = 0; i < g.size; i++) {
    for (let d = 0; d < g.dirCount; d++) {
      if (!(layer[i] & (1 << d))) continue;
      const n = g.neighbor(i, d);
      if (n < 0 || !(layer[n] & (1 << g.opposite(d)))) bad++;
    }
  }
  return bad;
}
