import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject, createProject } from '../src/core/project';
import { resampleMap } from '../src/core/resample';
import { buildScene, type Scene3D } from '../src/core/scene3d/build';
import { sceneToGlb } from '../src/core/scene3d/glb';
import { set3d } from '../src/core/scene3d/options';
import { PROP } from '../src/core/scene3d/props';
import { addStorey, removeStorey, sanitize3d, storey3d, storeyLayers, storeyNumbers, storeyView, MAX_STOREYS } from '../src/core/scene3d/storeys';
import { T } from '../src/core/tiles';
import type { WorldMap } from '../src/core/types';
import { make } from './helpers';

/** A walled 12×10 room on the ground storey with a staircase up to a gallery on storey 1. */
function keep(): WorldMap {
  const m = make('dungeon', 'square', 3, [12, 10]);
  set3d(m.settings, true);
  m.features = [];
  const L = m.layers;
  const at = (c: number, r: number) => r * 12 + c;
  for (let r = 0; r < 10; r++) for (let c = 0; c < 12; c++) L.terrain[at(c, r)] = c === 0 || r === 0 || c === 11 || r === 9 ? T.WALL : T.FLOOR;
  L.object.fill(0);
  const g3 = storey3d(m, 0, true);
  g3.roof.fill(1);
  // Three stair cells climbing north at heights 0, 2 and 4 m (Underkeep's recipe for a storey).
  for (const [r, h] of [[7, 0], [6, 4], [5, 8]] as const) {
    L.terrain[at(5, r)] = T.STAIRS_UP;
    g3.facing[at(5, r)] = 0;
    g3.height[at(5, r)] = h;
  }
  expect(addStorey(m, 1)).toBe(1);
  const up = storeyLayers(m, 1);
  const up3 = storey3d(m, 1)!;
  // A gallery along the north wall, with a hole over the upper stairs.
  for (let c = 1; c < 11; c++) for (const r of [1, 2, 3, 4]) up.terrain[at(c, r)] = T.FLOOR;
  up.terrain[at(5, 5)] = T.VOID;
  up.terrain[at(5, 6)] = T.VOID;
  up3.prop[at(2, 2)] = PROP.CHEST;
  up3.facing[at(2, 2)] = 2;
  g3.prop[at(9, 7)] = PROP.BRAZIER;
  m.features.push({ id: 'f_boss', type: 'boss', name: 'Castellan', c: 8, r: 2, z: 1 });
  m.rooms = [{ name: 'Gallery', z: 1, c0: 1, r0: 1, c1: 10, r1: 4 }];
  return m;
}

function heights(s: Scene3D, kind: string): number[] {
  const p = s.parts.find((x) => x.kind === kind)?.mesh.positions ?? new Float32Array();
  const out: number[] = [];
  for (let k = 1; k < p.length; k += 3) out.push(p[k]);
  return out;
}

