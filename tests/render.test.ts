import { describe, expect, it } from 'vitest';
import { Grid } from '../src/core/grid';
import { emptyLayers, type WorldMap } from '../src/core/types';
import { paintOrder } from '../src/ui/drawObjects';
import { OVERVIEW_MIN_CELLS, overviewWanted } from '../src/ui/overview';
import { cacheRegion, cellsInRegion, regionAround, wantsOverview, DEFAULT_VIEW } from '../src/ui/render';
import { GRIDS } from './helpers';

/** The cells a region draws, found the slow way: every cell's centre against the region and its margins. */
function slowCells(g: Grid, r: { x0: number; y0: number; x1: number; y1: number }): number[] {
  return paintOrder(g).filter((i) => {
    const [x, y] = g.center(i);
    return x >= r.x0 - 9 && x <= r.x1 + 9 && y >= r.y0 - 2 && y <= r.y1 + 16;
  });
}

const world = (n: number): WorldMap => ({
  id: 'w', name: 'World', kind: 'overland', scaleId: 'local', grid: 'iso', width: n, height: n, seed: 1,
  settings: { rpgdcMapId: 'overworld' }, layers: emptyLayers(n * n), children: [], features: [],
});

describe('drawing just part of a big map', () => {
  it('finds the cells around a region without looking at the rest, in the order they’re painted', () => {
    for (const type of GRIDS) {
      for (const [w, h] of [[30, 20], [17, 33]]) {
        const g = new Grid(type, w, h);
        for (const r of [{ x0: 3, y0: 2, x1: 14, y1: 9 }, { x0: -5, y0: -5, x1: 2, y1: 1 }, { x0: 20, y0: 15, x1: 90, y1: 60 }, { x0: 0, y0: 0, x1: 0.5, y1: 0.5 }]) {
          const fast = cellsInRegion(g, r);
          const want = slowCells(g, r);
          if (type === 'iso') expect(fast, `${type} ${w}×${h} ${JSON.stringify(r)}`).toEqual(want);
          else expect([...fast].sort((a, b) => a - b), `${type} ${w}×${h} ${JSON.stringify(r)}`).toEqual(want);
        }
      }
    }
  });

  it('redraws what a painted cell and the things standing near it can reach, and no more', () => {
    const g = new Grid('iso', 768, 768);
    const one = regionAround(g, [g.idx(400, 400)]);
    expect(one).toHaveLength(1);
    const [x, y] = g.centerCR(400, 400);
    expect(one[0]).toEqual({ x0: x - 9, y0: y - 16, x1: x + 9, y1: y + 2 });
    // A brush stroke is one patch; cells far apart (a guard's post across town) are patches of their own.
    expect(regionAround(g, [g.idx(400, 400), g.idx(401, 400), g.idx(400, 401)])).toHaveLength(1);
    expect(regionAround(g, [g.idx(400, 400), g.idx(100, 700)])).toHaveLength(2);
  });

  it('draws a big map zoomed out (or with too many cells in view) as an overview; small maps as before', () => {
    const big = world(768);
    const g = new Grid('iso', 768, 768);
    // Zoomed right out: the whole map, a pixel a unit.
    const far = cacheRegion(big, { x0: -100, y0: -50, x1: 1700, y1: 900 }, 0.7);
    expect([far.s, far.region]).toEqual([1, { x0: 0, y0: 0, x1: 1536, y1: 768 }]);
    expect(wantsOverview(big, far.s, DEFAULT_VIEW, far.region)).toBe(true);
    // Zoomed in on the town: cell by cell.
    const near = cacheRegion(big, { x0: 760, y0: 370, x1: 790, y1: 400 }, 40);
    expect(wantsOverview(big, near.s, DEFAULT_VIEW, near.region)).toBe(false);
    expect(overviewWanted(g, 3, 1000, false)).toBe(false);
    expect(overviewWanted(g, 2, 1000, false)).toBe(true);
    expect(overviewWanted(g, 5, 1000, true)).toBe(true);
    expect(overviewWanted(g, 20, 100_000, false)).toBe(true);
    // Maps up to 256×256 always cell by cell, at any zoom.
    expect(OVERVIEW_MIN_CELLS).toBe(256 * 256);
    const small = new Grid('iso', 256, 256);
    expect(overviewWanted(small, 1, 65536, true)).toBe(false);
    expect(wantsOverview(world(256), 2, DEFAULT_VIEW)).toBe(false);
  });
});
