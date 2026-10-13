import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createProject } from '../src/core/project';
import { fromRpgdcMaps } from '../src/core/rpgdc/import';
import { set3d } from '../src/core/scene3d/options';
import { addStorey, storey3d, storeyLayers } from '../src/core/scene3d/storeys';
import { packLayer, packedBytes, restoreSnapshot, samePacked, snapshotProject, snapshotsBytes, unpackLayer } from '../src/core/snapshot';
import { T } from '../src/core/tiles';
import { make } from './helpers';

/** The game's own maps: the 768-tile overworld and everything under it. */
const game = () => fromRpgdcMaps(JSON.parse(readFileSync(new URL('./fixtures/rpg-dc.maps.json', import.meta.url), 'utf8')));
const overworldId = 'rpgdc-overworld';

describe('packed layers', () => {
  it('keeps each layer in the smallest kind of array that holds it exactly', () => {
    expect(packLayer([0, 3, 255])).toBeInstanceOf(Uint8Array);
    expect(packLayer([-3, 0, 100])).toBeInstanceOf(Int8Array);
    expect(packLayer([0, 300, 65535])).toBeInstanceOf(Uint16Array);
    expect(packLayer([-300, 0, 3])).toBeInstanceOf(Int16Array);
    expect(packLayer([0, 70000])).toBeInstanceOf(Uint32Array);
    expect(packLayer([-70000, 0])).toBeInstanceOf(Int32Array);
    expect(packLayer([0.5, 0.25])).toBeInstanceOf(Float32Array);
    expect(packLayer([0.1, 0.4])).toBeInstanceOf(Float64Array);
    expect(packLayer(new Array(1000).fill(0.5))).toEqual({ fill: 0.5, length: 1000 });
    expect(packLayer([1, null, 2])).toEqual([1, null, 2]);
    for (const values of [[0, 3, 255], [-3, 7], [0.1, 0.4, 1e9], [0.5, 0.5], [NaN, 1], [], [Infinity, -1]]) {
      const p = packLayer(values);
      expect(unpackLayer(p)).toEqual(values);
      // (NaN is never the same as itself: a layer holding one is just copied again.)
      expect(samePacked(values, p)).toBe(!values.some(Number.isNaN));
      if (values.length) expect(samePacked([...values.slice(1), 42], p)).toBe(false);
    }
  }, 30_000);

  it('keeps the game’s 768-tile world in a couple of MB instead of 18 MB of JSON', () => {
    const p = game();
    const snap = snapshotProject(p);
    const bytes = snapshotsBytes([snap]);
    expect(bytes).toBeLessThan(4_000_000);
    expect(snap.layers.get(`${overworldId}|layers.terrain`)).toBeInstanceOf(Uint8Array);
    expect(snap.layers.get(`${overworldId}|layers.elevation`)).toEqual({ fill: 0.5, length: 768 * 768 });
  }, 30_000);
});

describe('project snapshots (undo and the autosave)', () => {
  it('give back the project exactly', () => {
    const p = game();
    expect(restoreSnapshot(snapshotProject(p))).toEqual(p);
    // A 3D map with a storey above and its heights, roofs and props.
    const q = createProject('3d');
    const m = make('dungeon', 'square', 3, [12, 10]);
    set3d(m.settings, true);
    storey3d(m, 0, true).height[5] = 4;
    addStorey(m, 1);
    storeyLayers(m, 1).terrain[7] = T.FLOOR;
    storey3d(m, 1)!.prop[7] = 2;
    q.maps[m.id] = m;
    const back = restoreSnapshot(snapshotProject(q));
    expect(back).toEqual(q);
    expect(back.maps[m.id].storeys![0].layers.terrain[7]).toBe(T.FLOOR);
  }, 30_000);

  it('share every layer a change didn’t touch with the snapshot before', () => {
    const p = game();
    const first = snapshotProject(p);
    p.maps[overworldId].layers.terrain[1000] = T.SAND;
    const second = snapshotProject(p, first.layers);
    const changed = [...second.layers].filter(([key, packed]) => first.layers.get(key) !== packed).map(([key]) => key);
    expect(changed).toEqual([`${overworldId}|layers.terrain`]);
    // So twenty-five steps of painting cost little more than one.
    expect(snapshotsBytes([first, second]) - snapshotsBytes([first])).toBeLessThan(packedBytes(second.layers.get(`${overworldId}|layers.terrain`)!) + second.json.length * 2 + 1);
    // Going back: the layers that are the same are kept as they are.
    const live = new Map<string, unknown[]>();
    const now = snapshotProject(p, second.layers, live);
    const kept: string[] = [];
    const back = restoreSnapshot(first, (key, packed) => {
      if (now.layers.get(key) !== packed) return undefined;
      kept.push(key);
      return live.get(key);
    });
    expect(back.maps[overworldId].layers.terrain[1000]).not.toBe(T.SAND);
    expect(kept).not.toContain(`${overworldId}|layers.terrain`);
    expect(kept).toContain(`${overworldId}|layers.object`);
    expect(back.maps[overworldId].layers.object).toBe(p.maps[overworldId].layers.object);
  }, 30_000);
});
