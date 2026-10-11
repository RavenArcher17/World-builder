/**
 * Keeps in storeys (a 3D map): a walled keep of rooms on the ground storey, a tower of storeys
 * over one room and a crypt under the halls, joined by real staircases (three cells climbing
 * 0, 2 and 4 m to the floor above, the cells over them left open). Then a Great Stair entrance,
 * a hearth, lights, furniture by room, and enemies, chests and traps whose tier rises with the
 * distance from the entrance, and a boss at the top of the tower (or deep in the crypt).
 *
 * The layout follows Underkeep's rules for stairs and storeys, so a generated keep passes the
 * game's own checks (underkeep/checks.ts) and exports straight to it; on any other square-grid
 * game it is simply a 3D dungeon in storeys.
 */
import { MAP3D_KEYS } from '../scene3d/options';
import { PROP } from '../scene3d/props';
import { emptyLayers3d } from '../scene3d/storeys';
import { O } from '../objects';
import { Rng } from '../rng';
import { SettingsReader } from '../settings';
import { T } from '../tiles';
import { type Feature, type Layers3d, type MapLayers, type MapSpec, type Room as NamedRoom, type Storey, type WorldMap, emptyLayers, newId } from '../types';

interface Rect {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

interface Room extends Rect {
  id: number;
  kind: string;
  name: string;
  depth: number;
}

interface Level {
  z: number;
  L: MapLayers;
  E: Layers3d;
  /** Cells nothing may be put on (stairs, stairwells, doorways, the cells in front of doorways). */
  reserved: Set<number>;
  /** Cells something stands on already (one thing per cell). */
  taken: Set<number>;
}

const HALL_KINDS = ['chapel', 'kitchen', 'barracks', 'armoury', 'library', 'storeroom', 'guardroom', 'kennels', 'bedchamber'];
const ROOM_NAMES: Record<string, string> = {
  hall: 'Great Hall',
  courtyard: 'Courtyard',
  tower: 'Tower Room',
  chapel: 'Chapel',
  kitchen: 'Kitchens',
  barracks: 'Barracks',
  armoury: 'Armoury',
  library: 'Library',
  storeroom: 'Storeroom',
  guardroom: 'Guardroom',
  kennels: 'Kennels',
  bedchamber: 'Bedchamber',
};
const CRYPT_NAMES = ['Crypt', 'Ossuary', 'Catacomb', 'Sepulchre', 'Undercroft', 'Charnel Room', 'Tomb', 'Vault'];
const ENEMIES: Record<string, string[]> = {
  hall: ['shieldman', 'halberdier'],
  barracks: ['shieldman', 'halberdier', 'shieldman'],
  guardroom: ['halberdier', 'shieldman'],
  armoury: ['halberdier', 'shieldman'],
  kitchen: ['rats'],
  storeroom: ['rats'],
  kennels: ['hound'],
  chapel: ['sexton'],
  library: ['shieldman', 'sexton'],
  bedchamber: ['shieldman'],
  courtyard: ['hound', 'shieldman'],
  tower: ['halberdier', 'shieldman'],
  crypt: ['sexton', 'swarm', 'crawler', 'rats', 'sexton'],
};

/** Generate a keep in storeys. Square and isometric grids only (stairs face north, east, south or west). */
export function generateKeep(spec: MapSpec): WorldMap {
  const S = new SettingsReader(spec.settings, 'dungeon', spec.scaleId);
  const rng = new Rng(spec.seed).fork('keep');
  const W = spec.width;
  const H = spec.height;
  const N = W * H;
  const at = (c: number, r: number) => r * W + c;
  const map: WorldMap = {
    id: newId('map'),
    name: spec.name,
    kind: 'dungeon',
    scaleId: spec.scaleId,
    grid: spec.grid,
    width: W,
    height: H,
    seed: spec.seed,
    settings: { ...spec.settings, [MAP3D_KEYS.on]: true, [MAP3D_KEYS.look]: 'blocks', [MAP3D_KEYS.tile]: 2, [MAP3D_KEYS.wall]: 4.5 },
    layers: emptyLayers(N),
    features: [],
    children: [],
  };
  const keep: Rect = { c0: 1, r0: 1, c1: W - 2, r1: H - 2 };
  const level = (z: number, L: MapLayers): Level => ({ z, L, E: emptyLayers3d(N), reserved: new Set(), taken: new Set() });

  // ---- rooms: split the keep's inside, walls one cell thick between rooms -------------------
  const minSide = 3 + Math.round(S.num('roomSize', 0.45) * 3);
  const maxArea = Math.round(160 - S.num('roomDensity', 0.55) * 110);
  const leaves: Rect[] = [];
  const split = (r: Rect, depth: number) => {
    const w = r.c1 - r.c0 + 1;
    const h = r.r1 - r.r0 + 1;
    const canV = w >= minSide * 2 + 1;
    const canH = h >= minSide * 2 + 1;
    if ((!canV && !canH) || (w * h <= maxArea && depth > 1 && rng.chance(0.6))) {
      leaves.push(r);
      return;
    }
    const vertical = canV && (!canH || w > h || (w === h && rng.chance(0.5)));
    if (vertical) {
      const s = rng.int(r.c0 + minSide, r.c1 - minSide);
      split({ ...r, c1: s - 1 }, depth + 1);
      split({ ...r, c0: s + 1 }, depth + 1);
    } else {
      const s = rng.int(r.r0 + minSide, r.r1 - minSide);
      split({ ...r, r1: s - 1 }, depth + 1);
      split({ ...r, r0: s + 1 }, depth + 1);
    }
  };
  split({ c0: keep.c0 + 1, r0: keep.r0 + 1, c1: keep.c1 - 1, r1: keep.r1 - 1 }, 0);
  const rooms: Room[] = leaves.map((r, id) => ({ ...r, id, kind: '', name: '', depth: 0 }));
  const area = (r: Rect) => (r.c1 - r.c0 + 1) * (r.r1 - r.r0 + 1);

  const hall = rooms.reduce((best, r) => (area(r) > area(best) && r.r1 - r.r0 >= 2 ? r : best), rooms[0]);
  // Room kinds: the hall, a tower over one room, a crypt stair in another, a courtyard, the rest.
  const tall = (r: Rect) => r.r1 - r.r0 + 1 >= 5;
  const wide = (r: Rect) => r.c1 - r.c0 + 1 >= 3;
  const corner = (r: Rect) => (r.c0 === keep.c0 + 1 || r.c1 === keep.c1 - 1) && (r.r0 === keep.r0 + 1 || r.r1 === keep.r1 - 1);
  hall.kind = 'hall';
  const towerWanted = Math.round(S.num('towerStoreys', 2));
  const cryptWanted = Math.round(S.num('cryptStoreys', 1));
  const towerRoom = towerWanted > 0 ? [...rooms].sort((a, b) => Number(corner(b)) - Number(corner(a)) || area(a) - area(b)).find((r) => r !== hall && tall(r) && wide(r)) : undefined;
  if (towerRoom) towerRoom.kind = 'tower';
  const cryptRoom = cryptWanted > 0 ? rooms.find((r) => r.kind === '' && tall(r) && (cryptWanted < 2 || wide(r))) ?? (hall !== towerRoom && tall(hall) ? hall : undefined) : undefined;
  const towers = towerRoom ? Math.min(towerWanted, 3) : 0;
  const crypts = cryptRoom ? Math.min(cryptWanted, wide(cryptRoom) ? 2 : 1) : 0;
  // The staircases' columns (tower: up from the ground storey; crypt: up from each crypt storey).
  // No doorway may open next to them, or it would lead into a stairwell's side or its hole.
  const stairColumn = new Set<number>();
  const column = (room: Rect, c: number) => {
    for (let r = room.r0; r <= room.r0 + 4; r++) stairColumn.add(at(c, r));
  };
  if (towers) column(towerRoom!, towerRoom!.c0);
  if (crypts >= 1) column(cryptRoom!, cryptRoom!.c0);
  if (crypts >= 2) column(cryptRoom!, cryptRoom!.c1);
  const nextToStairs = (i: number) => [1, -1, W, -W].some((d) => stairColumn.has(i + d));

  // Doors between rooms that share a wall: a spanning tree, then a few loops.
  interface Edge {
    a: number;
    b: number;
    cells: number[];
  }
  const edges: Edge[] = [];
  for (const a of rooms) {
    for (const b of rooms) {
      if (a.id >= b.id) continue;
      const cells: number[] = [];
      if (a.c1 + 2 === b.c0 || b.c1 + 2 === a.c0) {
        const c = a.c1 + 2 === b.c0 ? a.c1 + 1 : b.c1 + 1;
        for (let r = Math.max(a.r0, b.r0); r <= Math.min(a.r1, b.r1); r++) cells.push(at(c, r));
      } else if (a.r1 + 2 === b.r0 || b.r1 + 2 === a.r0) {
        const r = a.r1 + 2 === b.r0 ? a.r1 + 1 : b.r1 + 1;
        for (let c = Math.max(a.c0, b.c0); c <= Math.min(a.c1, b.c1); c++) cells.push(at(c, r));
      }
      if (cells.length) edges.push({ a: a.id, b: b.id, cells });
    }
  }
  const parent = rooms.map((r) => r.id);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const doors: Edge[] = [];
  const usable = (e: Edge) => e.cells.some((i) => !nextToStairs(i));
  for (const e of rng.shuffle([...edges]).sort((x, y) => Number(usable(y)) - Number(usable(x)))) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) {
      parent[ra] = rb;
      doors.push(e);
    } else if (rng.chance(S.num('loops', 0.3) * 0.5)) doors.push(e);
  }
  const doorCells = doors.map((e) => {
    const ok = e.cells.filter((i) => !nextToStairs(i));
    const from = ok.length ? ok : e.cells;
    return from[Math.floor(from.length / 2 + rng.range(-0.49, 0.49) * Math.max(0, from.length - 2))];
  });

  // Room depth: steps through doors from the Great Hall.
  const links = new Map<number, number[]>(rooms.map((r) => [r.id, []]));
  for (const e of doors) {
    links.get(e.a)!.push(e.b);
    links.get(e.b)!.push(e.a);
  }
  for (const r of rooms) r.depth = -1;
  hall.depth = 0;
  const queue = [hall];
  for (let k = 0; k < queue.length; k++) {
    for (const n of links.get(queue[k].id)!) {
      if (rooms[n].depth >= 0) continue;
      rooms[n].depth = queue[k].depth + 1;
      queue.push(rooms[n]);
    }
  }

  if (S.bool('courtyard', true)) {
    const yard = rooms.find((r) => r.kind === '' && r !== cryptRoom && area(r) >= 12);
    if (yard) yard.kind = 'courtyard';
  }
  const kinds = rng.shuffle([...HALL_KINDS]);
  let k = 0;
  for (const r of rooms) if (!r.kind) r.kind = kinds[k++ % kinds.length];
  for (const r of rooms) r.name = ROOM_NAMES[r.kind];

  // ---- storeys ---------------------------------------------------------------------------
  const ground = level(0, map.layers);
  map.layers3d = ground.E;
  const levels = new Map<number, Level>([[0, ground]]);
  const build = (lv: Level, which: Room[], floor: number, outside: number) => {
    lv.L.terrain.fill(outside);
    for (let r = keep.r0; r <= keep.r1; r++) for (let c = keep.c0; c <= keep.c1; c++) lv.L.terrain[at(c, r)] = T.WALL;
    for (const room of which) {
      for (let r = room.r0; r <= room.r1; r++) for (let c = room.c0; c <= room.c1; c++) {
        lv.L.terrain[at(c, r)] = room.kind === 'courtyard' && lv.z === 0 ? T.GRASS : floor;
        lv.E.roof[at(c, r)] = room.kind === 'courtyard' && lv.z === 0 ? 0 : 1;
      }
    }
    for (const i of doorCells) {
      lv.L.terrain[i] = T.DOOR;
      lv.E.roof[i] = 1;
      lv.reserved.add(i);
      // Keep the way through each doorway clear on both sides.
      const c = i % W;
      const r = Math.floor(i / W);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) lv.reserved.add(at(c + dc, r + dr));
    }
  };
  build(ground, rooms, T.FLOOR, T.VOID);
  for (let z = -1; z >= -crypts; z--) {
    const lv = level(z, emptyLayers(N));
    build(lv, rooms, T.CRYPT_FLOOR, T.VOID);
    levels.set(z, lv);
  }
  for (let z = 1; z <= towers; z++) {
    const lv = level(z, emptyLayers(N));
    const t = towerRoom!;
    lv.L.terrain.fill(T.VOID);
    for (let r = t.r0 - 1; r <= t.r1 + 1; r++) for (let c = t.c0 - 1; c <= t.c1 + 1; c++) lv.L.terrain[at(c, r)] = T.WALL;
    for (let r = t.r0; r <= t.r1; r++) for (let c = t.c0; c <= t.c1; c++) {
      lv.L.terrain[at(c, r)] = T.PLANKS;
      // The top of the tower is the belfry, open to the sky.
      lv.E.roof[at(c, r)] = z === towers ? 0 : 1;
    }
    levels.set(z, lv);
  }

  // Staircases: on storey z, three cells in a column climbing north at 0, 2 and 4 m to the floor
  // of storey z + 1. The cell beyond the top step is walled on storey z (so the stairs climb out
  // of it), and the cells over the upper two steps are left open on storey z + 1.
  const staircase = (z: number, room: Rect, c: number) => {
    const lv = levels.get(z)!;
    const up = levels.get(z + 1)!;
    const rows = [room.r0 + 3, room.r0 + 2, room.r0 + 1];
    rows.forEach((r, n) => {
      const i = at(c, r);
      lv.L.terrain[i] = T.STAIRS_UP;
      lv.E.facing[i] = 0;
      lv.E.height[i] = n * 4;
      lv.reserved.add(i);
      if (n > 0) {
        up.L.terrain[i] = T.VOID;
        up.reserved.add(i);
      }
    });
    lv.L.terrain[at(c, room.r0)] = T.WALL;
    lv.reserved.add(at(c, room.r0));
    lv.reserved.add(at(c, room.r0 + 4));
    up.reserved.add(at(c, room.r0));
    up.reserved.add(at(c, room.r0 + 3));
  };
  for (let z = 0; z < towers; z++) staircase(z, towerRoom!, z % 2 === 0 ? towerRoom!.c0 : towerRoom!.c1);
  for (let z = -1; z >= -crypts; z--) staircase(z, cryptRoom!, z === -1 ? cryptRoom!.c0 : cryptRoom!.c1);

  // ---- things in rooms -------------------------------------------------------------------
  const free = (lv: Level, i: number) => !lv.reserved.has(i) && !lv.taken.has(i) && floorTile(lv.L.terrain[i]);
  /** Facing away from the wall a cell backs onto (0 north … 3 west), or -1 in the open. */
  const awayFromWall = (room: Rect, c: number, r: number) => (r === room.r0 ? 2 : r === room.r1 ? 0 : c === room.c0 ? 1 : c === room.c1 ? 3 : -1);
  const wallCells = (room: Rect) => {
    const out: [number, number][] = [];
    for (let c = room.c0; c <= room.c1; c++) out.push([c, room.r0], [c, room.r1]);
    for (let r = room.r0 + 1; r < room.r1; r++) out.push([room.c0, r], [room.c1, r]);
    return out;
  };
  const prop = (lv: Level, room: Rect, id: number, onWall = true, near?: [number, number]) => {
    const spots = onWall ? wallCells(room) : interior(room);
    const order = near ? spots.sort((a, b) => Math.hypot(a[0] - near[0], a[1] - near[1]) - Math.hypot(b[0] - near[0], b[1] - near[1])) : rng.shuffle(spots);
    for (const [c, r] of order) {
      const i = at(c, r);
      if (!free(lv, i)) continue;
      lv.E.prop[i] = id;
      const f = awayFromWall(room, c, r);
      lv.E.facing[i] = f >= 0 ? f : rng.int(0, 3);
      lv.taken.add(i);
      return i;
    }
    return -1;
  };
  const object = (lv: Level, room: Rect, id: number) => {
    for (const [c, r] of rng.shuffle(wallCells(room))) {
      const i = at(c, r);
      if (!free(lv, i)) continue;
      lv.L.object[i] = id;
      const f = awayFromWall(room, c, r);
      lv.E.facing[i] = f >= 0 ? f : 0;
      lv.taken.add(i);
      return i;
    }
    return -1;
  };
  const place = (lv: Level, room: Rect, type: string, name: string, props: Record<string, string | number>, inside = true) => {
    const spots = rng.shuffle(inside ? interior(room) : wallCells(room));
    for (const [c, r] of spots) {
      const i = at(c, r);
      if (!free(lv, i)) continue;
      lv.taken.add(i);
      const f: Feature = { id: newId('f'), type, name, c, r, props, ...(lv.z && { z: lv.z }) };
      map.features.push(f);
      return f;
    }
    return null;
  };
  const named: NamedRoom[] = [];
  const maxDepth = Math.max(1, ...rooms.map((r) => r.depth)) + crypts + towers;
  const tierFor = (depth: number) => Math.min(2, Math.floor((depth / (maxDepth + 1)) * 3));
  const monsters = S.num('monsters', 0.5);
  const treasure = S.num('treasure', 0.4);
  const traps = S.num('traps', 0.35);

  // The Great Stair: the entrance, in the middle of the hall's south side, facing in.
  const ec = Math.floor((hall.c0 + hall.c1) / 2);
  const entrance = at(ec, hall.r1);
  ground.taken.add(entrance);
  ground.reserved.add(at(ec, hall.r1 - 1));
  map.features.push({ id: newId('f'), type: 'entrance', name: 'Great Stair', c: ec, r: hall.r1, props: { facing: 0 } });

  const furnish = (lv: Level, room: Room, kind: string) => {
    const big = area(room) > 24;
    switch (kind) {
      case 'hall':
        prop(lv, room, PROP.HEARTH, true, [ec, room.r0]);
        prop(lv, room, PROP.BRAZIER, false);
        if (big) prop(lv, room, PROP.BRAZIER, false);
        for (let n = 0; n < 2 + Number(big); n++) object(lv, room, O.TABLE);
        object(lv, room, O.BENCH);
        prop(lv, room, PROP.BANNER);
        break;
      case 'courtyard':
        prop(lv, room, PROP.CAMPFIRE, false);
        prop(lv, room, PROP.STANDING_TORCH);
        if (big) prop(lv, room, PROP.TRAINING_DUMMY, false);
        prop(lv, room, PROP.HAY);
        break;
      case 'chapel':
        prop(lv, room, PROP.ALTAR, true, [(room.c0 + room.c1) / 2, room.r0]);
        prop(lv, room, PROP.CANDELABRA);
        for (let n = 0; n < 2 + Number(big) * 2; n++) prop(lv, room, PROP.PEW, false);
        break;
      case 'kitchen':
        prop(lv, room, PROP.CAULDRON);
        prop(lv, room, PROP.BRAZIER, false);
        object(lv, room, O.TABLE);
        object(lv, room, O.BARREL);
        object(lv, room, O.CRATE);
        break;
      case 'barracks':
        prop(lv, room, PROP.BRAZIER, false);
        for (let n = 0; n < 2 + Number(big); n++) object(lv, room, O.BED);
        prop(lv, room, PROP.WEAPON_RACK);
        break;
      case 'armoury':
        prop(lv, room, PROP.WALL_TORCH);
        prop(lv, room, PROP.WEAPON_RACK);
        prop(lv, room, PROP.WEAPON_RACK);
        object(lv, room, O.CRATE);
        break;
      case 'library':
        prop(lv, room, PROP.CANDELABRA, false);
        for (let n = 0; n < 2 + Number(big); n++) object(lv, room, O.BOOKSHELF);
        prop(lv, room, PROP.DESK, false);
        prop(lv, room, PROP.CHAIR, false);
        break;
      case 'storeroom':
        prop(lv, room, PROP.WALL_TORCH);
        object(lv, room, O.CRATE);
        object(lv, room, O.BARREL);
        prop(lv, room, PROP.POTS);
        break;
      case 'guardroom':
        prop(lv, room, PROP.BRAZIER, false);
        object(lv, room, O.TABLE);
        prop(lv, room, PROP.CHAIR, false);
        prop(lv, room, PROP.WEAPON_RACK);
        break;
      case 'kennels':
        prop(lv, room, PROP.WALL_TORCH);
        prop(lv, room, PROP.HAY);
        prop(lv, room, PROP.HAY);
        break;
      case 'bedchamber':
        prop(lv, room, PROP.CANDELABRA);
        object(lv, room, O.BED);
        prop(lv, room, PROP.WARDROBE);
        prop(lv, room, PROP.RUG, false);
        break;
      case 'tower':
        prop(lv, room, PROP.WALL_TORCH);
        object(lv, room, O.CRATE);
        break;
      case 'crypt':
        prop(lv, room, PROP.CANDELABRA, false);
        for (let n = 0; n < 1 + Number(big) * 2; n++) prop(lv, room, PROP.GRAVESTONE);
        if (rng.chance(0.5)) prop(lv, room, PROP.PILLAR, false);
        if (rng.chance(0.4)) prop(lv, room, PROP.STATUE);
        prop(lv, room, PROP.POTS);
        break;
      case 'belfry':
        prop(lv, room, PROP.GREAT_BELL, false);
        prop(lv, room, PROP.BRAZIER, false);
        break;
    }
  };
  const populate = (lv: Level, room: Room, kind: string, depth: number) => {
    const tier = tierFor(depth);
    const pool = ENEMIES[kind] ?? ENEMIES.hall;
    // About one enemy per 30 cells at the default density; the crypt is quieter.
    let count = Math.round(area(room) * monsters * (kind === 'crypt' ? 0.04 : 0.065) + rng.range(-0.5, 0.5));
    if (kind === 'hall') count = Math.min(count, 1);
    for (let n = 0; n < count; n++) {
      const kindOf = rng.pick(pool);
      place(lv, room, 'monster', capital(kindOf.replace('_', ' ')), { kind: kindOf, tier });
    }
    if (kind !== 'hall' && kind !== 'courtyard' && rng.chance(treasure * (0.6 + depth * 0.1))) place(lv, room, 'treasure', 'Chest', { tier, facing: -1 }, false);
    if (kind !== 'hall' && rng.chance(traps * 0.5)) place(lv, room, 'trap', 'Spike trap', { tier });
  };
  for (const room of rooms) {
    furnish(ground, room, room.kind);
    populate(ground, room, room.kind, room.depth);
    named.push({ name: room.name, z: 0, c0: room.c0, r0: room.r0, c1: room.c1, r1: room.r1 });
  }
  const cryptNames = rng.shuffle([...CRYPT_NAMES]);
  for (let z = -1; z >= -crypts; z--) {
    const lv = levels.get(z)!;
    rooms.forEach((room, n) => {
      const depth = Math.abs(cryptRoom!.depth - room.depth) + cryptRoom!.depth + 2 * -z;
      furnish(lv, room, 'crypt');
      populate(lv, room, 'crypt', depth);
      named.push({ name: `${cryptNames[n % cryptNames.length]}${z < -1 ? ' (deep)' : ''}`, z, c0: room.c0, r0: room.r0, c1: room.c1, r1: room.r1 });
    });
  }
  for (let z = 1; z <= towers; z++) {
    const lv = levels.get(z)!;
    const t = { ...towerRoom!, kind: z === towers ? 'belfry' : 'tower' };
    furnish(lv, t, t.kind);
    if (z < towers) populate(lv, t, 'tower', towerRoom!.depth + 2 * z);
    named.push({ name: z === towers ? 'Belfry' : `Tower, storey ${z}`, z, c0: t.c0, r0: t.r0, c1: t.c1, r1: t.r1 });
  }
  // The boss: at the top of the tower, or in the deepest crypt, with the best chest.
  const bossLevel = towers ? levels.get(towers)! : crypts ? levels.get(-crypts)! : ground;
  const bossRoom = towers ? towerRoom! : rooms.reduce((a, b) => (b.depth > a.depth ? b : a));
  const bossKind = towers ? 'castellan' : crypts ? 'sacristan' : rooms.some((r) => r.kind === 'kennels') ? 'kennel_master' : 'warden';
  place(bossLevel, bossRoom, 'boss', capital(bossKind.replace('_', '-')), { kind: bossKind, tier: 3 });
  place(bossLevel, bossRoom, 'treasure', 'Chest', { tier: 3, facing: -1 }, false);

  const storeys: Storey[] = [];
  for (const [z, lv] of levels) if (z !== 0) storeys.push({ z, layers: lv.L, layers3d: lv.E });
  if (storeys.length) map.storeys = storeys.sort((a, b) => a.z - b.z);
  map.rooms = named;
  return map;
}

function floorTile(t: number): boolean {
  return t === T.FLOOR || t === T.CRYPT_FLOOR || t === T.PLANKS || t === T.GRASS;
}

function interior(room: Rect): [number, number][] {
  const out: [number, number][] = [];
  for (let r = room.r0 + 1; r < room.r1; r++) for (let c = room.c0 + 1; c < room.c1; c++) out.push([c, r]);
  return out.length ? out : [[room.c0, room.r0]];
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
