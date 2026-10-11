/**
 * A tiny mesh builder: triangles with per-vertex normals and colours, plus the primitive shapes
 * (boxes, cylinders, cones, rocks, prisms) the 3D map is made of. Plain arrays, no WebGL, so the
 * same meshes feed the 3D view and the .glb export, and run in tests.
 */

export type V3 = [number, number, number];
/** 0..255 per channel. */
export type RGBA = [number, number, number, number];

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  /** RGBA, 0..255. */
  colors: Uint8Array;
  indices: Uint32Array;
}

export class MeshBuilder {
  // Growable typed arrays: big maps make hundreds of thousands of vertices, and plain arrays
  // cost a lot of memory and a slow copy at the end.
  private pos = new Float32Array(3 * 1024);
  private nrm = new Float32Array(3 * 1024);
  private col = new Uint8Array(4 * 1024);
  private idx = new Uint32Array(3 * 1024);
  private nv = 0;
  private ni = 0;

  get vertexCount(): number {
    return this.nv;
  }

  get empty(): boolean {
    return this.ni === 0;
  }

  vertex(p: V3, n: V3, c: RGBA): number {
    if (this.nv * 3 + 3 > this.pos.length) {
      this.pos = grow(this.pos);
      this.nrm = grow(this.nrm);
      this.col = grow(this.col);
    }
    const v = this.nv++;
    this.pos[v * 3] = p[0];
    this.pos[v * 3 + 1] = p[1];
    this.pos[v * 3 + 2] = p[2];
    this.nrm[v * 3] = n[0];
    this.nrm[v * 3 + 1] = n[1];
    this.nrm[v * 3 + 2] = n[2];
    this.col[v * 4] = c[0];
    this.col[v * 4 + 1] = c[1];
    this.col[v * 4 + 2] = c[2];
    this.col[v * 4 + 3] = c[3];
    return v;
  }

  tri(a: number, b: number, c: number): void {
    if (this.ni + 3 > this.idx.length) this.idx = grow(this.idx);
    this.idx[this.ni++] = a;
    this.idx[this.ni++] = b;
    this.idx[this.ni++] = c;
  }

