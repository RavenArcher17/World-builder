import { featureDef } from './features';
import { getScale } from './scales';
import type { MapKind, Settings, SettingValue } from './types';

/** Declarative description of a generator option; the UI builds its forms from these. */
export interface SettingSchema {
  key: string;
  label: string;
  group: string;
  type: 'bool' | 'range' | 'select';
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  help?: string;
}

const range = (key: string, label: string, group: string, min = 0, max = 1, step = 0.05, help?: string): SettingSchema => ({
  key,
  label,
  group,
  type: 'range',
  min,
  max,
  step,
  help,
});
const bool = (key: string, label: string, group: string, help?: string): SettingSchema => ({ key, label, group, type: 'bool', help });
const select = (key: string, label: string, group: string, options: [string, string][], help?: string): SettingSchema => ({
  key,
  label,
  group,
  type: 'select',
  options: options.map(([value, l]) => ({ value, label: l })),
  help,
});

const plural = (s: string) => (s.endsWith('y') ? s.slice(0, -1) + 'ies' : s.endsWith('s') ? s : s + 's');

const OVERLAND_FEATURES = ['capital', 'city', 'town', 'village', 'hamlet', 'farm'];
const OVERLAND_POIS = ['castle', 'dungeon', 'ruins', 'cave', 'tower', 'temple', 'shrine', 'mine', 'lair', 'camp', 'landmark', 'inn'];

export const SETTING_SCHEMAS: Record<MapKind, SettingSchema[]> = {
  overland: [
    select('landform', 'Landform', 'Landform', [
      ['continents', 'Continents'],
      ['islands', 'Archipelago / islands'],
      ['pangaea', 'Single landmass'],
      ['coastal', 'Coastline'],
      ['inland', 'Inland (no sea)'],
    ]),
    range('waterLevel', 'Sea coverage', 'Landform', 0, 0.85, 0.01, 'Fraction of the map below sea level'),
    range('mountains', 'Mountains', 'Landform'),
    range('roughness', 'Roughness', 'Landform'),
    range('moisture', 'Moisture', 'Climate'),
    range('temperature', 'Temperature', 'Climate'),
    range('riverAmount', 'Rivers', 'Climate'),
    bool('t_rivers', 'Rivers', 'Terrain'),
    bool('t_lakes', 'Lakes', 'Terrain'),
    bool('t_forests', 'Forests & jungle', 'Terrain'),
    bool('t_mountains', 'Mountains & hills', 'Terrain'),
    bool('t_deserts', 'Deserts & badlands', 'Terrain'),
    bool('t_swamps', 'Swamps', 'Terrain'),
    bool('t_snow', 'Snow & glaciers', 'Terrain'),
    ...OVERLAND_FEATURES.map((t) => bool(`f_${t}`, plural(featureDef(t).label), 'Settlements')),
    bool('ports', 'Ports on coastal towns', 'Settlements'),
    range('settlementDensity', 'Settlement density', 'Settlements', 0, 2.5, 0.05),
    ...OVERLAND_POIS.map((t) => bool(`f_${t}`, plural(featureDef(t).label), 'Places of interest')),
    range('poiDensity', 'Places of interest density', 'Places of interest', 0, 2.5, 0.05),
    bool('t_roads', 'Roads', 'Roads'),
    range('roadLoops', 'Extra road links', 'Roads'),
  ],
  settlement: [
    select('sizeClass', 'Size', 'Layout', [
      ['hamlet', 'Hamlet'],
      ['village', 'Village'],
      ['town', 'Town'],
      ['city', 'City'],
      ['capital', 'Capital'],
    ]),
    range('density', 'Building density', 'Layout'),
    select('baseTerrain', 'Surroundings', 'Layout', [
      ['grassland', 'Grassland'],
      ['forest', 'Forest'],
      ['desert', 'Desert'],
      ['tundra', 'Tundra'],
      ['swamp', 'Swamp'],
      ['hills', 'Hills'],
    ]),
    bool('walls', 'City walls', 'Structures'),
    bool('castle', 'Keep / castle', 'Structures'),
    bool('market', 'Market square', 'Structures'),
    bool('temple', 'Temple', 'Structures'),
    bool('shops', 'Taverns, inns & shops', 'Structures'),
    bool('graveyard', 'Graveyard', 'Structures'),
    bool('river', 'River through town', 'Water'),
    bool('coast', 'Coastline', 'Water'),
    select('coastDir', 'Coast side', 'Water', [
      ['N', 'North'],
      ['E', 'East'],
      ['S', 'South'],
      ['W', 'West'],
    ]),
    bool('docks', 'Docks', 'Water'),
    bool('farms', 'Farmland around', 'Surroundings'),
    bool('ruined', 'Ruined / abandoned', 'Surroundings'),
  ],
  dungeon: [
    select('style', 'Style', 'Layout', [
      ['rooms', 'Rooms & corridors'],
      ['caves', 'Natural caves'],
      ['mixed', 'Mixed'],
    ]),
    range('roomDensity', 'Room count', 'Layout'),
    range('roomSize', 'Room size', 'Layout'),
    range('winding', 'Winding corridors', 'Layout'),
    range('loops', 'Loops', 'Layout'),
    bool('doors', 'Doors', 'Details'),
    bool('secrets', 'Secret doors', 'Details'),
    bool('water', 'Pools & water', 'Details'),
    bool('stairsDown', 'Stairs to a deeper level', 'Details'),
    range('monsters', 'Monsters', 'Contents'),
    range('treasure', 'Treasure', 'Contents'),
    range('traps', 'Traps', 'Contents'),
  ],
};

