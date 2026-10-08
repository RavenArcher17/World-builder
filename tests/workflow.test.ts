import { describe, expect, it } from 'vitest';
import { composeMaps } from '../src/core/compose';
import { toCsv, toGameJson, toTiled } from '../src/core/export/formats';
import { Grid } from '../src/core/grid';
import { createProject, deleteMap, parseProject, serializeProject } from '../src/core/project';
import { regenerateRegion } from '../src/core/region';
import { resampleMap } from '../src/core/resample';
import { T, TILES } from '../src/core/tiles';
import { SEA_LEVEL } from '../src/core/types';
import { createChildMap, suggestZoom } from '../src/core/zoom';
import { GRIDS, bitmaskProblems, make } from './helpers';

function projectWith(...maps: ReturnType<typeof make>[]) {
  const p = createProject('test');
  for (const m of maps) p.maps[m.id] = m;
  return p;
}

describe('zooming in', () => {
  it.each(GRIDS)('keeps the parent region shape, places and links on %s', (grid) => {
    const world = make('world', grid, 11);
    const p = projectWith(world);
    const city = world.features.find((f) => f.type === 'city' || f.type === 'capital')!;
    const rect = { c0: Math.max(0, city.c - 10), r0: Math.max(0, city.r - 8), c1: Math.min(world.width - 1, city.c + 10), r1: Math.min(world.height - 1, city.r + 8) };
    const opts = suggestZoom(world, rect);
    expect(opts.scaleId).toBe('continent');
    const child = createChildMap(p, world.id, rect, opts);
    expect(world.children).toContain(child.id);
    expect(child.parent?.mapId).toBe(world.id);
    expect(child.features.map((f) => f.name)).toContain(city.name);

    // Land/sea agreement between parent cells and the child area they cover.
    const pg = new Grid(world.grid, world.width, world.height);
    let parentLand = 0;
    let n = 0;
    for (let r = rect.r0; r <= rect.r1; r++)
      for (let c = rect.c0; c <= rect.c1; c++, n++) if (world.layers.elevation[pg.idx(c, r)] >= SEA_LEVEL) parentLand++;
    const childLand = child.layers.elevation.filter((e) => e >= SEA_LEVEL).length / child.layers.elevation.length;
    expect(Math.abs(childLand - parentLand / n)).toBeLessThan(0.15);
    expect(bitmaskProblems(child, child.layers.river)).toBe(0);
    expect(bitmaskProblems(child, child.layers.road)).toBe(0);
  });

  it('suggests a town layout for a small selection around a town', () => {
    const k = make('kingdom', 'square', 4);
    const town = k.features.find((f) => f.type === 'town')!;
    const rect = { c0: town.c - 1, r0: town.r - 1, c1: town.c + 1, r1: town.r + 1 };
    const opts = suggestZoom(k, rect);
    expect(['town', 'city']).toContain(opts.scaleId);
    expect(opts.name).toBe(town.name);
    const p = projectWith(k);
    const child = createChildMap(p, k.id, rect, opts);
    expect(child.kind).toBe('settlement');
    expect(k.features.find((f) => f.id === town.id)?.childMapId).toBe(child.id);
  });

  it('deleting a map removes its descendants and unlinks it', () => {
    const k = make('kingdom', 'square', 4);
    const p = projectWith(k);
    const child = createChildMap(p, k.id, { c0: 0, r0: 0, c1: 20, r1: 15 }, suggestZoom(k, { c0: 0, r0: 0, c1: 20, r1: 15 }));
    const grand = createChildMap(p, child.id, { c0: 0, r0: 0, c1: 10, r1: 10 }, suggestZoom(child, { c0: 0, r0: 0, c1: 10, r1: 10 }));
    expect(deleteMap(p, child.id).sort()).toEqual([child.id, grand.id].sort());
    expect(k.children).toEqual([]);
  });
});

describe('re-rolling an area', () => {
  it.each(['kingdom', 'town', 'dungeon'])('%s changes only the selection', (id) => {
    const m = make(id, 'hex-pointy', 17);
    const p = projectWith(m);
    const rect = { c0: 10, r0: 10, c1: 25, r1: 22 };
    const out = regenerateRegion(p, m, rect, 999);
    const g = new Grid(m.grid, m.width, m.height);
    let changedInside = 0;
    for (let i = 0; i < g.size; i++) {
      const c = g.col(i);
      const r = g.row(i);
      const inside = c >= rect.c0 && c <= rect.c1 && r >= rect.r0 && r <= rect.r1;
      if (!inside && m.kind === 'overland') expect(out.layers.terrain[i]).toBe(m.layers.terrain[i]);
      if (inside && out.layers.terrain[i] !== m.layers.terrain[i]) changedInside++;
    }
    expect(changedInside).toBeGreaterThan(10);
    expect(bitmaskProblems(out, out.layers.road)).toBe(0);
    expect(bitmaskProblems(out, out.layers.river)).toBe(0);
    expect(out.id).toBe(m.id);
  });
});

