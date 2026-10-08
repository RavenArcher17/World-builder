/**
 * "Check for game": problems that would stop RPG-DC loading or playing a map correctly.
 * Every issue names a tile so the editor can jump to it.
 */
import { objectDef } from '../objects';
import type { Feature, Project, WorldMap } from '../types';
import {
  MONSTER_KINDS,
  NEIGHBOURS,
  findGameMap,
  gameGround,
  gameKind,
  gameMapId,
  gameMaps,
  gameObject,
  isGameGround,
  isWalkable,
  isWalkableAt,
  mapZone,
  placeProps,
  reachable,
  stairsDirection,
  zoneAt,
} from './game';

export interface GameIssue {
  severity: 'error' | 'warning';
  /** World Builder map id (for jumping there). */
  mapId: string;
  /** The game's map id. */
  gameMapId: string;
  c: number;
  r: number;
  message: string;
}

export const OVERWORLD_SIZE = 128;
export const DUNGEON_SIZE = 48;

export function checkGameMaps(project: Project): GameIssue[] {
  const issues: GameIssue[] = [];
  const maps = gameMaps(project);
  const add = (severity: GameIssue['severity'], map: WorldMap, c: number, r: number, message: string) =>
    issues.push({ severity, mapId: map.id, gameMapId: gameMapId(map), c, r, message });
  const at = (f: Feature) => `(${f.c}, ${f.r})`;

  // Map ids must be unique, and there must be an overworld.
  const seenIds = new Map<string, WorldMap>();
  for (const m of maps) {
    if (seenIds.has(gameMapId(m))) add('error', m, 0, 0, `Two maps use the game id "${gameMapId(m)}".`);
    seenIds.set(gameMapId(m), m);
  }
  const overworld = maps.find((m) => gameKind(m) === 'overworld');

  // Spawn point: exactly one, on the overworld, walkable, in the Safe zone.
  const spawns: { map: WorldMap; f: Feature }[] = [];
  for (const m of maps) for (const f of m.features) if (f.type === 'spawn_point') spawns.push({ map: m, f });
  if (!overworld) {
    if (maps.length) add('error', maps[0], 0, 0, 'There is no overworld map (a map that is not a dungeon floor).');
  } else if (!spawns.some((s) => s.map === overworld)) {
    add('error', overworld, Math.floor(overworld.width / 2), Math.floor(overworld.height / 2), 'No spawn point: place one where new players start.');
  }
  const owSpawns = spawns.filter((s) => s.map === overworld);
  for (const { map, f } of spawns) {
    if (map !== overworld) add('error', map, f.c, f.r, `Spawn point ${at(f)} is not on the overworld.`);
    else if (owSpawns.length > 1) add('error', map, f.c, f.r, `${owSpawns.length} spawn points: keep exactly one ${at(f)}.`);
    const i = f.r * map.width + f.c;
    if (!isWalkable(map, i)) add('error', map, f.c, f.r, `Spawn point ${at(f)} is on a tile you can't walk on.`);
    else if (zoneAt(map, i)?.key !== 'safe') add('error', map, f.c, f.r, `Spawn point ${at(f)} is not in the Safe zone.`);
  }

  // Links between maps.
  const linksOf = (m: WorldMap) => m.features.filter((f) => f.type === 'link');
  const arrivals = new Map<WorldMap, { x: number; y: number }[]>();
  for (const m of maps) {
    for (const f of linksOf(m)) {
      const p = placeProps(f);
      const dir = stairsDirection(m.layers.object[f.r * m.width + f.c]);
      if (!dir) add('error', m, f.c, f.r, `Link ${at(f)} is not on a crypt entrance or stairs.`);
      const target = findGameMap(project, p.toMap);
      if (!target) {
        add('error', m, f.c, f.r, p.toMap ? `Link ${at(f)} goes to "${p.toMap}", which isn't a map in this project.` : `Link ${at(f)} has no target map.`);
        continue;
      }
      const tx = Number(p.toX);
      const ty = Number(p.toY);
      if (!isWalkableAt(target, tx, ty)) {
        add('error', m, f.c, f.r, `Link ${at(f)} arrives on (${tx}, ${ty}) on ${gameMapId(target)}, which you can't walk on.`);
      } else {
        arrivals.set(target, [...(arrivals.get(target) ?? []), { x: tx, y: ty }]);
      }
      if (dir) {
        const back = dir === 'down' ? 'up' : 'down';
        const paired = linksOf(target).some(
          (g) => placeProps(g).toMap === gameMapId(m) && stairsDirection(target.layers.object[g.r * target.width + g.c]) === back,
        );
        if (!paired) {
          add(
            'error',
            m,
            f.c,
            f.r,
            `Stairs ${dir} ${at(f)} lead to ${gameMapId(target)}, but no stairs ${back} on ${gameMapId(target)} lead back to ${gameMapId(m)}.`,
          );
        }
      }
    }
  }

  for (const m of maps) {
    const w = m.width;
    const L = m.layers;
    const linked = new Set(linksOf(m).map((f) => f.r * w + f.c));

    // Every entrance and staircase needs a link.
    for (let i = 0; i < L.object.length; i++) {
      if (stairsDirection(L.object[i]) && !linked.has(i)) {
        add('error', m, i % w, Math.floor(i / w), `${objectDef(L.object[i])!.name} (${i % w}, ${Math.floor(i / w)}) has no link: place a Stairs link on it.`);
      }
    }

    // Stations and fishing spots must be usable from a tile you can walk to.
    const starts = m === overworld ? owSpawns.map((s) => ({ x: s.f.c, y: s.f.r })) : arrivals.get(m) ?? [];
    const reached = reachable(m, starts);
    for (let i = 0; i < L.object.length; i++) {
      const d = objectDef(L.object[i]);
      if (!d || (d.group !== 'station' && d.group !== 'fishing')) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      const usable = NEIGHBOURS.some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < w && ny < m.height && reached[ny * w + nx] === 1;
      });
      if (!usable) {
        const from = m === overworld ? 'the spawn point' : 'where players arrive';
        add('error', m, x, y, `${d.name} (${x}, ${y}) has no walkable neighbour that can be reached from ${from}.`);
      }
    }

    // Monsters: never in the Safe zone, never on a tile you can't walk on.
    for (const f of m.features) {
      if (f.type !== 'monster_spawn' && f.type !== 'boss') continue;
      const i = f.r * w + f.c;
      const kind = String(placeProps(f).kind);
      const label = f.type === 'boss' ? 'Boss' : 'Monster spawn';
      if (!MONSTER_KINDS.some((k) => k.key === kind)) add('error', m, f.c, f.r, `${label} ${at(f)} has an unknown monster "${kind}".`);
      if (!isWalkable(m, i)) add('error', m, f.c, f.r, `${label} ${at(f)} is on a tile you can't walk on.`);
      else if (zoneAt(m, i)?.key === 'safe') add('error', m, f.c, f.r, `${label} ${at(f)} is in the Safe zone.`);
    }

    // Zones: every overworld cell, or one zone for a whole dungeon floor.
    if (gameKind(m) === 'overworld') {
      let missing = 0;
      let first = -1;
      for (let i = 0; i < L.zone.length; i++) {
        if (L.zone[i] >= 1 && L.zone[i] <= 4) continue;
        missing++;
        if (first < 0) first = i;
      }
      if (missing) add('error', m, first % w, Math.floor(first / w), `${missing} cell(s) have no zone, starting at (${first % w}, ${Math.floor(first / w)}).`);
    } else if (!mapZone(m)) {
      add('error', m, 0, 0, 'This dungeon floor has no zone: choose one under Map.');
    }

    // Ground and objects the game doesn't have are exported as the closest thing it does.
    let odd = 0;
    let oddAt = -1;
    for (let i = 0; i < L.terrain.length; i++) {
      if (isGameGround(L.terrain[i]) && gameObject(L.object[i]) === L.object[i]) continue;
      odd++;
      if (oddAt < 0) oddAt = i;
    }
    if (odd) {
      const g = ['grass', 'path', 'water', 'town floor', 'crypt floor', 'crypt wall'][gameGround(L.terrain[oddAt])];
      add('warning', m, oddAt % w, Math.floor(oddAt / w), `${odd} cell(s) use ground or objects the game doesn't have; they export as the closest game ground (first one exports as ${g}).`);
    }

    const want = gameKind(m) === 'overworld' ? OVERWORLD_SIZE : DUNGEON_SIZE;
    if (m.width !== want || m.height !== want) {
      add('warning', m, 0, 0, `The game expects ${gameKind(m) === 'overworld' ? 'the overworld' : 'crypt floors'} to be ${want}×${want}; this map is ${m.width}×${m.height}.`);
    }
  }

  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}
