import type { MapKind } from './types';

export interface ScaleDef {
  id: string;
  label: string;
  kind: MapKind;
  /** Human description of what one cell represents. */
  cell: string;
  description: string;
  width: number;
  height: number;
  /** Wavelength (in cells) of the largest terrain features. */
  featureSize: number;
  /** Apply a north/south temperature gradient. */
  latitude: boolean;
  /** Extra detail noise added on top of a parent map when zooming in. */
  detail: number;
  /** Minimum catchment (cells of rain) for a river to show. */
  riverThreshold: number;
  /** Expected count per 1000 cells at density 1. */
  rates: Record<string, number>;
  /** Scales offered when zooming into part of this map. */
  children: string[];
}

export const SCALES: ScaleDef[] = [
  {
    id: 'world',
    label: 'World',
    kind: 'overland',
    cell: '≈ 50 km',
    description: 'Whole world: continents, oceans, great cities.',
    width: 128,
    height: 80,
    featureSize: 48,
    latitude: true,
    detail: 0.1,
    riverThreshold: 40,
    rates: { capital: 0.1, city: 0.6, town: 1.4, castle: 0.4, dungeon: 0.4, ruins: 0.6, lair: 0.3, tower: 0.2, temple: 0.2, landmark: 0.3, mine: 0.3 },
    children: ['continent', 'kingdom', 'county'],
  },
  {
    id: 'continent',
    label: 'Continent',
    kind: 'overland',
    cell: '≈ 20 km',
    description: 'A continent or sub-continent with several realms.',
    width: 112,
    height: 80,
    featureSize: 40,
    latitude: true,
    detail: 0.09,
    riverThreshold: 35,
    rates: { capital: 0.12, city: 0.6, town: 1.8, village: 1.2, castle: 0.8, dungeon: 0.8, ruins: 0.8, cave: 0.4, lair: 0.4, tower: 0.4, temple: 0.4, mine: 0.5, landmark: 0.4, camp: 0.2 },
    children: ['kingdom', 'county', 'local'],
  },
  {
    id: 'kingdom',
    label: 'Kingdom',
    kind: 'overland',
    cell: '≈ 5 km',
    description: 'A kingdom or large region: towns, castles, roads.',
    width: 96,
    height: 72,
    featureSize: 34,
    latitude: false,
    detail: 0.08,
    riverThreshold: 30,
    rates: { city: 0.3, town: 1.8, village: 3.5, castle: 1, dungeon: 1, ruins: 1, cave: 0.6, lair: 0.5, tower: 0.6, temple: 0.6, shrine: 0.4, mine: 0.6, camp: 0.4, landmark: 0.5, inn: 0.5 },
    children: ['county', 'local', 'city', 'town', 'village', 'dungeon', 'cave'],
  },
  {
    id: 'county',
    label: 'County / Province',
    kind: 'overland',
    cell: '≈ 1 km',
    description: 'A county, barony or province: villages, farms, dungeons.',
    width: 80,
    height: 64,
    featureSize: 30,
    latitude: false,
    detail: 0.07,
    riverThreshold: 28,
    rates: { town: 0.5, village: 3.5, hamlet: 5, castle: 0.6, dungeon: 1.2, ruins: 1.2, cave: 1, lair: 0.6, tower: 0.6, temple: 0.5, shrine: 1, mine: 0.8, camp: 0.8, landmark: 0.8, farm: 4, inn: 1 },
    children: ['local', 'city', 'town', 'village', 'dungeon', 'cave'],
  },
  {
    id: 'local',
    label: 'Local area',
    kind: 'overland',
    cell: '≈ 200 m',
    description: 'A valley, forest or stretch of coast at walking scale.',
    width: 64,
    height: 64,
    featureSize: 26,
    latitude: false,
    detail: 0.05,
    riverThreshold: 30,
    rates: { village: 0.5, hamlet: 2, farm: 6, dungeon: 1, ruins: 1.5, cave: 1.5, tower: 0.5, shrine: 1.5, camp: 1.2, landmark: 1.2, lair: 0.6, mine: 0.6 },
    children: ['city', 'town', 'village', 'dungeon', 'cave'],
  },
  {
    id: 'city',
    label: 'City layout',
    kind: 'settlement',
    cell: '≈ 10 m',
    description: 'Walled city: districts, streets, market, keep.',
    width: 96,
    height: 96,
    featureSize: 24,
    latitude: false,
    detail: 0,
    riverThreshold: 0,
    rates: {},
    children: ['dungeon', 'cave'],
  },
  {
    id: 'town',
    label: 'Town layout',
    kind: 'settlement',
    cell: '≈ 8 m',
    description: 'Market town: streets, plaza, tavern, temple.',
    width: 72,
    height: 72,
    featureSize: 20,
    latitude: false,
    detail: 0,
    riverThreshold: 0,
    rates: {},
    children: ['dungeon', 'cave'],
  },
  {
    id: 'village',
    label: 'Village layout',
    kind: 'settlement',
    cell: '≈ 6 m',
    description: 'Small village with farms around it.',
    width: 48,
    height: 48,
    featureSize: 16,
    latitude: false,
    detail: 0,
    riverThreshold: 0,
    rates: {},
    children: ['dungeon', 'cave'],
  },
  {
    id: 'dungeon',
    label: 'Dungeon',
    kind: 'dungeon',
    cell: '≈ 1.5 m (5 ft)',
    description: 'Rooms and corridors, doors, traps and treasure.',
    width: 48,
    height: 48,
    featureSize: 12,
    latitude: false,
    detail: 0,
    riverThreshold: 0,
    rates: {},
    children: ['dungeon', 'cave'],
  },
  {
    id: 'cave',
    label: 'Cave system',
    kind: 'dungeon',
    cell: '≈ 1.5 m (5 ft)',
    description: 'Natural caverns with pools and chasms.',
    width: 56,
    height: 48,
    featureSize: 12,
    latitude: false,
    detail: 0,
    riverThreshold: 0,
    rates: {},
    children: ['dungeon', 'cave'],
  },
];

const BY_ID = new Map(SCALES.map((s) => [s.id, s]));

export function getScale(id: string): ScaleDef {
  return BY_ID.get(id) ?? SCALES[0];
}
