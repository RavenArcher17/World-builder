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
}

export interface Project {
  format: 'world-builder-project';
  version: 1;
  name: string;
  maps: Record<string, WorldMap>;
}

export const SEA_LEVEL = 0.4;

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
  };
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1679616;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36).padStart(4, '0')}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, '0')}`;
}
