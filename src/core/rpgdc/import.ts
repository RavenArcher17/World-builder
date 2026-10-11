/**
 * Opening an "RPG-DC maps" file (the game's own `shared/maps/rpg-dc.maps.json`, or an export from
 * here) as a project: the reverse of export.ts. This is how a project catches up with maps changed
 * on the game's side. Exporting the project again gives back the same maps.
 */
import { featureDef } from '../features';
import { objectByKey } from '../objects';
import { PLACES_VERSION } from './migrate';
import { createProject } from '../project';
import { emptyLayers, newId, type Feature, type Project, type WorldMap } from '../types';
import { GROUND_LEGEND, GROUND_TILES, NPC_ROLES, ZONE_LEGEND, type GameKind } from './game';
import type { RpgdcMap, RpgdcMapsFile } from './export';

/** The project id imported maps get, so saving to the cloud replaces the RPG-DC project there. */
export const RPGDC_PROJECT_ID = 'rpgdc-world';

export function isRpgdcMapsFile(data: unknown): data is RpgdcMapsFile {
  return !!data && typeof data === 'object' && (data as { format?: unknown }).format === 'rpgdc-maps' && Array.isArray((data as { maps?: unknown }).maps);
}

/** A project holding every map in an RPG-DC maps file. Throws on anything it can't read. */
export function fromRpgdcMaps(file: RpgdcMapsFile, name = 'RPG-DC'): Project {
  if (!isRpgdcMapsFile(file)) throw new Error('Not an RPG-DC maps file');
  const project = createProject(name);
  project.id = RPGDC_PROJECT_ID;
  for (const raw of file.maps) {
    const map = importMap(raw);
    project.maps[map.id] = map;
  }
  return project;
}

const KINDS: Record<GameKind, { kind: WorldMap['kind']; scaleId: string }> = {
  overworld: { kind: 'overland', scaleId: 'local' },
  dungeon: { kind: 'dungeon', scaleId: 'dungeon' },
  interior: { kind: 'dungeon', scaleId: 'dungeon' },
};

function importMap(raw: RpgdcMap): WorldMap {
  const fail = (msg: string): never => {
    throw new Error(`Map "${raw?.id}": ${msg}`);
  };
  const kind = raw.kind;
  if (!KINDS[kind]) fail(`unknown kind "${kind}"`);
  const { width: w, height: h } = raw;
  const size = w * h;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) fail('bad size');
  const layer = (values: unknown, legend: unknown, lookup: (key: string) => number | undefined, what: string): number[] => {
    if (!Array.isArray(values) || values.length !== size || !Array.isArray(legend)) fail(`${what} must have ${size} values`);
    const table = (legend as string[]).map(lookup);
    return (values as number[]).map((v, i) => {
      const out = table[v];
      if (out === undefined) fail(`${what} at (${i % w}, ${Math.floor(i / w)}) is "${(legend as string[])[v]}", which World Builder doesn't know`);
      return out as number;
    });
  };
  const L = emptyLayers(size);
  L.terrain = layer(raw.ground, raw.groundLegend, (k) => {
    const i = GROUND_LEGEND.indexOf(k as (typeof GROUND_LEGEND)[number]);
    return i < 0 ? undefined : GROUND_TILES[i];
  }, 'ground');
  L.object = layer(raw.objects, raw.objectLegend, (k) => (k === '' ? 0 : objectByKey(k)?.id), 'objects');
  if (kind === 'overworld') {
    L.zone = layer(raw.zones, raw.zoneLegend, (k) => {
      const i = ZONE_LEGEND.indexOf(k as (typeof ZONE_LEGEND)[number]);
      return i < 0 ? undefined : i + 1;
    }, 'zones');
  }
  // Ground the game draws flat (no relief), like maps converted from the game before.
  L.elevation.fill(0.5);

  const settings: WorldMap['settings'] = { rpgdcMapId: raw.id, rpgdcPlaces: PLACES_VERSION };
  if (kind !== 'overworld') settings.rpgdcZone = raw.zone ?? (kind === 'interior' ? 'safe' : 'deep');
  if (kind === 'interior') settings.rpgdcKind = 'interior';
  return {
    id: `rpgdc-${raw.id}`,
    name: raw.name,
    ...KINDS[kind],
    grid: 'iso',
    width: w,
    height: h,
    seed: 0,
    settings,
    layers: L,
    features: (raw.places ?? []).map(importPlace),
    children: [],
  };
}

function importPlace(p: RpgdcMap['places'][number]): Feature {
  const { type, x, y, ...rest } = p as { type: string; x: number; y: number } & Record<string, string | number>;
  const props: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(rest)) if (typeof v === 'string' || typeof v === 'number') props[k] = v;
  if (type === 'building' && props.sign === undefined) props.sign = '';
  // Buildings go by their sign and townspeople by their trade, so the map reads like the town.
  const name =
    (type === 'building' && String(props.sign)) ||
    (type === 'npc' && NPC_ROLES.find((r) => r.value === props.role)?.label) ||
    featureDef(type).label;
  const f: Feature = { id: newId('f'), type, c: x, r: y, name };
  if (Object.keys(props).length) f.props = props;
  return f;
}
