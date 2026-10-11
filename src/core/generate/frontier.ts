/**
 * Overland options about places, both off unless switched on in the generator's settings:
 *
 * - **Level ground under places** (`levelPlaces`): towns and places sit on level ground that
 *   blends into the land around them, so a 3D export has flat sites to build on.
 * - **Danger rings** (`dangerRings`): one axis for how far, how hard and how rewarding. Each
 *   place gets a danger level from 1 to 5 by its distance from home (the capital, or the biggest
 *   settlement nearest the middle), in five rings out to the farthest land. The level is in the
 *   place's `props` (`danger`, `dangerName`, and `home` on the home itself), which exports carry.
 *   Zooming in keeps the parent's levels.
 */
import { SETTLEMENT_TYPES, featureDef } from '../features';
import { Grid } from '../grid';
import { smoothstep } from '../noise';
import { isWater } from '../tiles';
import { type Feature, type MapLayers, SEA_LEVEL } from '../types';

/** Radius of level ground, in cells, by place type (other places get 1). */
const LEVEL_RADIUS: Record<string, number> = { capital: 3, city: 2.5, castle: 2, town: 2, village: 1.5 };

export function levelPlaces(g: Grid, L: MapLayers, features: Feature[]): void {
  const E = L.elevation;
  const before = E.slice();
  const weight = new Float64Array(g.size);
  for (const f of features) {
    if (f.c < 0 || f.r < 0 || f.c >= g.width || f.r >= g.height) continue;
    const at = g.idx(f.c, f.r);
    if (isWater(L.terrain[at])) continue;
    const level = before[at];
    const R = LEVEL_RADIUS[f.type] ?? 1;
    const [x0, y0] = g.pos(at);
    const reach = Math.ceil(R) + 1;
    for (let r = Math.max(0, f.r - reach); r <= Math.min(g.height - 1, f.r + reach); r++) {
      for (let c = Math.max(0, f.c - reach); c <= Math.min(g.width - 1, f.c + reach); c++) {
        const i = g.idx(c, r);
        if (isWater(L.terrain[i])) continue;
        const [x, y] = g.pos(i);
        const w = 1 - smoothstep(R * 0.5, R + 0.5, Math.hypot(x - x0, y - y0));
        // Where two sites overlap, the nearer one sets the level.
        if (w <= weight[i]) continue;
        weight[i] = w;
        E[i] = Math.round(Math.max(SEA_LEVEL + 0.002, before[i] + (level - before[i]) * w) * 1000) / 1000;
      }
    }
  }
}

export const DANGER_NAMES = ['Heartland', 'Borderland', 'Frontier', 'Wilds', 'Deep wilds'];

export function dangerRings(g: Grid, L: MapLayers, features: Feature[]): void {
  if (!features.length) return;
  // A zoomed-in map keeps its parent's rings: new places take the level of the nearest place
  // that came from the parent with one.
  const inherited = features.filter((f) => Number(f.props?.danger) >= 1);
  if (inherited.length) {
    for (const f of features) {
      if (inherited.includes(f)) continue;
      const [x, y] = g.posCR(f.c, f.r);
      const near = inherited.reduce((a, b) => (Math.hypot(...sub(g.posCR(b.c, b.r), x, y)) < Math.hypot(...sub(g.posCR(a.c, a.r), x, y)) ? b : a));
      const danger = Number(near.props!.danger);
      f.props = { ...(f.props ?? {}), danger, dangerName: DANGER_NAMES[danger - 1] };
    }
    return;
  }
  const { w, h } = g.logicalBounds();
  const mid = (f: Feature) => {
    const [x, y] = g.posCR(f.c, f.r);
    return Math.hypot(x - w / 2, y - h / 2);
  };
  const towns = features.filter((f) => SETTLEMENT_TYPES.has(f.type));
  const home = towns.length ? towns.reduce((a, b) => (featureDef(b.type).rank > featureDef(a.type).rank || (featureDef(b.type).rank === featureDef(a.type).rank && mid(b) < mid(a)) ? b : a)) : undefined;
  const [hx, hy] = home ? g.posCR(home.c, home.r) : [w / 2, h / 2];
  let far = 0;
  for (let i = 0; i < g.size; i++) {
    if (isWater(L.terrain[i])) continue;
    const [x, y] = g.pos(i);
    far = Math.max(far, Math.hypot(x - hx, y - hy));
  }
  for (const f of features) {
    const [x, y] = g.posCR(f.c, f.r);
    const danger = 1 + Math.min(4, Math.floor((Math.hypot(x - hx, y - hy) / Math.max(1, far)) * 5));
    f.props = { ...(f.props ?? {}), danger, dangerName: DANGER_NAMES[danger - 1], ...(f === home && { home: true }) };
  }
}

const sub = ([a, b]: [number, number], x: number, y: number): [number, number] => [a - x, b - y];

/** What the place panel says about a place's danger level, if it has one. */
export function dangerLabel(f: Feature): string {
  const d = Number(f.props?.danger);
  if (!(d >= 1 && d <= 5)) return '';
  const name = String(f.props?.dangerName ?? DANGER_NAMES[d - 1]);
  return `⚠️ Danger ${d} of 5 · ${name}${f.props?.home ? ' · the danger rings start here' : ''}`;
}
