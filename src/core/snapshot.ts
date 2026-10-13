/**
 * Compact copies of a project, for undo and for keeping it in the browser. A map's per-cell layers
 * are most of a project (a 768×768 map has 590k cells in each of its eleven layers, about 18 MB as
 * JSON), so they're kept as typed arrays of the smallest kind that holds their values exactly (one
 * byte a cell for ground, objects and zones), or as one value when every cell has it. The rest of
 * the project (names, places, settings) is kept as JSON.
 *
 * A layer that hasn't changed since an earlier copy is shared with it rather than copied again,
 * so undo steps cost only what they change.
 */
import type { Project, WorldMap } from './types';

/** A layer's values: a typed array, one value repeated, or (values that aren't all numbers) a plain copy. */
export type PackedLayer =
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array
  | { fill: number; length: number }
  | unknown[];

export interface ProjectSnapshot {
  /** The project with its layers taken out (each left as null), as JSON. */
  json: string;
  /** Every layer, by `${mapId}|${path}`, e.g. `map_1|layers.terrain` or `map_1|storeys.0.layers3d.height`. */
  layers: Map<string, PackedLayer>;
}

/** Pack a layer (see PackedLayer). */
export function packLayer(values: readonly unknown[]): PackedLayer {
  const n = values.length;
  if (!n) return { fill: 0, length: 0 };
  const first = values[0];
  if (typeof first !== 'number') return values.slice();
  let min = first;
  let max = first;
  let same = true;
  let int = Number.isInteger(first);
  let f32 = Math.fround(first) === first;
  for (let i = 1; i < n; i++) {
    const v = values[i];
    if (typeof v !== 'number') return values.slice();
    if (v === first) continue;
    same = false;
    if (v < min) min = v;
    else if (v > max) max = v;
    if (int && !Number.isInteger(v)) int = false;
    if (f32 && Math.fround(v) !== v) f32 = false;
  }
  if (same && !Number.isNaN(first)) return { fill: first, length: n };
  const nums = values as readonly number[];
  if (int) {
    if (min >= 0 && max <= 0xff) return Uint8Array.from(nums);
    if (min >= -0x80 && max <= 0x7f) return Int8Array.from(nums);
    if (min >= 0 && max <= 0xffff) return Uint16Array.from(nums);
    if (min >= -0x8000 && max <= 0x7fff) return Int16Array.from(nums);
    if (min >= 0 && max <= 0xffffffff) return Uint32Array.from(nums);
    if (min >= -0x80000000 && max <= 0x7fffffff) return Int32Array.from(nums);
  }
  return f32 ? Float32Array.from(nums) : Float64Array.from(nums);
}

/** The values of a packed layer, as the plain array maps keep. */
export function unpackLayer(p: PackedLayer): number[] {
  if (Array.isArray(p)) return p.slice() as number[];
  if ('fill' in p && !ArrayBuffer.isView(p)) return new Array<number>(p.length).fill(p.fill);
  // A loop: much quicker than Array.from on a typed array.
  const q = p as ArrayLike<number>;
  const out = new Array<number>(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i];
  return out;
}

/** Whether a layer holds just what a packed one does (so the packed one can be kept for it). */
export function samePacked(values: readonly unknown[], p: PackedLayer): boolean {
  if (Array.isArray(p) || ArrayBuffer.isView(p)) {
    const q = p as ArrayLike<unknown>;
    if (q.length !== values.length) return false;
    for (let i = 0; i < values.length; i++) if (values[i] !== q[i]) return false;
    return true;
  }
  const { fill, length } = p as { fill: number; length: number };
  if (length !== values.length) return false;
  for (let i = 0; i < values.length; i++) if (values[i] !== fill) return false;
  return true;
}

/** Bytes a packed layer takes, about. */
export function packedBytes(p: PackedLayer): number {
  if (ArrayBuffer.isView(p)) return p.byteLength;
  if (Array.isArray(p)) return p.length * 8;
  return 16;
}

/** The objects holding a map's layers, by path: the ground storey's, its 3D data, and each other storey's. */
function holders(map: WorldMap): [string, object | undefined][] {
  const out: [string, object | undefined][] = [['layers', map.layers]];
  if (map.layers3d) out.push(['layers3d', map.layers3d]);
  map.storeys?.forEach((s, k) => out.push([`storeys.${k}.layers`, s.layers], [`storeys.${k}.layers3d`, s.layers3d]));
  return out;
}

/**
 * A snapshot of a project. Layers equal to the ones in `previous` (an earlier snapshot's layers)
 * are shared with it. `live` (when given) is filled with the project's own arrays by key, so a
 * restore can keep the ones that don't change.
 */
export function snapshotProject(project: Project, previous?: Map<string, PackedLayer>, live?: Map<string, unknown[]>): ProjectSnapshot {
  const layers = new Map<string, PackedLayer>();
  const maps: Record<string, unknown> = {};
  for (const [id, map] of Object.entries(project.maps)) {
    const copy: Record<string, unknown> = { ...map };
    const taken = new Map<object, Record<string, unknown>>();
    for (const [path, holder] of holders(map)) {
      if (!holder) continue;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(holder)) {
        if (!Array.isArray(v)) {
          out[k] = v;
          continue;
        }
        const key = `${id}|${path}.${k}`;
        const old = previous?.get(key);
        layers.set(key, old !== undefined && samePacked(v, old) ? old : packLayer(v));
        live?.set(key, v);
        out[k] = null;
      }
      taken.set(holder, out);
    }
    copy.layers = taken.get(map.layers);
    if (map.layers3d) copy.layers3d = taken.get(map.layers3d);
    if (map.storeys) copy.storeys = map.storeys.map((s) => ({ ...s, layers: taken.get(s.layers), layers3d: taken.get(s.layers3d) }));
    maps[id] = copy;
  }
  return { json: JSON.stringify({ ...project, maps }), layers };
}

/**
 * The project a snapshot holds. `keep` can hand back an array to use as it is for a layer (one
 * that already holds just those values), instead of a fresh copy.
 */
export function restoreSnapshot(snap: ProjectSnapshot, keep?: (key: string, packed: PackedLayer) => unknown[] | undefined): Project {
  const project = JSON.parse(snap.json) as Project;
  for (const [id, map] of Object.entries(project.maps ?? {})) {
    for (const [path, holder] of holders(map)) {
      if (!holder) continue;
      const h = holder as Record<string, unknown>;
      for (const k of Object.keys(h)) {
        const key = `${id}|${path}.${k}`;
        const p = snap.layers.get(key);
        if (p !== undefined) h[k] = keep?.(key, p) ?? unpackLayer(p);
      }
    }
  }
  return project;
}

/** Bytes the snapshots take between them, counting each shared layer once. */
export function snapshotsBytes(snaps: ProjectSnapshot[]): number {
  const seen = new Set<PackedLayer>();
  let bytes = 0;
  for (const s of snaps) {
    bytes += s.json.length * 2;
    for (const p of s.layers.values()) {
      if (seen.has(p)) continue;
      seen.add(p);
      bytes += packedBytes(p);
    }
  }
  return bytes;
}
