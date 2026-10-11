import { describe, expect, it } from 'vitest';
import { buildScene } from '../src/core/scene3d/build';
import { storeyLayers, storeyNumbers } from '../src/core/scene3d/storeys';
import { T } from '../src/core/tiles';
import { checkUnderkeepMap, validateUnderkeep } from '../src/core/underkeep/checks';
import { isUnderkeep, toUnderkeep, underkeepFileName } from '../src/core/underkeep/export';
import type { UkMap } from '../src/core/underkeep/format';
import { fromUnderkeep, isUnderkeepFile, upgradeUnderkeep } from '../src/core/underkeep/import';
import { make } from './helpers';

/**
 * A 14×12 tower in Underkeep's own format: a hall on storey 0 with the Great Stair, a staircase
 * of three cells (0, 2 and 4 m) climbing north to a gallery on storey 1.
 */
export function tower(): UkMap {
  const w = 14;
  const h = 12;
  const row = (fill: string, inner: string) => fill + inner.repeat(w - 2) + fill;
  const hall = Array.from({ length: h }, (_, y) => (y === 0 || y === h - 1 ? '#'.repeat(w) : row('#', '.')));
  // Stairs at x 6, rows 8, 7, 6, pointing north (^); the top one points at the gallery's row 5.
  const put = (rows: string[], x: number, y: number, ch: string) => (rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1));
  for (const y of [8, 7, 6]) put(hall, 6, y, '^');
  // In front of the top stair the hall is walled, so the stairs climb out to the gallery above.
  put(hall, 6, 5, '#');
  const gallery = Array.from({ length: h }, (_, y) => (y === 0 ? '#'.repeat(w) : y >= 1 && y <= 5 ? row('#', '.') : ' '.repeat(w)));
  const heights = (z: number) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (z === 0 && x === 6 ? (y === 7 ? 4 : y === 6 ? 8 : 0) : 0)));
  return {
    version: 2,
    name: 'Test tower',
    w,
    h,
    storeys: [
      { tiles: hall, roof: Array(h).fill('1'.repeat(w)), height: heights(0) },
      { tiles: gallery, roof: Array(h).fill('0'.repeat(w)), height: heights(1) },
    ],
    objects: [
      { t: 'stair', x: 2, y: 10, z: 0, r: 0, tier: -1 },
      { t: 'hearth', x: 2, y: 1, z: 0, r: 2, tier: -1 },
      { t: 'brazier', x: 10, y: 9, z: 0, r: 0, tier: -1 },
      { t: 'shieldman', x: 11, y: 4, z: 0, r: 0, tier: 1 },
      { t: 'castellan', x: 10, y: 2, z: 1, r: 0, tier: 3 },
      { t: 'chest', x: 3, y: 2, z: 1, r: -1, tier: 2 },
      { t: 'rope', x: 12, y: 1, z: 1, r: 0, tier: -1 },
      { t: 'table', x: 9, y: 6, z: 0, r: 1, tier: -1 },
      { t: 'banner', x: 7, y: 1, z: 1, r: 2, tier: -1 },
      { t: 'trap', x: 4, y: 4, z: 0, r: 0, tier: -1 },
      { t: 'clapper', x: 8, y: 3, z: 1, r: 0, tier: -1 },
    ],
    regions: [
      { name: 'The Hall', z: 0, x0: 1, y0: 1, x1: 12, y1: 10 },
      { name: 'The Gallery', z: 1, x0: 1, y0: 1, x1: 12, y1: 5 },
    ],
  };
}

const sortObjects = (md: UkMap) => [...md.objects].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);

