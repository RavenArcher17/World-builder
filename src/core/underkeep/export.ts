/** World Builder map → Underkeep map file (docs/underkeep-export.md). */
import { featureDef } from '../features';
import { Grid } from '../grid';
import { objectDef } from '../objects';
import { propDef } from '../scene3d/props';
import { featureStorey, storey3d, storeyLayers, storeyNumbers } from '../scene3d/storeys';
import { T, tile } from '../tiles';
import type { Feature, WorldMap } from '../types';
import { OBJECT_TO_UK, PLACE_TO_UK, PROP_TO_UK, STAIR_CHARS, UK, UK_PLACE, type UkMap, type UkObject, type UkStorey } from './format';

/** Maps made for Underkeep carry this settings key. */
export const UNDERKEEP_KEY = 'underkeep';

export function isUnderkeep(map: WorldMap | null | undefined): boolean {
  return !!map && map.settings[UNDERKEEP_KEY] === true;
}

/** Underkeep maps are square grids (isometric maps are square grids drawn as diamonds). */
export function canBeUnderkeep(map: WorldMap): boolean {
  return map.grid === 'square' || map.grid === 'iso';
}

const SOLID = new Set<number>([T.WALL, T.CRYPT_WALL, T.ROCK, T.KEEP, T.BUILDING]);
const GRASSY = new Set<number>([T.GRASS, T.GRASSLAND, T.SAVANNA, T.FOREST, T.JUNGLE, T.TAIGA, T.SWAMP, T.HILLS, T.TUNDRA, T.FIELD, T.GARDEN]);

/** The Underkeep tile for a World Builder tile (stairs are handled with their facing). */
export function tileChar(t: number): string {
  if (t === T.VOID) return ' ';
  if (SOLID.has(t)) return '#';
  if (t === T.PLANKS || t === T.BRIDGE || t === T.DOCK) return '_';
  if (GRASSY.has(t)) return ',';
  return tile(t).walkable || t === T.PIT || t === T.WATER || t === T.POOL || t === T.LAKE ? '.' : '#';
}

export interface UnderkeepExport {
  md: UkMap;
  /** Things that have no place in an Underkeep map, described for the user. */
  dropped: string[];
}

/** Build the Underkeep map file. Throws on a hex map. */
export function toUnderkeep(map: WorldMap): UnderkeepExport {
  if (!canBeUnderkeep(map)) throw new Error('Underkeep maps use square cells: convert this map to a square grid first (Export → Convert to grid).');
  const g = new Grid(map.grid, map.width, map.height);
  const zs = storeyNumbers(map);
  const z0 = zs[0];
  const dropped = new Map<string, number>();
  const drop = (what: string) => dropped.set(what, (dropped.get(what) ?? 0) + 1);
  const storeys: UkStorey[] = zs.map((z) => {
    const L = storeyLayers(map, z);
    const E = storey3d(map, z);
    const tiles: string[] = [];
    const roof: string[] = [];
    const height: number[][] = [];
    const lo = z === z0 ? UK.H_MIN : 0;
    for (let r = 0; r < map.height; r++) {
      let row = '';
      let roofRow = '';
      const hRow: number[] = [];
      for (let c = 0; c < map.width; c++) {
        const i = g.idx(c, r);
        const t = L.terrain[i];
        // Stairs with a facing are 3D staircases; without one they mark a link to another map
        // (generated dungeons), which in Underkeep is just floor.
        const f = E?.facing[i] ?? -1;
        if ((t === T.STAIRS_UP || t === T.STAIRS_DOWN) && f >= 0) row += STAIR_CHARS[t === T.STAIRS_UP ? f : (f + 2) % 4];
        else row += tileChar(t);
        // Without 3D data a map is indoors: covered everywhere, as the game's editor starts.
        roofRow += (E ? E.roof[i] : 1) ? '1' : '0';
        let hgt = E?.height[i] ?? 0;
        if (t === T.PIT && !hgt) hgt = UK.H_MIN;
        hRow.push(Math.max(lo, Math.min(UK.H_MAX, hgt)));
      }
      tiles.push(row);
      roof.push(roofRow);
      height.push(hRow);
    }
    return { tiles, roof, height };
  });

  // One object per cell: a place beats a prop, a prop beats an object.
  const objects: UkObject[] = [];
  const taken = new Set<string>();
  const put = (o: UkObject, what: string) => {
    const key = `${o.x},${o.y},${o.z}`;
    if (taken.has(key)) {
      drop(`${what} sharing a cell with something else`);
      return;
    }
    taken.add(key);
    objects.push(o);
  };
  const hasStair = map.features.some((f) => f.type === UK_PLACE.stair);
  for (const f of map.features) {
    const t = placeType(f, hasStair);
    if (!t) {
      drop(f.type === 'entrance' ? 'entrance (the Great Stair is the way in)' : featureDef(f.type).label.toLowerCase());
      continue;
    }
    const props = f.props ?? {};
    put(
      {
        t,
        x: f.c,
        y: f.r,
        z: featureStorey(f) - z0,
        r: Number(props.facing ?? (t === 'chest' ? -1 : 0)),
        tier: Number(props.tier ?? (f.type === 'treasure' ? 2 : -1)),
      },
      'a place',
    );
  }
  for (const z of zs) {
    const L = storeyLayers(map, z);
    const E = storey3d(map, z);
    for (let i = 0; i < g.size; i++) {
      const x = g.col(i);
      const y = g.row(i);
      const prop = E ? propDef(E.prop[i]) : undefined;
      const facing = E?.facing[i] ?? -1;
      if (prop) {
        const t = PROP_TO_UK[prop.key];
        put({ t, x, y, z: z - z0, r: facing >= 0 ? facing : t === 'chest' ? -1 : 0, tier: -1 }, prop.name);
      }
      const obj = objectDef(L.object[i]);
      if (obj) {
        const t = OBJECT_TO_UK[obj.key];
        if (!t) drop(obj.name);
        else put({ t, x, y, z: z - z0, r: facing >= 0 ? facing : 0, tier: -1 }, obj.name);
      }
    }
  }

  const md: UkMap = {
    version: 2,
    name: map.name,
    w: map.width,
    h: map.height,
    storeys,
    objects,
    ...(map.rooms?.length && {
      regions: map.rooms.map((r) => ({ name: r.name, z: r.z - z0, x0: Math.min(r.c0, r.c1), y0: Math.min(r.r0, r.r1), x1: Math.max(r.c0, r.c1), y1: Math.max(r.r0, r.r1) })),
    }),
    notes: `Made in World Builder (https://world-builder-fc2cf.web.app) from “${map.name}”.`,
  };
  return { md, dropped: [...dropped].map(([what, n]) => `${n} × ${what}`) };
}

function placeType(f: Feature, hasStair: boolean): string | null {
  const kind = String(f.props?.kind ?? '');
  switch (f.type) {
    case UK_PLACE.stair:
      return 'stair';
    case UK_PLACE.exit:
      return ['rope', 'grate', 'lift', 'postern'].includes(kind) ? kind : 'grate';
    case UK_PLACE.enemy:
      return kind || 'shieldman';
    case UK_PLACE.clapper:
      return 'clapper';
    case 'entrance':
      return hasStair ? null : 'stair';
  }
  return PLACE_TO_UK[f.type] ?? null;
}

/** A file name the game accepts (letters, digits, spaces, - and _). */
export function underkeepFileName(name: string): string {
  const safe = [...name.trim()].filter((ch) => ch.toLowerCase() !== ch.toUpperCase() || /[0-9 _-]/.test(ch)).join('').trim();
  return `${safe || 'untitled'}.json`;
}
