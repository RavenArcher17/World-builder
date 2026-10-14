/**
 * Turns a map into a 3D scene: meshes (ground, structures, objects, places, roads, water) and
 * marker points with the map's data attached. Pure data, no WebGL: the 3D view draws it and the
 * .glb export writes it (docs/3d-export.md).
 *
 * Axes: x = east (columns), z = south (rows), y = up, in metres, with the map's top-left corner
 * at the origin. One logical grid unit (the distance between neighbouring cell centres) is
 * `options.tile` metres.
 */
import { featureDef } from '../features';
import { Grid } from '../grid';
import { linkedNeighbors } from '../links';
import { objectDef, type ObjectDef } from '../objects';
import { T, isSea, isWater, tile } from '../tiles';
import { SEA_LEVEL, type WorldMap } from '../types';
import { MeshBuilder, type MeshData, type RGBA, type V3, cross, hash01, mix, rgba, shade } from './mesh';
import { type Map3dOptions, options3d } from './options';
import { type PropDef, propDef } from './props';
import { FACING_STEP, facingAngle as angleOfFacing, featureStorey, storey3d, storeyLayers, storeyNumbers } from './storeys';

export type PartKind = 'ground' | 'structures' | 'roofs' | 'objects' | 'places' | 'roads' | 'water';

export interface ScenePart {
  /** Node name in the .glb ("-col" asks Godot to give it collision on import). */
  name: string;
  kind: PartKind;
  /** Walk-on / bump-into geometry (gets collision in game engines). */
  solid: boolean;
  mesh: MeshData;
}

export interface SceneMarker {
  name: string;
  position: V3;
  /** What the marker stands for (a place or an object), for game scripts. */
  data: Record<string, unknown>;
}

export interface Scene3D {
  name: string;
  options: Map3dOptions;
  bounds: { min: V3; max: V3 };
  parts: ScenePart[];
  markers: SceneMarker[];
  /** Map-level facts written to the root node. */
  info: Record<string, unknown>;
  /** True for dungeons and other places under a roof (the view uses a dark sky). */
  underground: boolean;
}

const S3 = Math.sqrt(3);

/** A cell's outline in logical units, as (x, z) points. Isometric maps are square grids in 3D. */
export function cellPolygon(g: Grid, i: number): [number, number][] {
  if (g.isHex) return g.corners(i).map(([x, y]): [number, number] => [x / S3, y / S3]);
  const c = g.col(i);
  const r = g.row(i);
  return [
    [c, r],
    [c + 1, r],
    [c + 1, r + 1],
    [c, r + 1],
  ];
}

const WATER_SHALLOW = rgba('#5fb2d4', 205);
const WATER_DEEP = rgba('#1c4d7a', 225);
const EARTH = rgba('#6b5a45');
/** The sides of the map's slab. */
const SKIRT = rgba('#4a4036');
const ROAD_COLORS: Record<number, RGBA> = { 1: rgba('#a88b62'), 2: rgba('#9a7a52'), 3: rgba('#d8bd84') };
const ROAD_WIDTH: Record<number, number> = { 1: 0.14, 2: 0.22, 3: 0.34 };
const RIVER = rgba('#4a8ec4', 215);
const WALL_PALETTE = ['#cdb894', '#bba07c', '#d8c8a4', '#a98d6c', '#cfbca4', '#b7a58c'].map((c) => rgba(c));
const ROOF_PALETTE = ['#8a4b32', '#6b3a2a', '#7a5a3a', '#5a4a44', '#9a5b3b', '#6e4e3e'].map((c) => rgba(c));
const STONE = rgba('#7a756d');
const DARK = rgba('#1d1b22');

