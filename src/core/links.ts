/**
 * Helpers for linear networks (roads, rivers) stored as per-cell direction bitmasks.
 * Bit d of layer[i] means "cell i connects to its neighbour in direction d". The encoding is
 * symmetric and works on every grid type, and it is exported as-is so engines can autotile.
 */
import type { Grid } from './grid';
import { Rng, hashInts } from './rng';

export type Pt = [number, number];

export function link(g: Grid, layer: number[], a: number, b: number): boolean {
  if (a === b) return false;
  const d = g.dirBetween(a, b);
  if (d < 0) return false;
  layer[a] |= 1 << d;
  layer[b] |= 1 << g.opposite(d);
  return true;
}

export function linkPath(g: Grid, layer: number[], path: number[], level?: number[], value = 1): void {
  for (let k = 0; k < path.length; k++) {
    if (k > 0) link(g, layer, path[k - 1], path[k]);
    if (level) level[path[k]] = Math.max(level[path[k]], value);
  }
}

export function linkedNeighbors(g: Grid, layer: number[], i: number): number[] {
  const out: number[] = [];
  const m = layer[i];
  if (!m) return out;
  for (let d = 0; d < g.dirCount; d++) {
    if (m & (1 << d)) {
      const n = g.neighbor(i, d);
      if (n >= 0) out.push(n);
    }
  }
  return out;
}

/** Remove every connection touching cell i (on both sides). */
export function unlinkCell(g: Grid, layer: number[], i: number): void {
  for (let d = 0; d < g.dirCount; d++) {
    if (layer[i] & (1 << d)) {
      const n = g.neighbor(i, d);
      if (n >= 0) layer[n] &= ~(1 << g.opposite(d));
    }
  }
  layer[i] = 0;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Adjacent-cell path approximating the straight line between two logical points. */
export function traceLine(g: Grid, a: Pt, b: Pt): number[] {
  let cur = g.posToCellClamped(a[0], a[1]);
  const end = g.posToCellClamped(b[0], b[1]);
  const [ex, ey] = g.pos(end);
  const path = [cur];
  for (let guard = 0; cur !== end && guard < g.size; guard++) {
    const [cx, cy] = g.pos(cur);
    const curD = Math.hypot(cx - ex, cy - ey);
    let best = -1;
    let bestScore = Infinity;
    for (const n of g.neighbors(cur, true)) {
      const p = g.pos(n);
      const dEnd = Math.hypot(p[0] - ex, p[1] - ey);
      if (dEnd >= curD - 1e-9) continue;
      const score = dEnd + 1.5 * distToSegment(p, a, b);
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    if (best < 0) break;
    path.push(best);
    cur = best;
  }
  return path;
}

/** Trace a polyline through the grid, returning a connected cell path. */
export function tracePolyline(g: Grid, pts: Pt[]): number[] {
  const out: number[] = [];
  for (let k = 1; k < pts.length; k++) {
    const seg = traceLine(g, pts[k - 1], pts[k]);
    for (const c of seg) if (out[out.length - 1] !== c) out.push(c);
  }
  return out;
}

/**
 * Midpoint displacement: turns a straight segment into a natural meander. Seeded by the
 * endpoints' identity so the same parent segment always produces the same curve, which keeps
 * rivers and roads continuous across neighbouring detail maps.
 */
export function meander(a: Pt, b: Pt, seed: number, depth = 3, amp = 0.22): Pt[] {
  const rng = new Rng(seed);
  let pts: Pt[] = [a, b];
  let scale = amp;
  for (let d = 0; d < depth; d++) {
    const next: Pt[] = [pts[0]];
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1];
      const q = pts[k];
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const off = (rng.next() * 2 - 1) * scale;
      next.push([(p[0] + q[0]) / 2 - dy * off, (p[1] + q[1]) / 2 + dx * off]);
      next.push(q);
    }
    pts = next;
    scale *= 0.6;
  }
  return pts;
}

export function segmentSeed(a: number, b: number, salt: number): number {
  return hashInts(Math.min(a, b), Math.max(a, b), salt);
}

/** Clip a polyline to an axis-aligned box, returning the pieces that fall inside. */
export function clipPolyline(pts: Pt[], x0: number, y0: number, x1: number, y1: number): Pt[][] {
  const pieces: Pt[][] = [];
  let cur: Pt[] = [];
  for (let k = 1; k < pts.length; k++) {
    const seg = clipSegment(pts[k - 1], pts[k], x0, y0, x1, y1);
    if (!seg) {
      if (cur.length) pieces.push(cur);
      cur = [];
      continue;
    }
    const [p, q] = seg;
    const last = cur[cur.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) {
      if (cur.length) pieces.push(cur);
      cur = [p];
    }
    cur.push(q);
  }
  if (cur.length) pieces.push(cur);
  return pieces.filter((p) => p.length >= 2);
}

function clipSegment(a: Pt, b: Pt, x0: number, y0: number, x1: number, y1: number): [Pt, Pt] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const checks: [number, number][] = [
    [-dx, a[0] - x0],
    [dx, x1 - a[0]],
    [-dy, a[1] - y0],
    [dy, y1 - a[1]],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
}

/** Break a bitmask network into polylines (lists of cell indices) for drawing or export. */
export function extractPolylines(g: Grid, layer: number[]): number[][] {
  const degree = (i: number) => linkedNeighbors(g, layer, i).length;
  const seen = new Set<number>();
  const key = (a: number, b: number) => (a < b ? a * g.size + b : b * g.size + a);
  const lines: number[][] = [];
  const walk = (start: number, next: number) => {
    const line = [start];
    let prev = start;
    let cur = next;
    seen.add(key(prev, cur));
    for (;;) {
      line.push(cur);
      if (degree(cur) !== 2) break;
      const nxt = linkedNeighbors(g, layer, cur).find((n) => n !== prev && !seen.has(key(cur, n)));
      if (nxt === undefined) break;
      seen.add(key(cur, nxt));
      prev = cur;
      cur = nxt;
    }
    lines.push(line);
  };
  for (let i = 0; i < g.size; i++) {
    if (!layer[i] || degree(i) === 2) continue;
    for (const n of linkedNeighbors(g, layer, i)) if (!seen.has(key(i, n))) walk(i, n);
  }
  // Remaining edges belong to loops.
  for (let i = 0; i < g.size; i++) {
    if (!layer[i]) continue;
    for (const n of linkedNeighbors(g, layer, i)) if (!seen.has(key(i, n))) walk(i, n);
  }
  return lines;
}