export function defaultSettings(kind: MapKind, scaleId: string): Settings {
  const scale = getScale(scaleId);
  const s: Settings = {};
  if (kind === 'overland') {
    const landform: Record<string, [string, number]> = {
      world: ['continents', 0.58],
      continent: ['pangaea', 0.4],
      kingdom: ['coastal', 0.22],
      county: ['inland', 0.02],
      local: ['inland', 0.02],
    };
    const [lf, wl] = landform[scaleId] ?? ['continents', 0.45];
    Object.assign(s, {
      landform: lf,
      waterLevel: wl,
      mountains: 0.5,
      roughness: 0.5,
      moisture: 0.5,
      temperature: 0.5,
      riverAmount: 0.5,
      t_rivers: true,
      t_lakes: true,
      t_forests: true,
      t_mountains: true,
      t_deserts: true,
      t_swamps: true,
      t_snow: true,
      t_roads: true,
      ports: true,
      settlementDensity: 1,
      poiDensity: 1,
      roadLoops: 0.3,
    });
    for (const t of [...OVERLAND_FEATURES, ...OVERLAND_POIS]) s[`f_${t}`] = (scale.rates[t] ?? 0) > 0;
  } else if (kind === 'settlement') {
    const size = scaleId === 'city' ? 'city' : scaleId === 'village' ? 'village' : 'town';
    Object.assign(s, {
      sizeClass: size,
      density: 0.6,
      baseTerrain: 'grassland',
      walls: size !== 'village',
      castle: size === 'city',
      market: true,
      temple: true,
      shops: true,
      graveyard: true,
      river: true,
      coast: false,
      coastDir: 'E',
      docks: true,
      farms: true,
      ruined: false,
    });
  } else {
    Object.assign(s, {
      style: scaleId === 'cave' ? 'caves' : 'rooms',
      roomDensity: 0.55,
      roomSize: 0.45,
      winding: 0.4,
      loops: 0.3,
      doors: true,
      secrets: true,
      water: true,
      stairsDown: true,
      monsters: 0.5,
      treasure: 0.4,
      traps: 0.35,
    });
  }
  return s;
}

/** Typed accessors that fall back to defaults when a project from an older version lacks a key. */
export class SettingsReader {
  private defaults: Settings;
  constructor(private s: Settings, kind: MapKind, scaleId: string) {
    this.defaults = defaultSettings(kind, scaleId);
  }
  private get(key: string): SettingValue | undefined {
    return key in this.s ? this.s[key] : this.defaults[key];
  }
  num(key: string, fallback = 0): number {
    const v = this.get(key);
    return typeof v === 'number' ? v : fallback;
  }
  bool(key: string, fallback = false): boolean {
    const v = this.get(key);
    return typeof v === 'boolean' ? v : fallback;
  }
  str(key: string, fallback = ''): string {
    const v = this.get(key);
    return typeof v === 'string' ? v : fallback;
  }
}