export function buildScene(map: WorldMap, opts: Map3dOptions = options3d(map)): Scene3D {
  const g = new Grid(map.grid, map.width, map.height);
  const L = map.layers;
  const N = g.size;
  const S = opts.tile;
  const overland = map.kind === 'overland';
  const blocks = opts.look === 'blocks';
  const step = overland ? Math.max(0.5, S / 2) : 0.5;
  const q = (h: number) => (blocks ? Math.round(h / step) * step : h);

  // ---- cell geometry -------------------------------------------------------------------------
  const polys: [number, number][][] = new Array(N);
  const centres: [number, number][] = new Array(N);
  /** Neighbour across each edge of the outline (-1 at the map edge). */
  const across: number[][] = new Array(N);
  for (let i = 0; i < N; i++) {
    const p = cellPolygon(g, i);
    polys[i] = p;
    const c = g.pos(i);
    centres[i] = c;
    across[i] = p.map((a, k) => {
      const b = p[(k + 1) % p.length];
      return g.posToCell(a[0] + b[0] - c[0], a[1] + b[1] - c[1]);
    });
  }

  // ---- heights -------------------------------------------------------------------------------
  const R = opts.relief;
  // The sea floor drops to a quarter of the relief: deep enough to read as sea, shallow enough to keep the slab thin.
  const landH = (e: number) => (e >= SEA_LEVEL ? ((e - SEA_LEVEL) / (1 - SEA_LEVEL)) * R : ((e - SEA_LEVEL) / SEA_LEVEL) * R * 0.25);
  const ground = new Float64Array(N);
  const water = new Float64Array(N).fill(NaN);
  const overWater = (t: number) => isWater(t) || t === T.BRIDGE || t === T.DOCK;
  for (let i = 0; i < N; i++) {
    const t = L.terrain[i];
    const base = overland ? landH(L.elevation[i]) : 0;
    if (overWater(t)) {
      if (overland && isSea(t) && L.elevation[i] < SEA_LEVEL) {
        water[i] = 0;
        ground[i] = Math.min(base, -Math.max(1, R * 0.03));
      } else {
        const level = overland ? (L.elevation[i] >= SEA_LEVEL ? base : 0) : -0.4;
        water[i] = level;
        ground[i] = level - (overland ? Math.max(1, R * 0.025) : 1.2);
      }
    } else if (t === T.PIT) {
      ground[i] = base - 4;
    } else if (t === T.VOID) {
      // Nothing here: a hole down to the storey below (or the map's base).
      ground[i] = base - 6;
    } else {
      ground[i] = base;
    }
  }
  if (overland) {
    // Soften single-cell spikes once: each land cell moves halfway towards its land neighbours.
    const soft = Float64Array.from(ground);
    for (let i = 0; i < N; i++) {
      if (!Number.isNaN(water[i]) || L.terrain[i] === T.PIT) continue;
      let sum = 2 * ground[i];
      let n = 2;
      for (const j of across[i]) {
        if (j < 0 || !Number.isNaN(water[j])) continue;
        sum += ground[j];
        n++;
      }
      soft[i] = Math.max(0, sum / n);
    }
    ground.set(soft);
  }
  // Heights set by hand (3D maps) raise or lower the ground in half metres.
  const ext0 = map.layers3d;
  if (ext0) {
    for (let i = 0; i < N; i++) {
      const dh = ext0.height[i] * 0.5;
      if (!dh) continue;
      ground[i] += dh;
      if (!Number.isNaN(water[i])) water[i] += dh;
    }
  }
  if (blocks) {
    for (let i = 0; i < N; i++) {
      ground[i] = q(ground[i]);
      if (!Number.isNaN(water[i])) {
        water[i] = Math.floor(water[i] / step + 1e-6) * step;
        if (ground[i] >= water[i]) ground[i] = water[i] - step;
      }
    }
  }

  // Smooth ground: a corner's height is the mean of the cells that share it. Worked out once per
  // cell (the same numbers are read for the ground, the water, the roads and the walls).
  const cornerKey = (x: number, z: number) => Math.round(x * 512) * 1048576 + Math.round(z * 512);
  const keys: number[][] = new Array(N);
  const corners: number[][] = new Array(N);
  if (blocks) {
    for (let i = 0; i < N; i++) corners[i] = polys[i].map(() => ground[i]);
  } else {
    // Number each distinct corner once, then add up in flat arrays.
    const slot = new Map<number, number>();
    const slots: number[][] = new Array(N);
    for (let i = 0; i < N; i++) {
      keys[i] = polys[i].map(([x, z]) => cornerKey(x, z));
      slots[i] = keys[i].map((k) => {
        let s = slot.get(k);
        if (s === undefined) slot.set(k, (s = slot.size));
        return s;
      });
    }
    const sum = new Float64Array(slot.size);
    const count = new Uint8Array(slot.size);
    for (let i = 0; i < N; i++) {
      for (const s of slots[i]) {
        sum[s] += ground[i];
        count[s]++;
      }
    }
    for (let i = 0; i < N; i++) corners[i] = slots[i].map((s) => sum[s] / count[s]);
    // Smooth normals are summed per corner slot too.
    for (let i = 0; i < N; i++) keys[i] = slots[i];
  }
  const cornerHeights = (i: number) => corners[i];

  /** Height of the ground surface at a logical point inside (or just outside) cell i. */
  const surfaceAt = (i: number, x: number, z: number): number => {
    if (blocks) return ground[i];
    const p = polys[i];
    const hs = cornerHeights(i);
    const [cx, cz] = centres[i];
    let best = -Infinity;
    let h = ground[i];
    for (let k = 0; k < p.length; k++) {
      const k2 = (k + 1) % p.length;
      const [u, v, w] = barycentric(x, z, cx, cz, p[k][0], p[k][1], p[k2][0], p[k2][1]);
      const m = Math.min(u, v, w);
      if (m > best) {
        best = m;
        h = u * ground[i] + v * hs[k] + w * hs[k2];
      }
    }
    return h;
  };
  const centreY = (i: number) => (Number.isNaN(water[i]) ? ground[i] : water[i]);

  let minY = Infinity;
  for (let i = 0; i < N; i++) minY = Math.min(minY, ground[i]);
  const baseY = minY - Math.max(1, S);

  // ---- ground --------------------------------------------------------------------------------
  const groundMesh = new MeshBuilder();
  const colorOf = (i: number): RGBA => {
    const c = rgba(tile(L.terrain[i]).color);
    return shade(c, 0.96 + 0.08 * hash01(i));
  };
  if (blocks) {
    for (let i = 0; i < N; i++) {
      const top = colorOf(i);
      const side = mix(shade(top, 0.78), EARTH, 0.35);
      const p = polys[i];
      const y = ground[i];
      if (L.terrain[i] !== T.VOID) groundMesh.face(p.map(([x, z]): V3 => [x * S, y, z * S]), top, [0, 1, 0]);
      for (let k = 0; k < p.length; k++) {
        const n = across[i][k];
        const lower = n < 0 ? baseY : ground[n];
        if (lower >= y) continue;
        const a = p[k];
        const b = p[(k + 1) % p.length];
        groundMesh.face(
          [[a[0] * S, lower, a[1] * S], [b[0] * S, lower, b[1] * S], [b[0] * S, y, b[1] * S], [a[0] * S, y, a[1] * S]],
          n < 0 ? SKIRT : side,
          [(a[0] + b[0]) / 2 - centres[i][0], 0, (a[1] + b[1]) / 2 - centres[i][1]],
        );
      }
    }
  } else {
    smoothGround(groundMesh, N, polys, centres, ground, corners, keys, colorOf, S);
    // A skirt down the map's edge so it reads as a solid slab.
    for (let i = 0; i < N; i++) {
      const p = polys[i];
      const hs = cornerHeights(i);
      for (let k = 0; k < p.length; k++) {
        if (across[i][k] >= 0) continue;
        const k2 = (k + 1) % p.length;
        const a = p[k];
        const b = p[k2];
        groundMesh.face(
          [[a[0] * S, baseY, a[1] * S], [b[0] * S, baseY, b[1] * S], [b[0] * S, hs[k2], b[1] * S], [a[0] * S, hs[k], a[1] * S]],
          SKIRT,
          [(a[0] + b[0]) / 2 - centres[i][0], 0, (a[1] + b[1]) / 2 - centres[i][1]],
        );
      }
    }
  }
  // ---- water ---------------------------------------------------------------------------------
  const waterMesh = new MeshBuilder();
  const depthColor = (depth: number): RGBA => {
    const t = smoothstep(0, Math.max(2, R * 0.12), depth);
    const c = mix(WATER_SHALLOW, WATER_DEEP, t);
    return depth < 0.25 ? mix(c, rgba('#e8f4f8', 200), 0.35) : c;
  };
  const waterPoly = (i: number, level: number) => {
    const p = polys[i];
    const hs = cornerHeights(i);
    const [cx, cz] = centres[i];
    // Fan from the centre so each corner can carry its own depth colour.
    const centre = waterMesh.vertex([cx * S, level, cz * S], [0, 1, 0], depthColor(level - ground[i]));
    const ring = p.map(([x, z], k) => waterMesh.vertex([x * S, level, z * S], [0, 1, 0], depthColor(level - hs[k])));
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      // Up-facing winding (x east, z south): centre, then the next corner, then this one.
      if (orientUp(p[k], p[(k + 1) % p.length], [cx, cz])) waterMesh.tri(centre, b, a);
      else waterMesh.tri(centre, a, b);
    }
  };
  for (let i = 0; i < N; i++) if (!Number.isNaN(water[i])) waterPoly(i, water[i]);
  // Where water meets the map's edge, close it with a face down to the ground (a cut-away view).
  for (let i = 0; i < N; i++) {
    if (Number.isNaN(water[i])) continue;
    const p = polys[i];
    const hs = cornerHeights(i);
    for (let k = 0; k < p.length; k++) {
      if (across[i][k] >= 0) continue;
      const k2 = (k + 1) % p.length;
      const lo0 = Math.min(hs[k], water[i]);
      const lo1 = Math.min(hs[k2], water[i]);
      if (lo0 >= water[i] - 1e-6 && lo1 >= water[i] - 1e-6) continue;
      const a = p[k];
      const b = p[k2];
      waterMesh.face(
        [[a[0] * S, lo0, a[1] * S], [b[0] * S, lo1, b[1] * S], [b[0] * S, water[i], b[1] * S], [a[0] * S, water[i], a[1] * S]],
        mix(WATER_DEEP, WATER_SHALLOW, 0.3),
        [(a[0] + b[0]) / 2 - centres[i][0], 0, (a[1] + b[1]) / 2 - centres[i][1]],
      );
    }
  }
  if (!blocks) {
    // Carry the water one cell onto the shore so the coastline follows the ground, not the grid.
    for (let i = 0; i < N; i++) {
      if (!Number.isNaN(water[i])) continue;
      let level = -Infinity;
      for (const n of across[i]) if (n >= 0 && !Number.isNaN(water[n]) && water[n] <= ground[i] + 1e-6) level = Math.max(level, water[n]);
      if (level > -Infinity && Math.min(...cornerHeights(i)) < level) waterPoly(i, level);
    }
  }

  // ---- structures: walls, buildings, gates, bridges, stairs -----------------------------------
  const structMesh = new MeshBuilder();
  const roofMesh = new MeshBuilder();
  const { h: solidH, top: solidTop, side: solidSide, buildings: buildingCells } = solidsOf(L, map.kind, opts.wall);
  const baseOf = (i: number) => (blocks ? ground[i] : Math.min(ground[i], ...cornerHeights(i)));
  const topOf = (i: number) => ground[i] + solidH[i];
  for (let i = 0; i < N; i++) {
    if (Number.isNaN(solidH[i])) continue;
    const p = polys[i];
    const y1 = topOf(i);
    const y0 = baseOf(i);
    structMesh.face(p.map(([x, z]): V3 => [x * S, y1, z * S]), solidTop[i], [0, 1, 0]);
    for (let k = 0; k < p.length; k++) {
      const n = across[i][k];
      const nSolid = n >= 0 && !Number.isNaN(solidH[n]);
      if (nSolid && topOf(n) >= y1 - 1e-6) continue;
      const lower = nSolid ? Math.max(y0, topOf(n)) : y0;
      const a = p[k];
      const b = p[(k + 1) % p.length];
      structMesh.face(
        [[a[0] * S, lower, a[1] * S], [b[0] * S, lower, b[1] * S], [b[0] * S, y1, b[1] * S], [a[0] * S, y1, a[1] * S]],
        solidSide[i],
        [(a[0] + b[0]) / 2 - centres[i][0], 0, (a[1] + b[1]) / 2 - centres[i][1]],
      );
    }
  }
  // Pitched roofs on buildings that fill a rectangle of square cells.
  if (!g.isHex) {
    for (const cells of buildingCells.values()) {
      let c0 = Infinity;
      let c1 = -Infinity;
      let r0 = Infinity;
      let r1 = -Infinity;
      for (const i of cells) {
        c0 = Math.min(c0, g.col(i));
        c1 = Math.max(c1, g.col(i));
        r0 = Math.min(r0, g.row(i));
        r1 = Math.max(r1, g.row(i));
      }
      const w = c1 - c0 + 1;
      const d = r1 - r0 + 1;
      if (w * d !== cells.length || w * d > 48) continue;
      const eaves = Math.max(...cells.map(topOf));
      const along = w >= d;
      const sx = (along ? w : d) * S;
      const sz = (along ? d : w) * S;
      structMesh.gable(((c0 + c1 + 1) / 2) * S, eaves, ((r0 + r1 + 1) / 2) * S, sx, sz, Math.min(sz * 0.45, 5), solidTop[cells[0]], along ? 0 : Math.PI / 2);
    }
  }

  // ---- storeys (3D maps) ---------------------------------------------------------------------
  const storeyH = opts.wall + 0.5;
  const zs = storeyNumbers(map);
  const levelBase = (z: number) => z * storeyH;
  const levelSolids = new Map<number, Float64Array>([[0, solidH]]);
  for (const z of zs) if (z !== 0) levelSolids.set(z, solidsOf(storeyLayers(map, z), 'dungeon', opts.wall).h);
  /** Surface height of the floor on cell i of storey z, or null where there is no floor. */
  const floorAt = (z: number, i: number): number | null => {
    if (!zs.includes(z)) return null;
    const t = storeyLayers(map, z).terrain[i];
    if (t === T.VOID || !Number.isNaN(levelSolids.get(z)![i])) return null;
    if (z === 0) return centreY(i);
    return levelBase(z) + (storey3d(map, z)?.height[i] ?? 0) * 0.5;
  };
  /** Stairs on a square grid with a set facing climb towards the floor they point at (Underkeep's rule). */
  const rampStairs = (z: number, i: number, facing: number, own: number, up: boolean) => {
    const dir = up ? facing : (facing + 2) % 4;
    const [dc, dr] = FACING_STEP[dir];
    const c = g.col(i) + dc;
    const r = g.row(i) + dr;
    let high = own;
    if (g.inBounds(c, r)) {
      const j = g.idx(c, r);
      const same = floorAt(z, j);
      const above = same === null ? floorAt(z + 1, j) : null;
      high = Math.max(own, same ?? above ?? own);
    }
    const ang = angleOfFacing(dir);
    const [cx, cz] = centres[i];
    const color = rgba('#a49c90');
    const rise = high - own;
    if (rise < 0.05) {
      structMesh.box(cx * S, own, cz * S, S * 0.9, 0.08, S * 0.9, color, ang);
      return;
    }
    const n = Math.max(2, Math.min(12, Math.round(rise / 0.25)));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n - 0.5;
      structMesh.box(cx * S + Math.cos(ang) * t * S, own, cz * S + Math.sin(ang) * t * S, S / n, (rise * (k + 1)) / n, S * 0.92, shade(color, 0.92 + 0.08 * (k % 2)), ang);
    }
  };
  for (let i = 0; i < N; i++) {
    const t = L.terrain[i];
    const p = polys[i].map(([x, z]): [number, number] => [x * S, z * S]);
    const y = ground[i];
    // Gates and doors in a wall get a lintel at the wall's height.
    const wall = across[i].find((n) => n >= 0 && !Number.isNaN(solidH[n]));
    if ((t === T.GATE || t === T.DOOR) && wall !== undefined) {
      const top = y + solidH[wall];
      structMesh.prism(p, Math.max(y + 2.4, top - (t === T.GATE ? 2 : 1.6)), top, solidTop[wall], solidSide[wall]);
    } else if (t === T.BRIDGE || t === T.DOCK) {
      const deck = Number.isNaN(water[i]) ? y : water[i];
      structMesh.prism(p, deck + 0.15, deck + 0.45, rgba(tile(t).color), shade(rgba(tile(t).color), 0.75));
    } else if (t === T.STAIRS_UP || t === T.STAIRS_DOWN) {
      const f = ext0?.facing[i] ?? -1;
      if (f >= 0 && !g.isHex) rampStairs(0, i, f, y, t === T.STAIRS_UP);
      // Without a set facing, stairs climb towards the walls around them (the stairwell's back).
      else stairs(structMesh, centres[i], facingAngle(i, centres, across, solidH) + Math.PI, S, y, t === T.STAIRS_UP ? 1 : -1);
    }
  }
  // A storey under the ground needs the ground's underside as its ceiling.
  if (zs[0] < 0) {
    for (let i = 0; i < N; i++) {
      if (L.terrain[i] === T.VOID) continue;
      structMesh.face(polys[i].map(([x, z]): V3 => [x * S, -0.5, z * S]), rgba('#3a3630'), [0, -1, 0]);
    }
  }
  // The other storeys: floor slabs, walls, stairs.
  for (const z of zs) {
    if (z === 0) continue;
    const Lz = storeyLayers(map, z);
    const Ez = storey3d(map, z)!;
    const base = levelBase(z);
    const sol = solidsOf(Lz, 'dungeon', opts.wall);
    for (let i = 0; i < N; i++) {
      const t = Lz.terrain[i];
      if (t === T.VOID) continue;
      const solid = !Number.isNaN(sol.h[i]);
      const top = solid ? base + sol.h[i] : (floorAt(z, i) as number);
      const nbTop = (n: number): number | null => {
        if (n < 0 || Lz.terrain[n] === T.VOID) return null;
        return Number.isNaN(sol.h[n]) ? (floorAt(z, n) as number) : base + sol.h[n];
      };
      column(structMesh, polys[i], centres[i], across[i], S, base - 0.5, top, solid ? sol.top[i] : colorOfTile(t, i), solid ? sol.side[i] : shade(colorOfTile(t, i), 0.75), nbTop, true);
      if (!solid && (t === T.STAIRS_UP || t === T.STAIRS_DOWN) && Ez.facing[i] >= 0 && !g.isHex) rampStairs(z, i, Ez.facing[i], top, t === T.STAIRS_UP);
    }
  }
  // Ceilings: a covered floor with nothing built over it gets a roof slab at the top of its storey.
  for (const z of zs) {
    const Ez = storey3d(map, z);
    if (!Ez) continue;
    const top = levelBase(z) + opts.wall;
    for (let i = 0; i < N; i++) {
      if (!Ez.roof[i] || floorAt(z, i) === null) continue;
      if (zs.includes(z + 1) && storeyLayers(map, z + 1).terrain[i] !== T.VOID) continue;
      const y = Math.max(top, (floorAt(z, i) as number) + 2.4);
      const poly = polys[i].map(([x, zz]): [number, number] => [x * S, zz * S]);
      roofMesh.prism(poly, y, y + 0.5, rgba('#5e5650'), rgba('#4e4842'));
      roofMesh.face(poly.map(([x, zz]): V3 => [x, y, zz]), rgba('#3c3833'), [0, -1, 0]);
    }
  }

  // ---- roads and rivers ----------------------------------------------------------------------
  const roadMesh = new MeshBuilder();
  const strips = (layer: number[], out: MeshBuilder, width: (i: number) => number, color: (i: number) => RGBA, lift: number) => {
    for (let i = 0; i < N; i++) {
      if (!layer[i]) continue;
      const [cx, cz] = centres[i];
      const w = width(i);
      const col = color(i);
      const ends = linkedNeighbors(g, layer, i);
      const at = (x: number, z: number): V3 => [x * S, surfaceAt(i, x, z) + lift, z * S];
      // A small disc joins the strips at the cell centre.
      const disc: V3[] = Array.from({ length: 8 }, (_, k) => {
        const a = (k / 8) * Math.PI * 2;
        return at(cx + (Math.cos(a) * w) / 2, cz + (Math.sin(a) * w) / 2);
      });
      out.face(disc, col, [0, 1, 0]);
      for (const n of ends) {
        const mx = (cx + centres[n][0]) / 2;
        const mz = (cz + centres[n][1]) / 2;
        const dx = mx - cx;
        const dz = mz - cz;
        const len = Math.hypot(dx, dz) || 1;
        const px = (-dz / len) * (w / 2);
        const pz = (dx / len) * (w / 2);
        out.face([at(cx + px, cz + pz), at(mx + px, mz + pz), at(mx - px, mz - pz), at(cx - px, cz - pz)], col, [0, 1, 0]);
      }
    }
  };
  strips(L.road, roadMesh, (i) => ROAD_WIDTH[L.roadLevel[i] || 1] ?? 0.2, (i) => ROAD_COLORS[L.roadLevel[i] || 1] ?? ROAD_COLORS[2], blocks ? 0.04 : 0.08);
  strips(
    L.river,
    waterMesh,
    (i) => Math.max(0.12, Math.min(0.55, 0.08 + Math.log10(Math.max(1, L.riverSize[i])) * 0.13)),
    () => RIVER,
    blocks ? 0.06 : 0.12,
  );

  // ---- objects and props ---------------------------------------------------------------------
  const objMesh = new MeshBuilder();
  const markers: SceneMarker[] = [];
  const names = new Map<string, number>();
  const uniqueName = (base: string) => {
    const clean = base.replace(/[^\w .:'()-]+/g, ' ').trim() || 'marker';
    const n = (names.get(clean) ?? 0) + 1;
    names.set(clean, n);
    return n === 1 ? clean : `${clean} ${n}`;
  };
  const storeyTag = (z: number) => (z ? { storey: z } : {});
  for (const z of zs) {
    const Lz = storeyLayers(map, z);
    const Ez = storey3d(map, z);
    const sol = levelSolids.get(z)!;
    for (let i = 0; i < N; i++) {
      const def = objectDef(Lz.object[i]);
      const prop = Ez ? propDef(Ez.prop[i]) : undefined;
      if (!def && !prop) continue;
      const y = floorAt(z, i) ?? (z === 0 ? centreY(i) : levelBase(z));
      const [cx, cz] = centres[i];
      const set = Ez && Ez.facing[i] >= 0 ? Ez.facing[i] : -1;
      // A gate or door spans the passage it stands in: east–west between walls to its west or
      // east, else north–south (the way RPG-DC's doorFacing turns its art). A boat lies alongside
      // its jetty: north–south when land is west or east of it, else east–west (RPG-DC's boat-y and boat-x).
      const spans = def?.shape === 'gate' || def?.shape === 'lockdoor';
      const facing =
        set >= 0
          ? angleOfFacing(set)
          : spans
            ? spanAngle(i, centres, across, sol)
            : def?.key === 'boat'
              ? mooredAngle(i, centres, across, Lz.terrain)
              : facingAngle(i, centres, across, sol);
      if (def) {
        objectModel(objMesh, def, cx * S, y, cz * S, S, i, facing, (dir) => {
          // Fence rails run to neighbouring fences (and ruined walls to neighbouring ruins).
          const out: [number, number][] = [];
          for (const n of g.neighbors(i, !g.isHex ? false : true)) {
            const nd = objectDef(Lz.object[n]);
            if (nd && nd.group === dir) out.push([(centres[n][0] - cx) * S, (centres[n][1] - cz) * S]);
          }
          return out;
        });
        if (['station', 'fishing', 'stairs', 'door', 'herb', 'altar', 'travel', 'puzzle', 'farm'].includes(def.group) || def.key === 'cache') {
          markers.push({
            name: uniqueName(`${def.key} ${g.col(i)},${g.row(i)}`),
            position: [cx * S, y, cz * S],
            data: { kind: 'object', key: def.key, id: def.id, name: def.name, group: def.group, col: g.col(i), row: g.row(i), ...storeyTag(z) },
          });
        }
      }
      if (prop) {
        propModel(objMesh, prop, cx * S, y, cz * S, S, i, facing);
        if (prop.group === 'light' || prop.group === 'loot' || prop.group === 'danger' || prop.light) {
          markers.push({
            name: uniqueName(`${prop.key} ${g.col(i)},${g.row(i)}`),
            position: [cx * S, y, cz * S],
            data: {
              kind: 'prop',
              key: prop.key,
              id: prop.id,
              name: prop.name,
              group: prop.group,
              col: g.col(i),
              row: g.row(i),
              ...storeyTag(z),
              ...(set >= 0 && { facing: ['north', 'east', 'south', 'west'][set] }),
              ...(prop.light && { lightRadius: prop.light }),
              ...(prop.sanctuary && { sanctuary: true }),
            },
          });
        }
      }
    }
  }

  // ---- places --------------------------------------------------------------------------------
  const placeMesh = new MeshBuilder();
  for (const f of map.features) {
    if (!g.inBounds(f.c, f.r)) continue;
    const i = g.idx(f.c, f.r);
    const z = featureStorey(f);
    const [cx, cz] = centres[i];
    const y = floorAt(z, i) ?? (z === 0 ? centreY(i) : levelBase(z));
    const def = featureDef(f.type);
    if (overland && z === 0) placeModel(placeMesh, f.type, cx * S, y, cz * S, S, hashString(f.id));
    markers.push({
      name: uniqueName(f.name ? `${def.label}: ${f.name}` : def.label),
      position: [cx * S, y, cz * S],
      data: {
        kind: 'place',
        id: f.id,
        type: f.type,
        label: def.label,
        name: f.name,
        col: f.c,
        row: f.r,
        ...storeyTag(z),
        ...(f.tags?.length && { tags: f.tags }),
        ...(f.notes && { notes: f.notes }),
        ...(f.props && Object.keys(f.props).length && { props: f.props }),
        ...(f.childMapId && { detailMapId: f.childMapId }),
      },
    });
  }
  // Named rooms: a marker at each room's middle carrying its outline.
  for (const room of map.rooms ?? []) {
    const c = clampInt((room.c0 + room.c1) / 2, 0, g.width - 1);
    const r = clampInt((room.r0 + room.r1) / 2, 0, g.height - 1);
    const i = g.idx(c, r);
    const y = floorAt(room.z, i) ?? levelBase(room.z);
    markers.push({
      name: uniqueName(`Room: ${room.name}`),
      position: [centres[i][0] * S, y, centres[i][1] * S],
      data: { kind: 'room', name: room.name, storey: room.z, c0: room.c0, r0: room.r0, c1: room.c1, r1: room.r1 },
    });
  }

  // ---- assemble ------------------------------------------------------------------------------
  const parts: ScenePart[] = [];
  const add = (name: string, kind: PartKind, solid: boolean, m: MeshBuilder) => {
    if (!m.empty) parts.push({ name, kind, solid, mesh: m.build() });
  };
  add('Ground-col', 'ground', true, groundMesh);
  add('Structures-col', 'structures', true, structMesh);
  add('Roofs-col', 'roofs', true, roofMesh);
  add('Objects-col', 'objects', true, objMesh);
  add('Places-col', 'places', true, placeMesh);
  add('Roads', 'roads', false, roadMesh);
  add('Water', 'water', false, waterMesh);

  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const p = part.mesh.positions;
    for (let k = 0; k < p.length; k += 3) {
      for (let a = 0; a < 3; a++) {
        if (p[k + a] < min[a]) min[a] = p[k + a];
        if (p[k + a] > max[a]) max[a] = p[k + a];
      }
    }
  }
  if (!parts.length) {
    min.fill(0);
    max.fill(0);
  }
  return {
    name: map.name,
    options: opts,
    bounds: { min, max },
    parts,
    markers,
    underground: map.kind === 'dungeon',
    info: {
      format: 'world-builder-3d',
      version: 1,
      map: map.name,
      mapId: map.id,
      kind: map.kind,
      grid: map.grid,
      width: map.width,
      height: map.height,
      seed: map.seed,
      tileMetres: S,
      look: opts.look,
      reliefMetres: opts.relief,
      wallMetres: opts.wall,
      axes: 'x = east (columns), z = south (rows), y = up; metres; origin at the top-left corner of the map',
    },
  };
}

