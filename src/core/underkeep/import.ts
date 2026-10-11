/** Underkeep map file → World Builder map (a 3D map with `settings.underkeep`). */
import { objectByKey } from '../objects';
import { MAP3D_KEYS } from '../scene3d/options';
import { propByKey } from '../scene3d/props';
import { emptyLayers3d } from '../scene3d/storeys';
import { defaultSettings } from '../settings';
import { T } from '../tiles';
import { type Feature, type Layers3d, type MapLayers, type Storey, type WorldMap, emptyLayers, newId } from '../types';
import { UNDERKEEP_KEY } from './export';
import { EXIT_TYPES, ENEMY_TYPES, PROP_TO_UK, STAIR_CHARS, UK, UK_PLACE, UK_TO_OBJECT, UK_TYPES, type UkMap, type UkObject, type UkStorey } from './format';

/** Does this look like an Underkeep map file (version 1 or 2)? */
export function isUnderkeepFile(data: unknown): data is UkMap {
  const d = data as Partial<UkMap> & { tiles?: unknown; format?: unknown };
  // World Builder projects and the RPG-DC maps file carry a `format`; Underkeep's files don't.
  return !!d && typeof d === 'object' && d.format === undefined && Number.isFinite(Number(d.w)) && Number.isFinite(Number(d.h)) && (Array.isArray(d.storeys) || Array.isArray(d.tiles)) && Array.isArray(d.objects ?? []);
}

/** The game's own upgrade: numbers to integers, short layers padded, version 1 to 2. */
export function upgradeUnderkeep(raw: UkMap & { tiles?: string[]; roof?: string[]; height?: number[][] }): UkMap {
  const w = Math.trunc(Number(raw.w));
  const h = Math.trunc(Number(raw.h));
  const storeys: UkStorey[] = (raw.storeys ?? [{ tiles: raw.tiles ?? [], roof: raw.roof ?? [], height: raw.height ?? [] }]).map((s) => {
    const tiles = [...(s.tiles ?? [])].map((row) => String(row).padEnd(w, ' ').slice(0, w));
    while (tiles.length < h) tiles.push(' '.repeat(w));
    const roof = [...(s.roof ?? [])].map((row) => String(row).padEnd(w, '1').slice(0, w));
    while (roof.length < h) roof.push('1'.repeat(w));
    const height = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => Math.trunc(Number(s.height?.[y]?.[x] ?? 0)) || 0));
    return { tiles: tiles.slice(0, h), roof: roof.slice(0, h), height };
  });
  const objects: UkObject[] = (raw.objects ?? []).map((o) => ({
    t: String(o.t),
    x: Math.trunc(Number(o.x)),
    y: Math.trunc(Number(o.y)),
    z: Math.max(0, Math.min(storeys.length - 1, Math.trunc(Number(o.z ?? 0)))),
    r: Math.trunc(Number(o.r ?? 0)),
    tier: Math.trunc(Number(o.tier ?? -1)),
  }));
  return { ...raw, version: 2, name: String(raw.name ?? 'Underkeep map'), w, h, storeys, objects };
}

/**
 * Turn an Underkeep map into a World Builder map. The storey holding the Great Stair becomes the
 * ground storey (z 0); the others sit above and below it.
 */
