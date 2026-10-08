import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/core/generate';
import { Grid } from '../src/core/grid';
import { components } from '../src/core/pathfinding';
import { SCALES } from '../src/core/scales';
import { defaultSettings } from '../src/core/settings';
import { DUNGEON_PASSABLE, STREET_TILES, T } from '../src/core/tiles';
import { GRIDS, bitmaskProblems, make } from './helpers';

describe('generation', () => {
  it.each(SCALES.map((s) => s.id))('%s is deterministic for a seed', (id) => {
    const a = make(id, 'hex-pointy', 99);
    const b = make(id, 'hex-pointy', 99);
    expect(a.layers).toEqual(b.layers);
    expect(a.features.map((f) => [f.type, f.c, f.r, f.name])).toEqual(b.features.map((f) => [f.type, f.c, f.r, f.name]));
    const c = make(id, 'hex-pointy', 100);
    expect(c.layers.terrain).not.toEqual(a.layers.terrain);
  });

  it.each(GRIDS)('overland maps on %s have water, land, rivers, roads and places', (grid) => {
    const m = make('kingdom', grid, 7);
    const t = new Set(m.layers.terrain);
    expect(t.has(T.OCEAN) || t.has(T.DEEP_OCEAN)).toBe(true);
    expect(t.has(T.GRASSLAND) || t.has(T.FOREST)).toBe(true);
    expect(m.layers.river.some(Boolean)).toBe(true);
    expect(m.layers.road.some(Boolean)).toBe(true);
    expect(m.features.some((f) => f.type === 'town')).toBe(true);
    expect(bitmaskProblems(m, m.layers.river)).toBe(0);
    expect(bitmaskProblems(m, m.layers.road)).toBe(0);
  });

  it('respects feature and terrain toggles', () => {
    const base = make('county', 'square', 5);
    expect(base.features.some((f) => f.type === 'dungeon')).toBe(true);
    expect(base.layers.terrain).toContain(T.FOREST);
    const settings = { ...defaultSettings('overland', 'county'), f_dungeon: false, t_roads: false, t_forests: false };
    const off = generateMap({ ...base, settings });
    expect(off.features.some((f) => f.type === 'dungeon')).toBe(false);
    expect(off.layers.road.some(Boolean)).toBe(false);
    expect(off.layers.terrain).not.toContain(T.FOREST);
  });

  it('puts places on walkable land', () => {
    for (const id of ['world', 'kingdom', 'county']) {
      const m = make(id, 'hex-flat', 3);
      const g = new Grid(m.grid, m.width, m.height);
      for (const f of m.features) {
        const t = m.layers.terrain[g.idx(f.c, f.r)];
        expect([T.OCEAN, T.DEEP_OCEAN, T.LAKE]).not.toContain(t);
      }
    }
  });

  it.each(GRIDS)('settlement streets form one network on %s', (grid) => {
    const m = make('town', grid, 21);
    const g = new Grid(m.grid, m.width, m.height);
    const isStreet = (i: number) => STREET_TILES.has(m.layers.terrain[i]);
    const { sizes } = components(g, isStreet);
    const total = sizes.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(50);
    expect(Math.max(...sizes) / total).toBeGreaterThan(0.9);
    expect(m.layers.terrain.filter((t) => t === T.BUILDING).length).toBeGreaterThan(100);
    expect(m.features.some((f) => f.type === 'market')).toBe(true);
  });

  it.each(GRIDS)('dungeons are fully connected on %s', (grid) => {
    for (const id of ['dungeon', 'cave']) {
      const m = make(id, grid, 8);
      const g = new Grid(m.grid, m.width, m.height);
      const { sizes } = components(g, (i) => DUNGEON_PASSABLE.has(m.layers.terrain[i]));
      expect(sizes.length).toBe(1);
      expect(m.layers.terrain).toContain(T.STAIRS_UP);
      expect(m.features.some((f) => f.type === 'entrance')).toBe(true);
    }
  });
});