// ---- helpers ---------------------------------------------------------------------------------

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function barycentric(px: number, pz: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number): [number, number, number] {
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-12) return [1, 0, 0];
  const u = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
  const v = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
  return [u, v, 1 - u - v];
}

/** True if (centre, b, a) winds counter-clockwise seen from above (normal +y with x east, z south). */
function orientUp(a: [number, number], b: [number, number], c: [number, number]): boolean {
  const n = cross([b[0] - c[0], 0, b[1] - c[1]], [a[0] - c[0], 0, a[1] - c[1]]);
  return n[1] > 0;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  return h >>> 0;
}

/** Smooth ground: each cell is a fan from its centre; normals are shared across cells so slopes shade smoothly. */
function smoothGround(
  out: MeshBuilder,
  N: number,
  polys: [number, number][][],
  centres: [number, number][],
  ground: Float64Array,
  corners: number[][],
  slots: number[][],
  colorOf: (i: number) => RGBA,
  S: number,
): void {
  let slotCount = 0;
  for (let i = 0; i < N; i++) for (const s of slots[i]) if (s >= slotCount) slotCount = s + 1;
  // Pass 1: add up the (area-weighted) face normals at every corner; centres belong to one cell.
  const acc = new Float64Array(slotCount * 3);
  const centreN = new Float64Array(N * 3);
  const flips: boolean[][] = new Array(N);
  for (let i = 0; i < N; i++) {
    const p = polys[i];
    const cx = centres[i][0] * S;
    const cy = ground[i];
    const cz = centres[i][1] * S;
    flips[i] = new Array(p.length);
    for (let k = 0; k < p.length; k++) {
      const k2 = (k + 1) % p.length;
      const ax = p[k][0] * S - cx;
      const ay = corners[i][k] - cy;
      const az = p[k][1] * S - cz;
      const bx = p[k2][0] * S - cx;
      const by = corners[i][k2] - cy;
      const bz = p[k2][1] * S - cz;
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const flip = ny < 0;
      if (flip) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      flips[i][k] = flip;
      centreN[i * 3] += nx;
      centreN[i * 3 + 1] += ny;
      centreN[i * 3 + 2] += nz;
      for (const s of [slots[i][k], slots[i][k2]]) {
        acc[s * 3] += nx;
        acc[s * 3 + 1] += ny;
        acc[s * 3 + 2] += nz;
      }
    }
  }
  const unit = (a: Float64Array, o: number): V3 => {
    const l = Math.hypot(a[o], a[o + 1], a[o + 2]) || 1;
    return [a[o] / l, a[o + 1] / l, a[o + 2] / l];
  };
  // Pass 2: each cell keeps its own vertices (crisp tile colours); positions and normals match across cells.
  for (let i = 0; i < N; i++) {
    const p = polys[i];
    const color = colorOf(i);
    const centre = out.vertex([centres[i][0] * S, ground[i], centres[i][1] * S], unit(centreN, i * 3), color);
    const ring = p.map(([x, z], k) => out.vertex([x * S, corners[i][k], z * S], unit(acc, slots[i][k] * 3), color));
    for (let k = 0; k < p.length; k++) {
      const k2 = (k + 1) % p.length;
      if (flips[i][k]) out.tri(centre, ring[k2], ring[k]);
      else out.tri(centre, ring[k], ring[k2]);
    }
  }
}

