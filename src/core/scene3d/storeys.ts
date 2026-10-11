/**
 * Storeys, heights, roofs, facing and props of 3D maps.
 *
 * The ground storey (z = 0) is the map's own `layers` plus `layers3d`; other storeys live in
 * `map.storeys`, each with full layers (terrain defaults to "Nothing") and its own `layers3d`.
 * Places carry the storey they are on in `feature.z`. Plain maps have none of these fields.
 */
import { T } from '../tiles';
import { type Feature, type Layers3d, type MapLayers, type Room, type Storey, type WorldMap, emptyLayers } from '../types';

/** Storeys a map may have in all (Underkeep's limit). */
export const MAX_STOREYS = 6;
/** Height limits in half metres (±20 m). */
export const HEIGHT_MIN = -40;
export const HEIGHT_MAX = 40;

export function emptyLayers3d(size: number): Layers3d {
  return {
    height: new Array<number>(size).fill(0),
    roof: new Array<number>(size).fill(0),
    facing: new Array<number>(size).fill(-1),
    prop: new Array<number>(size).fill(0),
  };
}

/** The storey numbers a map has, lowest first (always including 0). */
export function storeyNumbers(map: WorldMap): number[] {
  return [0, ...(map.storeys ?? []).map((s) => s.z)].sort((a, b) => a - b);
}

export function storeyLayers(map: WorldMap, z: number): MapLayers {
  if (z === 0) return map.layers;
  return map.storeys?.find((s) => s.z === z)?.layers ?? map.layers;
}

/** The storey's 3D data; for the ground storey it is created on first use when `create` is set. */
export function storey3d(map: WorldMap, z: number, create: true): Layers3d;
export function storey3d(map: WorldMap, z: number, create?: boolean): Layers3d | undefined;
export function storey3d(map: WorldMap, z: number, create = false): Layers3d | undefined {
  if (z !== 0) return map.storeys?.find((s) => s.z === z)?.layers3d;
  if (!map.layers3d && create) map.layers3d = emptyLayers3d(map.width * map.height);
  return map.layers3d;
}

export function featureStorey(f: Feature): number {
  return f.z ?? 0;
}

/** Add a storey above the highest or below the lowest. Returns its number, or null at the limit. */
export function addStorey(map: WorldMap, dir: 1 | -1): number | null {
  const zs = storeyNumbers(map);
  if (zs.length >= MAX_STOREYS) return null;
  const z = dir > 0 ? zs[zs.length - 1] + 1 : zs[0] - 1;
  const size = map.width * map.height;
  const layers = emptyLayers(size);
  layers.terrain.fill(T.VOID);
  const storey: Storey = { z, layers, layers3d: emptyLayers3d(size) };
  // A new storey is covered wherever the one it joins is.
  const near = storey3d(map, dir > 0 ? zs[zs.length - 1] : zs[0]);
  if (near) storey.layers3d.roof = [...near.roof];
  map.storeys = [...(map.storeys ?? []), storey].sort((a, b) => a.z - b.z);
  return z;
}

/** Remove a storey (not the ground storey) with its places and rooms. */
export function removeStorey(map: WorldMap, z: number): void {
  if (z === 0 || !map.storeys) return;
  map.storeys = map.storeys.filter((s) => s.z !== z);
  if (!map.storeys.length) delete map.storeys;
  map.features = map.features.filter((f) => featureStorey(f) !== z);
  if (map.rooms) map.rooms = map.rooms.filter((r) => r.z !== z);
}

/**
 * The map as seen on one storey: that storey's layers and only the places on it. For drawing and
 * hit-testing; the places are the map's own objects, so moving one moves it on the map.
 */
export function storeyView(map: WorldMap, z: number): WorldMap {
  if (z === 0 && !map.storeys?.length && !map.features.some((f) => f.z)) return map;
  return { ...map, layers: storeyLayers(map, z), features: map.features.filter((f) => featureStorey(f) === z) };
}

/** Height (half metres) on a storey, 0 where nothing was set. */
export function heightAt(map: WorldMap, z: number, i: number): number {
  return storey3d(map, z)?.height[i] ?? 0;
}

export function roomsOn(map: WorldMap, z: number): Room[] {
  return (map.rooms ?? []).filter((r) => r.z === z);
}

/** Keep 3D data the right size when a project is opened (and drop what doesn't fit). */
export function sanitize3d(map: WorldMap): void {
  const size = map.width * map.height;
  const fix = (l: Layers3d | undefined): Layers3d | undefined => {
    if (!l || typeof l !== 'object') return undefined;
    const blank = emptyLayers3d(size);
    for (const k of Object.keys(blank) as (keyof Layers3d)[]) {
      if (!Array.isArray(l[k]) || l[k].length !== size) l[k] = blank[k];
    }
    return l;
  };
  map.layers3d = fix(map.layers3d);
  if (!map.layers3d) delete map.layers3d;
  if (map.storeys !== undefined) {
    const blank = emptyLayers(size);
    map.storeys = (Array.isArray(map.storeys) ? map.storeys : []).filter((s) => s && Number.isInteger(s.z) && s.z !== 0 && s.layers);
    for (const s of map.storeys) {
      for (const k of Object.keys(blank) as (keyof MapLayers)[]) {
        if (!Array.isArray(s.layers[k]) || s.layers[k].length !== size) s.layers[k] = k === 'terrain' ? new Array<number>(size).fill(T.VOID) : blank[k];
      }
      s.layers3d = fix(s.layers3d) ?? emptyLayers3d(size);
    }
    if (!map.storeys.length) delete map.storeys;
  }
  if (map.rooms !== undefined && !Array.isArray(map.rooms)) delete map.rooms;
}

/** Facing as an angle in the x-z plane (x east, z south): 0 north is −z. */
export function facingAngle(f: number): number {
  return [-Math.PI / 2, 0, Math.PI / 2, Math.PI][((f % 4) + 4) % 4];
}

/** Grid step for a facing (square grids): 0 north, 1 east, 2 south, 3 west. */
export const FACING_STEP: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
