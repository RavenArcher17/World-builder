/**
 * Converts RPG-DC maps exported by the game's `tools/world-builder/export-map.ts` (stand-in
 * terrain plus the game's own tile id per cell in `layers.rpgdcTile`) to ground + object + zone
 * layers and typed places. Runs when a project is opened; it removes `rpgdcTile`, so a converted
 * project is never converted twice. Also brings older RPG-DC maps' places up to date (see
 * PLACES_VERSION).
 */
import { O } from '../objects';
import { T, tile } from '../tiles';
import type { Feature, Project, WorldMap } from '../types';
import { besideTile, gameMapId, isRpgdc, isWalkableAt, normalRange, zoneByDistance, zoneByKey } from './game';

/** The game's tile ids (shared/src/map.ts in RPG-DC). */
const G = {
  GRASS: 0,
  PATH: 1,
  WATER: 2,
  ROCK: 3,
  TREE: 4,
  FLOOR: 5,
  COPPER: 6,
  TIN: 7,
  IRON: 8,
  BANK: 9,
  WALL: 10,
  DUNGEON_FLOOR: 11,
  ENTRANCE: 12,
  STAIRS_DOWN: 13,
  STAIRS_UP: 14,
  SHOP: 15,
  FURNACE: 16,
  ANVIL: 17,
  RANGE: 18,
  FISHING: 19,
};

/** World Builder terrain the exporter used for each game tile. */
const STAND_IN: Record<number, number[]> = {
  [G.GRASS]: [T.GRASSLAND],
  [G.PATH]: [T.GRASSLAND, T.GATE],
  [G.WATER]: [T.LAKE],
  [G.ROCK]: [T.MOUNTAINS, T.WALL],
  [G.TREE]: [T.TAIGA, T.FOREST, T.SWAMP],
  [G.FLOOR]: [T.PLAZA],
  [G.COPPER]: [T.BADLANDS],
  [G.TIN]: [T.BADLANDS],
  [G.IRON]: [T.BADLANDS],
  [G.BANK]: [T.PLAZA],
  [G.WALL]: [T.ROCK],
  [G.DUNGEON_FLOOR]: [T.FLOOR],
  [G.ENTRANCE]: [T.GRASSLAND],
  [G.STAIRS_DOWN]: [T.STAIRS_DOWN],
  [G.STAIRS_UP]: [T.STAIRS_UP],
  [G.SHOP]: [T.PLAZA],
  [G.FURNACE]: [T.PLAZA],
  [G.ANVIL]: [T.PLAZA],
  [G.RANGE]: [T.PLAZA],
  [G.FISHING]: [T.LAKE],
};

const TREE_BY_TERRAIN: Record<number, number> = { [T.TAIGA]: O.TREE, [T.FOREST]: O.OAK, [T.SWAMP]: O.WILLOW };
const ORE_BY_TAG: Record<string, number> = { copper: O.COPPER_ROCK, tin: O.TIN_ROCK, iron: O.IRON_ROCK };
const FISH_BY_TAG: Record<string, number> = { shrimp_spot: O.FISHING_SHRIMP, trout_spot: O.FISHING_TROUT, salmon_spot: O.FISHING_SALMON };
const STATION: Record<number, number> = {
  [G.BANK]: O.BANK,
  [G.SHOP]: O.SHOP,
  [G.FURNACE]: O.FURNACE,
  [G.ANVIL]: O.ANVIL,
  [G.RANGE]: O.COOKING_FIRE,
};
/** Markers whose information now lives in the object layer. */
const DROPPED_MARKERS = new Set(['bank', 'shop', 'furnace', 'anvil', 'cooking_fire', 'fishing_spot', 'mine']);

export function needsMigration(map: WorldMap): boolean {
  const raw = (map.layers as unknown as Record<string, unknown>).rpgdcTile;
  return isRpgdc(map) && Array.isArray(raw) && raw.length === map.width * map.height;
}

/**
 * How RPG-DC places are stored, kept in each map's `settings.rpgdcPlaces`.
 * 2: a monster spawn's radius 0 means its monsters stay on their tile. Before that, 0 meant the
 * monster's normal range, so older maps get that range written out when opened.
 */
export const PLACES_VERSION = 2;

/** Migrate every RPG-DC map that still has an `rpgdcTile` layer, and bring older places up to date. Returns the changed map ids. */
export function migrateRpgdcProject(project: Project): string[] {
  const todo = Object.values(project.maps).filter(needsMigration);
  for (const map of todo) migrateCells(map);
  for (const map of todo) migratePlaces(project, map, todo);
  for (const map of todo) delete (map.layers as unknown as Record<string, unknown>).rpgdcTile;
  const upgraded = Object.values(project.maps).filter((m) => isRpgdc(m) && upgradePlaces(m));
  return [...new Set([...todo, ...upgraded].map((m) => m.id))];
}

