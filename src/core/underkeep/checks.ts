/**
 * Underkeep's own map checks (prototype/data/maps.gd → Maps.validate), run on the file World
 * Builder would export, so a map that passes here passes in the game. Movement follows the game:
 * level ground, ledges down (3.5 m for enemies, a storey for the player), stairs end to end
 * (also out of the top of a storey), off an upper floor down to what is below, and mantles up
 * 1.5 m.
 */
import { storey3d, storeyNumbers } from '../scene3d/storeys';
import type { WorldMap } from '../types';
import { canBeUnderkeep, toUnderkeep } from './export';
import { EXIT_TYPES, ENEMY_TYPES, FIRE_TYPES, FLOOR_CHARS, LIGHT_TYPES, UK, UK_TYPES, type UkMap } from './format';

export interface UkProblem {
  message: string;
  /** Cells as [x, y, storey index in the file]. */
  cells: [number, number, number][];
}

export interface UkReport {
  errors: UkProblem[];
  warnings: UkProblem[];
  counts: { enemies: number; chests: number; exits: number; lights: number; traps: number; fires: number; storeys: number; floor: number };
}

const STAIR_DIR: Record<string, [number, number]> = { '^': [0, -1], '>': [1, 0], v: [0, 1], '<': [-1, 0] };
const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const FRONT: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const NO_WAY = -9999;

/** Movement over an Underkeep map, as the game reckons it. */
export class UkGrid {
  constructor(readonly md: UkMap) {}

  get storeys(): number {
    return this.md.storeys.length;
  }
  private inside(x: number, y: number, z: number): boolean {
    return z >= 0 && z < this.storeys && x >= 0 && y >= 0 && x < this.md.w && y < this.md.h;
  }
  tile(x: number, y: number, z: number): string {
    return this.inside(x, y, z) ? this.md.storeys[z].tiles[y][x] ?? ' ' : ' ';
  }
  isFloor(x: number, y: number, z: number): boolean {
    const t = this.tile(x, y, z);
    return t !== ' ' && FLOOR_CHARS.includes(t);
  }
  h(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.md.storeys[z].height[y][x] : 0;
  }
  absH(x: number, y: number, z: number): number {
    return z * UK.PITCH + this.h(x, y, z);
  }
  isStair(x: number, y: number, z: number): boolean {
    return this.tile(x, y, z) in STAIR_DIR;
  }
  /** The height a stair reaches at its far edge: the floor it points at, here or on the storey above. */
  stairHigh(x: number, y: number, z: number): number {
    const [dx, dy] = STAIR_DIR[this.tile(x, y, z)];
    const own = this.absH(x, y, z);
    if (this.isFloor(x + dx, y + dy, z)) return Math.max(own, this.absH(x + dx, y + dy, z));
    if (this.isFloor(x + dx, y + dy, z + 1)) return Math.max(own, this.absH(x + dx, y + dy, z + 1));
    return own;
  }
  private exitH(x: number, y: number, z: number, d: [number, number]): number {
    if (this.isStair(x, y, z)) {
      const s = STAIR_DIR[this.tile(x, y, z)];
      if (d[0] === s[0] && d[1] === s[1]) return this.stairHigh(x, y, z);
      if (d[0] === -s[0] && d[1] === -s[1]) return this.absH(x, y, z);
      return NO_WAY;
    }
    return this.absH(x, y, z);
  }
  private entryH(x: number, y: number, z: number, d: [number, number]): number {
    if (this.isStair(x, y, z)) {
      const s = STAIR_DIR[this.tile(x, y, z)];
      if (d[0] === -s[0] && d[1] === -s[1]) return this.stairHigh(x, y, z);
      if (d[0] === s[0] && d[1] === s[1]) return this.absH(x, y, z);
      return NO_WAY;
    }
    return this.absH(x, y, z);
  }
  /** Cells a body can step to from (x, y, z); `jump` adds what only the player can do. */
  neighbours(x: number, y: number, z: number, jump: boolean): [number, number, number][] {
    const out: [number, number, number][] = [];
    if (!this.isFloor(x, y, z)) return out;
    const maxDrop = jump ? UK.MAX_DROP_PLAYER : UK.MAX_DROP;
    for (const d of DIRS) {
      const ex = this.exitH(x, y, z, d);
      if (ex === NO_WAY) continue;
      const bx = x + d[0];
      const by = y + d[1];
      const cands: number[] = [];
      if (this.isFloor(bx, by, z)) cands.push(z);
      else {
        if (this.isFloor(bx, by, z + 1)) cands.push(z + 1);
        if (this.tile(bx, by, z) === ' ') {
          for (let zz = z - 1; zz >= 0; zz--) {
            if (this.tile(bx, by, zz) === '#') break;
            if (this.isFloor(bx, by, zz)) {
              cands.push(zz);
              break;
            }
          }
        }
      }
      for (const cz of cands) {
        const en = this.entryH(bx, by, cz, d);
        if (en === NO_WAY) continue;
        const dh = en - ex;
        if (dh === 0 || (dh < 0 && -dh <= maxDrop) || (dh > 0 && jump && dh <= UK.MAX_CLIMB)) {
          out.push([bx, by, cz]);
          break;
        }
      }
    }
    return out;
  }
  /** Where the player arrives: the cell in front of the Great Stair (or the stair's own cell). */
  spawnCell(): [number, number, number] {
    const o = this.md.objects.find((x) => x.t === 'stair');
    if (!o) return [-1, -1, 0];
    const [fx, fy] = FRONT[((o.r % 4) + 4) % 4];
    return this.isFloor(o.x + fx, o.y + fy, o.z) ? [o.x + fx, o.y + fy, o.z] : [o.x, o.y, o.z];
  }
  /** Cells reachable from a cell, with their step counts. */
  reachable(from: [number, number, number], jump = true): Map<string, number> {
    const seen = new Map<string, number>();
    const key = (c: [number, number, number]) => c.join(',');
    if (from[0] < 0 || !this.isFloor(...from)) return seen;
    const q: [number, number, number][] = [from];
    seen.set(key(from), 0);
    for (let k = 0; k < q.length; k++) {
      const c = q[k];
      for (const n of this.neighbours(c[0], c[1], c[2], jump)) {
        if (seen.has(key(n))) continue;
        seen.set(key(n), seen.get(key(c))! + 1);
        q.push(n);
      }
    }
    return seen;
  }
}

