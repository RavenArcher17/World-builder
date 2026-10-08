import { describe, expect, it } from 'vitest';
import { paintCluster, paintGrove } from '../src/core/brushes';
import { O } from '../src/core/objects';
import { Rng } from '../src/core/rng';
import { T } from '../src/core/tiles';
import { WorldMap, emptyLayers } from '../src/core/types';
import { GRIDS } from './helpers';

function field(grid: WorldMap['grid']): WorldMap {
  const L = emptyLayers(30 * 30);
  L.terrain.fill(T.GRASS);
  return { id: 'm', name: 'm', kind: 'overland', scaleId: 'local', grid, width: 30, height: 30, seed: 1, settings: {}, layers: L, features: [], children: [] };
}

describe('object brushes', () => {
  it.each(GRIDS)('paint a grove of one species around the tap on %s', (grid) => {
    const m = field(grid);
    m.layers.object[15 * 30 + 16] = O.BANK;
    m.layers.terrain[15 * 30 + 14] = T.WATER;
    const changed = paintGrove(m, 15 * 30 + 15, O.OAK, 3, new Rng(4));
    expect(changed.length).toBeGreaterThan(6);
    expect(changed.every((i) => m.layers.object[i] === O.OAK)).toBe(true);
    expect(new Set(m.layers.object.filter(Boolean))).toEqual(new Set([O.OAK, O.BANK]));
    // Never on top of other objects or on water.
    expect(m.layers.object[15 * 30 + 16]).toBe(O.BANK);
    expect(m.layers.object[15 * 30 + 14]).toBe(0);
    for (const i of changed) expect(Math.max(Math.abs((i % 30) - 15), Math.abs(Math.floor(i / 30) - 15))).toBeLessThanOrEqual(4);
  });

  it('paints an ore cluster of 3 to 5 rocks next to the tap', () => {
    const m = field('iso');
    const changed = paintCluster(m, 10 * 30 + 10, O.TIN_ROCK, new Rng(9));
    expect(changed.length).toBeGreaterThanOrEqual(3);
    expect(changed.length).toBeLessThanOrEqual(5);
    expect(changed).toContain(10 * 30 + 10);
    for (const i of changed) {
      expect(m.layers.object[i]).toBe(O.TIN_ROCK);
      expect(Math.max(Math.abs((i % 30) - 10), Math.abs(Math.floor(i / 30) - 10))).toBeLessThanOrEqual(1);
    }
  });
});