/** Writes out the normal range for monster spawns saved when radius 0 meant it. True if the map changed. */
function upgradePlaces(map: WorldMap): boolean {
  if (Number(map.settings.rpgdcPlaces) >= PLACES_VERSION) return false;
  for (const f of map.features) {
    if (f.type === 'monster_spawn' && !(Number(f.props?.radius) > 0)) f.props = { ...f.props, radius: normalRange(f.props?.kind) };
  }
  map.settings.rpgdcPlaces = PLACES_VERSION;
  return true;
}

const cheb = (a: { c: number; r: number }, c: number, r: number) => Math.max(Math.abs(a.c - c), Math.abs(a.r - r));

function migrateCells(map: WorldMap): void {
  const L = map.layers;
  const raw = (L as unknown as Record<string, number[]>).rpgdcTile;
  const w = map.width;
  const town = map.features.find((f) => f.type === 'town');
  const mines = map.features.filter((f) => f.type === 'mine' && ORE_BY_TAG[f.tags?.[0] ?? '']);
  const fishAt = new Map<number, number>();
  for (const f of map.features) {
    const fish = FISH_BY_TAG[f.tags?.[0] ?? ''];
    if (f.type === 'fishing_spot' && fish) fishAt.set(f.r * w + f.c, fish);
  }
  const nearestOre = (c: number, r: number) => {
    let best = O.COPPER_ROCK;
    let bd = Infinity;
    for (const m of mines) {
      const d = Math.hypot(m.c - c, m.r - r);
      if (d < bd) {
        bd = d;
        best = ORE_BY_TAG[m.tags![0]];
      }
    }
    return best;
  };

  for (let i = 0; i < raw.length; i++) {
    const c = i % w;
    const r = Math.floor(i / w);
    const game = raw[i];
    const terrain = L.terrain[i];
    const road = L.road[i] !== 0;
    let ground: number;
    let object = 0;
    if (isUnchanged(game, terrain, road)) {
      [ground, object] = fromGameTile(game, terrain);
      if (game === G.ROCK) object = town && cheb(town, c, r) <= 6 ? O.FENCE : O.BOULDER;
      if (game === G.FISHING) object = fishAt.get(i) ?? O.FISHING_SHRIMP;
    } else {
      [ground, object] = fromTerrain(terrain, road);
      if (terrain === T.BADLANDS) object = nearestOre(c, r);
    }
    L.terrain[i] = ground;
    L.object[i] = object;
    // Paths are ground now, not road lines.
    L.road[i] = 0;
    L.roadLevel[i] = 0;
  }

  if (map.kind === 'dungeon') {
    L.zone.fill(0);
    if (!zoneByKey(map.settings.rpgdcZone)) map.settings.rpgdcZone = dungeonZone(map);
  } else if (town) {
    for (let i = 0; i < raw.length; i++) L.zone[i] = zoneByDistance(cheb(town, i % w, Math.floor(i / w)));
  }
}

/** True when the cell still shows the exporter's stand-in for its game tile. */
function isUnchanged(game: number, terrain: number, road: boolean): boolean {
  const stand = STAND_IN[game];
  if (!stand?.includes(terrain)) return false;
  // Grassland means a path only while it still carries road bits; a road painted on grass is an edit.
  if (terrain === T.GRASSLAND) return game === G.PATH ? road : !road;
  return true;
}

function fromGameTile(game: number, terrain: number): [number, number] {
  switch (game) {
    case G.PATH:
      return [T.PATH, 0];
    case G.WATER:
      return [T.WATER, 0];
    case G.ROCK:
      return [T.GRASS, O.BOULDER];
    case G.TREE:
      return [T.GRASS, TREE_BY_TERRAIN[terrain] ?? O.TREE];
    case G.FLOOR:
      return [T.TOWN_FLOOR, 0];
    case G.COPPER:
      return [T.GRASS, O.COPPER_ROCK];
    case G.TIN:
      return [T.GRASS, O.TIN_ROCK];
    case G.IRON:
      return [T.GRASS, O.IRON_ROCK];
    case G.WALL:
      return [T.CRYPT_WALL, 0];
    case G.DUNGEON_FLOOR:
      return [T.CRYPT_FLOOR, 0];
    case G.ENTRANCE:
      return [T.GRASS, O.CRYPT_ENTRANCE];
    case G.STAIRS_DOWN:
      return [T.CRYPT_FLOOR, O.STAIRS_DOWN];
    case G.STAIRS_UP:
      return [T.CRYPT_FLOOR, O.STAIRS_UP];
    case G.FISHING:
      return [T.WATER, O.FISHING_SHRIMP];
    default:
      if (STATION[game]) return [T.TOWN_FLOOR, STATION[game]];
      return [T.GRASS, 0];
  }
}

