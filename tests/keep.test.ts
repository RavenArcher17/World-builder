import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/core/generate';
import { getScale } from '../src/core/scales';
import { buildScene } from '../src/core/scene3d/build';
import { sceneToGlb } from '../src/core/scene3d/glb';
import { is3d } from '../src/core/scene3d/options';
import { storeyNumbers } from '../src/core/scene3d/storeys';
import { defaultSettings } from '../src/core/settings';
import { checkUnderkeepMap, validateUnderkeep } from '../src/core/underkeep/checks';
import { toUnderkeep } from '../src/core/underkeep/export';
import type { GridType } from '../src/core/grid';

function keep(seed: number, settings: Record<string, number | boolean | string> = {}, size: [number, number] = [36, 30], grid: GridType = 'square') {
  const s = getScale('keep');
  return generateMap({ name: 'Keep', kind: s.kind, scaleId: s.id, grid, width: size[0], height: size[1], seed, settings: { ...defaultSettings('dungeon', 'keep'), ...settings } });
}

describe('keeps in storeys', () => {
  it('is a 3D map with a tower above and a crypt below', () => {
    const m = keep(1);
    expect(is3d(m)).toBe(true);
    expect(storeyNumbers(m)).toEqual([-1, 0, 1, 2]);
    expect(m.features.filter((f) => f.type === 'entrance')).toHaveLength(1);
    expect(m.features.some((f) => f.type === 'boss' && f.z === 2)).toBe(true);
    expect(m.rooms?.some((r) => r.name === 'Great Hall')).toBe(true);
    expect(m.rooms?.some((r) => r.name === 'Belfry' && r.z === 2)).toBe(true);
  });

  it('is the same keep for the same seed', () => {
    const a = keep(77);
    const b = keep(77);
    expect(a.layers).toEqual(b.layers);
    expect(a.storeys).toEqual(b.storeys);
    expect(a.features.map((f) => [f.type, f.c, f.r, f.z, f.props])).toEqual(b.features.map((f) => [f.type, f.c, f.r, f.z, f.props]));
    expect(keep(78).layers.terrain).not.toEqual(a.layers.terrain);
  });

  it('passes Underkeep’s checks, every storey reachable, for many seeds and settings', () => {
    const settings: Record<string, number | boolean>[] = [
      {},
      { towerStoreys: 3, cryptStoreys: 2 },
      { towerStoreys: 0, cryptStoreys: 0, courtyard: false },
      { roomDensity: 1, roomSize: 0, monsters: 1, treasure: 1, traps: 1 },
      { roomDensity: 0, roomSize: 1 },
    ];
    for (const extra of settings) {
      for (let seed = 1; seed <= 12; seed++) {
        const m = keep(seed, extra);
        const { md } = toUnderkeep(m);
        const r = validateUnderkeep(md);
        const all = [...r.errors, ...r.warnings].map((p) => p.message);
        expect(all, `seed ${seed} ${JSON.stringify(extra)}`).toEqual([]);
        expect(md.storeys).toHaveLength(storeyNumbers(m).length);
      }
    }
  });

  it('builds in 3D and as a .glb', () => {
    const m = keep(5);
    const s = buildScene(m);
    expect(s.parts.map((p) => p.kind)).toEqual(expect.arrayContaining(['ground', 'structures', 'roofs', 'objects']));
    expect(s.markers.filter((k) => k.data.kind === 'room').length).toBe(m.rooms!.length);
    expect(sceneToGlb(s).byteLength).toBeGreaterThan(10000);
    expect(checkUnderkeepMap(m).problems).toEqual([]);
  });

  it('works on small and large keeps', () => {
    for (const size of [[16, 14], [24, 20], [60, 48]] as [number, number][]) {
      const m = keep(3, {}, size);
      expect(validateUnderkeep(toUnderkeep(m).md).errors, `${size}`).toEqual([]);
    }
  });

  it('falls back to rooms and corridors on hex grids', () => {
    const m = keep(3, {}, [30, 24], 'hex-pointy');
    expect(is3d(m)).toBe(false);
    expect(m.storeys).toBeUndefined();
  });
});
