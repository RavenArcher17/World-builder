/**
 * "Check for game": problems that would stop RPG-DC loading or playing a map correctly.
 * Every issue names a tile so the editor can jump to it.
 */
import { O, objectDef } from '../objects';
import type { Feature, Project, WorldMap } from '../types';
import {
  BACK,
  BUILDING_SIZES,
  BUILDING_STYLES,
  DUNGEON_THEMES,
  mapTheme,
  MONSTER_KINDS,
  NEIGHBOURS,
  NPC_ROLES,
  ROOF_COLOURS,
  WALL_COLOURS,
  buildingSizeOk,
  buildings,
  doorFace,
  talkSpots,
  findGameMap,
  gameGround,
  gameKind,
  gameMapId,
  gameMaps,
  gameObject,
  guardPosts,
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
/** Sizes the game takes for dungeon floors and building insides: [smallest, largest] a side. */
export const SIZES = { dungeon: [16, 64], interior: [4, 32] } as const;

/** Where each herb belongs, as the game places them. */
const HERB_ZONES: Record<number, { name: string; zones: string[] }> = {
  [O.HERB_SUNLEAF]: { name: 'Sunleaf', zones: ['frontier'] },
  [O.HERB_SILVERWEED]: { name: 'Silverweed', zones: ['frontier'] },
  [O.HERB_THORNBERRY]: { name: 'Thornberry', zones: ['wilderness'] },
  [O.HERB_NIGHTSHADE]: { name: 'Nightshade', zones: ['wilderness'] },
  [O.HERB_EMBERBLOOM]: { name: 'Emberbloom', zones: ['deep'] },
};
const TREES = new Set<number>([O.TREE, O.OAK, O.WILLOW]);

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
  const overworlds = maps.filter((m) => gameKind(m) === 'overworld');
  const overworld = overworlds[0];
  for (const m of overworlds.slice(1)) add('error', m, 0, 0, `There's more than one overworld: ${gameMapId(m)} should be a dungeon floor or a building's inside.`);

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
      if (!dir) add('error', m, f.c, f.r, `Link ${at(f)} is not on a crypt entrance, stairs, a door or a sewer grate.`);
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
        const back = BACK[dir];
        const paired = linksOf(target).some(
          (g) => placeProps(g).toMap === gameMapId(m) && stairsDirection(target.layers.object[g.r * target.width + g.c]) === back,
        );
        if (!paired) {
          add(
            'error',
            m,
            f.c,
            f.r,
            dir === 'door'
              ? `The door ${at(f)} leads into ${gameMapId(target)}, but no door on ${gameMapId(target)} leads back to ${gameMapId(m)}.`
              : `Stairs ${dir} ${at(f)} lead to ${gameMapId(target)}, but no stairs ${back} on ${gameMapId(target)} lead back to ${gameMapId(m)}.`,
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
        add('error', m, i % w, Math.floor(i / w), `${objectDef(L.object[i])!.name} (${i % w}, ${Math.floor(i / w)}) has no link: place a link on it.`);
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

    // Townspeople: on open floor, where players can walk up to them or talk across a counter.
    for (const f of m.features) {
      if (f.type !== 'npc') continue;
      const role = String(placeProps(f).role);
      if (!NPC_ROLES.some((r) => r.value === role)) add('error', m, f.c, f.r, `Townsperson ${at(f)} has an unknown role "${role}".`);
      if (!isWalkableAt(m, f.c, f.r)) add('error', m, f.c, f.r, `Townsperson ${at(f)} stands on a tile you can't walk on.`);
      else if (!talkSpots(m, f.c, f.r).some((t) => reached[t.y * w + t.x])) {
        add('error', m, f.c, f.r, `Players can't reach townsperson ${at(f)} from ${m === overworld ? 'the spawn point' : 'where they arrive'}, or talk to them across a counter.`);
      }
    }

    // Buildings: a size there's art for, and a door the camera can see.
    for (const b of buildings(m)) {
      const where = `(${b.x}, ${b.y})`;
      const name = b.sign ? `${b.sign} ${where}` : `The building ${where}`;
      if (!BUILDING_STYLES.some((s) => s.value === b.style)) add('error', m, b.x, b.y, `${name} has an unknown style "${b.style}".`);
      else if (!buildingSizeOk(b.style, b.w, b.h)) {
        const { min, max, towerMin, towerMax } = BUILDING_SIZES;
        add('error', m, b.x, b.y, b.style === 'tower' ? `${name}: towers are square, ${towerMin} to ${towerMax} tiles a side.` : `${name}: buildings are ${min} to ${max} tiles a side.`);
      }
      if (b.x + b.w > w || b.y + b.h > m.height) add('error', m, b.x, b.y, `${name} runs off the map.`);
      if (b.roof && !ROOF_COLOURS.some((c) => c.value === b.roof)) add('error', m, b.x, b.y, `${name} has an unknown roof colour "${b.roof}".`);
      if (b.walls && !WALL_COLOURS.some((c) => c.value === b.walls)) add('error', m, b.x, b.y, `${name} has an unknown wall colour "${b.walls}".`);
      let doors = 0;
      for (let y = b.y; y < Math.min(b.y + b.h, m.height); y++) {
        for (let x = b.x; x < Math.min(b.x + b.w, w); x++) {
          if (L.object[y * w + x] !== O.DOOR) continue;
          doors++;
          if (!doorFace(b, x, y)) add('error', m, x, y, `${name} has a door at (${x}, ${y}) the camera can't see: doors go in the south or east wall, not on a corner.`);
        }
      }
      if (!doors) add('error', m, b.x, b.y, `${name} has no door: put a Door object in its south or east wall.`);
    }

    // Herbs (warnings): in their zones, reachable, not blocking a path, not hidden by trees.
    if (m === overworld) {
      const herbs: number[] = [];
      for (let i = 0; i < L.object.length; i++) if (HERB_ZONES[L.object[i]]) herbs.push(i);
      if (herbs.length) {
        const x0 = herbs[0] % w;
        const y0 = Math.floor(herbs[0] / w);
        add('warning', m, x0, y0, `This overworld has ${herbs.length} herb patch(es): the game uses just these and stops scattering its own.`);
      }
      for (const i of herbs) {
        const x = i % w;
        const y = Math.floor(i / w);
        const herb = HERB_ZONES[L.object[i]];
        const zone = zoneAt(m, i)?.key ?? '';
        if (!herb.zones.includes(zone)) add('warning', m, x, y, `${herb.name} (${x}, ${y}) is in the ${zone || 'no'} zone; it grows in the ${herb.zones.join(' or ')}.`);
        const around = NEIGHBOURS.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < w && ny < m.height);
        if (!around.some(([nx, ny]) => reached[ny * w + nx])) add('warning', m, x, y, `${herb.name} (${x}, ${y}) can't be reached from the spawn point.`);
        else if (around.some(([nx, ny]) => !isWalkableAt(m, nx, ny))) add('warning', m, x, y, `${herb.name} (${x}, ${y}) has a blocked tile next to it, so it might block a path.`);
        let tree = false;
        for (let dy = -2; dy <= 2 && !tree; dy++) for (let dx = -2; dx <= 2 && !tree; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          tree = nx >= 0 && ny >= 0 && nx < w && ny < m.height && TREES.has(L.object[ny * w + nx]);
        }
        if (tree) add('warning', m, x, y, `${herb.name} (${x}, ${y}) is within 2 tiles of a tree, which hides it in the game.`);
      }
    }

    // Town guards stand at the gates of the Safe zone; without a gate there are none.
    if (m === overworld && owSpawns.length && !guardPosts(m).posts.length) {
      const s = owSpawns[0].f;
      add('warning', m, s.c, s.r, "The Safe zone has no gate (a walkable Safe tile beside a walkable tile outside it), so the game posts no town guards, and criminals come back at the spawn point.");
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

    // A theme (how a dungeon floor looks): only on dungeon floors, and one the game knows.
    const theme = mapTheme(m);
    if (theme && gameKind(m) !== 'dungeon') add('error', m, 0, 0, `Only dungeon floors have a look (theme); this map has "${theme}".`);
    else if (theme && !DUNGEON_THEMES.some((t) => t.value === theme)) add('error', m, 0, 0, `The look (theme) "${theme}" isn't one the game knows.`);

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
      add('error', m, 0, 0, `This ${gameKind(m) === 'interior' ? "building's inside" : 'dungeon floor'} has no zone: choose one under Map.`);
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
      const g = ['grass', 'path', 'water', 'town floor', 'crypt floor', 'crypt wall', 'planks'][gameGround(L.terrain[oddAt])];
      add('warning', m, oddAt % w, Math.floor(oddAt / w), `${odd} cell(s) use ground or objects the game doesn't have; they export as the closest game ground (first one exports as ${g}).`);
    }

    const kind = gameKind(m);
    if (kind === 'overworld') {
      if (m.width !== OVERWORLD_SIZE || m.height !== OVERWORLD_SIZE) {
        add('error', m, 0, 0, `The game needs the overworld to be ${OVERWORLD_SIZE}×${OVERWORLD_SIZE}; this map is ${m.width}×${m.height}.`);
      }
    } else {
      const [min, max] = SIZES[kind];
      if (m.width < min || m.height < min || m.width > max || m.height > max) {
        add('error', m, 0, 0, `The game needs ${kind === 'dungeon' ? 'dungeon floors' : "buildings' insides"} to be ${min} to ${max} tiles a side; this map is ${m.width}×${m.height}.`);
      }
    }
  }

  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}
