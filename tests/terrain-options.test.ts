import { describe, expect, it } from 'vitest';
import { SETTLEMENT_TYPES } from '../src/core/features';
import { generateMap } from '../src/core/generate';
import { Grid } from '../src/core/grid';
import { getScale } from '../src/core/scales';
import { createProject } from '../src/core/project';
import { defaultSettings } from '../src/core/settings';
import { T, isWater } from '../src/core/tiles';
import { SEA_LEVEL, type Settings, type WorldMap } from '../src/core/types';
import { createChildMap, suggestZoom } from '../src/core/zoom';
import { GRIDS } from './helpers';

/** The same map with some of the opt-in terrain options switched on. */
function withOptions(scaleId: string, extra: Settings, grid: (typeof GRIDS)[number] = 'square', seed = 3): WorldMap {
  const s = getScale(scaleId);
  return generateMap({ name: s.label, kind: 'overland', scaleId, grid, width: 96, height: 64, seed, settings: { ...defaultSettings('overland', scaleId), ...extra } });
}

const isSeaCell = (m: WorldMap, i: number) => m.layers.elevation[i] < SEA_LEVEL;
const quantile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * q)];
const median = (xs: number[]) => quantile(xs, 0.5);

describe('opt-in terrain options', () => {
  it('start switched off', () => {
    const s = defaultSettings('overland', 'world');
    expect(s).toMatchObject({ ranges: false, plains: 0, shelves: false, levelPlaces: false, dangerRings: false });
  });

  it('mountain ranges keep the coastline and gather the high ground into ranges', () => {
    const base = withOptions('kingdom', {});
    const ranged = withOptions('kingdom', { ranges: true });
    const N = base.layers.elevation.length;
    for (let i = 0; i < N; i++) expect(isSeaCell(ranged, i)).toBe(isSeaCell(base, i));
    expect(ranged.layers.elevation).not.toEqual(base.layers.elevation);
    // Lower, smoother country between the ranges, and higher ground along them.
    const land = [...Array(N).keys()].filter((i) => !isSeaCell(base, i));
    expect(quantile(land.map((i) => ranged.layers.elevation[i]), 0.25)).toBeLessThan(quantile(land.map((i) => base.layers.elevation[i]), 0.25));
    expect(ranged.layers.terrain).toContain(T.MOUNTAINS);
  });

  it('flat plains keep the coastline and lower the lowlands', () => {
    const base = withOptions('world', {});
    const flat = withOptions('world', { plains: 1 });
    const land = [...base.layers.elevation.keys()].filter((i) => !isSeaCell(base, i));
    for (const i of land) expect(isSeaCell(flat, i)).toBe(false);
    expect(median(land.map((i) => flat.layers.elevation[i]))).toBeLessThan(median(land.map((i) => base.layers.elevation[i])));
    expect(Math.max(...land.map((i) => flat.layers.elevation[i]))).toBeCloseTo(Math.max(...land.map((i) => base.layers.elevation[i])), 2);
  });

  it('coastal shelves are shallow by the shore and deep out at sea, without moving the sea', () => {
    const base = withOptions('world', {});
    const shelf = withOptions('world', { shelves: true });
    const g = new Grid(shelf.grid, shelf.width, shelf.height);
    let nearShore = 0;
    let deepNearShore = 0;
    for (let i = 0; i < g.size; i++) {
      expect(isSeaCell(shelf, i)).toBe(isSeaCell(base, i));
      if (!isSeaCell(shelf, i) || !g.neighbors(i).some((n) => !isSeaCell(shelf, n))) continue;
      nearShore++;
      if (shelf.layers.terrain[i] === T.DEEP_OCEAN) deepNearShore++;
    }
    expect(nearShore).toBeGreaterThan(50);
    expect(deepNearShore).toBe(0);
    expect(shelf.layers.terrain).toContain(T.DEEP_OCEAN);
  });

  it('levels the ground under places', () => {
    const base = withOptions('county', {});
    const level = withOptions('county', { levelPlaces: true });
    expect(level.features.map((f) => [f.type, f.c, f.r])).toEqual(base.features.map((f) => [f.type, f.c, f.r]));
    expect(level.layers.terrain).toEqual(base.layers.terrain);
    const g = new Grid(level.grid, level.width, level.height);
    const town = level.features.find((f) => f.type === 'town')!;
    const at = g.idx(town.c, town.r);
    // The cells next to a town are at its level (where they are land and no nearer place levels them).
    const flat = g.neighbors(at).filter((n) => !isWater(level.layers.terrain[n]) && Math.abs(level.layers.elevation[n] - level.layers.elevation[at]) < 0.002);
    expect(flat.length).toBeGreaterThan(0);
    for (let i = 0; i < g.size; i++) if (!isWater(level.layers.terrain[i])) expect(level.layers.elevation[i]).toBeGreaterThanOrEqual(SEA_LEVEL);
  });

  it.each(GRIDS)('danger rings rise from the capital outwards on %s', (grid) => {
    const m = withOptions('kingdom', { dangerRings: true }, grid);
    const g = new Grid(m.grid, m.width, m.height);
    const homes = m.features.filter((f) => f.props?.home);
    expect(homes).toHaveLength(1);
    const home = homes[0];
    expect(SETTLEMENT_TYPES.has(home.type)).toBe(true);
    expect(home.props?.danger).toBe(1);
    const dist = (c: number, r: number) => Math.hypot(g.posCR(c, r)[0] - g.posCR(home.c, home.r)[0], g.posCR(c, r)[1] - g.posCR(home.c, home.r)[1]);
    const byDist = [...m.features].sort((a, b) => dist(a.c, a.r) - dist(b.c, b.r));
    for (let k = 1; k < byDist.length; k++) expect(Number(byDist[k].props?.danger)).toBeGreaterThanOrEqual(Number(byDist[k - 1].props?.danger));
    const levels = new Set(m.features.map((f) => f.props?.danger));
    expect(levels.size).toBeGreaterThanOrEqual(3);
    for (const f of m.features) expect(f.props?.dangerName).toBeTruthy();
  });

  it('zoomed-in maps keep the parent’s danger levels', () => {
    const k = withOptions('kingdom', { dangerRings: true, levelPlaces: true });
    const p = createProject('test');
    p.maps[k.id] = k;
    const far = k.features.filter((f) => f.type !== 'inn').reduce((a, b) => (Number(b.props?.danger) > Number(a.props?.danger) ? b : a));
    const rect = { c0: Math.max(0, far.c - 8), r0: Math.max(0, far.r - 6), c1: Math.min(k.width - 1, far.c + 8), r1: Math.min(k.height - 1, far.r + 6) };
    const opts = suggestZoom(k, rect);
    expect(opts.settings.dangerRings).toBe(true);
    const child = createChildMap(p, k.id, rect, opts);
    expect(child.features.find((f) => f.name === far.name)?.props?.danger).toBe(far.props?.danger);
    // No new home: every place in the child takes a level from the parent's rings.
    expect(child.features.some((f) => f.props?.home)).toBe(false);
    for (const f of child.features) expect(Number(f.props?.danger)).toBeGreaterThanOrEqual(1);
    expect(Math.min(...child.features.map((f) => Number(f.props?.danger)))).toBeGreaterThan(1);
  });

  it('all together still make a sound map on every grid', () => {
    for (const grid of GRIDS) {
      const m = withOptions('continent', { ranges: true, plains: 0.5, shelves: true, levelPlaces: true, dangerRings: true }, grid, 8);
      expect(m.features.length).toBeGreaterThan(5);
      expect(m.layers.elevation.every((e) => e >= 0 && e <= 1)).toBe(true);
    }
  });
});