/** The game's checks. Errors stop the game from playing the map; warnings are advice. */
export function validateUnderkeep(md: UkMap): UkReport {
  const m = new UkGrid(md);
  const errors: UkProblem[] = [];
  const warnings: UkProblem[] = [];
  const counts = { enemies: 0, chests: 0, exits: 0, lights: 0, traps: 0, fires: 0, storeys: m.storeys, floor: 0 };
  const label = (t: string) => UK_TYPES[t]?.label ?? t;
  let stairs = 0;
  for (const o of md.objects) {
    if (o.t === 'stair') stairs++;
    if (EXIT_TYPES.includes(o.t)) counts.exits++;
    if (ENEMY_TYPES.includes(o.t)) counts.enemies++;
    if (o.t === 'chest') counts.chests++;
    if (LIGHT_TYPES.includes(o.t)) counts.lights++;
    if (FIRE_TYPES.includes(o.t)) counts.fires++;
    if (o.t === 'trap') counts.traps++;
    if (!m.isFloor(o.x, o.y, o.z)) errors.push({ message: `${label(o.t)} at ${o.x},${o.y} on storey ${o.z} is not on a floor cell.`, cells: [[o.x, o.y, o.z]] });
  }
  const taken = new Map<string, number>();
  const doubled: [number, number, number][] = [];
  for (const o of md.objects) {
    const k = `${o.x},${o.y},${o.z}`;
    taken.set(k, (taken.get(k) ?? 0) + 1);
    if (taken.get(k) === 2) doubled.push([o.x, o.y, o.z]);
  }
  if (doubled.length) errors.push({ message: `${doubled.length} cells hold more than one object.`, cells: doubled });
  const stairObjs = md.objects.filter((o) => o.t === 'stair').map((o): [number, number, number] => [o.x, o.y, o.z]);
  if (stairs === 0) errors.push({ message: 'No Great Stair. Place exactly one: it is where you enter.', cells: [] });
  else if (stairs > 1) errors.push({ message: `${stairs} Great Stairs. There can be only one.`, cells: stairObjs });
  const seen = m.reachable(m.spawnCell(), true);
  if (stairs === 1 && seen.size === 0) errors.push({ message: 'The Great Stair does not open onto a floor cell.', cells: stairObjs });
  const lost: [number, number, number][] = [];
  for (const o of md.objects) {
    if (['rope', 'grate', 'lift', 'postern', 'clapper', 'chest'].includes(o.t) || ENEMY_TYPES.includes(o.t)) {
      if (!seen.has(`${o.x},${o.y},${o.z}`) && m.isFloor(o.x, o.y, o.z)) lost.push([o.x, o.y, o.z]);
    }
  }
  if (lost.length) warnings.push({ message: `${lost.length} exits, chests or enemies cannot be walked, dropped or climbed to from the stair. Fine if reaching them is a jump across a gap; the check cannot see gaps.`, cells: lost });
  const steep: [number, number, number][] = [];
  const flat: [number, number, number][] = [];
  const bonk: [number, number, number][] = [];
  const walledFoot: [number, number, number][] = [];
  let cutOff = 0;
  for (let z = 0; z < m.storeys; z++) {
    let anyFloor = false;
    let anySeen = false;
    for (let y = 0; y < md.h; y++) {
      for (let x = 0; x < md.w; x++) {
        if (m.isFloor(x, y, z)) {
          anyFloor = true;
          if (seen.has(`${x},${y},${z}`)) anySeen = true;
        }
        if (!m.isStair(x, y, z)) continue;
        const rise = m.stairHigh(x, y, z) - m.absH(x, y, z);
        if (rise > UK.MAX_STAIR_RISE) steep.push([x, y, z]);
        else if (rise === 0) flat.push([x, y, z]);
        const [sx, sy] = STAIR_DIR[m.tile(x, y, z)];
        if (!m.isFloor(x - sx, y - sy, z)) walledFoot.push([x, y, z]);
        const topInStorey = m.stairHigh(x, y, z) - z * UK.PITCH;
        if (topInStorey > UK.PITCH - 5 && m.tile(x, y, z + 1) !== ' ') bonk.push([x, y, z]);
      }
    }
    if (anyFloor && !anySeen) cutOff++;
  }
  if (steep.length) errors.push({ message: `${steep.length} stair cells rise more than 2 m. Nobody can walk that: use more stair cells with heights in between.`, cells: steep });
  if (flat.length) warnings.push({ message: `${flat.length} stair cells go nowhere: the cell they point at is not higher.`, cells: flat });
  if (walledFoot.length) warnings.push({ message: `${walledFoot.length} staircases start against a wall or a drop. Stairs are entered from the low end only: leave a floor cell in front of the first step.`, cells: walledFoot });
  if (bonk.length) errors.push({ message: `${bonk.length} stair cells run into the floor above. Leave the cells over the upper part of a staircase as Nothing on the next storey.`, cells: bonk });
  if (cutOff) warnings.push({ message: `${cutOff} storey(s) cannot be reached at all. A staircase needs three cells to climb a storey: heights 0, 2 and 4 m, the last pointing at a floor cell on the storey above.`, cells: [] });
  if (counts.lights === 0) warnings.push({ message: 'No lights at all. It will be pitch black.', cells: [] });
  if (counts.fires === 0) warnings.push({ message: 'No hearth, campfire or bonfire. Once the lights fade, nowhere here is safe from the dark-born but a campfire kit.', cells: [] });
  if (counts.enemies === 0) warnings.push({ message: 'No enemies.', cells: [] });
  counts.floor = seen.size;
  return { errors, warnings, counts };
}

