import { describe, expect, it } from 'vitest';
import { toGameJson } from '../src/core/export/formats';
import { O } from '../src/core/objects';
import { buildScene, type Scene3D } from '../src/core/scene3d/build';
import { sceneToGlb } from '../src/core/scene3d/glb';
import { MAP3D_KEYS, defaultOptions3d, is3d, options3d, set3d } from '../src/core/scene3d/options';
import { T } from '../src/core/tiles';
import type { WorldMap } from '../src/core/types';
import { GRIDS, make } from './helpers';

/** Every triangle must wind counter-clockwise seen from its front (glTF), i.e. agree with its normals. */
function windingProblems(scene: Scene3D): number {
  let bad = 0;
  for (const part of scene.parts) {
    const { positions: p, normals: n, indices: idx } = part.mesh;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
      const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(g[0], g[1], g[2]);
      if (len < 1e-9) continue;
      const avg = [0, 1, 2].map((k) => n[a + k] + n[b + k] + n[c + k]);
      if ((g[0] * avg[0] + g[1] * avg[1] + g[2] * avg[2]) / len < 0) bad++;
    }
  }
  return bad;
}

function meshProblems(scene: Scene3D): string[] {
  const out: string[] = [];
  for (const part of scene.parts) {
    const { positions, normals, colors, indices } = part.mesh;
    const count = positions.length / 3;
    if (normals.length !== positions.length) out.push(`${part.name}: normals`);
    if (colors.length !== count * 4) out.push(`${part.name}: colours`);
    if (indices.length % 3) out.push(`${part.name}: index count`);
    if (indices.some((i) => i >= count)) out.push(`${part.name}: index out of range`);
    if (positions.some((v) => !Number.isFinite(v))) out.push(`${part.name}: bad position`);
    for (let k = 0; k < normals.length; k += 3) {
      const l = Math.hypot(normals[k], normals[k + 1], normals[k + 2]);
      if (Math.abs(l - 1) > 1e-3) {
        out.push(`${part.name}: normal length ${l}`);
        break;
      }
    }
  }
  return out;
}

function with3d(map: WorldMap, settings: Record<string, string | number | boolean> = {}): WorldMap {
  set3d(map.settings, true);
  Object.assign(map.settings, settings);
  return map;
}

/** Read a .glb back: header, chunks and the JSON. */
function readGlb(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(dv.getUint32(0, true)).toBe(0x46546c67);
  expect(dv.getUint32(4, true)).toBe(2);
  expect(dv.getUint32(8, true)).toBe(bytes.byteLength);
  const jsonLen = dv.getUint32(12, true);
  expect(dv.getUint32(16, true)).toBe(0x4e4f534a);
  expect(jsonLen % 4).toBe(0);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  let bin: Uint8Array | null = null;
  if (20 + jsonLen < bytes.byteLength) {
    const binLen = dv.getUint32(20 + jsonLen, true);
    expect(dv.getUint32(24 + jsonLen, true)).toBe(0x004e4942);
    expect(binLen % 4).toBe(0);
    bin = bytes.subarray(28 + jsonLen, 28 + jsonLen + binLen);
    expect(28 + jsonLen + binLen).toBe(bytes.byteLength);
  }
  return { json, bin };
}

describe('3D option', () => {
  it('is off unless a map switches it on, and the defaults follow the map kind', () => {
    const m = make('kingdom', 'square', 3, [24, 20]);
    expect(is3d(m)).toBe(false);
    const before = JSON.stringify(toGameJson(m));
    set3d(m.settings, true);
    expect(is3d(m)).toBe(true);
    expect(options3d(m)).toEqual(defaultOptions3d('overland', 24, 20));
    expect(options3d(m).look).toBe('smooth');
    set3d(m.settings, false);
    expect(is3d(m)).toBe(false);
    expect(MAP3D_KEYS.on in m.settings).toBe(false);
    // Nothing about the map's existing exports changes.
    expect(JSON.stringify(toGameJson(m))).toBe(before);
    expect(defaultOptions3d('dungeon', 40, 40)).toMatchObject({ tile: 2, wall: 4.5, look: 'blocks' });
  });

  it('keeps chosen options within sensible ranges', () => {
    const m = with3d(make('town', 'square', 3, [24, 20]), { [MAP3D_KEYS.tile]: 999, [MAP3D_KEYS.wall]: -3, [MAP3D_KEYS.look]: 'nonsense' });
    const o = options3d(m);
    expect(o.tile).toBe(50);
    expect(o.wall).toBe(1);
    expect(o.look).toBe('blocks');
  });
});

