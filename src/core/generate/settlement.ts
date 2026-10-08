/**
 * Settlement layouts (hamlet → capital): plaza, main roads to the edges, organic side streets,
 * walls with gates, keep, building lots, notable buildings, docks, farmland and ruins.
 */
import { Grid } from '../grid';
import { Pt, meander, tracePolyline } from '../links';
import { featureName } from '../names';
import { Noise2D } from '../noise';
import { bfsDistance, findPath } from '../pathfinding';
import { Rng } from '../rng';
import { SettingsReader } from '../settings';
import { STREET_TILES, T, isSea, isWater } from '../tiles';
import { Feature, MapSpec, WorldMap, emptyLayers, newId } from '../types';

interface SizeParams {
  radius: number;
  plaza: number;
  mainRoads: number;
  spacing: number;
  depth: number;
  bMin: number;
  bMax: number;
  yard: number;
  roles: string[];
  docks: number;
}

const SIZES: Record<string, SizeParams> = {
  hamlet: { radius: 0.3, plaza: 1.1, mainRoads: 2, spacing: 8, depth: 2, bMin: 1, bMax: 3, yard: 0.3, roles: ['tavern'], docks: 1 },
  village: { radius: 0.42, plaza: 1.6, mainRoads: 3, spacing: 6, depth: 2, bMin: 2, bMax: 4, yard: 0.25, roles: ['tavern', 'smithy', 'shop'], docks: 2 },
  town: { radius: 0.62, plaza: 2.6, mainRoads: 4, spacing: 4.6, depth: 2, bMin: 2, bMax: 6, yard: 0.15, roles: ['tavern', 'inn_bldg', 'smithy', 'shop', 'shop', 'stable', 'alchemist'], docks: 4 },
  city: {
    radius: 0.76,
    plaza: 3.4,
    mainRoads: 5,
    spacing: 3.8,
    depth: 2,
    bMin: 3,
    bMax: 8,
    yard: 0.06,
    roles: ['tavern', 'tavern', 'inn_bldg', 'smithy', 'shop', 'shop', 'shop', 'stable', 'alchemist', 'guildhall', 'library'],
    docks: 7,
  },
  capital: {
    radius: 0.86,
    plaza: 4.4,
    mainRoads: 6,
    spacing: 3.4,
    depth: 3,
    bMin: 3,
    bMax: 9,
    yard: 0.04,
    roles: ['tavern', 'tavern', 'tavern', 'inn_bldg', 'inn_bldg', 'smithy', 'smithy', 'shop', 'shop', 'shop', 'shop', 'stable', 'alchemist', 'guildhall', 'guildhall', 'library'],
    docks: 10,
  },
};

const GROUND: Record<string, [number, number]> = {
  grassland: [T.GRASSLAND, T.FOREST],
  forest: [T.GRASSLAND, T.FOREST],
  desert: [T.DESERT, T.SAVANNA],
  tundra: [T.TUNDRA, T.TAIGA],
  swamp: [T.SWAMP, T.FOREST],
  hills: [T.HILLS, T.FOREST],
};

