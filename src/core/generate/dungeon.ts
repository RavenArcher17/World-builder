/**
 * Dungeons and caves: rooms joined by corridors (MST + loops), cellular-automata caverns, or a
 * mix. Then doors, stairs, pools and contents (monsters, treasure, traps, boss, altar).
 */
import { Grid } from '../grid';
import { featureName } from '../names';
import { Noise2D } from '../noise';
import { bfsDistance, components, connectComponents, findPath } from '../pathfinding';
import { Rng } from '../rng';
import { SettingsReader } from '../settings';
import { DUNGEON_PASSABLE, T } from '../tiles';
import { Feature, MapSpec, WorldMap, emptyLayers, newId } from '../types';

interface Room {
  cells: number[];
  center: number;
}

export function generateDungeon(spec: MapSpec): WorldMap {
  const g = new Grid(spec.grid, spec.width, spec.height);
  const S = new SettingsReader(spec.settings, 'dungeon', spec.scaleId);
  const rng = new Rng(spec.seed);
  const L = emptyLayers(g.size);
  const ter = L.terrain;
  const N = g.size;
  ter.fill(T.ROCK);
  const style = S.str('style', 'rooms');
  const { w: LW, h: LH } = g.logicalBounds();
  const passable = (i: number) => DUNGEON_PASSABLE.has(ter[i]);
  const border = (i: number) => {
    const c = g.col(i);
    const r = g.row(i);
    return c === 0 || r === 0 || c === g.width - 1 || r === g.height - 1;
  };

  // Caves via cellular automata (optionally masked to part of the map for "mixed").
  if (style === 'caves' || style === 'mixed') {
    const rc = rng.fork('caves');
    const mask = new Noise2D(rng.fork('mask'));
    const inCave = (i: number) => {
      if (style !== 'mixed') return true;
      const [x, y] = g.pos(i);
      return mask.fbm(x * 0.05, y * 0.05, 2) > 0;
    };
    let open = new Uint8Array(N);
    for (let i = 0; i < N; i++) open[i] = !border(i) && inCave(i) && rc.chance(0.48) ? 1 : 0;
    const full = g.isHex ? 6 : 8;
    for (let it = 0; it < 5; it++) {
      const next = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        if (border(i) || !inCave(i)) continue;
        const nb = g.neighbors(i, true);
        let walls = full - nb.length;
        for (const n of nb) if (!open[n]) walls++;
        next[i] = g.isHex ? (walls >= 4 ? 0 : walls <= 2 ? 1 : open[i]) : walls >= 5 ? 0 : walls <= 3 ? 1 : open[i];
      }
      open = next;
    }
    const { labels, sizes } = components(g, (i) => open[i] === 1);
    for (let i = 0; i < N; i++) if (open[i] && sizes[labels[i]] >= 10) ter[i] = T.FLOOR;
  }

  // Rooms.
  const rooms: Room[] = [];
  if (style === 'rooms' || style === 'mixed') {
    const rr = rng.fork('rooms');
    const sizeK = S.num('roomSize', 0.45);
    const minS = 3;
    const maxS = 3 + Math.round(sizeK * 8);
    const avg = (minS + maxS) / 2;
    const want = Math.max(3, Math.round(((LW * LH) / (avg * avg * 3.2)) * (0.3 + S.num('roomDensity', 0.55) * 1.2)));
    for (let attempt = 0; attempt < want * 30 && rooms.length < want; attempt++) {
      const w = rr.range(minS, maxS);
      const h = rr.range(minS, maxS);
      const x0 = rr.range(1.2, LW - w - 1.2);
      const y0 = rr.range(1.2, LH - h - 1.2);
      const round = rr.chance(0.2);
      const cells: number[] = [];
      for (let i = 0; i < N; i++) {
        const [x, y] = g.pos(i);
        const inside = round
          ? ((x - x0 - w / 2) / (w / 2)) ** 2 + ((y - y0 - h / 2) / (h / 2)) ** 2 <= 1
          : x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h;
        if (inside) cells.push(i);
      }
      if (cells.length < 4 || cells.some(border)) continue;
      // Keep a wall of rock between rooms.
      if (cells.some((i) => ter[i] !== T.ROCK || g.neighbors(i, true).some((n) => ter[n] !== T.ROCK))) continue;
      for (const i of cells) ter[i] = T.FLOOR;
      const cx = x0 + w / 2;
      const cy = y0 + h / 2;
      let center = cells[0];
      let bd = Infinity;
      for (const i of cells) {
        const [x, y] = g.pos(i);
        const d = Math.hypot(x - cx, y - cy);
        if (d < bd) {
          bd = d;
          center = i;
        }
      }
      rooms.push({ cells, center });
    }

    // Corridors: MST over room centres plus some loops.
    const winding = S.num('winding', 0.4);
    const noise = new Noise2D(rng.fork('corridors'));
    const edges = roomGraph(g, rooms, S.num('loops', 0.3), rng.fork('graph'));
    for (const [a, b] of edges) {
      const goal = rooms[b].center;
      const path = findPath(g, [rooms[a].center], (i) => i === goal, {
        diagonals: false,
        cost: (to) => {
          if (border(to)) return Infinity;
          const t = ter[to];
          if (t === T.CORRIDOR) return 0.6;
          if (t === T.FLOOR) return 1.6;
          const [x, y] = g.pos(to);
          return 1 + winding * 3 * (noise.fbm(x * 0.25, y * 0.25, 2) + 1);
        },
      });
      if (path) for (const i of path) if (ter[i] === T.ROCK) ter[i] = T.CORRIDOR;
    }
  }

  // Everything must be reachable.
  connectComponents(
    g,
    passable,
    (i) => (border(i) ? Infinity : 1),
    (i) => (ter[i] = T.CORRIDOR),
    rng.fork('connect'),
  );

  const roomOf = new Int32Array(N).fill(-1);
  rooms.forEach((r, k) => r.cells.forEach((i) => (roomOf[i] = k)));

  // Doors where corridors enter rooms through a narrow gap.
  const features: Feature[] = [];
  const rf = rng.fork('features');
  const add = (type: string, i: number, name?: string) =>
    features.push({ id: newId('f'), type, name: name ?? capitalize(type), c: g.col(i), r: g.row(i) });
  if (S.bool('doors')) {
    for (let i = 0; i < N; i++) {
      if (ter[i] !== T.CORRIDOR) continue;
      const orth = g.neighbors(i, false);
      if (!orth.some((n) => roomOf[n] >= 0)) continue;
      if (orth.filter(passable).length !== 2) continue;
      if (!rf.chance(0.75)) continue;
      ter[i] = T.DOOR;
      if (S.bool('secrets') && rf.chance(0.12)) add('secret', i, 'Secret door');
    }
  }

  // Pools.
  if (S.bool('water')) {
    const nP = new Noise2D(rng.fork('pools'));
    for (let i = 0; i < N; i++) {
      if (ter[i] !== T.FLOOR) continue;
      const [x, y] = g.pos(i);
      if (nP.fbm(x * 0.12, y * 0.12, 3) < 0.38) continue;
      if (g.neighbors(i, true).every((n) => ter[n] === T.FLOOR || ter[n] === T.POOL)) ter[i] = T.POOL;
    }
    connectComponents(g, passable, (i) => (ter[i] === T.POOL ? 1 : Infinity), (i) => (ter[i] = T.FLOOR), rng.fork('pools2'));
  }

  // "Rooms" for contents: real rooms or, for caves, open areas sampled across the map.
  const spots: Room[] = rooms.length ? rooms : sampleSpots(g, ter, rf);
  if (!spots.length) {
    const any = ter.findIndex((t) => t === T.FLOOR || t === T.CORRIDOR);
    if (any >= 0) spots.push({ cells: [any], center: any });
  }
  if (spots.length) {
    // Entrance: the spot nearest a map edge.
    const edgeDist = (i: number) => Math.min(g.col(i), g.row(i), g.width - 1 - g.col(i), g.height - 1 - g.row(i));
    const entrance = spots.reduce((a, b) => (edgeDist(b.center) < edgeDist(a.center) ? b : a));
    ter[entrance.center] = T.STAIRS_UP;
    add('entrance', entrance.center, featureName(rng.fork('name'), 'dungeon').replace(/^The /, '') + ' Entrance');
    const dist = bfsDistance(g, [entrance.center], passable, false);
    const byDepth = spots.filter((s) => s !== entrance).sort((a, b) => dist[b.center] - dist[a.center]);
    if (S.bool('stairsDown') && byDepth.length) {
      const deep = byDepth[0];
      ter[deep.center] = T.STAIRS_DOWN;
      add('stairs_down', deep.center, 'Stairs down');
    }
    const monsters = S.num('monsters', 0.5);
    const treasure = S.num('treasure', 0.4);
    const traps = S.num('traps', 0.35);
    const free = (s: Room) => s.cells.filter((i) => ter[i] === T.FLOOR && !features.some((f) => f.c === g.col(i) && f.r === g.row(i)));
    if (monsters > 0 && byDepth.length > 1) {
      const lair = byDepth.slice(0, Math.max(1, Math.ceil(byDepth.length / 3))).sort((a, b) => b.cells.length - a.cells.length)[0];
      const c = free(lair);
      if (c.length) add('boss', rf.pick(c), 'Boss');
    }
    for (const s of byDepth) {
      const c = free(s);
      if (!c.length) continue;
      if (rf.chance(monsters * 0.6)) add('monster', rf.pick(c), 'Monsters');
      if (rf.chance(treasure * 0.4)) add('treasure', rf.pick(free(s).length ? free(s) : c), 'Treasure');
    }
    if (byDepth.length > 2 && rf.chance(0.6)) {
      const s = rf.pick(byDepth);
      const c = free(s);
      if (c.length) add('altar', rf.pick(c), 'Altar');
    }
    // Treasure in dead ends.
    for (let i = 0; i < N; i++) {
      if (!passable(i) || ter[i] === T.STAIRS_UP || ter[i] === T.STAIRS_DOWN) continue;
      if (g.neighbors(i, false).filter(passable).length === 1 && rf.chance(treasure * 0.5)) add('treasure', i, 'Treasure');
    }
    const corridor = Array.from({ length: N }, (_, i) => i).filter((i) => ter[i] === T.CORRIDOR);
    const trapCount = Math.round(corridor.length * traps * 0.03);
    for (let k = 0; k < trapCount && corridor.length; k++) add('trap', rf.pick(corridor), 'Trap');
  }

  return { ...spec, id: newId('map'), layers: L, features, children: [] };
}

