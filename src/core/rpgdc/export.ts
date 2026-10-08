/**
 * The "RPG-DC maps" export: every RPG-DC map in a project in one file, in the format the game
 * loads (documented in docs/rpgdc-export.md).
 */
import type { Project, WorldMap } from '../types';
import {
  GROUND_LEGEND,
  OBJECT_LEGEND,
  ZONE_LEGEND,
  gameGround,
  gameKind,
  gameMapId,
  gameMaps,
  gameObject,
  mapZone,
  placeProps,
} from './game';

export type RpgdcPlace =
  | { type: 'spawn_point'; x: number; y: number }
  | { type: 'monster_spawn'; x: number; y: number; kind: string; count: number; radius: number }
  | { type: 'boss'; x: number; y: number; kind: string }
  | { type: 'brazier'; x: number; y: number }
  | { type: 'link'; x: number; y: number; toMap: string; toX: number; toY: number };

export interface RpgdcMap {
  id: string;
  name: string;
  kind: 'overworld' | 'dungeon';
  width: number;
  height: number;
  zone: string | null;
  groundLegend: string[];
  ground: number[];
  objectLegend: string[];
  objects: number[];
  zoneLegend: string[];
  zones: number[] | null;
  places: RpgdcPlace[];
}

export interface RpgdcMapsFile {
  format: 'rpgdc-maps';
  version: 1;
  exportedAt: string;
  maps: RpgdcMap[];
}

export const RPGDC_EXPORT_NAME = 'rpg-dc.maps.json';

export function toRpgdcMaps(project: Project, exportedAt = new Date().toISOString()): RpgdcMapsFile {
  return { format: 'rpgdc-maps', version: 1, exportedAt, maps: gameMaps(project).map(exportMap) };
}

/** Exported zone index per cell; cells without a zone export as the harshest one (deep). */
const zoneIndex = (v: number) => (v >= 1 && v <= 4 ? v - 1 : 3);

function exportMap(map: WorldMap): RpgdcMap {
  const kind = gameKind(map);
  const L = map.layers;
  return {
    id: gameMapId(map),
    name: map.name,
    kind,
    width: map.width,
    height: map.height,
    zone: kind === 'dungeon' ? (mapZone(map)?.key ?? 'deep') : null,
    groundLegend: [...GROUND_LEGEND],
    ground: L.terrain.map(gameGround),
    objectLegend: [...OBJECT_LEGEND],
    objects: L.object.map(gameObject),
    zoneLegend: [...ZONE_LEGEND],
    zones: kind === 'dungeon' ? null : L.zone.map(zoneIndex),
    places: exportPlaces(map),
  };
}

function exportPlaces(map: WorldMap): RpgdcPlace[] {
  const out: RpgdcPlace[] = [];
  const order = ['spawn_point', 'link', 'boss', 'monster_spawn', 'brazier'];
  const features = map.features.filter((f) => order.includes(f.type)).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  for (const f of features) {
    const p = placeProps(f);
    const x = f.c;
    const y = f.r;
    switch (f.type) {
      case 'spawn_point':
        out.push({ type: 'spawn_point', x, y });
        break;
      case 'monster_spawn':
        out.push({ type: 'monster_spawn', x, y, kind: String(p.kind), count: Math.max(1, Math.round(Number(p.count) || 1)), radius: Math.max(0, Math.round(Number(p.radius) || 0)) });
        break;
      case 'boss':
        out.push({ type: 'boss', x, y, kind: String(p.kind) });
        break;
      case 'brazier':
        out.push({ type: 'brazier', x, y });
        break;
      case 'link':
        out.push({ type: 'link', x, y, toMap: String(p.toMap), toX: Math.round(Number(p.toX) || 0), toY: Math.round(Number(p.toY) || 0) });
        break;
    }
  }
  return out;
}