const DIR_VEC: Record<string, Pt> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export function generateSettlement(spec: MapSpec): WorldMap {
  const g = new Grid(spec.grid, spec.width, spec.height);
  const S = new SettingsReader(spec.settings, 'settlement', spec.scaleId);
  const rng = new Rng(spec.seed);
  const L = emptyLayers(g.size);
  const N = g.size;
  const ter = L.terrain;
  const sizeKey = S.str('sizeClass', 'town');
  const P = SIZES[sizeKey] ?? SIZES.town;
  const density = S.num('density', 0.6);
  const [ground, trees] = GROUND[S.str('baseTerrain', 'grassland')] ?? GROUND.grassland;
  const { w: LW, h: LH } = g.logicalBounds();
  let C: Pt = [LW / 2, LH / 2];
  const R = (Math.min(LW, LH) / 2) * P.radius;
  const nTree = new Noise2D(rng.fork('trees'));
  const nJit = new Noise2D(rng.fork('jitter'));
  const nEdge = new Noise2D(rng.fork('edge'));
  const isStreet = (i: number) => STREET_TILES.has(ter[i]);
  const dC = (i: number) => {
    const [x, y] = g.pos(i);
    return Math.hypot(x - C[0], y - C[1]);
  };
  const angleOf = (i: number) => {
    const [x, y] = g.pos(i);
    return Math.atan2(y - C[1], x - C[0]);
  };
  const edgeR = (a: number) => R * (1 + 0.14 * nEdge.get(Math.cos(a) * 1.3, Math.sin(a) * 1.3));

  // Ground and woods.
  const treeThr = S.str('baseTerrain') === 'forest' ? -0.15 : 0.32;
  for (let i = 0; i < N; i++) {
    const [x, y] = g.pos(i);
    ter[i] = trees !== ground && nTree.fbm(x * 0.07, y * 0.07, 3) > treeThr ? trees : ground;
  }

  // Coast.
  const coast = S.bool('coast');
  const coastDir = DIR_VEC[S.str('coastDir', 'E')] ?? DIR_VEC.E;
  if (coast) {
    const nC = new Noise2D(rng.fork('coast'));
    for (let i = 0; i < N; i++) {
      const [x, y] = g.pos(i);
      const proj = ((x - LW / 2) * coastDir[0]) / (LW / 2) + ((y - LH / 2) * coastDir[1]) / (LH / 2);
      const along = x * coastDir[1] + y * coastDir[0];
      const line = 0.6 + nC.fbm(along * 0.05, 3.7, 3) * 0.15;
      if (proj > line + 0.22) ter[i] = T.DEEP_OCEAN;
      else if (proj > line) ter[i] = T.OCEAN;
      else if (proj > line - 0.06) ter[i] = T.BEACH;
    }
    C = [C[0] - coastDir[0] * LW * 0.1, C[1] - coastDir[1] * LH * 0.1];
  }

  // River.
  if (S.bool('river')) {
    const rr = rng.fork('river');
    let a: Pt;
    let b: Pt;
    if (coast) {
      a = [LW / 2 - coastDir[0] * LW * 0.5 + rr.range(-0.2, 0.2) * LW * Math.abs(coastDir[1]), LH / 2 - coastDir[1] * LH * 0.5 + rr.range(-0.2, 0.2) * LH * Math.abs(coastDir[0])];
      b = [LW / 2 + coastDir[0] * LW * 0.5, LH / 2 + coastDir[1] * LH * 0.5];
    } else if (rr.chance(0.5)) {
      a = [0, LH * rr.range(0.25, 0.75)];
      b = [LW, LH * rr.range(0.25, 0.75)];
    } else {
      a = [LW * rr.range(0.25, 0.75), 0];
      b = [LW * rr.range(0.25, 0.75), LH];
    }
    const off = R * 0.3;
    const mid: Pt = [C[0] + rr.range(-off, off), C[1] + rr.range(-off, off)];
    const pts = [...meander(a, mid, rr.int(0, 1e9), 4, 0.18), ...meander(mid, b, rr.int(0, 1e9), 4, 0.18).slice(1)];
    const path = tracePolyline(g, pts);
    const horizontal = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]);
    const wide = sizeKey === 'town' || sizeKey === 'city' || sizeKey === 'capital';
    const widenDir = widenDirection(g, horizontal);
    for (const i of path) {
      if (isSea(ter[i])) continue;
      ter[i] = T.LAKE;
      if (wide) {
        const n = g.neighbor(i, widenDir);
        if (n >= 0 && !isSea(ter[n])) ter[n] = T.LAKE;
      }
    }
  }

  // Make sure the centre is on land.
  {
    let ci = g.posToCellClamped(C[0], C[1]);
    if (isWater(ter[ci])) {
      const d = bfsDistance(g, [ci], () => true, true);
      let best = ci;
      let bd = Infinity;
      for (let i = 0; i < N; i++) if (!isWater(ter[i]) && d[i] >= 0 && d[i] < bd) {
        bd = d[i];
        best = i;
      }
      ci = best;
      C = g.pos(ci);
    }
  }

  // Clear trees inside town.
  for (let i = 0; i < N; i++) if (ter[i] === trees && dC(i) < edgeR(angleOf(i)) * 1.1) ter[i] = ground;

  // Plaza.
  const plaza: number[] = [];
  for (let i = 0; i < N; i++) {
    if (dC(i) <= P.plaza && !isWater(ter[i])) {
      ter[i] = T.PLAZA;
      plaza.push(i);
    }
  }
  if (!plaza.length) {
    const ci = g.posToCellClamped(C[0], C[1]);
    ter[ci] = T.PLAZA;
    plaza.push(ci);
  }

  const jitter = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const [x, y] = g.pos(i);
    jitter[i] = (nJit.fbm(x * 0.3, y * 0.3, 2) + 1) * 0.5;
  }

  // Main roads to the map edge.
  const rm = rng.fork('main');
  const baseAngle = rm.next() * Math.PI * 2;
  for (let k = 0; k < P.mainRoads; k++) {
    const ang = baseAngle + (k * Math.PI * 2) / P.mainRoads + rm.range(-0.3, 0.3);
    const target = edgeCell(g, C, ang);
    if (target < 0 || isSea(ter[target])) continue;
    const path = findPath(g, plaza, (i) => i === target, {
      diagonals: false,
      cost: (to) => {
        const t = ter[to];
        if (isSea(t)) return Infinity;
        if (t === T.LAKE) return 10;
        if (isStreet(to)) return 0.4;
        return 1 + jitter[to] * 0.8;
      },
    });
    if (!path) continue;
    for (const i of path) {
      if (ter[i] === T.PLAZA) continue;
      ter[i] = ter[i] === T.LAKE || ter[i] === T.BRIDGE ? T.BRIDGE : T.MAIN_STREET;
    }
  }

  // Side streets: walk from random points back to the network.
  const rs = rng.fork('streets');
  const target = Math.round(((Math.PI * R * R) / (P.spacing * P.spacing)) * (0.5 + density));
  const bridges = sizeKey !== 'hamlet' && sizeKey !== 'village';
  let made = 0;
  for (let attempt = 0; attempt < target * 4 && made < target; attempt++) {
    const a = rs.next() * Math.PI * 2;
    const d = Math.sqrt(rs.next()) * R * 0.95;
    const start = g.posToCell(C[0] + Math.cos(a) * d, C[1] + Math.sin(a) * d);
    if (start < 0 || isWater(ter[start]) || isStreet(start)) continue;
    if (g.neighbors(start).some(isStreet)) continue;
    const path = findPath(g, [start], isStreet, {
      diagonals: false,
      cost: (to) => {
        const t = ter[to];
        if (isSea(t)) return Infinity;
        if (t === T.LAKE) return bridges ? 14 : Infinity;
        if (isStreet(to)) return 0.5;
        const crowd = g.neighbors(to).some(isStreet) ? 2.5 : 0;
        return 1 + jitter[to] + crowd;
      },
      maxCost: R * 2.5,
    });
    if (!path) continue;
    for (const i of path) {
      if (isStreet(i)) continue;
      ter[i] = ter[i] === T.LAKE ? T.BRIDGE : T.STREET;
    }
    made++;
  }

  // Walls.
  const walls = S.bool('walls') && sizeKey !== 'hamlet';
  const wallR = (a: number) => edgeR(a) + 0.5;
  if (walls) {
    for (let i = 0; i < N; i++) {
      const d = dC(i);
      const wr = wallR(angleOf(i));
      if (Math.abs(d - wr) >= 0.6) continue;
      const t = ter[i];
      if (isWater(t) || t === T.BRIDGE) continue;
      ter[i] = isStreet(i) ? T.GATE : T.WALL;
    }
  }
  const inside = (i: number) => dC(i) < (walls ? wallR(angleOf(i)) - 0.6 : edgeR(angleOf(i)));

  // Keep.
  const features: Feature[] = [];
  const nameRng = rng.fork('names');
  const addFeature = (type: string, i: number, name?: string) => {
    features.push({ id: newId('f'), type, name: name ?? featureName(nameRng, type), c: g.col(i), r: g.row(i) });
  };
  if (S.bool('castle')) {
    const rk = rng.fork('keep');
    const kr = sizeKey === 'city' || sizeKey === 'capital' ? 2.6 : 1.8;
    for (let tries = 0; tries < 12; tries++) {
      const a = rk.next() * Math.PI * 2;
      const kc: Pt = [C[0] + Math.cos(a) * R * 0.5, C[1] + Math.sin(a) * R * 0.5];
      const center = g.posToCell(kc[0], kc[1]);
      if (center < 0 || isWater(ter[center])) continue;
      const cells: number[] = [];
      for (let i = 0; i < N; i++) {
        const [x, y] = g.pos(i);
        if (Math.hypot(x - kc[0], y - kc[1]) <= kr && !isWater(ter[i]) && ter[i] !== T.MAIN_STREET && ter[i] !== T.PLAZA) cells.push(i);
      }
      for (const i of cells) ter[i] = T.KEEP;
      const path = findPath(g, cells, (i) => isStreet(i), {
        cost: (to) => (isWater(ter[to]) || ter[to] === T.WALL ? Infinity : ter[to] === T.KEEP ? 0.1 : 1),
        diagonals: false,
      });
      if (path) for (const i of path) if (ter[i] !== T.KEEP && !isStreet(i)) ter[i] = T.STREET;
      addFeature('keep', center);
      break;
    }
  }

  // Building lots.
  const ground2 = (t: number) => t === ground || t === trees || t === T.BEACH || t === T.GRASSLAND;
  const dStreet = bfsDistance(
    g,
    Array.from({ length: N }, (_, i) => i).filter(isStreet),
    (i) => !isWater(ter[i]) && ter[i] !== T.WALL,
    false,
  );
  const nLot = new Noise2D(rng.fork('lots'));
  const sparse = sizeKey === 'hamlet' || sizeKey === 'village';
  const rb = rng.fork('buildings');
  const candidates: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!ground2(ter[i]) || dStreet[i] < 1) continue;
    const [x, y] = g.pos(i);
    let ok = inside(i) && dStreet[i] <= P.depth;
    if (sparse && ok) ok = nLot.fbm(x * 0.25, y * 0.25, 2) > -0.45 + (1 - density) * 0.3 + (dStreet[i] - 1) * 0.25;
    if (!ok && walls && dStreet[i] === 1 && dC(i) < wallR(angleOf(i)) * 1.45 && g.neighbors(i).some((n) => ter[n] === T.MAIN_STREET)) {
      ok = rb.chance(0.45);
    }
    if (ok && rb.chance((1 - density) * 0.35)) ok = false;
    if (ok) candidates.push(i);
  }
  const isCand = new Uint8Array(N);
  for (const i of candidates) isCand[i] = 1;
  rb.shuffle(candidates);
  let nextId = 1;
  const buildings = new Map<number, number[]>();
  for (const s of candidates) {
    if (!isCand[s]) continue;
    if (rb.chance(P.yard)) {
      isCand[s] = 0;
      ter[s] = T.GARDEN;
      continue;
    }
    const want = rb.int(P.bMin, P.bMax);
    const cells = [s];
    isCand[s] = 0;
    for (let h = 0; h < cells.length && cells.length < want; h++) {
      for (const n of rb.shuffle(g.neighbors(cells[h], false))) {
        if (cells.length >= want) break;
        if (isCand[n]) {
          isCand[n] = 0;
          cells.push(n);
        }
      }
    }
    const id = nextId++;
    for (const i of cells) {
      ter[i] = T.BUILDING;
      L.building[i] = id;
    }
    buildings.set(id, cells);
  }

  // Notable buildings.
  const info = [...buildings.entries()].map(([id, cells]) => {
    let sx = 0;
    let sy = 0;
    for (const i of cells) {
      const [x, y] = g.pos(i);
      sx += x;
      sy += y;
    }
    const cx = sx / cells.length;
    const cy = sy / cells.length;
    let centroid = cells[0];
    let bd = Infinity;
    for (const i of cells) {
      const [x, y] = g.pos(i);
      const d = Math.hypot(x - cx, y - cy);
      if (d < bd) {
        bd = d;
        centroid = i;
      }
    }
    const touches = (t: number) => cells.some((i) => g.neighbors(i).some((n) => ter[n] === t));
    return { id, cells, centroid, dist: Math.hypot(cx - C[0], cy - C[1]), plaza: touches(T.PLAZA), main: touches(T.MAIN_STREET), used: false };
  });
  const take = (score: (b: (typeof info)[number]) => number) => {
    let best: (typeof info)[number] | undefined;
    let bs = -Infinity;
    for (const b of info) {
      if (b.used) continue;
      const s = score(b) + rb.next() * 0.5;
      if (s > bs) {
        bs = s;
        best = b;
      }
    }
    if (best) best.used = true;
    return best;
  };
  if (S.bool('temple')) {
    const b = take((b) => b.cells.length * 0.5 + (b.plaza ? 3 : 0) - b.dist / R);
    if (b) addFeature('temple_bldg', b.centroid);
  }
  if (walls && sizeKey !== 'village') {
    const b = take((b) => b.dist / R + (b.main ? 1 : 0));
    if (b) addFeature('barracks', b.centroid);
  }
  if (S.bool('shops')) {
    for (const role of P.roles) {
      const b =
        role === 'stable'
          ? take((b) => b.dist / R + (b.main ? 2 : 0))
          : take((b) => (b.plaza ? 2 : 0) + (b.main ? 1.2 : 0) - b.dist / R);
      if (b) addFeature(role, b.centroid);
    }
  }
  if (S.bool('market') && sizeKey !== 'hamlet') addFeature('market', plaza[Math.floor(plaza.length / 2)], 'Market Square');
  else addFeature('well', plaza[0], 'Village Well');

  // Graveyard on the edge of town.
  if (S.bool('graveyard')) {
    const rgy = rng.fork('graveyard');
    const want = sizeKey === 'hamlet' ? 3 : sizeKey === 'village' ? 5 : 10;
    for (let tries = 0; tries < 20; tries++) {
      const a = rgy.next() * Math.PI * 2;
      const r0 = walls ? wallR(a) - 1.8 : edgeR(a) * 0.95;
      const s = g.posToCell(C[0] + Math.cos(a) * r0, C[1] + Math.sin(a) * r0);
      if (s < 0 || !ground2(ter[s])) continue;
      const cells = [s];
      const seen = new Set(cells);
      for (let h = 0; h < cells.length && cells.length < want; h++) {
        for (const n of g.neighbors(cells[h], false)) {
          if (cells.length >= want) break;
          if (!seen.has(n) && ground2(ter[n])) {
            seen.add(n);
            cells.push(n);
          }
        }
      }
      for (const i of cells) ter[i] = T.GARDEN;
      addFeature('graveyard', s, 'Graveyard');
      break;
    }
  }

  // Docks.
  if (S.bool('docks') && sizeKey !== 'hamlet') {
    const rd = rng.fork('docks');
    const shore = rd.shuffle(
      Array.from({ length: N }, (_, i) => i).filter(
        (i) => isWater(ter[i]) && dC(i) < R * 1.3 && g.neighbors(i).some((n) => isStreet(n) || ter[n] === T.BUILDING),
      ),
    );
    const placed: number[] = [];
    for (const i of shore) {
      if (placed.length >= P.docks) break;
      if (placed.some((p) => g.dist(p, i) < 3)) continue;
      const wasSea = isSea(ter[i]);
      ter[i] = T.DOCK;
      placed.push(i);
      if (wasSea) {
        // Piers reach out into open water.
        const out = g.neighbors(i, false).find((n) => isSea(ter[n]));
        if (out !== undefined) ter[out] = T.DOCK;
      }
    }
    if (placed.length) addFeature('docks', placed[0], 'Docks');
  }

  // Farmland around the town.
  if (S.bool('farms')) {
    const nF = new Noise2D(rng.fork('farms'));
    const dMain = bfsDistance(
      g,
      Array.from({ length: N }, (_, i) => i).filter((i) => ter[i] === T.MAIN_STREET),
      () => true,
      false,
    );
    const rf = rng.fork('farmhouses');
    for (let i = 0; i < N; i++) {
      const t = ter[i];
      if (t !== ground && t !== trees) continue;
      const d = dC(i);
      const er = walls ? wallR(angleOf(i)) : edgeR(angleOf(i));
      if (d < er * 1.05 || d > er * 2.8) continue;
      if (dMain[i] < 0 || dMain[i] > 8) continue;
      const [x, y] = g.pos(i);
      const v = nF.fbm(x * 0.16, y * 0.16, 2);
      if (Math.abs(nF.get(x * 0.11 + 40, y * 0.11)) < 0.06) continue; // hedgerows
      if (v > -0.15) {
        ter[i] = T.FIELD;
        if (dMain[i] === 1 && rf.chance(0.04)) {
          ter[i] = T.BUILDING;
          L.building[i] = nextId++;
        }
      }
    }
  }

  // Ruins.
  if (S.bool('ruined')) {
    const rr = rng.fork('ruin');
    for (const [, cells] of buildings) {
      const roll = rr.next();
      if (roll >= 0.5 && roll <= 0.78) continue;
      for (const i of cells) {
        ter[i] = roll < 0.5 ? T.RUBBLE : T.GARDEN;
        L.building[i] = 0;
      }
    }
    for (let i = 0; i < N; i++) {
      const t = ter[i];
      if ((t === T.WALL || t === T.KEEP) && rr.chance(0.4)) ter[i] = T.RUBBLE;
      else if ((t === T.STREET || t === T.FIELD) && rr.chance(0.3)) ter[i] = ground;
    }
    const keep = features.filter((f) => rr.chance(0.35) || f.type === 'keep');
    for (const f of keep) f.name = `Ruined ${f.name}`;
    features.length = 0;
    features.push(...keep);
  }

  return { ...spec, id: newId('map'), layers: L, features, children: [] };
}

function widenDirection(g: Grid, horizontal: boolean): number {
  switch (g.type) {
    case 'hex-pointy':
      return horizontal ? 1 : 0;
    case 'hex-flat':
      return horizontal ? 3 : 2;
    default:
      return horizontal ? 2 : 0;
  }
}

/** The last in-bounds cell walking from `from` at angle `a`. */
function edgeCell(g: Grid, from: Pt, a: number): number {
  let last = -1;
  for (let d = 0; d < 1000; d += 0.5) {
    const i = g.posToCell(from[0] + Math.cos(a) * d, from[1] + Math.sin(a) * d);
    if (i < 0) {
      if (last >= 0) break;
      continue;
    }
    last = i;
  }
  return last;
}
