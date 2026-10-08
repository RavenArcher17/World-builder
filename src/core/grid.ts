/**
 * Grid geometry for every supported layout.
 *
 * Cells are always stored row-major in offset coordinates (col, row), which is what Tiled and
 * most engines expect. Two coordinate spaces are exposed:
 *  - logical: an isotropic plane where neighbouring cell centres are ~1 unit apart. Generators
 *    work here so noise, distances and shapes look the same on every grid type.
 *  - render: unit-sized drawing coordinates (multiply by a pixel scale to draw).
 *
 * Hex layouts follow Tiled's conventions: `hex-pointy` = staggeraxis y / staggerindex odd
 * ("odd-r": odd rows shifted right), `hex-flat` = staggeraxis x / staggerindex odd ("odd-q":
 * odd columns shifted down). `iso` is a diamond (2:1) projection of a square grid.
 */

export type GridType = 'square' | 'hex-pointy' | 'hex-flat' | 'iso';

export const GRID_TYPES: { id: GridType; label: string }[] = [
  { id: 'square', label: 'Square tiles' },
  { id: 'hex-pointy', label: 'Hex (pointy top)' },
  { id: 'hex-flat', label: 'Hex (flat top)' },
  { id: 'iso', label: 'Isometric tiles' },
];

const S3 = Math.sqrt(3);

