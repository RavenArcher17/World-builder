/** Object brushes that scatter many objects at once: groves of one tree, clusters of one ore. */
import { Grid } from './grid';
import type { Rng } from './rng';
import { tile } from './tiles';
import type { WorldMap } from './types';

/** Open land a tree or rock can go on: walkable, not water, nothing standing there. */
function free(map: WorldMap, i: number): boolean {
  const t = tile(map.layers.terrain[i]);
  return t.walkable && t.category !== 'water' && map.layers.object[i] === 0;
}

/**
 * A grove: about half the free cells within `radius` of `center` get the object, denser in the
 * middle. Returns the cells that changed.
 */
export function paintGrove(map: WorldMap, center: number, objectId: number, radius: number, rng: Rng): number[] {
  const g = new Grid(map.grid, map.width, map.height);
  const [cx, cy] = g.pos(center);
  const reach = Math.max(1, radius) + 0.5;
  const changed: number[] = [];
  const c0 = g.col(center);
  const r0 = g.row(center);
  const span = Math.ceil(reach) + 1;
  for (let r = r0 - span; r <= r0 + span; r++) {
    for (let c = c0 - span; c <= c0 + span; c++) {
      if (!g.inBounds(c, r)) continue;
      const i = g.idx(c, r);
      const [x, y] = g.pos(i);
      const d = Math.hypot(x - cx, y - cy) / reach;
      if (d > 1 || !free(map, i) || !rng.chance(0.75 - 0.45 * d)) continue;
      map.layers.object[i] = objectId;
      changed.push(i);
    }
  }
  return changed;
}

/** An ore cluster like the game's: 3–5 rocks of one ore in the 3×3 around `center`. */
export function paintCluster(map: WorldMap, center: number, objectId: number, rng: Rng): number[] {
  const g = new Grid(map.grid, map.width, map.height);
  const around = [center, ...g.neighbors(center, true)].filter((i) => free(map, i));
  rng.shuffle(around);
  // Always include the tapped cell when it's free, so the cluster lands where you tapped.
  if (free(map, center)) around.sort((a, b) => (a === center ? -1 : b === center ? 1 : 0));
  const changed = around.slice(0, rng.int(3, 5));
  for (const i of changed) map.layers.object[i] = objectId;
  return changed;
}