describe('stitching and conversion', () => {
  it('composes maps at offsets and fills the gaps', () => {
    const a = make('county', 'square', 1, [30, 20]);
    const b = make('village', 'square', 2, [24, 24]);
    const p = projectWith(a, b);
    const out = composeMaps(p, {
      name: 'board',
      grid: 'square',
      width: 70,
      height: 40,
      seed: 5,
      scaleId: 'county',
      placements: [
        { mapId: a.id, c: 0, r: 0 },
        { mapId: b.id, c: 40, r: 10 },
      ],
      fillGaps: true,
      connectRoads: true,
    });
    const g = new Grid('square', 70, 40);
    expect(out.layers.terrain[g.idx(5, 5)]).toBe(a.layers.terrain[5 * 30 + 5]);
    expect(out.layers.terrain[g.idx(45, 15)]).toBe(b.layers.terrain[5 * 24 + 5]);
    expect(out.features.length).toBe(a.features.length + b.features.length);
    expect(bitmaskProblems(out, out.layers.road)).toBe(0);
    expect(out.composedFrom).toHaveLength(2);
  });

  it('keeps hex row parity when placing pieces', () => {
    const a = make('village', 'hex-pointy', 2, [10, 10]);
    const p = projectWith(a);
    const out = composeMaps(p, { name: 'x', grid: 'hex-pointy', width: 30, height: 30, seed: 1, scaleId: 'county', placements: [{ mapId: a.id, c: 3, r: 5 }], fillGaps: false, connectRoads: false });
    expect(out.composedFrom?.[0].r! % 2).toBe(0);
  });

  it.each(GRIDS)('resamples a hex map to %s', (grid) => {
    const m = make('kingdom', 'hex-pointy', 3);
    const out = resampleMap(m, grid);
    expect(out.grid).toBe(grid);
    expect(out.layers.terrain.length).toBe(out.width * out.height);
    expect(out.features.length).toBe(m.features.length);
    expect(bitmaskProblems(out, out.layers.road)).toBe(0);
    expect(out.layers.road.some(Boolean)).toBe(true);
    const sea = (mm: typeof m) => mm.layers.terrain.filter((t) => t === T.OCEAN || t === T.DEEP_OCEAN).length / mm.layers.terrain.length;
    expect(Math.abs(sea(out) - sea(m))).toBeLessThan(0.05);
  });
});

describe('export', () => {
  it.each(GRIDS)('writes a valid Tiled map for %s', (grid) => {
    const m = make('county', grid, 2);
    const tmj = toTiled(m, 'tiles.png') as Record<string, any>;
    expect(tmj.orientation).toBe(grid === 'square' ? 'orthogonal' : grid === 'iso' ? 'isometric' : 'hexagonal');
    if (grid.startsWith('hex')) {
      expect(tmj.staggeraxis).toBe(grid === 'hex-pointy' ? 'y' : 'x');
      expect(tmj.staggerindex).toBe('odd');
    }
    const data = tmj.layers[0].data as number[];
    expect(data).toHaveLength(m.width * m.height);
    expect(Math.min(...data)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...data)).toBeLessThanOrEqual(TILES.length);
    expect(tmj.layers.find((l: any) => l.name === 'features').objects).toHaveLength(m.features.length);
    expect(tmj.tilesets[0].tilecount).toBe(TILES.length);
  });

  it('writes game JSON and CSV', () => {
    const m = make('town', 'square', 2);
    const j = toGameJson(m) as Record<string, any>;
    expect(j.layers.terrain).toHaveLength(m.width * m.height);
    expect(j.legend.map((l: any) => l.id).sort((a: number, b: number) => a - b)).toEqual([...new Set(m.layers.terrain)].sort((a, b) => a - b));
    const csv = toCsv(m).trim().split('\n');
    expect(csv).toHaveLength(m.height);
    expect(csv[0].split(',')).toHaveLength(m.width);
  });

  it('round-trips a project file', () => {
    const p = projectWith(make('village', 'iso', 2));
    const back = parseProject(serializeProject(p));
    expect(back).toEqual(p);
    expect(() => parseProject('{"hello":1}')).toThrow();
  });
});
