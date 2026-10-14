/**
 * "Check for game": problems that would stop RPG-DC loading or playing a map correctly.
 * Every issue names a tile so the editor can jump to it.
 */
import { O, objectDef } from '../objects';
import { T, tile } from '../tiles';
import type { Feature, Project, WorldMap } from '../types';
import {
  ARENA_MAP_ID,
  BACK,
  BUILDING_SIZES,
  FERRY_FARE,
  FERRY_NAME_MAX,
  FORT_ID,
  FORT_RADIUS,
  LANDMARK_ID,
  LANDMARK_NAME_MAX,
  LANDMARK_RADIUS,
  landmarkAt,
  landmarks,
  GROUND_LEGEND,
  GROUND_TILES,
  ITEM_ID,
  KEY_ITEMS,
  doorLocks,
  ferries,
  fortChest,
  leverWires,
  BUILDING_STYLES,
  DUNGEON_THEMES,
  mapTheme,
  MONSTER_KINDS,
  NEIGHBOURS,
  NPC_ROLES,
  PLOT_ID,
  PLOT_SIZES,
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
  walkableGround,
  walkableTiles,
  isWalkable,
  isWalkableAt,
  mapZone,
  placeProps,
  passableTiles,
  plotSizeOk,
  plots,
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

/** The smallest and biggest overworld the game takes: square, 128 to 1024 tiles a side (OVERWORLD_MAX in its map.ts). */
export const OVERWORLD_SIZE = 128;
export const OVERWORLD_MAX = 1024;
/** Sizes the game takes, per kind of map: [smallest, largest] a side (the overworld square). */
export const SIZES = { overworld: [OVERWORLD_SIZE, OVERWORLD_MAX], dungeon: [16, 64], interior: [4, 32] } as const;

/** Out of town: any zone but Safe. */
const WILD = ['frontier', 'wilderness', 'deep'];
/**
 * Where each herb belongs, as the game places them (HERB_PATCHES in its herbs.ts): the
 * heartland's herbs on grass in their zones, the new lands' each on its own land's ground,
 * anywhere out of town. (Its counts and distances from the spawn point only steer the game's own
 * scattering, on an overworld without herbs placed here.)
 */
const HERBS: Record<number, { name: string; ground: number; zones: string[] }> = {
  [O.HERB_SUNLEAF]: { name: 'Sunleaf', ground: T.GRASS, zones: ['frontier'] },
  [O.HERB_SILVERWEED]: { name: 'Silverweed', ground: T.GRASS, zones: ['frontier'] },
  [O.HERB_THORNBERRY]: { name: 'Thornberry', ground: T.GRASS, zones: ['wilderness'] },
  [O.HERB_NIGHTSHADE]: { name: 'Nightshade', ground: T.GRASS, zones: ['wilderness'] },
  [O.HERB_EMBERBLOOM]: { name: 'Emberbloom', ground: T.GRASS, zones: ['deep'] },
  [O.HERB_DUNEFLOWER]: { name: 'Duneflower', ground: T.SAND, zones: WILD },
  [O.HERB_BOGMYRTLE]: { name: 'Bog myrtle', ground: T.MUD, zones: WILD },
  [O.HERB_FROSTCAP]: { name: 'Frostcap', ground: T.SNOW, zones: WILD },
};
/** What the game draws as a tree (a thicket looks like the trees round it, and palms are see-through like trees), which can hide what's near it. */
const TREES = new Set<number>([O.TREE, O.OAK, O.WILLOW, O.YEW, O.THICKET, O.PALM]);
/**
 * Objects used from a tile beside them, which must be one players can walk to (and caches and
 * levers, below): stations and workbenches, fishing spots, altars, waystones and boats, and
 * Farming's patches (the game's STATIONS and FISHING).
 */
const USED_FROM_BESIDE = new Set(['station', 'fishing', 'altar', 'travel', 'farm']);
const groundName = (t: number) => tile(t).name.toLowerCase();
/** "a boulder", "an allotment": an object's name in a sentence. */
const anObject = (name: string) => `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name.charAt(0).toLowerCase()}${name.slice(1)}`;

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
    // The cells with something standing on them (on a big map, far fewer than all its cells).
    const things: number[] = [];
    for (let i = 0; i < L.object.length; i++) if (L.object[i]) things.push(i);

    // Every entrance and staircase needs a link.
    for (const i of things) {
      if (stairsDirection(L.object[i]) && !linked.has(i)) {
        add('error', m, i % w, Math.floor(i / w), `${objectDef(L.object[i])!.name} (${i % w}, ${Math.floor(i / w)}) has no link: place a link on it.`);
      }
    }

    // Stairs are drawn on the floor, so a wall just in front of them on screen (east, south or
    // south-east), even a low one, hides them; the game's own tests refuse that.
    if (gameKind(m) === 'dungeon') {
      for (const f of linksOf(m)) {
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) {
          const x = f.c + dx;
          const y = f.r + dy;
          if (x < w && y < m.height && L.terrain[y * w + x] === T.CRYPT_WALL) {
            add('error', m, f.c, f.r, `The stairs ${at(f)} are hidden behind the wall at (${x}, ${y}): the game draws stairs on the floor, so a wall east, south or south-east of them covers them. Move the stairs or the wall.`);
            break;
          }
        }
      }
    }

    // Stations, altars, waystones, boats, caches, levers, fishing spots and Farming's patches must
    // be usable from a tile you can walk to (thickets are walked through, so a glade behind one is
    // reachable, and patches walked over; players open gates and locked doors, so they count as
    // open too, as in the game's checks; and from beside a boat they can sail where its ferry lands).
    const starts = m === overworld ? owSpawns.map((s) => ({ x: s.f.c, y: s.f.r })) : arrivals.get(m) ?? [];
    const walk = walkableTiles(m);
    const walkAt = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < m.height && walk[y * w + x] === 1;
    const reached = reachable(m, starts, passableTiles(m, walk));
    for (const i of things) {
      const d = objectDef(L.object[i]);
      if (!d || (!USED_FROM_BESIDE.has(d.group) && L.object[i] !== O.CACHE && L.object[i] !== O.LEVER)) continue;
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

    // Guild forts: on the overworld, the yard all in the Deep, the banner and chest on open ground
    // players can reach, and (a warning) a palisade of fences round the yard with a gate in each side.
    for (const f of m.features) {
      if (f.type !== 'fort') continue;
      const p = placeProps(f);
      const id = String(p.id).trim();
      const name = String(p.name).trim();
      const label = `The fort ${name || id || at(f)}`;
      if (m !== overworld) {
        add('error', m, f.c, f.r, `${label} isn't on the overworld: forts stand in the Deep.`);
        continue;
      }
      if (!FORT_ID.test(id)) add('error', m, f.c, f.r, `${label} needs an id of lower-case letters, digits and _ (like deep_keep).`);
      else if (m.features.some((g) => g !== f && g.type === 'fort' && String(placeProps(g).id).trim() === id)) add('error', m, f.c, f.r, `Two forts use the id "${id}".`);
      if (!name || name.length > 40) add('error', m, f.c, f.r, `${label} needs a name of up to 40 letters.`);
      let shallow = -1;
      for (let y = f.r - FORT_RADIUS; y <= f.r + FORT_RADIUS && shallow < 0; y++) {
        for (let x = f.c - FORT_RADIUS; x <= f.c + FORT_RADIUS && shallow < 0; x++) {
          if (x < 0 || y < 0 || x >= w || y >= m.height || zoneAt(m, y * w + x)?.key !== 'deep') shallow = y * w + x;
        }
      }
      if (shallow >= 0) add('error', m, f.c, f.r, `${label}'s yard (${FORT_RADIUS} tiles round its banner) isn't all in the Deep.`);
      const chest = fortChest(f.c, f.r);
      for (const [what, t] of [['banner', { x: f.c, y: f.r }], ['chest', chest]] as const) {
        if (!isWalkableAt(m, t.x, t.y)) add('error', m, t.x, t.y, `${label}'s ${what} (${t.x}, ${t.y}) is on a tile you can't walk on.`);
        else if (!reached[t.y * w + t.x]) add('error', m, t.x, t.y, `${label}'s ${what} (${t.x}, ${t.y}) can't be reached from the spawn point.`);
      }
      const wall = FORT_RADIUS + 1;
      outer: for (let y = f.r - wall; y <= f.r + wall; y++) {
        for (let x = f.c - wall; x <= f.c + wall; x++) {
          const edge = Math.max(Math.abs(x - f.c), Math.abs(y - f.r)) === wall;
          const gate = Math.abs(x - f.c) <= 1 || Math.abs(y - f.r) <= 1;
          if (!edge || gate || (x >= 0 && y >= 0 && x < w && y < m.height && L.object[y * w + x] === O.FENCE)) continue;
          add('warning', m, x, y, `${label}'s palisade has a gap at (${x}, ${y}): fence the yard ${wall} tiles round the banner, leaving a 3-tile gate in the middle of each side.`);
          break outer;
        }
      }
    }

    // The travelling merchant: one spot, on the overworld, in town, where players can reach her.
    for (const f of m.features) {
      if (f.type !== 'merchant') continue;
      const i = f.r * w + f.c;
      if (m !== overworld) add('error', m, f.c, f.r, `The travelling merchant's spot ${at(f)} isn't on the overworld.`);
      else if (m.features.filter((g) => g.type === 'merchant').length > 1) add('error', m, f.c, f.r, `There's more than one spot for the travelling merchant: keep one ${at(f)}.`);
      else if (!isWalkable(m, i)) add('error', m, f.c, f.r, `The travelling merchant ${at(f)} stands on a tile you can't walk on.`);
      else if (zoneAt(m, i)?.key !== 'safe') add('error', m, f.c, f.r, `The travelling merchant's spot ${at(f)} isn't in the Safe zone.`);
      else if (!talkSpots(m, f.c, f.r).some((t) => reached[t.y * w + t.x])) add('error', m, f.c, f.r, `Players can't reach the travelling merchant ${at(f)} from the spawn point.`);
    }

    // Plots of land (the game's land.ts, and what it won't load): on the overworld, with an id used
    // by no other plot and a size of 12 or 20, not running off the map; then, as the game's
    // checkMaps (the first problem it finds for each): out of the Safe zone, every tile open ground
    // players can walk on and reach (nothing standing on it), no door or stairs, townsperson,
    // monster spawn, fort or the merchant on it, and not overlapping another plot.
    const land = plots(m);
    land.forEach((p, k) => {
      const f = p.feature;
      const label = `The plot ${p.id || at(f)}`;
      if (m !== overworld) {
        add('error', m, p.x, p.y, `${label} isn't on the overworld: plots go on the overworld.`);
        return;
      }
      const before = land.slice(0, k).find((o) => o.id === p.id);
      if (!PLOT_ID.test(p.id)) add('error', m, p.x, p.y, `${label} needs an id of lower-case letters, digits and _ (like plot_mere).`);
      else if (before) add('error', m, p.x, p.y, `${label} ${at(f)}: there's already a plot called ${p.id}, at (${before.x}, ${before.y}).`);
      if (!plotSizeOk(p.size)) {
        add('error', m, p.x, p.y, `${label}'s size must be ${PLOT_SIZES.join(' or ')} (tiles a side).`);
        return;
      }
      if (p.x + p.size > w || p.y + p.size > m.height) {
        add('error', m, p.x, p.y, `${label} runs off the map.`);
        return;
      }
      let problem: string | null = null;
      for (let y = p.y; y < p.y + p.size && !problem; y++) {
        for (let x = p.x; x < p.x + p.size && !problem; x++) {
          const i = y * w + x;
          const thing = objectDef(L.object[i]);
          if (zoneAt(m, i)?.key === 'safe') problem = `reaches into the Safe zone at (${x}, ${y}): plots are out in the wilds`;
          else if (thing) problem = `has ${anObject(thing.name)} on it at (${x}, ${y}): a plot must be open ground`;
          else if (!walk[i]) problem = `has ground you can't walk on at (${x}, ${y})`;
          else if (!reached[i]) problem = `can't be reached from the spawn point at (${x}, ${y})`;
        }
      }
      const inside = (t: Feature) => t.c >= p.x && t.r >= p.y && t.c < p.x + p.size && t.r < p.y + p.size;
      const what = (t: Feature) => {
        const q = placeProps(t);
        if (t.type === 'link') return 'a door or stairs';
        if (t.type === 'npc') return `the ${String(q.role).replace(/_/g, ' ')}`;
        if (t.type === 'monster_spawn') return `a ${String(q.kind).replace(/_/g, ' ')} spawn`;
        if (t.type === 'fort') return `the fort ${String(q.id).trim()}`;
        return 'the travelling merchant';
      };
      const onIt = ['link', 'npc', 'monster_spawn', 'fort', 'merchant']
        .flatMap((type) => m.features.filter((t) => t.type === type))
        .find(inside);
      if (!problem && onIt) problem = `has ${what(onIt)} on it at (${onIt.c}, ${onIt.r})`;
      const other = land.find((q) => q !== p && plotSizeOk(q.size) && q.x < p.x + p.size && p.x < q.x + q.size && q.y < p.y + p.size && p.y < q.y + q.size);
      if (!problem && other) problem = `overlaps the plot ${other.id || at(other.feature)}`;
      if (problem) add('error', m, p.x, p.y, `${label} ${problem}.`);
    });

    // Landmarks (the game's landmarks.ts): on the overworld, with an id, a name and a radius the game
    // takes (it won't load the maps otherwise).
    const marks = landmarks(m);
    marks.forEach((l, k) => {
      const f = l.feature;
      const label = `The landmark ${l.name || l.id || at(f)}`;
      if (m !== overworld) {
        add('error', m, f.c, f.r, `${label} isn't on the overworld: landmarks go on the overworld.`);
        return;
      }
      const before = marks.slice(0, k).find((o) => o.id === l.id);
      if (!LANDMARK_ID.test(l.id)) add('error', m, f.c, f.r, `${label} needs an id of lower-case letters, digits and _ (like hermit_lake).`);
      else if (before) add('error', m, f.c, f.r, `${label} ${at(f)}: there's already a landmark called ${l.id}, at (${before.x}, ${before.y}).`);
      if (!l.name || l.name.length > LANDMARK_NAME_MAX) add('error', m, f.c, f.r, `${label} needs a name of up to ${LANDMARK_NAME_MAX} letters.`);
      const { min, max } = LANDMARK_RADIUS;
      if (!Number.isInteger(l.radius) || l.radius < min || l.radius > max) add('error', m, f.c, f.r, `${label}'s radius must be a whole number from ${min} to ${max}.`);
    });

    // Waystones: on the overworld, each in a landmark (within its radius; where landmarks overlap,
    // the one with the nearest middle) outside the Deep, and one to a landmark: the game uses the
    // first it finds, scanning rows from the top.
    const stones = new Map<string, { x: number; y: number }>();
    for (const i of things) {
      if (L.object[i] !== O.WAYSTONE) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      const l = m === overworld ? landmarkAt(marks, x, y) : null;
      const first = l && stones.get(l.id);
      const name = l && (l.name || l.id);
      if (m !== overworld) add('error', m, x, y, `Waystone (${x}, ${y}) isn't on the overworld: waystones go on the overworld.`);
      else if (!l) add('error', m, x, y, `Waystone (${x}, ${y}) isn't in a landmark: put a landmark place round it.`);
      else if (first) add('error', m, x, y, `A second waystone in ${name} (${x}, ${y}): the first is at (${first.x}, ${first.y}).`);
      else if (zoneAt(m, i)?.key === 'deep') add('error', m, x, y, `The waystone in ${name} (${x}, ${y}) is in the Deep, where waystones don't work.`);
      if (l && !first) stones.set(l.id, { x, y });
    }

    // Gates and levers (the game's gates.ts): every lever place on a lever, wired to a gate on this
    // map (once); every gate wired to a lever, and every lever to a gate. Locked doors: each has a
    // lock naming its key (an item; the game refuses a lock with any other), and locks are on locked
    // doors.
    const wires = leverWires(m);
    const objectOn = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < m.height ? L.object[y * w + x] : 0);
    wires.forEach((l, k) => {
      if (objectOn(l.x, l.y) !== O.LEVER) add('error', m, l.x, l.y, `The lever place (${l.x}, ${l.y}) isn't on a lever: put it on a Lever object.`);
      if (objectOn(l.toX, l.toY) !== O.GATE) add('error', m, l.x, l.y, `The lever (${l.x}, ${l.y}) is wired to (${l.toX}, ${l.toY}), which isn't a gate: pick the gate it opens.`);
      else if (wires.slice(0, k).some((o) => o.x === l.x && o.y === l.y && o.toX === l.toX && o.toY === l.toY)) add('error', m, l.x, l.y, `The lever (${l.x}, ${l.y}) is wired to the gate at (${l.toX}, ${l.toY}) twice: keep one of the two places.`);
    });
    const locks = doorLocks(m);
    locks.forEach((l, k) => {
      const label = `The lock (${l.x}, ${l.y})`;
      if (objectOn(l.x, l.y) !== O.LOCKED_DOOR) add('error', m, l.x, l.y, `${label} isn't on a locked door: put it on a Locked door object.`);
      else if (locks.slice(0, k).some((o) => o.x === l.x && o.y === l.y)) add('error', m, l.x, l.y, `${label}: there's already a lock on this door.`);
      if (!ITEM_ID.test(l.key)) add('error', m, l.x, l.y, `${label} needs a key: the id of an item in the game, like ${KEY_ITEMS[0].value}.`);
      else if (!KEY_ITEMS.some((key) => key.value === l.key)) {
        add('warning', m, l.x, l.y, `${label} wants "${l.key}", which isn't a key World Builder knows (${KEY_ITEMS.map((key) => key.value).join(', ')}): the game won't load a lock whose key isn't one of its items, so check it has one called that.`);
      }
    });
    // Ferries (the game's checks, and what it won't load): each ferry place on a boat, one to a
    // boat, landing on a tile of this map players can walk on, for a whole number of coins, with a
    // name (where it goes); and every boat has its ferry.
    const sailings = ferries(m);
    sailings.forEach((f, k) => {
      const label = `The ferry ${f.name ? `to ${f.name} ` : ''}(${f.x}, ${f.y})`;
      if (objectOn(f.x, f.y) !== O.BOAT) add('error', m, f.x, f.y, `${label} isn't on a boat: put it on a Ferry boat object.`);
      else if (sailings.slice(0, k).some((o) => o.x === f.x && o.y === f.y)) add('error', m, f.x, f.y, `${label}: there's already a ferry from this boat.`);
      if (!Number.isInteger(f.toX) || !Number.isInteger(f.toY) || !isWalkableAt(m, f.toX, f.toY)) {
        add('error', m, f.x, f.y, `${label} lands on (${f.toX}, ${f.toY}), which you can't walk on: pick where it lands.`);
      }
      if (!Number.isInteger(f.fare) || f.fare < FERRY_FARE.min || f.fare > FERRY_FARE.max) {
        add('error', m, f.x, f.y, `${label}'s fare must be a whole number of coins from ${FERRY_FARE.min} to ${FERRY_FARE.max}.`);
      }
      if (!f.name || f.name.length > FERRY_NAME_MAX) add('error', m, f.x, f.y, `${label} needs a name: where it goes, in up to ${FERRY_NAME_MAX} letters.`);
    });
    for (const i of things) {
      const o = L.object[i];
      if (o !== O.GATE && o !== O.LEVER && o !== O.LOCKED_DOOR && o !== O.BOAT) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      if (o === O.GATE && !wires.some((l) => l.toX === x && l.toY === y)) add('error', m, x, y, `Gate (${x}, ${y}) has no lever to open it: put a lever place on a Lever and point it at this gate.`);
      if (o === O.LEVER && !wires.some((l) => l.x === x && l.y === y)) add('error', m, x, y, `Lever (${x}, ${y}) isn't wired to a gate: put a lever place on it and point it at the gate it opens.`);
      if (o === O.LOCKED_DOOR && !locks.some((l) => l.x === x && l.y === y)) add('error', m, x, y, `Locked door (${x}, ${y}) has no lock: put a lock place on it, naming the key that opens it.`);
      if (o === O.BOAT && !sailings.some((f) => f.x === x && f.y === y)) add('error', m, x, y, `Boat (${x}, ${y}) has no ferry place: put a ferry place on it, saying where it sails.`);
    }

    // Thickets (a warning): the game lets players push through one wherever it stands, so one on
    // water or a wall is a way across it.
    for (const i of things) {
      if (L.object[i] !== O.THICKET || walkableGround(L.terrain[i])) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      add('warning', m, x, y, `Thicket (${x}, ${y}) is on ${groundName(L.terrain[i])}: players can walk through a thicket wherever it stands, so they can cross the ${groundName(L.terrain[i])} there.`);
    }

    // The Duel Arena: duellists fight in its pits, the places you can stand that can't be walked to
    // from its door, so it needs at least one, big enough for two.
    if (gameMapId(m) === ARENA_MAP_ID && starts.length) {
      const pits: number[] = [];
      const inPit = new Uint8Array(L.terrain.length);
      for (let i = 0; i < L.terrain.length; i++) {
        if (reached[i] || inPit[i] || !walk[i]) continue;
        const pit = reachable(m, [{ x: i % w, y: Math.floor(i / w) }], walk);
        let size = 0;
        pit.forEach((v, j) => { if (v) { inPit[j] = 1; size++; } });
        pits.push(size);
        if (size < 2) add('warning', m, i % w, Math.floor(i / w), `The pit at (${i % w}, ${Math.floor(i / w)}) has room for only one: duels need two.`);
      }
      if (!pits.length) add('warning', m, starts[0].x, starts[0].y, 'The Duel Arena has no pit: fence or wall off a space players can\'t walk into from the door, for the game to put duellists in.');
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

    // Wild herbs (warnings): in their zones, reachable, not blocking a path, not hidden by trees.
    // (Farming's herb patches aren't wild herbs: the game counts only its eight herb_ objects.)
    if (m === overworld) {
      const herbs: number[] = [];
      for (const i of things) if (HERBS[L.object[i]]) herbs.push(i);
      if (herbs.length) {
        const x0 = herbs[0] % w;
        const y0 = Math.floor(herbs[0] / w);
        add('warning', m, x0, y0, `This overworld has ${herbs.length} wild herb(s): the game uses just these and stops scattering its own.`);
      }
      for (const i of herbs) {
        const x = i % w;
        const y = Math.floor(i / w);
        const herb = HERBS[L.object[i]];
        const zone = zoneAt(m, i)?.key ?? '';
        if (!herb.zones.includes(zone)) {
          add('warning', m, x, y, `${herb.name} (${x}, ${y}) is in the ${zone || 'no'} zone; it grows ${herb.zones === WILD ? 'anywhere out of town (not the Safe zone)' : `in the ${herb.zones.join(' or ')}`}.`);
        }
        if (L.terrain[i] !== herb.ground) add('warning', m, x, y, `${herb.name} (${x}, ${y}) is on ${groundName(L.terrain[i])}; it grows on ${groundName(herb.ground)}.`);
        const around = NEIGHBOURS.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < w && ny < m.height);
        if (!around.some(([nx, ny]) => reached[ny * w + nx])) add('warning', m, x, y, `${herb.name} (${x}, ${y}) can't be reached from the spawn point.`);
        else if (around.some(([nx, ny]) => !walkAt(nx, ny))) add('warning', m, x, y, `${herb.name} (${x}, ${y}) has a blocked tile next to it, so it might block a path.`);
        let tree = false;
        for (let dy = -2; dy <= 2 && !tree; dy++) for (let dx = -2; dx <= 2 && !tree; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          tree = nx >= 0 && ny >= 0 && nx < w && ny < m.height && TREES.has(L.object[ny * w + nx]);
        }
        if (tree) add('warning', m, x, y, `${herb.name} (${x}, ${y}) is within 2 tiles of a tree, which hides it in the game.`);
      }
    }

    // Runecrafting altars and essence rocks (warnings): out of town, and not hidden by trees, which
    // stand in front of them on screen and take the taps meant for them. Runite belongs in the Deep.
    for (const i of things) {
      const o = L.object[i];
      const d = objectDef(o);
      if (!d || (d.group !== 'altar' && o !== O.ESSENCE_ROCK && o !== O.RUNITE_ROCK)) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      const zone = zoneAt(m, i)?.key ?? '';
      if (o === O.RUNITE_ROCK) {
        if (zone !== 'deep') add('warning', m, x, y, `${d.name} (${x}, ${y}) is in the ${zone || 'no'} zone; the game keeps runite in the Deep.`);
        continue;
      }
      if (d.group === 'altar' && zone === 'safe') add('warning', m, x, y, `${d.name} (${x}, ${y}) is in the Safe zone; altars stand out in the wild, the better runes further out.`);
      let tree = false;
      for (let dy = -2; dy <= 2 && !tree; dy++) for (let dx = -2; dx <= 2 && !tree; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        tree = nx >= 0 && ny >= 0 && nx < w && ny < m.height && TREES.has(L.object[ny * w + nx]);
      }
      if (tree) add('warning', m, x, y, `${d.name} (${x}, ${y}) is within 2 tiles of a tree, which can hide it in the game and take the taps meant for it.`);
    }

    // Town guards stand at the gates of the Safe zone; without a gate there are none.
    if (m === overworld && owSpawns.length && !guardPosts(m, walk).posts.length) {
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
      if (!(walk[i] ?? isWalkable(m, i))) add('error', m, f.c, f.r, `${label} ${at(f)} is on a tile you can't walk on.`);
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
    const gameGrounds = new Set<number>(GROUND_TILES);
    for (let i = 0; i < L.terrain.length; i++) {
      if (gameGrounds.has(L.terrain[i]) && gameObject(L.object[i]) === L.object[i]) continue;
      odd++;
      if (oddAt < 0) oddAt = i;
    }
    if (odd) {
      const g = GROUND_LEGEND[gameGround(L.terrain[oddAt])].replace('_', ' ');
      add('warning', m, oddAt % w, Math.floor(oddAt / w), `${odd} cell(s) use ground or objects the game doesn't have; they export as the closest game ground (first one exports as ${g}).`);
    }

    // Sizes: the overworld square, 128 to 1024 tiles a side; dungeon floors and insides within theirs.
    const kind = gameKind(m);
    const [min, max] = SIZES[kind];
    const square = kind !== 'overworld' || m.width === m.height;
    if (!square || m.width < min || m.height < min || m.width > max || m.height > max) {
      const what = kind === 'overworld' ? 'the overworld to be square,' : kind === 'dungeon' ? 'dungeon floors to be' : "buildings' insides to be";
      add('error', m, 0, 0, `The game needs ${what} ${min} to ${max} tiles a side; this map is ${m.width}×${m.height}.`);
    }
  }

  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}
