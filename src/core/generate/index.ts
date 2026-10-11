import { SettingsReader } from '../settings';
import type { MapSpec, WorldMap } from '../types';
import { generateDungeon } from './dungeon';
import { generateKeep } from './keep';
import { OverlandGuide, generateOverland } from './overland';
import { generateSettlement } from './settlement';

/** Generate any kind of map from a spec. `guide` only applies to overland maps. */
export function generateMap(spec: MapSpec, guide?: OverlandGuide): WorldMap {
  switch (spec.kind) {
    case 'settlement':
      return generateSettlement(spec);
    case 'dungeon':
      // Keeps in storeys need square cells (stairs face north, east, south or west).
      if (new SettingsReader(spec.settings, 'dungeon', spec.scaleId).str('style') === 'keep') {
        if (spec.grid === 'square' || spec.grid === 'iso') return generateKeep(spec);
        return generateDungeon({ ...spec, settings: { ...spec.settings, style: 'rooms' } });
      }
      return generateDungeon(spec);
    default:
      return generateOverland(spec, guide);
  }
}

export type { OverlandGuide };