export function fromUnderkeep(raw: UkMap): WorldMap {
  const md = upgradeUnderkeep(raw);
  const { w, h } = md;
  const size = w * h;
  const stair = md.objects.find((o) => o.t === 'stair');
  const ground = stair?.z ?? 0;
  const settings = {
    ...defaultSettings('dungeon', 'dungeon'),
    [MAP3D_KEYS.on]: true,
    [MAP3D_KEYS.look]: 'blocks',
    [MAP3D_KEYS.tile]: 2,
    [MAP3D_KEYS.wall]: UK.PITCH * UK.H_UNIT - 0.5,
    [UNDERKEEP_KEY]: true,
  };
  const map: WorldMap = {
    id: newId('map'),
    name: md.name,
    kind: 'dungeon',
    scaleId: 'dungeon',
    grid: 'square',
    width: w,
    height: h,
    seed: 0,
    settings,
    layers: emptyLayers(size),
    features: [],
    children: [],
  };
  const levels = new Map<number, { L: MapLayers; E: Layers3d }>();
  const storeys: Storey[] = [];
  md.storeys.forEach((s, k) => {
    const z = k - ground;
    const L = z === 0 ? map.layers : emptyLayers(size);
    const E = emptyLayers3d(size);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const ch = s.tiles[y][x];
        const stairIdx = (STAIR_CHARS as readonly string[]).indexOf(ch);
        L.terrain[i] = stairIdx >= 0 ? T.STAIRS_UP : ch === '#' ? T.WALL : ch === '.' ? T.FLOOR : ch === '_' ? T.PLANKS : ch === ',' ? T.GRASS : T.VOID;
        if (stairIdx >= 0) E.facing[i] = stairIdx;
        E.roof[i] = s.roof[y][x] === '0' ? 0 : 1;
        E.height[i] = s.height[y][x];
      }
    }
    if (z === 0) map.layers3d = E;
    else storeys.push({ z, layers: L, layers3d: E });
    levels.set(z, { L, E });
  });
  if (storeys.length) map.storeys = storeys.sort((a, b) => a.z - b.z);

  const propOf = Object.fromEntries(Object.entries(PROP_TO_UK).map(([p, u]) => [u, p]));
  for (const o of md.objects) {
    const z = o.z - ground;
    const lv = levels.get(z);
    if (!lv || o.x < 0 || o.y < 0 || o.x >= w || o.y >= h) continue;
    const i = o.y * w + o.x;
    const prop = propOf[o.t] ? propByKey(propOf[o.t]) : undefined;
    const obj = UK_TO_OBJECT[o.t] ? objectByKey(UK_TO_OBJECT[o.t]) : undefined;
    // Chests and traps carry a tier, so they come in as places; other props keep their turn.
    if (prop && o.t !== 'chest' && o.t !== 'trap') {
      lv.E.prop[i] = prop.id;
      lv.E.facing[i] = ((o.r % 4) + 4) % 4;
    } else if (obj) {
      lv.L.object[i] = obj.id;
      lv.E.facing[i] = ((o.r % 4) + 4) % 4;
    } else {
      const f = placeFor(o, z);
      if (f) map.features.push(f);
      else if (prop) lv.E.prop[i] = prop.id;
    }
  }
  if (md.regions?.length) {
    map.rooms = md.regions.map((r) => ({ name: String(r.name), z: Math.trunc(Number(r.z)) - ground, c0: Math.trunc(Number(r.x0)), r0: Math.trunc(Number(r.y0)), c1: Math.trunc(Number(r.x1)), r1: Math.trunc(Number(r.y1)) }));
  }
  return map;
}

/** Exits, enemies, the stair, chests, traps and the clapper come in as places carrying their tier and facing. */
function placeFor(o: UkObject, z: number): Feature | null {
  const base = { id: newId('f'), c: o.x, r: o.y, ...(z && { z }) };
  const facing: Record<string, number> = o.r >= 0 ? { facing: o.r % 4 } : {};
  if (o.t === 'stair') return { ...base, type: UK_PLACE.stair, name: 'Great Stair', props: { facing: ((o.r % 4) + 4) % 4 } };
  if (EXIT_TYPES.includes(o.t)) return { ...base, type: UK_PLACE.exit, name: UK_TYPES[o.t].label.split(' (')[0], props: { kind: o.t, ...facing } };
  if (ENEMY_TYPES.includes(o.t)) return { ...base, type: UK_PLACE.enemy, name: UK_TYPES[o.t].label.split(' (')[0], props: { kind: o.t, tier: o.tier } };
  if (o.t === 'clapper') return { ...base, type: UK_PLACE.clapper, name: "The great bell's clapper", props: {} };
  if (o.t === 'chest') return { ...base, type: 'treasure', name: 'Chest', props: { tier: o.tier, ...facing } };
  if (o.t === 'trap') return { ...base, type: 'trap', name: 'Spike trap', props: { tier: o.tier } };
  return null;
}
