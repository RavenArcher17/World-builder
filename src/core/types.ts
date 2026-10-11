import type { GridType } from './grid';

export type MapKind = 'overland' | 'settlement' | 'dungeon';

export type SettingValue = number | boolean | string;
export type Settings = Record<string, SettingValue>;

export interface Feature {
  id: string;
  type: string;
  c: number;
  r: number;
  name: string;
  notes?: string;
  tags?: string[];
  /** A detail map generated for this feature (town layout, dungeon, zoomed region). */
  childMapId?: string;
  /** Typed fields for place types that define them (e.g. a monster spawn's kind and count). */
  props?: Record<string, string | number | boolean>;
  /** Storey of a 3D map the place is on (absent = the ground storey, 0). */
  z?: number;
}

/**
 * Per-cell data, stored row-major (index = row * width + col). Plain arrays keep the project
 * JSON-serialisable and trivially consumable by game code.
 */
export interface MapLayers {
  /** Tile id from the shared registry in tiles.ts. */
  terrain: number[];
  /** 0..1, sea level is SEA_LEVEL (overland maps only; flat elsewhere). */
  elevation: number[];
  moisture: number[];
  temperature: number[];
  /** Bitmask of road connections: bit d set = connected to the neighbour in direction d. */
  road: number[];
  /** 0 none, 1 trail, 2 road, 3 highway. */
  roadLevel: number[];
  /** Bitmask of river connections (same encoding as road). */
  river: number[];
  /** Upstream catchment; larger = wider river. */
  riverSize: number[];
  /** Building id per cell (0 = none) so engines can tell adjacent buildings apart. */
  building: number[];
  /** What stands on the cell (objects.ts id, 0 = nothing): trees, rocks, stations, stairs. */
  object: number[];
  /** Rules zone per cell (0 = none; game maps use 1 safe, 2 frontier, 3 wilderness, 4 deep). */
  zone: number[];
}

/**
 * Per-cell 3D data, kept only on maps with 3D on (see scene3d/). Row-major like MapLayers.
 */
export interface Layers3d {
  /** Floor height in half metres above the storey's floor level (negative: a pit). */
  height: number[];
  /** 1 = covered (a roof or ceiling over it), 0 = open sky. */
  roof: number[];
  /** Which way the stairs or thing on the cell faces: 0 north, 1 east, 2 south, 3 west; -1 automatic. */
  facing: number[];
  /** A 3D prop standing on the cell (id in scene3d/props.ts, 0 = none). */
  prop: number[];
}

/** A storey of a 3D map other than the ground storey (which is the map's own layers). */
export interface Storey {
  /** 1 is the storey above the ground storey, -1 the one below, … */
  z: number;
  layers: MapLayers;
  layers3d: Layers3d;
}

/** A named area of a 3D map (a room), on one storey. */
export interface Room {
  name: string;
  z: number;
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

export interface ParentLink {
  mapId: string;
  c0: number;
  r0: number;
  c1: number;
  r1: number;
  featureId?: string;
}

export interface Placement {
  mapId: string;
  c: number;
  r: number;
}

export interface MapSpec {
  name: string;
  kind: MapKind;
  scaleId: string;
  grid: GridType;
  width: number;
  height: number;
  seed: number;
  settings: Settings;
}

export interface WorldMap extends MapSpec {
  id: string;
  layers: MapLayers;
  features: Feature[];
  parent?: ParentLink;
  children: string[];
  composedFrom?: Placement[];
  /** 3D maps: heights, roofs, facing and props of the ground storey. */
  layers3d?: Layers3d;
  /** 3D maps: storeys above and below the ground storey. */
  storeys?: Storey[];
  /** 3D maps: named rooms. */
  rooms?: Room[];
}

export interface Project {
  format: 'world-builder-project';
  version: 1;
  /** Stable id; also the document id when the project is saved to the cloud. */
  id: string;
  name: string;
  maps: Record<string, WorldMap>;
}

export const SEA_LEVEL = 0.4;

/** Largest value in a layer (a loop: spreading a 256×256 layer into Math.max overflows the stack on some browsers). */
export function layerMax(values: number[]): number {
  let m = 0;
  for (const v of values) if (v > m) m = v;
  return m;
}

export function emptyLayers(size: number): MapLayers {
  const z = () => new Array<number>(size).fill(0);
  return {
    terrain: z(),
    elevation: new Array<number>(size).fill(0.5),
    moisture: new Array<number>(size).fill(0.5),
    temperature: new Array<number>(size).fill(0.5),
    road: z(),
    roadLevel: z(),
    river: z(),
    riverSize: z(),
    building: z(),
    object: z(),
    zone: z(),
  };
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1679616;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36).padStart(4, '0')}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, '0')}`;
}