export interface MapProblem {
  level: 'error' | 'warning';
  message: string;
  /** Cells on the World Builder map (z = storey, 0 the ground storey). */
  cells: { c: number; r: number; z: number }[];
}

/**
 * Check a World Builder map for Underkeep: the game's own checks on the file it would export,
 * plus what doesn't carry over (map size, heights out of range, things with no Underkeep match).
 */
export function checkUnderkeepMap(map: WorldMap): { problems: MapProblem[]; counts: UkReport['counts'] | null } {
  if (!canBeUnderkeep(map)) {
    return { problems: [{ level: 'error', message: 'Underkeep maps use square cells. Export this map with Convert to grid → Square tiles, then open that.', cells: [] }], counts: null };
  }
  const { md, dropped } = toUnderkeep(map);
  const z0 = storeyNumbers(map)[0];
  const report = validateUnderkeep(md);
  const toMap = (p: UkProblem, level: MapProblem['level']): MapProblem => ({ level, message: p.message, cells: p.cells.map(([x, y, z]) => ({ c: x, r: y, z: z + z0 })) });
  const problems = [...report.errors.map((p) => toMap(p, 'error')), ...report.warnings.map((p) => toMap(p, 'warning'))];
  if (map.width < UK.MIN_SIZE || map.height < UK.MIN_SIZE || map.width > UK.MAX_SIZE || map.height > UK.MAX_SIZE) {
    problems.push({ level: 'warning', message: `The map is ${map.width}×${map.height}: the game plays it, but its own map editor only opens maps of ${UK.MIN_SIZE} to ${UK.MAX_SIZE} cells a side.`, cells: [] });
  }
  const out: { c: number; r: number; z: number }[] = [];
  for (const z of storeyNumbers(map)) {
    const E = storey3d(map, z);
    if (!E) continue;
    const lo = z === z0 ? UK.H_MIN : 0;
    for (let i = 0; i < E.height.length; i++) if (E.height[i] < lo || E.height[i] > UK.H_MAX) out.push({ c: i % map.width, r: Math.floor(i / map.width), z });
  }
  if (out.length) problems.push({ level: 'warning', message: `${out.length} cells are higher than 4.5 m or lower than the game allows (−4 m on the lowest storey, 0 above it); they are exported at the limit.`, cells: out });
  if (dropped.length) problems.push({ level: 'warning', message: `Not in the Underkeep file: ${dropped.join(', ')}.`, cells: [] });
  return { problems, counts: report.counts };
}
