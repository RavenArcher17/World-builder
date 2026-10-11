/**
 * 3D is an option a map switches on (`settings.map3d`). Maps without it behave exactly as plain
 * 2D World Builder maps; the other `map3d*` keys only matter once it is on.
 */
import type { MapKind, Settings, WorldMap } from '../types';

/** How the ground is shaped: a smooth surface through the cell centres, or flat-topped columns. */
export type GroundLook = 'smooth' | 'blocks';

export interface Map3dOptions {
  look: GroundLook;
  /** Width of one cell in metres (square cells; across the flats for hexes). */
  tile: number;
  /** Height in metres of the highest possible ground above sea level (overland maps). */
  relief: number;
  /** Height of dungeon walls and solid rock in metres. */
  wall: number;
}

export const MAP3D_KEYS = {
  on: 'map3d',
  look: 'map3dLook',
  tile: 'map3dTile',
  relief: 'map3dRelief',
  wall: 'map3dWall',
} as const;

export const TILE_RANGE = { min: 0.5, max: 50 };
export const RELIEF_RANGE = { min: 0, max: 2000 };
export const WALL_RANGE = { min: 1, max: 20 };

export function is3d(map: WorldMap | null | undefined): boolean {
  return !!map && map.settings[MAP3D_KEYS.on] === true;
}

/** Defaults for a map of this kind and size; Underkeep's numbers for built places (2 m cells, 4.5 m walls). */
export function defaultOptions3d(kind: MapKind, width: number, height: number): Map3dOptions {
  const tile = kind === 'dungeon' ? 2 : 4;
  return {
    look: kind === 'overland' ? 'smooth' : 'blocks',
    tile,
    relief: Math.round(Math.max(width, height) * tile * 0.1),
    wall: 4.5,
  };
}

const num = (v: unknown, fallback: number, range: { min: number; max: number }) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(range.max, Math.max(range.min, v)) : fallback;

export function options3d(map: Pick<WorldMap, 'kind' | 'width' | 'height' | 'settings'>): Map3dOptions {
  const d = defaultOptions3d(map.kind, map.width, map.height);
  const s = map.settings;
  return {
    look: s[MAP3D_KEYS.look] === 'blocks' || s[MAP3D_KEYS.look] === 'smooth' ? (s[MAP3D_KEYS.look] as GroundLook) : d.look,
    tile: num(s[MAP3D_KEYS.tile], d.tile, TILE_RANGE),
    relief: num(s[MAP3D_KEYS.relief], d.relief, RELIEF_RANGE),
    wall: num(s[MAP3D_KEYS.wall], d.wall, WALL_RANGE),
  };
}

/** Switch 3D on or off. The chosen options stay in the settings, so switching back on restores them. */
export function set3d(settings: Settings, on: boolean): void {
  if (on) settings[MAP3D_KEYS.on] = true;
  else delete settings[MAP3D_KEYS.on];
}