/** Square/iso directions: E, SE, S, SW, W, NW, N, NE (orthogonals on even indices). */
const SQ_DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
/** Pointy hex directions: E, SE, SW, W, NW, NE. */
const PT_EVEN = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
const PT_ODD = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]];
/** Flat hex directions: N, NE, SE, S, SW, NW. */
const FL_EVEN = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]];
const FL_ODD = [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

export const DIRECTION_NAMES: Record<GridType, string[]> = {
  square: ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'],
  iso: ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'],
  'hex-pointy': ['E', 'SE', 'SW', 'W', 'NW', 'NE'],
  'hex-flat': ['N', 'NE', 'SE', 'S', 'SW', 'NW'],
};

export class Grid {
  readonly size: number;
  readonly dirCount: number;
  readonly isHex: boolean;

  constructor(readonly type: GridType, readonly width: number, readonly height: number) {
    this.size = width * height;
    this.isHex = type === 'hex-pointy' || type === 'hex-flat';
    this.dirCount = this.isHex ? 6 : 8;
  }

  idx(c: number, r: number): number {
    return r * this.width + c;
  }
  col(i: number): number {
    return i % this.width;
  }
  row(i: number): number {
    return Math.floor(i / this.width);
  }
  inBounds(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.width && r < this.height;
  }

  dirOffsets(c: number, r: number): number[][] {
    switch (this.type) {
      case 'hex-pointy':
        return r & 1 ? PT_ODD : PT_EVEN;
      case 'hex-flat':
        return c & 1 ? FL_ODD : FL_EVEN;
      default:
        return SQ_DIRS;
    }
  }

  /** Index of the neighbour in direction `dir`, or -1 if outside the map. */
  neighbor(i: number, dir: number): number {
    const c = this.col(i);
    const r = this.row(i);
    const o = this.dirOffsets(c, r)[dir];
    const nc = c + o[0];
    const nr = r + o[1];
    return this.inBounds(nc, nr) ? this.idx(nc, nr) : -1;
  }

  /**
   * Neighbour indices. On square/iso grids `diagonals=false` restricts to the 4 orthogonal
   * neighbours (corridors, flood fills); hex grids always return 6.
   */
  neighbors(i: number, diagonals = true): number[] {
    const out: number[] = [];
    const c = this.col(i);
    const r = this.row(i);
    const offs = this.dirOffsets(c, r);
    const step = !this.isHex && !diagonals ? 2 : 1;
    for (let d = 0; d < offs.length; d += step) {
      const nc = c + offs[d][0];
      const nr = r + offs[d][1];
      if (this.inBounds(nc, nr)) out.push(nr * this.width + nc);
    }
    return out;
  }

  opposite(dir: number): number {
    return (dir + this.dirCount / 2) % this.dirCount;
  }

  /** Direction from cell i to adjacent cell j, or -1 if they are not adjacent. */
  dirBetween(i: number, j: number): number {
    const c = this.col(i);
    const r = this.row(i);
    const dc = this.col(j) - c;
    const dr = this.row(j) - r;
    const offs = this.dirOffsets(c, r);
    for (let d = 0; d < offs.length; d++) if (offs[d][0] === dc && offs[d][1] === dr) return d;
    return -1;
  }

  // ---- logical (isotropic) space -------------------------------------------------------

  posCR(c: number, r: number): [number, number] {
    switch (this.type) {
      case 'hex-pointy':
        return [c + 0.5 * (r & 1) + 0.5, (r * S3) / 2 + 1 / S3];
      case 'hex-flat':
        return [(c * S3) / 2 + 1 / S3, r + 0.5 * (c & 1) + 0.5];
      default:
        return [c + 0.5, r + 0.5];
    }
  }

  pos(i: number): [number, number] {
    return this.posCR(this.col(i), this.row(i));
  }

  logicalBounds(): { w: number; h: number } {
    switch (this.type) {
      case 'hex-pointy':
        return { w: this.width + 0.5, h: ((this.height - 1) * S3) / 2 + 2 / S3 };
      case 'hex-flat':
        return { w: ((this.width - 1) * S3) / 2 + 2 / S3, h: this.height + 0.5 };
      default:
        return { w: this.width, h: this.height };
    }
  }

  /** Cell containing a logical point, or -1. */
  posToCell(x: number, y: number): number {
    if (this.isHex) return this.pixelToCell(x * S3, y * S3);
    const c = Math.floor(x);
    const r = Math.floor(y);
    return this.inBounds(c, r) ? this.idx(c, r) : -1;
  }

  /** Like posToCell but clamps the point into the map so it always returns a cell. */
  posToCellClamped(x: number, y: number): number {
    const b = this.logicalBounds();
    const cx = Math.min(Math.max(x, 0.01), b.w - 0.01);
    const cy = Math.min(Math.max(y, 0.01), b.h - 0.01);
    let i = this.posToCell(cx, cy);
    if (i >= 0) return i;
    // Hex maps have ragged edges; search nearest centre.
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < this.size; k++) {
      const [px, py] = this.pos(k);
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    i = best;
    return i;
  }

  dist(i: number, j: number): number {
    const a = this.pos(i);
    const b = this.pos(j);
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  // ---- render space ---------------------------------------------------------------------

  centerCR(c: number, r: number): [number, number] {
    const [x, y] = this.posCR(c, r);
    switch (this.type) {
      case 'hex-pointy':
      case 'hex-flat':
        return [x * S3, y * S3];
      case 'iso':
        return [x - y + this.height, (x + y) / 2];
      default:
        return [x, y];
    }
  }

  center(i: number): [number, number] {
    return this.centerCR(this.col(i), this.row(i));
  }

  cornersCR(c: number, r: number): [number, number][] {
    const [x, y] = this.centerCR(c, r);
    switch (this.type) {
      case 'hex-pointy':
        return HEX_PT_CORNERS.map(([dx, dy]) => [x + dx, y + dy]);
      case 'hex-flat':
        return HEX_FL_CORNERS.map(([dx, dy]) => [x + dx, y + dy]);
      case 'iso':
        return [[x, y - 0.5], [x + 1, y], [x, y + 0.5], [x - 1, y]];
      default:
        return [[x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [x - 0.5, y + 0.5]];
    }
  }

  corners(i: number): [number, number][] {
    return this.cornersCR(this.col(i), this.row(i));
  }

  renderBounds(): { w: number; h: number } {
    switch (this.type) {
      case 'hex-pointy':
        return { w: S3 * (this.width + 0.5), h: (this.height - 1) * 1.5 + 2 };
      case 'hex-flat':
        return { w: (this.width - 1) * 1.5 + 2, h: S3 * (this.height + 0.5) };
      case 'iso':
        return { w: this.width + this.height, h: (this.width + this.height) / 2 };
      default:
        return { w: this.width, h: this.height };
    }
  }

  /** Cell at a render-space point, or -1. */
  pixelToCell(x: number, y: number): number {
    let c: number;
    let r: number;
    switch (this.type) {
      case 'hex-pointy': {
        const X = x - S3 / 2;
        const Y = y - 1;
        const [q, rr] = cubeRound((S3 / 3) * X - Y / 3, (2 / 3) * Y);
        r = rr;
        c = q + (rr - (rr & 1)) / 2;
        break;
      }
      case 'hex-flat': {
        const X = x - 1;
        const Y = y - S3 / 2;
        const [q, rr] = cubeRound((2 / 3) * X, -X / 3 + (S3 / 3) * Y);
        c = q;
        r = rr + (q - (q & 1)) / 2;
        break;
      }
      case 'iso': {
        const xx = x - this.height;
        c = Math.floor((xx + 2 * y) / 2);
        r = Math.floor((2 * y - xx) / 2);
        break;
      }
      default:
        c = Math.floor(x);
        r = Math.floor(y);
    }
    return this.inBounds(c, r) ? this.idx(c, r) : -1;
  }
}

const HEX_PT_CORNERS: [number, number][] = Array.from({ length: 6 }, (_, k) => {
  const a = ((30 + 60 * k) * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
});
const HEX_FL_CORNERS: [number, number][] = Array.from({ length: 6 }, (_, k) => {
  const a = ((60 * k) * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
});

function cubeRound(fq: number, fr: number): [number, number] {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r];
}

export interface CellRect {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

export function normalizeRect(a: CellRect): CellRect {
  return {
    c0: Math.min(a.c0, a.c1),
    r0: Math.min(a.r0, a.r1),
    c1: Math.max(a.c0, a.c1),
    r1: Math.max(a.r0, a.r1),
  };
}

export function inRect(rect: CellRect, c: number, r: number): boolean {
  return c >= rect.c0 && c <= rect.c1 && r >= rect.r0 && r <= rect.r1;
}

/** Logical-space bounding box of a rectangle of cells. */
export function rectLogicalBox(g: Grid, rect: CellRect): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let r = rect.r0; r <= rect.r1; r++) {
    for (let c = rect.c0; c <= rect.c1; c++) {
      const [x, y] = g.posCR(c, r);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return { x0: x0 - 0.5, y0: y0 - 0.5, x1: x1 + 0.5, y1: y1 + 0.5 };
}