/** Height and colours of the solid things (walls, rock, buildings, the keep) on a storey's cells. */
function solidsOf(L: { terrain: number[]; building: number[] }, kind: WorldMap['kind'], wall: number) {
  const N = L.terrain.length;
  const h = new Float64Array(N).fill(NaN);
  const top: RGBA[] = new Array(N);
  const side: RGBA[] = new Array(N);
  const buildings = new Map<number, number[]>();
  for (let i = 0; i < N; i++) {
    const t = L.terrain[i];
    switch (t) {
      case T.ROCK:
        h[i] = wall;
        top[i] = rgba('#34323b');
        side[i] = STONE;
        break;
      case T.CRYPT_WALL:
        h[i] = wall;
        top[i] = rgba(tile(t).color);
        side[i] = rgba('#5c5462');
        break;
      case T.WALL:
        h[i] = kind === 'dungeon' ? wall : 6;
        top[i] = shade(rgba(tile(t).color), 1.15);
        side[i] = rgba('#8a8580');
        break;
      case T.KEEP:
        h[i] = 14;
        top[i] = rgba(tile(t).color);
        side[i] = rgba('#9a9aa6');
        break;
      case T.BUILDING: {
        const id = L.building[i] || i + 1;
        const storeys = 1 + Math.floor(hash01(id * 7 + 3) * (hash01(id) < 0.15 ? 3 : 2));
        h[i] = storeys * 3.2 + 0.4;
        top[i] = ROOF_PALETTE[Math.floor(hash01(id * 13) * ROOF_PALETTE.length)];
        side[i] = WALL_PALETTE[Math.floor(hash01(id * 5 + 1) * WALL_PALETTE.length)];
        if (L.building[i]) {
          const list = buildings.get(L.building[i]) ?? [];
          list.push(i);
          buildings.set(L.building[i], list);
        }
        break;
      }
    }
  }
  return { h, top, side, buildings };
}

