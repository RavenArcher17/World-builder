import type { MapSpec, WorldMap } from '../types';
import { generateDungeon } from './dungeon';
import { OverlandGuide, generateOverland } from './overland';
import { generateSettlement } from './settlement';

/** Generate any kind of map from a spec. `guide` only applies to overland maps. */
export function generateMap(spec: MapSpec, guide?: OverlandGuide): WorldMap {
  switch (spec.kind) {
    case 'settlement':
      return generateSettlement(spec);
    case 'dungeon':
      return generateDungeon(spec);
    default:
      return generateOverland(spec, guide);
  }
}

export type { OverlandGuide };
