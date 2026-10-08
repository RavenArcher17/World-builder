/**
 * Convert a map to another grid layout (square ↔ hex ↔ isometric) or size, so the same world can
 * be exported for games that use different tile systems.
 */
import { Grid, GridType } from './grid';
import { linkPath, linkedNeighbors, traceLine } from './links';
import { WorldMap, emptyLayers, newId } from './types';

const S3 = Math.sqrt(3);

/** Grid dimensions that cover roughly the same logical area as the source map. */
export function equivalentSize(src: Grid, grid: GridType): { width: number; height: number } {
  const { w, h } = src.logicalBounds();
  const n = (v: number) => Math.max(1, Math.round(v));
  switch (grid) {
    case 'hex-pointy':
      return { width: n(w - 0.5), height: n((h - 2 / S3) / (S3 / 2) + 1) };
    case 'hex-flat':
      return { width: n((w - 2 / S3) / (S3 / 2) + 1), height: n(h - 0.5) };
    default:
      return { width: n(w), height: n(h) };
  }
}

export function resampleMap(src: WorldMap, grid: GridType, width?: number, height?: number): WorldMap {
  const sg = new Grid(src.grid, src.width, src.height);
  const size = width && height ? { width, height } : equivalentSize(sg, grid);
  const dg = new Grid(grid, size.width, size.height);
  const sb = sg.logicalBounds();
  const db = dg.logicalBounds();
  const kx = sb.w / db.w;
  const ky = sb.h / db.h;
  const toSrc = (x: number, y: number) => sg.posToCellClamped(x * kx, y * ky);
  const toDst = (x: number, y: number): [number, number] => [x / kx, y / ky];
  const S = src.layers;
  const D = emptyLayers(dg.size);
  for (let i = 0; i < dg.size; i++) {
    const [x, y] = dg.pos(i);
    const j = toSrc(x, y);
    D.terrain[i] = S.terrain[j];
    D.elevation[i] = S.elevation[j];
    D.moisture[i] = S.moisture[j];
    D.temperature[i] = S.temperature[j];
    D.building[i] = S.building[j];
  }
  for (const [layer, out, extra] of [
    [S.road, D.road, 'road'],
    [S.river, D.river, 'river'],
  ] as const) {
    for (let i = 0; i < sg.size; i++) {
      for (const j of linkedNeighbors(sg, layer, i)) {
        if (j < i) continue;
        const a = sg.pos(i);
        const b = sg.pos(j);
        const path = traceLine(dg, toDst(a[0], a[1]), toDst(b[0], b[1]));
        if (extra === 'road') linkPath(dg, out, path, D.roadLevel, Math.max(1, Math.min(S.roadLevel[i] || 1, S.roadLevel[j] || 1)));
        else {
          linkPath(dg, out, path);
          for (const k of path) D.riverSize[k] = Math.max(D.riverSize[k], S.riverSize[i], S.riverSize[j]);
        }
      }
    }
  }
  const features = src.features.map((f) => {
    const [x, y] = sg.posCR(f.c, f.r);
    const [dx, dy] = toDst(x, y);
    const k = dg.posToCellClamped(dx, dy);
    return { ...f, c: dg.col(k), r: dg.row(k) };
  });
  return {
    ...src,
    id: newId('map'),
    grid,
    width: dg.width,
    height: dg.height,
    layers: D,
    features,
    children: [],
    parent: undefined,
  };
}