function capitalize(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function roomGraph(g: Grid, rooms: Room[], loops: number, rng: Rng): [number, number][] {
  const n = rooms.length;
  if (n < 2) return [];
  const d = (a: number, b: number) => g.dist(rooms[a].center, rooms[b].center);
  const inTree = new Uint8Array(n);
  const best = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const edges: [number, number][] = [];
  best[0] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
    inTree[u] = 1;
    if (from[u] >= 0) edges.push([from[u], u]);
    for (let v = 0; v < n; v++) if (!inTree[v] && d(u, v) < best[v]) {
      best[v] = d(u, v);
      from[v] = u;
    }
  }
  const has = new Set(edges.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
  for (let i = 0; i < n; i++) {
    if (!rng.chance(loops)) continue;
    const j = [...Array(n).keys()]
      .filter((j) => j !== i && !has.has(`${Math.min(i, j)}-${Math.max(i, j)}`))
      .sort((a, b) => d(i, a) - d(i, b))[0];
    if (j === undefined) continue;
    has.add(`${Math.min(i, j)}-${Math.max(i, j)}`);
    edges.push([i, j]);
  }
  return edges;
}

/** For caves: pick well-spaced open cells and treat their surroundings as "rooms". */
function sampleSpots(g: Grid, ter: number[], rng: Rng): Room[] {
  const open = rng.shuffle(Array.from({ length: g.size }, (_, i) => i).filter((i) => ter[i] === T.FLOOR));
  const spots: Room[] = [];
  for (const i of open) {
    if (spots.some((s) => g.dist(s.center, i) < 7)) continue;
    const cells = [i, ...g.neighbors(i, true).filter((n) => ter[n] === T.FLOOR)];
    spots.push({ cells, center: i });
  }
  return spots;
}