describe('storeys', () => {
  it('adds storeys above and below up to the limit, and removes them with their places', () => {
    const m = make('dungeon', 'square', 3, [10, 8]);
    expect(storeyNumbers(m)).toEqual([0]);
    expect(addStorey(m, 1)).toBe(1);
    expect(addStorey(m, -1)).toBe(-1);
    expect(storeyNumbers(m)).toEqual([-1, 0, 1]);
    expect(storeyLayers(m, 1).terrain.every((t) => t === T.VOID)).toBe(true);
    for (let k = 0; k < 10; k++) addStorey(m, 1);
    expect(storeyNumbers(m)).toHaveLength(MAX_STOREYS);
    m.features.push({ id: 'x', type: 'boss', name: 'B', c: 1, r: 1, z: -1 });
    removeStorey(m, -1);
    expect(storeyNumbers(m)).not.toContain(-1);
    expect(m.features.find((f) => f.id === 'x')).toBeUndefined();
  });

  it('shows each storey with only its own places', () => {
    const m = keep();
    expect(storeyView(m, 1).features.map((f) => f.id)).toEqual(['f_boss']);
    expect(storeyView(m, 0).features).toEqual([]);
    expect(storeyView(m, 1).layers).toBe(storeyLayers(m, 1));
  });

  it('builds both storeys, the stairs up to the gallery, ceilings, props and markers', () => {
    const m = keep();
    const s = buildScene(m);
    // Storey 1's floor sits at 5 m (4.5 m walls + a 0.5 m slab).
    expect(heights(s, 'structures')).toContain(5);
    // The top stair cell climbs from 4 m to the gallery floor at 5 m.
    const stairs = heights(s, 'structures').filter((y) => y > 4 && y < 5.01);
    expect(stairs.length).toBeGreaterThan(0);
    // Ceilings over the covered ground floor, but not under the gallery (it is the ceiling there).
    const roofs = heights(s, 'roofs');
    expect(roofs.length).toBeGreaterThan(0);
    expect(Math.min(...roofs)).toBeCloseTo(4.5);
    expect(s.markers.find((k) => k.data.key === 'chest')?.position[1]).toBeCloseTo(5);
    expect(s.markers.find((k) => k.data.key === 'brazier')?.data).toMatchObject({ kind: 'prop', lightRadius: 5 });
    expect(s.markers.find((k) => k.data.kind === 'place')?.data).toMatchObject({ storey: 1, name: 'Castellan' });
    expect(s.markers.find((k) => k.data.kind === 'room')?.data).toMatchObject({ name: 'Gallery', storey: 1 });
    expect(sceneToGlb(s).byteLength).toBeGreaterThan(1000);
  });

  it('keeps a plain map exactly as before (no 3D data, same scene)', () => {
    const m = make('dungeon', 'square', 3, [16, 12]);
    set3d(m.settings, true);
    const a = buildScene(m);
    expect(m.layers3d).toBeUndefined();
    storey3d(m, 0, true);
    const b = buildScene(m);
    expect(Array.from(b.parts[0].mesh.positions)).toEqual(Array.from(a.parts[0].mesh.positions));
    expect(b.parts.map((p) => p.name)).toEqual(a.parts.map((p) => p.name));
  });

  it('raises the ground by hand-set heights in half metres', () => {
    const m = make('dungeon', 'square', 3, [10, 8]);
    set3d(m.settings, true);
    m.layers.terrain.fill(T.FLOOR);
    storey3d(m, 0, true).height[3 * 10 + 4] = 6;
    expect(Math.max(...heights(buildScene(m), 'ground'))).toBeCloseTo(3);
  });

  it('survives saving, reopening and converting the grid', () => {
    const m = keep();
    const p = createProject('t');
    p.maps[m.id] = m;
    const back = parseProject(serializeProject(p)).maps[m.id];
    expect(back.storeys?.[0].z).toBe(1);
    expect(back.layers3d?.facing[7 * 12 + 5]).toBe(0);
    const big = resampleMap(back, 'square', 24, 20);
    expect(big.storeys?.[0].layers.terrain).toHaveLength(24 * 20);
    expect(big.layers3d?.height).toHaveLength(24 * 20);
    expect(big.rooms?.[0]).toMatchObject({ name: 'Gallery', c0: 2, r0: 2, c1: 21, r1: 9 });
    expect(() => buildScene(big)).not.toThrow();
  });

  it('repairs or drops 3D data of the wrong size when a project opens', () => {
    const m = keep();
    m.layers3d!.height = [1, 2, 3];
    (m.storeys![0].layers as { terrain: number[] }).terrain = [];
    m.storeys!.push({ z: 0, layers: m.layers, layers3d: m.layers3d! });
    sanitize3d(m);
    expect(m.layers3d!.height).toHaveLength(120);
    expect(m.storeys).toHaveLength(1);
    expect(m.storeys![0].layers.terrain.every((t) => t === T.VOID)).toBe(true);
  });
});