function colorOfTile(t: number, i: number): RGBA {
  return shade(rgba(tile(t).color), 0.96 + 0.08 * hash01(i));
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/**
 * A flat-topped column over a cell from y0 to y1: the top, the sides that show (where the
 * neighbour's top is lower, or there is no neighbour), and optionally the underside.
 */
function column(
  out: MeshBuilder,
  poly: [number, number][],
  centre: [number, number],
  across: number[],
  S: number,
  y0: number,
  y1: number,
  top: RGBA,
  side: RGBA,
  nbTop: (n: number) => number | null,
  bottom = false,
): void {
  out.face(poly.map(([x, z]): V3 => [x * S, y1, z * S]), top, [0, 1, 0]);
  if (bottom) out.face(poly.map(([x, z]): V3 => [x * S, y0, z * S]), shade(side, 0.6), [0, -1, 0]);
  for (let k = 0; k < poly.length; k++) {
    const t = nbTop(across[k]);
    const lower = t === null ? y0 : Math.max(y0, t);
    if (lower >= y1 - 1e-6) continue;
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    out.face(
      [[a[0] * S, lower, a[1] * S], [b[0] * S, lower, b[1] * S], [b[0] * S, y1, b[1] * S], [a[0] * S, y1, a[1] * S]],
      side,
      [(a[0] + b[0]) / 2 - centre[0], 0, (a[1] + b[1]) / 2 - centre[1]],
    );
  }
}

/** A primitive model for a 3D prop standing on (x, y, z), its front towards `facing`. */
function propModel(out: MeshBuilder, def: PropDef, x: number, y: number, z: number, S: number, seed: number, facing: number): void {
  const c = rgba(def.color);
  const fx = Math.cos(facing);
  const fz = Math.sin(facing);
  // Wall things stand at the back of their cell, against the wall behind them.
  const back = def.wall ? S * 0.38 : 0;
  const bx = x - fx * back;
  const bz = z - fz * back;
  const turn = facing + Math.PI / 2;
  const wood = rgba('#7a5a3a');
  const stone = rgba('#8a857c');
  const flame = rgba('#ffb040');
  switch (def.key) {
    case 'pillar':
      out.cylinder(x, y, z, S * 0.22, S * 0.2, 4.2, 10, c);
      return;
    case 'statue':
      out.box(x, y, z, 0.9, 0.5, 0.9, stone, turn);
      out.cylinder(x, y + 0.5, z, 0.28, 0.22, 1.5, 8, c);
      out.blob(x, y + 2.2, z, 0.22, 0.26, 0.22, c, seed);
      return;
    case 'rubble':
      for (let k = 0; k < 4; k++) out.blob(x + (hash01(seed + k) - 0.5) * S * 0.5, y + 0.2, z + (hash01(seed + k * 7) - 0.5) * S * 0.5, 0.35, 0.25, 0.3, c, seed + k);
      return;
    case 'locked_door':
      out.box(bx, y, bz, S * 0.9, 2.4, 0.18, c, turn);
      out.box(bx + fx * 0.1, y + 1.1, bz + fz * 0.1, 0.18, 0.22, 0.06, rgba('#d8c060'), turn);
      return;
    case 'pew':
      out.box(x, y, z, S * 0.8, 0.45, 0.45, c, turn);
      out.box(x - fx * 0.2, y + 0.45, z - fz * 0.2, S * 0.8, 0.5, 0.08, c, turn);
      return;
    case 'chair':
      out.box(x, y, z, 0.5, 0.45, 0.5, c, turn);
      out.box(x - fx * 0.22, y + 0.45, z - fz * 0.22, 0.5, 0.55, 0.06, c, turn);
      return;
    case 'desk':
      out.box(x, y, z, 1.2, 0.8, 0.6, c, turn);
      out.cylinder(x + 0.3, y + 0.8, z, 0.04, 0.04, 0.2, 6, rgba('#f0e8c8'));
      return;
    case 'wardrobe':
      out.box(bx, y, bz, 1.2, 2.1, 0.6, c, turn);
      return;
    case 'shelf':
      out.box(bx, y, bz, 1.2, 1.8, 0.35, c, turn);
      for (let k = 0; k < 3; k++) out.cylinder(bx + fx * 0.1 + (k - 1) * 0.3 * Math.cos(turn), y + 1.0, bz + fz * 0.1 + (k - 1) * 0.3 * Math.sin(turn), 0.08, 0.08, 0.2, 6, rgba('#9ac0b0'));
      return;
    case 'altar':
      out.box(x, y, z, 1.6, 1.0, 0.8, c, turn);
      out.cylinder(x - 0.5 * Math.cos(turn), y + 1.0, z - 0.5 * Math.sin(turn), 0.04, 0.04, 0.25, 6, rgba('#f8f0d8'));
      out.cylinder(x + 0.5 * Math.cos(turn), y + 1.0, z + 0.5 * Math.sin(turn), 0.04, 0.04, 0.25, 6, rgba('#f8f0d8'));
      return;
    case 'rug':
      out.box(x, y + 0.01, z, S * 0.8, 0.03, S * 0.6, c, turn);
      return;
    case 'banner':
      out.box(bx, y + 1.4, bz, 0.8, 1.8, 0.05, c, turn);
      return;
    case 'training_dummy':
      out.cylinder(x, y, z, 0.06, 0.06, 1.0, 6, wood);
      out.cylinder(x, y + 1.0, z, 0.25, 0.2, 0.7, 8, c);
      out.blob(x, y + 1.9, z, 0.18, 0.2, 0.18, c, seed);
      return;
    case 'gravestone':
      out.box(x, y, z, 0.7, 1.0, 0.18, c, turn);
      return;
    case 'hay':
      out.box(x - 0.3, y, z, 0.9, 0.5, 0.6, c, turn);
      out.box(x + 0.3, y, z + 0.1, 0.9, 0.5, 0.6, c, turn + 0.4);
      return;
    case 'cauldron':
      out.cylinder(x, y, z, 0.35, 0.45, 0.6, 10, c);
      out.cylinder(x, y + 0.6, z, 0.38, 0.38, 0.02, 10, rgba('#6ab060'));
      return;
    case 'fountain':
      out.cylinder(x, y, z, S * 0.42, S * 0.42, 0.5, 12, stone);
      out.cylinder(x, y + 0.5, z, S * 0.36, S * 0.36, 0.02, 12, rgba('#5a9ac8'));
      out.cylinder(x, y, z, 0.15, 0.12, 1.4, 8, stone);
      return;
    case 'great_bell':
      out.cylinder(x, y + 1.0, z, 0.9, 0.45, 1.3, 12, c);
      return;
    case 'brazier':
      out.cylinder(x, y, z, 0.12, 0.2, 0.9, 6, rgba('#4a4440'));
      out.cylinder(x, y + 0.9, z, 0.25, 0.45, 0.3, 8, rgba('#4a4440'));
      out.cylinder(x, y + 1.2, z, 0.3, 0, 0.5, 6, flame);
      return;
    case 'wall_torch':
      out.box(bx, y + 1.8, bz, 0.1, 0.5, 0.1, wood, turn);
      out.cylinder(bx + fx * 0.06, y + 2.3, bz + fz * 0.06, 0.1, 0, 0.3, 6, flame);
      return;
    case 'candelabra':
      out.cylinder(x, y, z, 0.2, 0.05, 1.4, 6, rgba('#c8a040'));
      for (let k = -1; k <= 1; k++) out.cylinder(x + k * 0.2 * Math.cos(turn), y + 1.4, z + k * 0.2 * Math.sin(turn), 0.035, 0.035, 0.25, 6, rgba('#f8f0d8'));
      return;
    case 'standing_torch':
      out.cylinder(x, y, z, 0.06, 0.05, 2.2, 6, wood);
      out.cylinder(x, y + 2.2, z, 0.14, 0, 0.4, 6, flame);
      return;
    case 'hearth':
      out.box(bx, y, bz, S * 0.9, 1.4, 0.7, stone, turn);
      out.box(bx + fx * 0.2, y + 0.1, bz + fz * 0.2, S * 0.5, 0.7, 0.4, rgba('#2a2420'), turn);
      out.cylinder(bx + fx * 0.25, y + 0.1, bz + fz * 0.25, 0.25, 0, 0.5, 6, flame);
      return;
    case 'campfire':
    case 'bonfire': {
      const k = def.key === 'bonfire' ? 1.8 : 1;
      for (let n = 0; n < 7; n++) {
        const a = (n / 7) * Math.PI * 2;
        out.blob(x + Math.cos(a) * 0.45 * k, y + 0.1, z + Math.sin(a) * 0.45 * k, 0.13 * k, 0.1 * k, 0.13 * k, stone, seed + n);
      }
      out.cylinder(x, y, z, 0.3 * k, 0, 0.8 * k, 6, flame);
      return;
    }
    case 'chest':
      out.box(x, y, z, 0.9, 0.55, 0.55, c, turn);
      out.box(x, y + 0.55, z, 0.9, 0.15, 0.55, shade(c, 0.85), turn);
      return;
    case 'pots':
      for (let k = 0; k < 3; k++) out.cylinder(x + (k - 1) * 0.35, y, z + (k % 2) * 0.25, 0.16, 0.12, 0.5, 8, c);
      return;
    case 'weapon_rack':
      out.box(bx, y, bz, 1.4, 1.6, 0.3, wood, turn);
      for (let k = -1; k <= 1; k++) out.box(bx + fx * 0.15 + k * 0.4 * Math.cos(turn), y + 0.3, bz + fz * 0.15 + k * 0.4 * Math.sin(turn), 0.06, 1.3, 0.06, c, turn);
      return;
    case 'spike_trap':
      out.box(x, y + 0.01, z, S * 0.8, 0.05, S * 0.8, rgba('#3a3634'), turn);
      for (let k = 0; k < 9; k++) out.cylinder(x + ((k % 3) - 1) * S * 0.22, y, z + (Math.floor(k / 3) - 1) * S * 0.22, 0.05, 0, 0.3, 4, c);
      return;
  }
  out.box(x, y, z, 0.7, 0.9, 0.7, c, turn);
}

/** Which way a thing on cell i faces: towards open floor, away from the walls around it. */
function facingAngle(i: number, centres: [number, number][], across: number[][], solidH: Float64Array): number {
  let x = 0;
  let z = 0;
  for (const n of across[i]) {
    if (n < 0 || Number.isNaN(solidH[n])) continue;
    x -= centres[n][0] - centres[i][0];
    z -= centres[n][1] - centres[i][1];
  }
  return x === 0 && z === 0 ? 0 : Math.atan2(z, x);
}

/**
 * The way a gate or door at cell i runs (radians, 0 = along x): east–west when a solid neighbour
 * lies to its west or east (on its row), else north–south.
 */
function spanAngle(i: number, centres: [number, number][], across: number[][], solidH: Float64Array): number {
  const wallBeside = across[i].some((n) => n >= 0 && !Number.isNaN(solidH[n]) && Math.abs(centres[n][1] - centres[i][1]) < 0.25);
  return wallBeside ? 0 : Math.PI / 2;
}

/**
 * The way a boat at cell i lies (radians, 0 = along x): along z (north–south) when there's land,
 * not water, to its west or east (on its row), else along x.
 */
function mooredAngle(i: number, centres: [number, number][], across: number[][], terrain: ArrayLike<number>): number {
  const landBeside = across[i].some((n) => n >= 0 && !isWater(terrain[n]) && Math.abs(centres[n][1] - centres[i][1]) < 0.25);
  return landBeside ? Math.PI / 2 : 0;
}

function stairs(out: MeshBuilder, centre: [number, number], ang: number, S: number, y: number, dir: 1 | -1): void {
  const steps = 5;
  const run = S * 0.8;
  const rise = 2.2;
  const color = rgba(dir > 0 ? '#9c968c' : '#6a6470');
  const cx = centre[0] * S;
  const cz = centre[1] * S;
  for (let k = 0; k < steps; k++) {
    const t = (k + 0.5) / steps - 0.5;
    const px = cx + Math.cos(ang) * t * run;
    const pz = cz + Math.sin(ang) * t * run;
    if (dir > 0) out.box(px, y, pz, run / steps, (rise * (k + 1)) / steps, S * 0.7, color, ang);
    else out.box(px, y - (rise * (k + 1)) / steps, pz, run / steps, 0.12, S * 0.7, color, ang);
  }
  if (dir < 0) out.box(cx, y - rise - 0.2, cz, S * 0.85, 0.1, S * 0.85, DARK);
}

/** A primitive model for an object, standing on (x, y, z). `S` is the cell size in metres. */
function objectModel(
  out: MeshBuilder,
  def: ObjectDef,
  x: number,
  y: number,
  z: number,
  S: number,
  seed: number,
  facing: number,
  linksTo: (group: string) => [number, number][],
): void {
  const c = rgba(def.color);
  const r = hash01(seed);
  const k = Math.min(1, S / 2.5) * (0.88 + 0.24 * r);
  const trunk = rgba('#6b4a2e');
  switch (def.shape) {
    case 'pine':
      out.cylinder(x, y, z, 0.14 * k, 0.1 * k, 1.2 * k, 6, trunk);
      out.cylinder(x, y + 0.9 * k, z, 1.0 * k, 0, 2.2 * k, 7, c);
      out.cylinder(x, y + 2.1 * k, z, 0.72 * k, 0, 1.8 * k, 7, shade(c, 1.1));
      return;
    case 'round':
      out.cylinder(x, y, z, 0.16 * k, 0.12 * k, 1.4 * k, 6, trunk);
      out.blob(x, y + 2.2 * k, z, 1.1 * k, 1.0 * k, 1.1 * k, c, seed);
      return;
    case 'willow':
      out.cylinder(x, y, z, 0.16 * k, 0.12 * k, 1.5 * k, 6, trunk);
      out.blob(x, y + 2.0 * k, z, 1.3 * k, 0.9 * k, 1.3 * k, c, seed);
      out.cylinder(x, y + 0.6 * k, z, 1.25 * k, 0.9 * k, 1.3 * k, 8, shade(c, 0.9), false);
      return;
    case 'boulder':
      out.blob(x, y + 0.35 * k, z, 0.75 * k, 0.55 * k, 0.65 * k, c, seed);
      return;
    case 'ore':
      out.blob(x, y + 0.35 * k, z, 0.7 * k, 0.55 * k, 0.65 * k, rgba('#7d7770'), seed);
      for (let n = 0; n < 3; n++) {
        const a = (n / 3) * Math.PI * 2 + r * 6;
        out.blob(x + Math.cos(a) * 0.45 * k, y + 0.45 * k, z + Math.sin(a) * 0.45 * k, 0.16 * k, 0.16 * k, 0.16 * k, c, seed + n);
      }
      return;
    case 'fence': {
      out.box(x, y, z, 0.18, 1.3, 0.18, c);
      for (const [dx, dz] of linksTo(def.group)) {
        const len = Math.hypot(dx, dz) / 2;
        const ang = Math.atan2(dz, dx);
        out.box(x + dx / 4, y + 0.45, z + dz / 4, len, 0.12, 0.08, c, ang);
        out.box(x + dx / 4, y + 0.95, z + dz / 4, len, 0.12, 0.08, c, ang);
      }
      return;
    }
    case 'cairn':
      // A small pile of stones: a ring of four, two on them and one on top.
      for (let n = 0; n < 4; n++) {
        const a = (n / 4) * Math.PI * 2 + r * 6;
        out.blob(x + Math.cos(a) * 0.3, y + 0.12, z + Math.sin(a) * 0.3, 0.22, 0.16, 0.2, shade(c, 0.9 + (n % 2) * 0.15), seed + n);
      }
      for (let n = 0; n < 2; n++) {
        const a = n * Math.PI + r * 6;
        out.blob(x + Math.cos(a) * 0.13, y + 0.36, z + Math.sin(a) * 0.13, 0.18, 0.13, 0.17, c, seed + 4 + n);
      }
      out.blob(x, y + 0.56, z, 0.13, 0.11, 0.13, shade(c, 1.1), seed + 6);
      return;
    case 'thicket':
      // A dense, low tree of a bush, dark green, that can be pushed through.
      out.cylinder(x, y, z, 0.12 * k, 0.09 * k, 0.9 * k, 6, trunk);
      out.blob(x, y + 1.1 * k, z, 1.15 * k, 0.95 * k, 1.15 * k, c, seed);
      out.blob(x + 0.35 * k, y + 1.7 * k, z - 0.2 * k, 0.75 * k, 0.6 * k, 0.75 * k, shade(c, 1.15), seed + 1);
      return;
    case 'gate':
    case 'lockdoor': {
      // A stone doorway across the passage (`facing` runs along it): two posts and a lintel, with
      // an iron portcullis in it, or an iron-bound wooden door with a brass lock.
      const ca = Math.cos(facing);
      const sa = Math.sin(facing);
      const along = (d: number): [number, number] => [x + ca * d, z + sa * d];
      for (const side of [-1, 1]) {
        const [px, pz] = along(side * 0.62);
        out.box(px, y, pz, 0.3, 2.5, 0.5, STONE, facing);
      }
      out.box(x, y + 2.5, z, 1.55, 0.35, 0.5, STONE, facing);
      if (def.shape === 'gate') {
        for (let n = 0; n < 5; n++) {
          const [bx, bz] = along(-0.4 + n * 0.2);
          out.box(bx, y, bz, 0.06, 2.5, 0.06, c, facing);
        }
        for (const h of [0.6, 1.4, 2.1]) out.box(x, y + h, z, 0.95, 0.07, 0.07, c, facing);
      } else {
        out.box(x, y, z, 0.94, 2.4, 0.16, c, facing);
        for (const h of [0.5, 1.8]) out.box(x, y + h, z, 0.96, 0.12, 0.2, rgba('#3a3634'), facing);
        const [lx, lz] = along(0.28);
        out.box(lx, y + 1.1, lz, 0.14, 0.2, 0.24, rgba('#d8a84a'), facing);
      }
      return;
    }
    case 'lever': {
      // A lever on a stone block: a stout iron handle set to one side of its slot, with a brass knob.
      out.box(x, y, z, 0.7, 0.55, 0.7, STONE, facing);
      out.box(x, y + 0.55, z, 0.42, 0.05, 0.14, rgba('#2a2628'), facing);
      const [hx, hz] = [x + Math.cos(facing) * 0.12, z + Math.sin(facing) * 0.12];
      out.box(hx, y + 0.55, hz, 0.09, 0.75, 0.09, rgba('#3a3634'), facing);
      out.blob(hx, y + 1.35, hz, 0.13, 0.13, 0.13, c, seed);
      return;
    }
    case 'patch': {
      // A Farming patch: a low bed of tilled soil with three ridges raked along it, flat enough to
      // walk over, and what grows in it: rows of seedlings (an allotment), a leafy herb with a
      // flower (a herb patch) or a sapling (a tree patch).
      const b = Math.min(1.6, S * 0.9);
      out.box(x, y, z, b, 0.1, b, c);
      for (const dz of [-b / 3, 0, b / 3]) out.box(x, y + 0.1, z + dz, b * 0.92, 0.08, b * 0.16, shade(c, 1.18));
      const green = rgba('#5f9a3a');
      if (def.key === 'patch_tree') {
        out.cylinder(x, y + 0.18, z, 0.05, 0.035, 0.75, 5, trunk);
        out.blob(x, y + 1.0, z, 0.3, 0.28, 0.3, green, seed);
      } else if (def.key === 'patch_herb') {
        for (let n = 0; n < 3; n++) {
          const a = (n / 3) * Math.PI * 2 + r * 6;
          out.blob(x + Math.cos(a) * 0.14, y + 0.3, z + Math.sin(a) * 0.14, 0.16, 0.14, 0.16, shade(green, 1.1), seed + n);
        }
        out.blob(x, y + 0.48, z, 0.08, 0.08, 0.08, rgba('#b07ad8'), seed + 3);
      } else {
        for (const dz of [-b / 3, 0, b / 3]) {
          for (const dx of [-b / 4, b / 4]) out.blob(x + dx, y + 0.26, z + dz, 0.11, 0.1, 0.11, shade(green, 1.15), seed + Math.round(dx * 11 + dz * 7));
        }
      }
      return;
    }
    case 'ruin': {
      // A low, broken stone wall: a stub of a pillar, and a course of stone towards each
      // neighbouring ruin, its top ragged.
      const h = 0.7 + 0.8 * r;
      out.box(x, y, z, 0.5, h, 0.5, c);
      for (const [dx, dz] of linksTo(def.group)) {
        const len = Math.hypot(dx, dz) / 2;
        const ang = Math.atan2(dz, dx);
        out.box(x + dx / 4, y, z + dz / 4, len, 0.35 + 0.6 * hash01(seed + Math.round(dx * 7 + dz * 13)), 0.4, shade(c, 0.92), ang);
      }
      return;
    }
  }
  // Icon objects: a simple shape per kind of thing.
  const wood = rgba('#8a6a46');
  switch (def.key) {
    case 'bank':
      out.box(x, y, z, 1.6, 1.6, 1.4, rgba('#d8cba8'), facing);
      out.gable(x, y + 1.6, z, 1.8, 1.6, 0.6, c, facing);
      return;
    case 'shop':
    case 'market_stall':
      out.box(x, y, z, 1.4, 0.9, 0.7, wood, facing);
      for (const s of [-1, 1]) out.box(x + Math.cos(facing) * 0.6 * s, y, z + Math.sin(facing) * 0.6 * s, 0.1, 2.0, 0.1, wood, facing);
      out.gable(x, y + 2.0, z, 1.6, 1.1, 0.4, c, facing);
      return;
    case 'furnace':
      out.box(x, y, z, 1.2, 1.1, 1.2, rgba('#6a5a52'), facing);
      out.box(x, y + 0.2, z, 0.5, 0.4, 1.22, c, facing);
      out.cylinder(x + 0.35, y + 1.1, z + 0.35, 0.18, 0.15, 1.2, 6, rgba('#55504c'));
      return;
    case 'anvil':
      out.box(x, y, z, 0.4, 0.45, 0.4, wood, facing);
      out.box(x, y + 0.45, z, 0.75, 0.25, 0.3, c, facing);
      return;
    case 'cooking_fire':
      for (let n = 0; n < 7; n++) {
        const a = (n / 7) * Math.PI * 2;
        out.blob(x + Math.cos(a) * 0.45, y + 0.1, z + Math.sin(a) * 0.45, 0.13, 0.1, 0.13, STONE, seed + n);
      }
      out.cylinder(x, y, z, 0.3, 0, 0.8, 6, rgba('#f0a040'));
      return;
    case 'crypt_entrance':
      out.box(x, y - 0.02, z, S * 0.7, 0.04, S * 0.7, DARK);
      out.box(x - 0.6, y, z, 0.35, 2.2, 0.35, STONE);
      out.box(x + 0.6, y, z, 0.35, 2.2, 0.35, STONE);
      out.box(x, y + 2.2, z, 1.6, 0.35, 0.4, STONE);
      return;
    case 'stairs_down':
    case 'sewer_grate':
      out.box(x, y - 0.02, z, S * 0.6, 0.05, S * 0.6, DARK);
      for (let n = 0; n < 4; n++) out.box(x, y + 0.03, z - S * 0.24 + (n * S * 0.48) / 3, S * 0.6, 0.04, 0.06, c);
      return;
    case 'stairs_up':
      for (let n = 0; n < 4; n++) out.box(x - S * 0.3 + (n + 0.5) * (S * 0.15), y, z, S * 0.15, 0.25 * (n + 1), S * 0.6, c);
      return;
    case 'door':
      out.box(x, y, z, 1.0, 2.2, 0.16, c, facing + Math.PI / 2);
      return;
    case 'bookshelf':
      out.box(x, y, z, 1.0, 2.0, 0.4, c, facing + Math.PI / 2);
      return;
    case 'bed':
      out.box(x, y, z, 0.95, 0.5, 1.9, c, facing);
      out.box(x, y + 0.5, z, 0.9, 0.1, 0.5, rgba('#e8e2d4'), facing);
      return;
    case 'barrel':
      out.cylinder(x, y, z, 0.32, 0.32, 0.9, 8, c);
      return;
    case 'crate':
      out.box(x, y, z, 0.8, 0.8, 0.8, c, facing);
      return;
    case 'table':
    case 'counter':
    case 'alchemy_table':
    case 'sewing_table':
    case 'fletching_bench':
    case 'bench':
      out.box(x, y, z, def.key === 'counter' ? 1.6 : 1.2, def.key === 'bench' ? 0.45 : 0.85, def.key === 'bench' ? 0.4 : 0.7, def.key === 'bench' ? wood : c, facing);
      return;
    case 'lectern':
      out.box(x, y, z, 0.5, 1.1, 0.4, c, facing);
      return;
    case 'spinning_wheel': {
      // A low bench with the wheel standing up at one end (in line with the bench, along
      // `facing`), its hub, and the distaff of flax at the other end.
      const [ca, sa] = [Math.cos(facing), Math.sin(facing)];
      out.box(x, y, z, 1.0, 0.45, 0.35, wood, facing);
      const R = 0.42;
      const [wx, wz] = [x + ca * 0.18, z + sa * 0.18];
      const wy = y + 0.45 + R + 0.05;
      const rim: V3[] = [];
      for (let n = 0; n < 10; n++) {
        const t = (n / 10) * Math.PI * 2;
        rim.push([wx + Math.cos(t) * R * ca, wy + Math.sin(t) * R, wz + Math.cos(t) * R * sa]);
      }
      for (const side of [1, -1]) out.face(rim, c, [-sa * side, 0, ca * side]);
      out.blob(wx, wy, wz, 0.07, 0.07, 0.07, shade(wood, 0.7), seed);
      for (const side of [1, -1]) out.box(wx - sa * side * 0.1, y + 0.45, wz + ca * side * 0.1, 0.06, R + 0.05, 0.06, shade(wood, 0.85), facing);
      const [dx, dz] = [x - ca * 0.38, z - sa * 0.38];
      out.cylinder(dx, y + 0.45, dz, 0.035, 0.03, 0.55, 5, shade(wood, 0.8));
      out.blob(dx, y + 0.95, dz, 0.09, 0.14, 0.09, rgba('#e8dcb0'), seed + 1);
      return;
    }
    case 'millstones':
      // Two round stones, one on the other, on a wooden spindle, with a hopper for the grain over them.
      out.cylinder(x, y, z, 0.7, 0.7, 0.32, 12, shade(c, 0.9));
      out.cylinder(x, y + 0.32, z, 0.64, 0.64, 0.28, 12, c);
      out.cylinder(x, y + 0.6, z, 0.07, 0.07, 0.5, 6, wood);
      out.box(x, y + 1.0, z, 0.45, 0.35, 0.45, wood, facing);
      return;
    case 'well':
      out.cylinder(x, y, z, 0.7, 0.7, 0.8, 10, STONE);
      out.cylinder(x, y + 0.8, z, 0.55, 0.55, 0.02, 10, rgba('#2f5f8f'));
      out.gable(x, y + 2.0, z, 1.6, 1.2, 0.4, rgba('#7a4a32'), facing);
      for (const s of [-1, 1]) out.box(x + Math.cos(facing) * 0.7 * s, y, z + Math.sin(facing) * 0.7 * s, 0.1, 2.0, 0.1, wood, facing);
      return;
    case 'lamp_post':
      out.cylinder(x, y, z, 0.07, 0.06, 2.8, 6, c);
      out.box(x, y + 2.8, z, 0.3, 0.35, 0.3, rgba('#ffd36a'));
      return;
    case 'flower_bed':
      out.box(x, y, z, 0.9, 0.25, 0.9, rgba('#6b4a2e'), facing);
      out.blob(x, y + 0.35, z, 0.4, 0.15, 0.4, c, seed);
      return;
    case 'signpost':
      out.box(x, y, z, 0.12, 1.8, 0.12, wood);
      out.box(x, y + 1.4, z, 0.7, 0.25, 0.06, c, facing);
      return;
    case 'notice_board':
      for (const s of [-1, 1]) out.box(x + Math.cos(facing) * 0.5 * s, y, z + Math.sin(facing) * 0.5 * s, 0.1, 1.8, 0.1, wood, facing);
      out.box(x, y + 0.9, z, 1.1, 0.8, 0.08, c, facing);
      return;
    case 'waystone':
      // A grey standing stone with a column of glowing runes down its face.
      out.box(x, y, z, 0.7, 2.0, 0.45, STONE, facing);
      out.box(x + Math.cos(facing + Math.PI / 2) * 0.23, y + 0.4, z + Math.sin(facing + Math.PI / 2) * 0.23, 0.14, 1.3, 0.02, c, facing);
      return;
    case 'cactus': {
      // A column with an arm either side, turned at random.
      const a = r * Math.PI;
      out.cylinder(x, y, z, 0.24 * k, 0.2 * k, 1.9 * k, 8, c);
      for (const [side, h] of [[1, 0.8], [-1, 1.1]]) {
        const ax = x + Math.cos(a) * 0.36 * k * side;
        const az = z + Math.sin(a) * 0.36 * k * side;
        out.cylinder(ax, y + h * k, az, 0.13 * k, 0.11 * k, 0.6 * k, 6, c);
      }
      return;
    }
    case 'palm': {
      // A ringed trunk leaning one way as it rises, coconuts under a crown of drooping fronds.
      const a = r * Math.PI * 2;
      const H = 3.2 * k;
      const segs = 5;
      const lean = (t: number): [number, number] => [x + Math.cos(a) * 0.6 * k * t * t, z + Math.sin(a) * 0.6 * k * t * t];
      for (let n = 0; n < segs; n++) {
        const [sx, sz] = lean(n / segs);
        out.cylinder(sx, y + (H * n) / segs, sz, (0.17 - 0.02 * n) * k, (0.15 - 0.02 * n) * k, H / segs + 0.03, 6, shade(trunk, n % 2 ? 0.85 : 1.1));
      }
      const [tx, tz] = lean(1);
      const top = y + H;
      for (let n = 0; n < 3; n++) out.blob(tx + Math.cos(a + n * 2.1) * 0.13 * k, top - 0.12 * k, tz + Math.sin(a + n * 2.1) * 0.13 * k, 0.1 * k, 0.1 * k, 0.1 * k, rgba('#5a4a2a'));
      for (let n = 0; n < 7; n++) {
        // A frond: arching up from the crown, then down to its tip, seen from above and below.
        const b = a + (n / 7) * Math.PI * 2 + r;
        const [dx, dz] = [Math.cos(b), Math.sin(b)];
        const len = 1.35 * k;
        const wd = 0.24 * k;
        const base: V3 = [tx, top, tz];
        const tip: V3 = [tx + dx * len, top - 0.55 * k, tz + dz * len];
        const left: V3 = [tx + dx * len * 0.5 - dz * wd, top + 0.12 * k, tz + dz * len * 0.5 + dx * wd];
        const right: V3 = [tx + dx * len * 0.5 + dz * wd, top + 0.12 * k, tz + dz * len * 0.5 - dx * wd];
        for (const up of [1, -1]) {
          out.face([base, left, tip], up > 0 ? c : shade(c, 0.7), [0, up, 0]);
          out.face([base, tip, right], up > 0 ? c : shade(c, 0.7), [0, up, 0]);
        }
      }
      return;
    }
    case 'wreck': {
      // A boat's hull run aground: its keel, one side standing and the other stove in to its ribs,
      // and the stump of its mast; turned at random.
      const turn = r * Math.PI;
      const [ca, sa] = [Math.cos(turn), Math.sin(turn)];
      const at = (u: number, v: number): [number, number] => [x + ca * u - sa * v, z + sa * u + ca * v];
      out.box(x, y, z, 2.2 * k, 0.3 * k, 0.9 * k, c, turn);
      const [ux, uz] = at(0, -0.45 * k);
      out.box(ux, y, uz, 2.0 * k, 0.95 * k, 0.12 * k, shade(c, 1.1), turn);
      for (let n = 0; n < 4; n++) {
        const [rx, rz] = at((-0.75 + n * 0.5) * k, 0.42 * k);
        out.box(rx, y, rz, 0.1 * k, (0.5 + 0.2 * (n % 2)) * k, 0.1 * k, shade(c, 0.75), turn);
      }
      const [px, pz] = at(-0.5 * k, 0.4 * k);
      out.box(px, y, pz, 0.7 * k, 0.35 * k, 0.1 * k, shade(c, 1.1), turn);
      out.cylinder(x + ca * 0.2 * k, y + 0.3 * k, z + sa * 0.2 * k, 0.08 * k, 0.07 * k, 0.9 * k, 6, shade(c, 0.85));
      return;
    }
    case 'boat': {
      // A small sailing boat on the water, along `facing`: a wooden hull painted along the top, a
      // pointed bow, a mast and a sail set along it.
      const [ca, sa] = [Math.cos(facing), Math.sin(facing)];
      const at = (u: number): [number, number] => [x + ca * u, z + sa * u];
      out.box(x, y - 0.35, z, 2.2, 0.6, 0.95, wood, facing);
      out.box(x, y + 0.25, z, 2.25, 0.14, 1.0, c, facing);
      const [bx, bz] = at(1.3);
      out.box(bx, y - 0.3, bz, 0.45, 0.6, 0.6, wood, facing);
      out.box(bx, y + 0.25, bz, 0.5, 0.14, 0.64, c, facing);
      const [mx, mz] = at(-0.15);
      out.cylinder(mx, y + 0.25, mz, 0.06, 0.05, 2.6, 6, shade(wood, 0.8));
      const foot: V3 = [mx, y + 0.55, mz];
      const head: V3 = [mx, y + 2.75, mz];
      const [sx, sz] = at(-1.05);
      const clew: V3 = [sx, y + 0.55, sz];
      for (const side of [1, -1]) out.face([foot, head, clew], rgba('#efe6d2'), [-sa * side, 0, ca * side]);
      return;
    }
    case 'dead_tree': {
      // A grey trunk with a few bare branches.
      out.cylinder(x, y, z, 0.18 * k, 0.1 * k, 2.2 * k, 6, c);
      for (let n = 0; n < 3; n++) {
        const a = (n / 3) * Math.PI * 2 + r * 6;
        out.cylinder(x + Math.cos(a) * 0.3 * k, y + (1.3 + n * 0.25) * k, z + Math.sin(a) * 0.3 * k, 0.07 * k, 0.03 * k, 0.8 * k, 5, c);
      }
      return;
    }
  }
  switch (def.group) {
    case 'herb':
      out.blob(x, y + 0.25, z, 0.35, 0.25, 0.35, c, seed);
      return;
    case 'fishing':
      out.cylinder(x, y - 0.05, z, 0.25, 0.25, 0.25, 8, c);
      return;
    case 'station':
      out.box(x, y, z, 1.1, 0.9, 0.8, c, facing);
      return;
    case 'altar':
      // A stone block with an orb in the rune's colour over it.
      out.box(x, y, z, 1.0, 0.8, 1.0, rgba('#6a6a70'), facing);
      out.blob(x, y + 1.25, z, 0.22, 0.22, 0.22, c, seed);
      return;
  }
  out.box(x, y, z, 0.7, 0.9, 0.7, c, facing);
}

/** A small model of a place on an overland map: houses for settlements, a keep for a castle, … */
function placeModel(out: MeshBuilder, type: string, x: number, y: number, z: number, S: number, seed: number): void {
  const houses: Record<string, number> = { capital: 9, city: 7, town: 5, village: 3, hamlet: 2, farm: 1, inn: 1 };
  const u = S * 0.16;
  const stone = rgba('#9a958c');
  const roof = (n: number) => ROOF_PALETTE[Math.floor(hash01(seed + n * 17) * ROOF_PALETTE.length)];
  const wall = (n: number) => WALL_PALETTE[Math.floor(hash01(seed + n * 29) * WALL_PALETTE.length)];
  if (houses[type]) {
    const n = houses[type];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + hash01(seed + k) * 0.8;
      const d = k === 0 && n > 1 ? 0 : S * (0.18 + 0.14 * hash01(seed + k * 3));
      const hx = x + Math.cos(a) * d;
      const hz = z + Math.sin(a) * d;
      const turn = Math.floor(hash01(seed + k * 7) * 4) * (Math.PI / 2);
      out.box(hx, y, hz, u * 1.3, u, u, wall(k), turn);
      out.gable(hx, y + u, hz, u * 1.4, u * 1.1, u * 0.6, roof(k), turn);
    }
    if (type === 'capital' || type === 'city') {
      out.cylinder(x, y, z, u * 0.5, u * 0.45, u * 3, 8, stone);
      out.cylinder(x, y + u * 3, z, u * 0.6, 0, u * 1.2, 8, roof(99));
    }
    return;
  }
  switch (type) {
    case 'castle':
      out.box(x, y, z, u * 2.2, u * 2.2, u * 2.2, stone);
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        out.cylinder(x + dx * u * 1.3, y, z + dz * u * 1.3, u * 0.45, u * 0.45, u * 3, 8, stone);
        out.cylinder(x + dx * u * 1.3, y + u * 3, z + dz * u * 1.3, u * 0.55, 0, u, 8, roof(dx + dz * 3));
      }
      return;
    case 'tower':
      out.cylinder(x, y, z, u * 0.6, u * 0.55, u * 4, 8, stone);
      out.cylinder(x, y + u * 4, z, u * 0.75, 0, u * 1.5, 8, roof(1));
      return;
    case 'dungeon':
    case 'cave':
    case 'mine':
    case 'lair':
      out.blob(x, y, z, u * 2, u * 1.3, u * 1.8, rgba('#6f6a62'), seed);
      out.box(x, y, z + u * 1.5, u * 0.9, u * 0.9, u * 0.5, DARK);
      return;
    case 'ruins':
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        out.box(x + Math.cos(a) * u, y, z + Math.sin(a) * u, u * 1.4, u * (0.4 + hash01(seed + k) * 1.2), u * 0.3, stone, a + Math.PI / 2);
      }
      return;
    case 'temple':
    case 'shrine': {
      const s = type === 'temple' ? 1.4 : 0.8;
      out.box(x, y, z, u * 1.6 * s, u * 0.3, u * 1.2 * s, stone);
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.cylinder(x + dx * u * 0.6 * s, y + u * 0.3, z + dz * u * 0.4 * s, u * 0.12, u * 0.12, u * s, 6, rgba('#ddd6c8'));
      out.gable(x, y + u * (0.3 + s), z, u * 1.7 * s, u * 1.3 * s, u * 0.5 * s, rgba('#b8b0a0'));
      return;
    }
    case 'camp':
      out.cylinder(x, y, z, u * 0.8, 0, u * 1.1, 6, rgba('#b8a070'));
      return;
    default:
      out.cylinder(x, y, z, u * 0.35, u * 0.15, u * 2.6, 4, stone);
  }
}