describe('3D scene', () => {
  for (const grid of GRIDS) {
    for (const look of ['smooth', 'blocks'] as const) {
      it(`overland on ${grid}, ${look}: ground, water, roads, rivers, places`, () => {
        const m = with3d(make('kingdom', grid, 7, [40, 30]), { [MAP3D_KEYS.look]: look });
        const s = buildScene(m);
        expect(meshProblems(s)).toEqual([]);
        expect(windingProblems(s)).toBe(0);
        const kinds = s.parts.map((p) => p.kind);
        expect(kinds).toEqual(expect.arrayContaining(['ground', 'water', 'roads', 'places']));
        expect(s.markers.filter((k) => k.data.kind === 'place')).toHaveLength(m.features.length);
        // The sea sits at y = 0 and the ground rises above it.
        expect(s.bounds.max[1]).toBeGreaterThan(1);
        expect(s.bounds.min[1]).toBeLessThan(0);
      });
    }
  }

  it.each(GRIDS)('dungeon on %s: walls stand at the wall height', (grid) => {
    const m = with3d(make('dungeon', grid, 5, [36, 30]));
    const s = buildScene(m);
    expect(meshProblems(s)).toEqual([]);
    expect(windingProblems(s)).toBe(0);
    const walls = s.parts.find((p) => p.kind === 'structures')!;
    let top = -Infinity;
    for (let k = 1; k < walls.mesh.positions.length; k += 3) top = Math.max(top, walls.mesh.positions[k]);
    expect(top).toBeCloseTo(4.5, 5);
    expect(s.underground).toBe(true);
  });

  it.each(GRIDS)('town on %s: buildings, walls and the keep stand up', (grid) => {
    const m = with3d(make('town', grid, 5, [48, 40]));
    const s = buildScene(m);
    expect(meshProblems(s)).toEqual([]);
    expect(windingProblems(s)).toBe(0);
    const st = s.parts.find((p) => p.kind === 'structures')!;
    expect(st.mesh.indices.length).toBeGreaterThan(100);
    expect(s.bounds.max[1]).toBeGreaterThan(3);
  });

  it('blocks put the ground on whole steps', () => {
    const m = with3d(make('kingdom', 'square', 11, [30, 24]), { [MAP3D_KEYS.look]: 'blocks', [MAP3D_KEYS.tile]: 4 });
    const s = buildScene(m);
    const ground = s.parts.find((p) => p.kind === 'ground')!.mesh;
    for (let k = 1; k < ground.positions.length; k += 3) {
      const y = ground.positions[k];
      if (y === s.bounds.min[1]) continue;
      expect(Math.abs(y / 2 - Math.round(y / 2))).toBeLessThan(1e-4);
    }
  });

  it('places the map in metres from its top-left corner', () => {
    const m = with3d(make('dungeon', 'square', 5, [20, 16]), { [MAP3D_KEYS.tile]: 3 });
    const s = buildScene(m);
    expect(s.bounds.min[0]).toBeCloseTo(0);
    expect(s.bounds.min[2]).toBeCloseTo(0);
    expect(s.bounds.max[0]).toBeCloseTo(60);
    expect(s.bounds.max[2]).toBeCloseTo(48);
  });

  it('models every kind of object and marks the ones a game uses', () => {
    const m = with3d(make('town', 'square', 2, [12, 12]));
    m.layers.terrain.fill(T.GRASS);
    m.layers.building.fill(0);
    m.features = [];
    const ids = Object.values(O);
    ids.forEach((id, k) => (m.layers.object[k] = id));
    const s = buildScene(m);
    expect(meshProblems(s)).toEqual([]);
    expect(windingProblems(s)).toBe(0);
    const objects = s.parts.find((p) => p.kind === 'objects')!;
    expect(objects.mesh.indices.length).toBeGreaterThan(ids.length * 12);
    expect(s.markers.find((k) => k.data.key === 'bank')).toBeTruthy();
    expect(s.markers.find((k) => k.data.key === 'tree')).toBeUndefined();
  });

  it('joins a ruined wall to the ruins beside it, and marks a cache but not a thicket', () => {
    const build = (cells: [number, number, number][]) => {
      const m = with3d(make('town', 'square', 2, [12, 12]));
      m.layers.terrain.fill(T.GRASS);
      m.layers.building.fill(0);
      m.layers.object.fill(0);
      m.features = [];
      for (const [c, r, o] of cells) m.layers.object[r * 12 + c] = o;
      return buildScene(m);
    };
    const triangles = (s: Scene3D) => s.parts.find((p) => p.kind === 'objects')!.mesh.indices.length;
    const apart = build([[2, 2, O.RUIN], [6, 6, O.RUIN]]);
    const joined = build([[2, 2, O.RUIN], [3, 2, O.RUIN]]);
    expect(meshProblems(joined)).toEqual([]);
    expect(triangles(joined)).toBeGreaterThan(triangles(apart));
    const secrets = build([[2, 2, O.CACHE], [6, 6, O.THICKET]]);
    expect(meshProblems(secrets)).toEqual([]);
    expect(windingProblems(secrets)).toBe(0);
    expect(secrets.markers.filter((k) => k.data.kind === 'object').map((k) => k.data.key)).toEqual(['cache']);
  });
});

