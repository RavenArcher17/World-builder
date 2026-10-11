/**
 * Convert a map to another grid layout (square ↔ hex ↔ isometric) or size, so the same world can
 * be exported for games that use different tile systems.
 */
import { Grid, GridType } from './grid';
import { linkPath, linkedNeighbors, traceLine } from './links';
import { type Layers3d, WorldMap, emptyLayers, newId } from './types';

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
  const from = new Int32Array(dg.size);
  for (let i = 0; i < dg.size; i++) {
    const [x, y] = dg.pos(i);
    const j = toSrc(x, y);
    from[i] = j;
    D.terrain[i] = S.terrain[j];
    D.elevation[i] = S.elevation[j];
    D.moisture[i] = S.moisture[j];
    D.temperature[i] = S.temperature[j];
    D.building[i] = S.building[j];
    D.object[i] = S.object[j];
    D.zone[i] = S.zone[j];
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
  // 3D maps: storeys, heights, roofs, facing and props follow the same cells; rooms their corners.
  const pick = (a: number[]) => Array.from(from, (j) => a[j]);
  const pick3d = (l: Layers3d): Layers3d => ({ height: pick(l.height), roof: pick(l.roof), facing: pick(l.facing), prop: pick(l.prop) });
  /** The cell under a point just inside a source cell's corner (k = −1 top-left, +1 bottom-right). */
  const cornerCell = (c: number, r: number, k: number) => {
    const [x, y] = sg.posCR(c, r);
    const [dx, dy] = toDst(x + k * 0.49, y + k * 0.49);
    return dg.posToCellClamped(dx, dy);
  };
  const extra3d: Partial<WorldMap> = {
    ...(src.layers3d && { layers3d: pick3d(src.layers3d) }),
    ...(src.storeys && {
      storeys: src.storeys.map((s) => ({
        z: s.z,
        layers: { ...emptyLayers(dg.size), terrain: pick(s.layers.terrain), object: pick(s.layers.object), building: pick(s.layers.building), zone: pick(s.layers.zone) },
        layers3d: pick3d(s.layers3d),
      })),
    }),
    ...(src.rooms && {
      rooms: src.rooms.map((room) => {
        const a = cornerCell(room.c0, room.r0, -1);
        const b = cornerCell(room.c1, room.r1, 1);
        return { ...room, c0: dg.col(a), r0: dg.row(a), c1: dg.col(b), r1: dg.row(b) };
      }),
    }),
  };
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
    ...extra3d,
  };
}
