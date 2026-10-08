import { describe, expect, it } from 'vitest';
import { Grid } from '../src/core/grid';
import { GRIDS } from './helpers';

describe.each(GRIDS)('Grid %s', (type) => {
  const g = new Grid(type, 13, 9);

  it('round-trips cell centres through pixel and logical lookups', () => {
    for (let i = 0; i < g.size; i++) {
      const [x, y] = g.center(i);
      expect(g.pixelToCell(x, y)).toBe(i);
      const [lx, ly] = g.pos(i);
      expect(g.posToCell(lx, ly)).toBe(i);
    }
  });

  it('has symmetric neighbours with consistent opposite directions', () => {
    for (let i = 0; i < g.size; i++) {
      for (let d = 0; d < g.dirCount; d++) {
        const n = g.neighbor(i, d);
        if (n < 0) continue;
        expect(g.neighbor(n, g.opposite(d))).toBe(i);
        expect(g.dirBetween(i, n)).toBe(d);
        expect(g.neighbors(n)).toContain(i);
      }
    }
  });

  it('places neighbours about one logical unit apart', () => {
    for (let i = 0; i < g.size; i++) {
      for (const n of g.neighbors(i, false)) expect(g.dist(i, n)).toBeCloseTo(1, 5);
    }
  });

  it('keeps every cell inside the render bounds', () => {
    const b = g.renderBounds();
    for (let i = 0; i < g.size; i++) {
      for (const [x, y] of g.corners(i)) {
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(x).toBeLessThanOrEqual(b.w + 1e-9);
        expect(y).toBeLessThanOrEqual(b.h + 1e-9);
      }
    }
  });
});