describe('Underkeep map files', () => {
  it('recognises the format and upgrades version 1', () => {
    expect(isUnderkeepFile(tower())).toBe(true);
    expect(isUnderkeepFile({ format: 'world-builder-project', maps: {} })).toBe(false);
    const v1 = upgradeUnderkeep({ w: 3, h: 2, tiles: ['#.#'], objects: [{ t: 'stair', x: '1', y: 0 }] } as never);
    expect(v1.storeys).toHaveLength(1);
    expect(v1.storeys[0].tiles).toEqual(['#.#', '   ']);
    expect(v1.storeys[0].roof).toEqual(['111', '111']);
    expect(v1.objects[0]).toEqual({ t: 'stair', x: 1, y: 0, z: 0, r: 0, tier: -1 });
  });

  it('passes the game’s own checks for a good map', () => {
    const r = validateUnderkeep(tower());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.counts).toMatchObject({ enemies: 2, chests: 1, exits: 2, lights: 2, fires: 1, storeys: 2 });
    // Both storeys are reachable: the stairs climb to the gallery.
    expect(r.counts.floor).toBeGreaterThan(10 * 12);
  });

  it('opens as a 3D Underkeep map and writes back the same file', () => {
    const md = tower();
    const map = fromUnderkeep(md);
    expect(isUnderkeep(map)).toBe(true);
    expect(storeyNumbers(map)).toEqual([0, 1]);
    expect(storeyLayers(map, 1).terrain[7 * 14 + 3]).toBe(T.VOID);
    expect(map.features.find((f) => f.type === 'uk_enemy' && f.z === 1)?.props).toMatchObject({ kind: 'castellan', tier: 3 });
    expect(map.rooms).toHaveLength(2);
    const back = toUnderkeep(map);
    expect(back.dropped).toEqual([]);
    expect(back.md.storeys).toEqual(md.storeys);
    expect(sortObjects(back.md)).toEqual(sortObjects(md));
    expect(back.md.regions).toEqual(md.regions);
    expect(() => buildScene(map)).not.toThrow();
  });

  it('puts the storey with the Great Stair at ground level', () => {
    const md = tower();
    // Move the stair up to the gallery: storey 1 of the file becomes World Builder's ground storey.
    md.objects[0] = { t: 'stair', x: 2, y: 4, z: 1, r: 1, tier: -1 };
    const map = fromUnderkeep(md);
    expect(storeyNumbers(map)).toEqual([-1, 0]);
    expect(toUnderkeep(map).md.storeys).toEqual(md.storeys);
  });

  it('reports what the game would refuse', () => {
    const two = tower();
    two.objects.push({ t: 'stair', x: 4, y: 9, z: 0, r: 0, tier: -1 });
    expect(validateUnderkeep(two).errors.map((e) => e.message)).toContain('2 Great Stairs. There can be only one.');

    const none = tower();
    none.objects.shift();
    expect(validateUnderkeep(none).errors[0].message).toMatch(/No Great Stair/);

    const wall = tower();
    wall.objects.push({ t: 'pot', x: 0, y: 5, z: 0, r: 0, tier: -1 });
    expect(validateUnderkeep(wall).errors[0]).toMatchObject({ cells: [[0, 5, 0]] });

    const steep = tower();
    steep.storeys[0].height[7][6] = 6;
    expect(validateUnderkeep(steep).errors.map((e) => e.message).join()).toMatch(/rise more than 2 m/);

    const bonk = tower();
    bonk.storeys[1].tiles[6] = '#' + '.'.repeat(12) + '#';
    expect(validateUnderkeep(bonk).errors.map((e) => e.message).join()).toMatch(/run into the floor above/);
  });

  it('warns about what it cannot see or reach', () => {
    const cut = tower();
    for (const y of [8, 7, 6]) cut.storeys[0].tiles[y] = cut.storeys[0].tiles[y].slice(0, 6) + '.' + cut.storeys[0].tiles[y].slice(7);
    const msgs = validateUnderkeep(cut).warnings.map((w) => w.message).join('\n');
    expect(msgs).toMatch(/cannot be walked, dropped or climbed/);
    expect(msgs).toMatch(/storey\(s\) cannot be reached/);
    const dark = tower();
    dark.objects = dark.objects.filter((o) => !['hearth', 'brazier'].includes(o.t));
    expect(validateUnderkeep(dark).warnings.map((w) => w.message).join()).toMatch(/pitch black/);
  });

  it('exports a generated dungeon, turning its places into Underkeep objects', () => {
    const m = make('dungeon', 'square', 8, [40, 32]);
    const { md, dropped } = toUnderkeep(m);
    expect(md.storeys).toHaveLength(1);
    expect(md.objects.filter((o) => o.t === 'stair')).toHaveLength(1);
    expect(md.storeys[0].tiles.join('')).toMatch(/^[#. ^>v<_,]+$/);
    expect(dropped.join()).not.toMatch(/entrance/);
    const { problems } = checkUnderkeepMap(m);
    expect(problems.filter((p) => p.level === 'error')).toEqual([]);
  });

  it('refuses hex maps and names files the way the game does', () => {
    const hex = make('dungeon', 'hex-pointy', 8, [20, 16]);
    expect(() => toUnderkeep(hex)).toThrow(/square cells/);
    expect(checkUnderkeepMap(hex).problems[0].level).toBe('error');
    expect(underkeepFileName('Bell Tower: v2!')).toBe('Bell Tower v2.json');
    expect(underkeepFileName('***')).toBe('untitled.json');
  });
});
