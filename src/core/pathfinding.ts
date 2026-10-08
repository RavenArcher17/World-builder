import type { Grid } from './grid';
import type { Rng } from './rng';

/** Minimal binary min-heap keyed by priority. */
export class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, priority: number): void {
    const a = this.items;
    const p = this.prio;
    a.push(item);
    p.push(priority);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (p[parent] <= p[i]) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      [p[i], p[parent]] = [p[parent], p[i]];
      i = parent;
    }
  }

  pop(): number {
    const a = this.items;
    const p = this.prio;
    const top = a[0];
    const lastItem = a.pop()!;
    const lastPrio = p.pop()!;
    if (a.length > 0) {
      a[0] = lastItem;
      p[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && p[l] < p[m]) m = l;
        if (r < a.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        [p[i], p[m]] = [p[m], p[i]];
        i = m;
      }
    }
    return top;
  }
}

export interface PathOptions {
  /** Cost of stepping onto `to` (multiplied by step length). Infinity = blocked. */
  cost: (to: number, from: number) => number;
  /** Optional admissible heuristic towards the goal. */
  heuristic?: (i: number) => number;
  diagonals?: boolean;
  maxCost?: number;
}

/**
 * Multi-source A* / Dijkstra. Returns the cell path from a start cell to the first goal cell
 * reached (inclusive), or null when no goal is reachable.
 */
export function findPath(
  g: Grid,
  starts: number[],
  isGoal: (i: number) => boolean,
  opts: PathOptions,
): number[] | null {
  const dist = new Float64Array(g.size).fill(Infinity);
  const prev = new Int32Array(g.size).fill(-1);
  const heap = new MinHeap();
  const h = opts.heuristic ?? (() => 0);
  const maxCost = opts.maxCost ?? Infinity;
  for (const s of starts) {
    if (s < 0) continue;
    dist[s] = 0;
    heap.push(s, h(s));
  }
  const closed = new Uint8Array(g.size);
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (isGoal(cur)) {
      const path: number[] = [];
      for (let i = cur; i >= 0; i = prev[i]) path.push(i);
      return path.reverse();
    }
    const [cx, cy] = g.pos(cur);
    for (const n of g.neighbors(cur, opts.diagonals ?? true)) {
      if (closed[n]) continue;
      const c = opts.cost(n, cur);
      if (!isFinite(c)) continue;
      const [nx, ny] = g.pos(n);
      const nd = dist[cur] + c * Math.hypot(nx - cx, ny - cy);
      if (nd < dist[n] && nd <= maxCost) {
        dist[n] = nd;
        prev[n] = cur;
        heap.push(n, nd + h(n));
      }
    }
  }
  return null;
}

/** Breadth-first step distances from a set of sources (Infinity where unreachable). */
export function bfsDistance(g: Grid, sources: number[], passable: (i: number) => boolean, diagonals = false): Int32Array {
  const d = new Int32Array(g.size).fill(-1);
  const q: number[] = [];
  for (const s of sources) {
    d[s] = 0;
    q.push(s);
  }
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    for (const n of g.neighbors(cur, diagonals)) {
      if (d[n] >= 0 || !passable(n)) continue;
      d[n] = d[cur] + 1;
      q.push(n);
    }
  }
  return d;
}

/** Label connected components of cells matching `inSet`. Returns labels (-1 = not in set) and sizes. */
export function components(g: Grid, inSet: (i: number) => boolean, diagonals = false): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(g.size).fill(-1);
  const sizes: number[] = [];
  for (let i = 0; i < g.size; i++) {
    if (labels[i] >= 0 || !inSet(i)) continue;
    const id = sizes.length;
    let count = 0;
    const stack = [i];
    labels[i] = id;
    while (stack.length) {
      const cur = stack.pop()!;
      count++;
      for (const n of g.neighbors(cur, diagonals)) {
        if (labels[n] < 0 && inSet(n)) {
          labels[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(count);
  }
  return { labels, sizes };
}

/**
 * Join every component of passable cells into one network by carving the cheapest paths
 * between them. `carve` is called for each newly opened cell.
 */
export function connectComponents(
  g: Grid,
  passable: (i: number) => boolean,
  carveCost: (i: number) => number,
  carve: (i: number) => void,
  rng: Rng,
  minSize = 1,
): void {
  for (let guard = 0; guard < 500; guard++) {
    const { labels, sizes } = components(g, passable);
    const valid = sizes.map((s, i) => (s >= minSize ? i : -1)).filter((i) => i >= 0);
    if (valid.length <= 1) return;
    // Grow from the largest component to the nearest other component.
    let main = valid[0];
    for (const v of valid) if (sizes[v] > sizes[main]) main = v;
    const starts: number[] = [];
    for (let i = 0; i < g.size; i++) if (labels[i] === main) starts.push(i);
    const jitter = rng.fork(guard);
    const path = findPath(g, starts, (i) => labels[i] >= 0 && labels[i] !== main && sizes[labels[i]] >= minSize, {
      cost: (to) => (passable(to) ? 0.5 : carveCost(to) * (1 + jitter.next() * 0.3)),
      diagonals: false,
    });
    if (!path) return;
    for (const i of path) if (!passable(i)) carve(i);
  }
}