describe('.glb export', () => {
  it('writes a valid binary glTF with collision names and marker data', () => {
    const m = with3d(make('kingdom', 'hex-pointy', 7, [30, 24]));
    const s = buildScene(m);
    const glb = sceneToGlb(s);
    const { json, bin } = readGlb(glb);
    expect(json.asset.version).toBe('2.0');
    expect(bin).not.toBeNull();
    for (const bv of json.bufferViews) {
      expect(bv.byteOffset % 4).toBe(0);
      expect(bv.byteOffset + bv.byteLength).toBeLessThanOrEqual(json.buffers[0].byteLength);
    }
    const size: Record<number, number> = { 5126: 4, 5121: 1, 5123: 2, 5125: 4 };
    const comps: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4 };
    for (const a of json.accessors) {
      const bv = json.bufferViews[a.bufferView];
      expect(a.count * comps[a.type] * size[a.componentType]).toBe(bv.byteLength);
    }
    const names = json.nodes.map((n: { name: string }) => n.name);
    expect(names).toEqual(expect.arrayContaining(['Ground-col', 'Water', 'Roads', 'Markers']));
    const root = json.nodes[0];
    expect(root.extras.worldBuilder).toMatchObject({ format: 'world-builder-3d', tileMetres: 4, grid: 'hex-pointy' });
    const markers = json.nodes[json.nodes.findIndex((n: { name: string }) => n.name === 'Markers')].children;
    expect(markers).toHaveLength(s.markers.length);
    const town = json.nodes[markers[0]];
    expect(town.extras.worldBuilder.kind).toBe('place');
    expect(town.translation).toHaveLength(3);
    // Positions read back from the binary match the scene.
    const ground = json.meshes.find((x: { name: string }) => x.name === 'Ground-col');
    const acc = json.accessors[ground.primitives[0].attributes.POSITION];
    const bv = json.bufferViews[acc.bufferView];
    const back = new Float32Array(bin!.slice(bv.byteOffset, bv.byteOffset + bv.byteLength).buffer);
    expect(Array.from(back.slice(0, 9))).toEqual(Array.from(s.parts[0].mesh.positions.slice(0, 9)));
    expect(acc.min[1]).toBeCloseTo(s.bounds.min[1], 3);
  });

  it('handles an empty map', () => {
    const m = with3d(make('dungeon', 'square', 5, [8, 8]));
    m.layers.terrain.fill(T.FLOOR);
    m.features = [];
    const { json } = readGlb(sceneToGlb(buildScene(m)));
    expect(json.nodes[0].children.length).toBeGreaterThan(0);
  });
});

describe('the winding check itself', () => {
  it('notices a flipped triangle', () => {
    const s = buildScene(with3d(make('dungeon', 'square', 5, [12, 12])));
    const idx = s.parts[0].mesh.indices;
    [idx[0], idx[1]] = [idx[1], idx[0]];
    expect(windingProblems(s)).toBeGreaterThan(0);
  });
});