  /**
   * A flat polygon (convex, points in order either way round) facing `outward`: its own vertices,
   * one normal, fanned from the first point.
   */
  face(pts: V3[], color: RGBA, outward: V3): void {
    if (pts.length < 3) return;
    let n = polygonNormal(pts);
    if (dot(n, outward) < 0) {
      pts = [...pts].reverse();
      n = [-n[0], -n[1], -n[2]];
    }
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) return;
    const base = this.vertexCount;
    for (const p of pts) this.vertex(p, n, color);
    for (let k = 1; k + 1 < pts.length; k++) this.tri(base, base + k, base + k + 1);
  }

  /** Axis-aligned box (optionally turned about its vertical axis) standing on y0. */
  box(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, color: RGBA, turn = 0, top?: RGBA): void {
    const hx = sx / 2;
    const hz = sz / 2;
    const cs = Math.cos(turn);
    const sn = Math.sin(turn);
    const at = (x: number, y: number, z: number): V3 => [cx + x * cs - z * sn, y, cz + x * sn + z * cs];
    const y1 = y0 + sy;
    const c = [at(-hx, 0, -hz), at(hx, 0, -hz), at(hx, 0, hz), at(-hx, 0, hz)];
    const lo = c.map((p): V3 => [p[0], y0, p[2]]);
    const hi = c.map((p): V3 => [p[0], y1, p[2]]);
    this.face(hi, top ?? color, [0, 1, 0]);
    this.face(lo, shade(color, 0.6), [0, -1, 0]);
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      const out: V3 = [(c[k][0] + c[k2][0]) / 2 - cx, 0, (c[k][2] + c[k2][2]) / 2 - cz];
      this.face([lo[k], lo[k2], hi[k2], hi[k]], shade(color, 0.85), out);
    }
  }

  /** Cylinder or truncated cone (r1 = 0: a cone) standing on y0, flat-shaded with `segs` sides. */
  cylinder(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, segs: number, color: RGBA, cap = true): void {
    const ring = (r: number, y: number): V3[] =>
      Array.from({ length: segs }, (_, k) => {
        const a = (k / segs) * Math.PI * 2;
        return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      });
    const lo = ring(r0, y0);
    const hi = ring(r1, y0 + h);
    for (let k = 0; k < segs; k++) {
      const k2 = (k + 1) % segs;
      const a = ((k + 0.5) / segs) * Math.PI * 2;
      const out: V3 = [Math.cos(a), (r0 - r1) / Math.max(h, 1e-6), Math.sin(a)];
      if (r1 > 1e-6) this.face([lo[k], lo[k2], hi[k2], hi[k]], color, out);
      else this.face([lo[k], lo[k2], hi[0]], color, out);
    }
    if (cap && r1 > 1e-6) this.face(hi, color, [0, 1, 0]);
    if (cap && r0 > 1e-6) this.face(lo, shade(color, 0.6), [0, -1, 0]);
  }

  /** A low-poly rock or canopy: an icosahedron scaled by (rx, ry, rz), centred at (cx, cy, cz). */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: RGBA, jitterSeed = 0): void {
    const verts = ICO_VERTS.map(([x, y, z], k): V3 => {
      const j = jitterSeed ? 0.85 + 0.3 * hash01(jitterSeed * 31 + k) : 1;
      return [cx + x * rx * j, cy + y * ry * j, cz + z * rz * j];
    });
    for (const [a, b, c] of ICO_FACES) {
      const p = [verts[a], verts[b], verts[c]];
      const m: V3 = [(p[0][0] + p[1][0] + p[2][0]) / 3 - cx, (p[0][1] + p[1][1] + p[2][1]) / 3 - cy, (p[0][2] + p[1][2] + p[2][2]) / 3 - cz];
      this.face(p, color, m);
    }
  }

  /** A vertical prism over a convex polygon (x, z points) from y0 to y1: top and sides, no bottom. */
  prism(poly: [number, number][], y0: number, y1: number, top: RGBA, side: RGBA): void {
    if (y1 - y0 < 1e-4) return;
    let cx = 0;
    let cz = 0;
    for (const [x, z] of poly) {
      cx += x / poly.length;
      cz += z / poly.length;
    }
    this.face(poly.map(([x, z]): V3 => [x, y1, z]), top, [0, 1, 0]);
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k];
      const b = poly[(k + 1) % poly.length];
      const out: V3 = [(a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz];
      this.face([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], side, out);
    }
  }

  /** A gable roof over a rectangle (ridge along x before turning), its eaves at y0. */
  gable(cx: number, y0: number, cz: number, sx: number, sz: number, rise: number, color: RGBA, turn = 0): void {
    const cs = Math.cos(turn);
    const sn = Math.sin(turn);
    const at = (x: number, y: number, z: number): V3 => [cx + x * cs - z * sn, y, cz + x * sn + z * cs];
    const hx = sx / 2;
    const hz = sz / 2;
    const y1 = y0 + rise;
    const r0 = at(-hx, y1, 0);
    const r1 = at(hx, y1, 0);
    const a = at(-hx, y0, -hz);
    const b = at(hx, y0, -hz);
    const c = at(hx, y0, hz);
    const d = at(-hx, y0, hz);
    const north = at(0, 0, -1);
    const south = at(0, 0, 1);
    this.face([a, b, r1, r0], color, [north[0] - cx, 1, north[2] - cz]);
    this.face([d, c, r1, r0], color, [south[0] - cx, 1, south[2] - cz]);
    const west = at(-1, 0, 0);
    const east = at(1, 0, 0);
    this.face([a, d, r0], shade(color, 0.8), [west[0] - cx, 0, west[2] - cz]);
    this.face([b, c, r1], shade(color, 0.8), [east[0] - cx, 0, east[2] - cz]);
  }

  build(): MeshData {
    return {
      positions: this.pos.slice(0, this.nv * 3),
      normals: this.nrm.slice(0, this.nv * 3),
      colors: this.col.slice(0, this.nv * 4),
      indices: this.idx.slice(0, this.ni),
    };
  }
}

function grow<A extends Float32Array | Uint8Array | Uint32Array>(a: A): A {
  const b = new (a.constructor as new (n: number) => A)(a.length * 2);
  b.set(a);
  return b;
}

export function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
}

/** Newell's method: robust for any planar polygon. */
function polygonNormal(pts: V3[]): V3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % pts.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return normalize([x, y, z]);
}

export function rgba(hex: string, alpha = 255): RGBA {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [200, 200, 200, alpha];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

/** Darken (k < 1) or lighten (k > 1) a colour, keeping alpha. */
export function shade(c: RGBA, k: number): RGBA {
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return [f(c[0]), f(c[1]), f(c[2]), c[3]];
}

export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  const f = (x: number, y: number) => Math.round(x + (y - x) * t);
  return [f(a[0], b[0]), f(a[1], b[1]), f(a[2], b[2]), f(a[3], b[3])];
}

/** Deterministic 0..1 from an integer, for per-cell variety that never changes between exports. */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS: V3[] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
].map((v) => normalize(v as V3));
const ICO_FACES: [number, number, number][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/**
 * Vertex colours are authored as sRGB bytes (like the 2D map's colours); glTF and three.js want
 * them linear. 16-bit keeps the dark shades from banding.
 */
export function linearColors(colors: Uint8Array): Uint16Array {
  const out = new Uint16Array(colors.length);
  for (let k = 0; k < colors.length; k++) out[k] = k % 4 === 3 ? colors[k] * 257 : SRGB_TO_LINEAR16[colors[k]];
  return out;
}

const SRGB_TO_LINEAR16 = Uint16Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  const l = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return Math.round(l * 65535);
});