/** Map edited stand-in terrain back to ground + object. */
function fromTerrain(terrain: number, road: boolean): [number, number] {
  switch (terrain) {
    case T.GRASSLAND:
      return [road ? T.PATH : T.GRASS, 0];
    case T.LAKE:
      return [T.WATER, 0];
    case T.MOUNTAINS:
      return [T.GRASS, O.BOULDER];
    case T.WALL:
      return [T.GRASS, O.FENCE];
    case T.PLAZA:
      return [T.TOWN_FLOOR, 0];
    case T.GATE:
      return [T.PATH, 0];
    case T.TAIGA:
    case T.FOREST:
    case T.SWAMP:
      return [T.GRASS, TREE_BY_TERRAIN[terrain]];
    case T.BADLANDS:
      return [T.GRASS, O.COPPER_ROCK];
    case T.ROCK:
      return [T.CRYPT_WALL, 0];
    case T.FLOOR:
      return [T.CRYPT_FLOOR, 0];
    case T.STAIRS_UP:
      return [T.CRYPT_FLOOR, O.STAIRS_UP];
    case T.STAIRS_DOWN:
      return [T.CRYPT_FLOOR, O.STAIRS_DOWN];
    default: {
      // Painted with the general palette: the closest game ground.
      if (terrain >= T.GRASS) return [terrain, 0];
      const t = tile(terrain);
      if (t.category === 'water') return [T.WATER, 0];
      if (t.category === 'dungeon') return [t.walkable ? T.CRYPT_FLOOR : T.CRYPT_WALL, 0];
      if (t.category === 'urban' && t.walkable) return [T.TOWN_FLOOR, 0];
      return t.walkable ? [T.GRASS, 0] : [T.GRASS, O.BOULDER];
    }
  }
}

function dungeonZone(map: WorldMap): string {
  if (gameMapId(map) === 'crypt1') return 'wilderness';
  const tagged = map.features.map((f) => f.tags?.[1]).find((z) => zoneByKey(z));
  return tagged ?? 'deep';
}

function migratePlaces(project: Project, map: WorldMap, batch: WorldMap[]): void {
  const keep: Feature[] = [];
  for (const f of map.features) {
    if (DROPPED_MARKERS.has(f.type)) continue;
    if (f.type === 'monster') {
      const kind = f.tags?.[0] ?? 'rat';
      keep.push(asPlace(f, 'monster_spawn', { kind, count: 1, radius: normalRange(kind) }));
    } else if (f.type === 'boss') {
      keep.push(asPlace(f, 'boss', { kind: f.tags?.[0] ?? 'bone_king' }));
    } else {
      keep.push(f);
    }
  }
  map.features = keep;

  // Stairs: the exporter linked each map to the next with a `dungeon` / `stairs_down` marker
  // (childMapId) and put an `entrance` marker on the next map's stairs up.
  for (const down of map.features) {
    if ((down.type !== 'dungeon' && down.type !== 'stairs_down') || !down.childMapId) continue;
    const child = project.maps[down.childMapId];
    if (!child || !batch.includes(child)) continue;
    const upIdx = child.features.findIndex((f) => f.type === 'entrance');
    const upCell = upIdx >= 0 ? child.features[upIdx] : findObject(child, O.STAIRS_UP);
    if (!upCell) continue;
    // Going down you arrive just east of the stairs up (the game's dungeon spawn).
    const arrive = isWalkableAt(child, upCell.c + 1, upCell.r) ? { x: upCell.c + 1, y: upCell.r } : besideTile(child, upCell.c, upCell.r);
    // Going up you arrive on the first walkable tile beside the stairs down.
    const back = besideTile(map, down.c, down.r);
    Object.assign(down, {
      type: 'link',
      props: { toMap: gameMapId(child), toX: arrive?.x ?? upCell.c, toY: arrive?.y ?? upCell.r },
    });
    const upLink: Feature = {
      id: upIdx >= 0 ? child.features[upIdx].id : `${child.id}-up`,
      type: 'link',
      c: upCell.c,
      r: upCell.r,
      name: upIdx >= 0 ? child.features[upIdx].name : 'Stairs up',
      props: { toMap: gameMapId(map), toX: back?.x ?? down.c, toY: back?.y ?? down.r },
    };
    if (upIdx >= 0) child.features[upIdx] = upLink;
    else child.features.push(upLink);
  }
}

function asPlace(f: Feature, type: string, props: Feature['props']): Feature {
  const out: Feature = { ...f, type, props };
  delete out.tags;
  return out;
}

function findObject(map: WorldMap, object: number): { c: number; r: number } | undefined {
  const i = map.layers.object.indexOf(object);
  return i >= 0 ? { c: i % map.width, r: Math.floor(i / map.width) } : undefined;
}
