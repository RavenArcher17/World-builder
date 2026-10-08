/** Ground textures, object shapes and zone tints, drawn into the cached base image of a map. */
import type { Grid } from '../core/grid';
import { objectDef } from '../core/objects';
import type { TilePattern } from '../core/tiles';

/** Pixel radius of the inside of a cell, and whether the ground is foreshortened (iso). */
export function cellMetrics(g: Grid, s: number): { inner: number; flat: number } {
  if (g.type === 'iso') return { inner: s * 0.62, flat: 0.5 };
  if (g.isHex) return { inner: s * 0.8, flat: 1 };
  return { inner: s * 0.46, flat: 1 };
}

const PATTERN_INK: Record<TilePattern, string> = {
  blades: 'rgba(40,80,20,0.45)',
  dirt: 'rgba(90,60,25,0.45)',
  waves: 'rgba(220,240,255,0.55)',
  cobbles: 'rgba(70,64,56,0.45)',
  flags: 'rgba(40,36,30,0.45)',
  bricks: 'rgba(0,0,0,0.45)',
};

/** A small texture inside a cell so grass, path and floors stay distinguishable at a glance. */
export function drawPattern(ctx: CanvasRenderingContext2D, pattern: TilePattern, x: number, y: number, inner: number, flat: number, seed: number): void {
  const R = inner;
  const j = ((seed * 2654435761) >>> 0) / 4294967296;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, flat);
  ctx.strokeStyle = PATTERN_INK[pattern];
  ctx.fillStyle = PATTERN_INK[pattern];
  ctx.lineWidth = Math.max(1, R * 0.1);
  ctx.beginPath();
  switch (pattern) {
    case 'blades':
      for (const [dx, dy] of [[-0.4, 0.1], [0.05, -0.3], [0.4, 0.25]]) {
        const bx = (dx + (j - 0.5) * 0.3) * R;
        const by = dy * R;
        ctx.moveTo(bx - R * 0.08, by + R * 0.12);
        ctx.lineTo(bx, by - R * 0.14);
        ctx.lineTo(bx + R * 0.08, by + R * 0.12);
      }
      ctx.stroke();
      break;
    case 'dirt':
      for (const [dx, dy] of [[-0.35, -0.2], [0.3, -0.05], [-0.05, 0.35], [0.4, 0.4]]) {
        ctx.moveTo((dx + j * 0.2) * R + R * 0.07, dy * R);
        ctx.arc((dx + j * 0.2) * R, dy * R, R * 0.07, 0, Math.PI * 2);
      }
      ctx.fill();
      break;
    case 'waves':
      for (const dy of [-0.25, 0.3]) {
        const ox = (j - 0.5) * 0.4 * R;
        ctx.moveTo(-0.45 * R + ox, dy * R);
        ctx.quadraticCurveTo(-0.22 * R + ox, (dy - 0.18) * R, 0 + ox, dy * R);
        ctx.quadraticCurveTo(0.22 * R + ox, (dy + 0.18) * R, 0.45 * R + ox, dy * R);
      }
      ctx.stroke();
      break;
    case 'cobbles':
      for (const [dx, dy] of [[-0.5, -0.5], [0.05, -0.5], [-0.5, 0.05], [0.05, 0.05]]) ctx.rect(dx * R + R * 0.06, dy * R + R * 0.06, R * 0.38, R * 0.38);
      ctx.stroke();
      break;
    case 'flags':
      ctx.moveTo(-0.6 * R, (j - 0.5) * 0.4 * R);
      ctx.lineTo(0.6 * R, (j - 0.5) * 0.4 * R);
      ctx.moveTo((0.5 - j) * 0.4 * R, -0.6 * R);
      ctx.lineTo((0.5 - j) * 0.4 * R, 0.6 * R);
      ctx.stroke();
      break;
    case 'bricks':
      for (const dy of [-0.3, 0.05, 0.4]) {
        ctx.moveTo(-0.65 * R, dy * R);
        ctx.lineTo(0.65 * R, dy * R);
      }
      ctx.moveTo(-0.1 * R, -0.3 * R);
      ctx.lineTo(-0.1 * R, 0.05 * R);
      ctx.moveTo(0.3 * R, 0.05 * R);
      ctx.lineTo(0.3 * R, 0.4 * R);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
};

/**
 * Draw an object standing on a cell whose ground centre is (x, y). `u` is the object size unit
 * in pixels (about half a cell); upright things (trees) grow upward from the centre.
 */
export function drawObject(ctx: CanvasRenderingContext2D, id: number, x: number, y: number, u: number): void {
  const d = objectDef(id);
  if (!d) return;
  if (u < 2.5) {
    ctx.fillStyle = d.color;
    ctx.fillRect(x - 1, y - 1, 2, 2);
    return;
  }
  ctx.lineWidth = Math.max(1, u * 0.12);
  switch (d.shape) {
    case 'pine': {
      ctx.strokeStyle = '#4b3420';
      ctx.beginPath();
      ctx.moveTo(x, y + u * 0.2);
      ctx.lineTo(x, y - u * 0.3);
      ctx.stroke();
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.moveTo(x, y - u * 1.65);
      ctx.lineTo(x + u * 0.6, y - u * 0.15);
      ctx.lineTo(x - u * 0.6, y - u * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = shade(d.color, 0.6);
      ctx.stroke();
      break;
    }
    case 'round':
    case 'willow': {
      ctx.strokeStyle = '#4b3420';
      ctx.beginPath();
      ctx.moveTo(x, y + u * 0.2);
      ctx.lineTo(x, y - u * 0.5);
      ctx.stroke();
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(x, y - u * 0.9, u * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = shade(d.color, 0.6);
      ctx.stroke();
      if (d.shape === 'willow') {
        ctx.strokeStyle = shade(d.color, 1.25);
        ctx.beginPath();
        for (const dx of [-0.45, -0.15, 0.15, 0.45]) {
          ctx.moveTo(x + dx * u, y - u * 0.9);
          ctx.quadraticCurveTo(x + dx * u * 1.3, y - u * 0.4, x + dx * u * 1.2, y - u * 0.05);
        }
        ctx.stroke();
      }
      break;
    }
    case 'boulder':
    case 'ore': {
      const base = d.shape === 'ore' ? '#6e6a66' : d.color;
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.moveTo(x - u * 0.65, y + u * 0.15);
      ctx.lineTo(x - u * 0.5, y - u * 0.45);
      ctx.lineTo(x - u * 0.05, y - u * 0.7);
      ctx.lineTo(x + u * 0.5, y - u * 0.45);
      ctx.lineTo(x + u * 0.68, y + u * 0.1);
      ctx.lineTo(x + u * 0.2, y + u * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = shade(base, 0.6);
      ctx.stroke();
      if (d.shape === 'ore') {
        ctx.fillStyle = d.color;
        for (const [dx, dy] of [[-0.25, -0.3], [0.2, -0.15], [-0.05, 0.05]]) {
          ctx.beginPath();
          ctx.arc(x + dx * u, y + dy * u, u * 0.14, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'fence': {
      ctx.strokeStyle = d.color;
      ctx.lineWidth = Math.max(1, u * 0.18);
      ctx.beginPath();
      for (const dx of [-0.55, 0, 0.55]) {
        ctx.moveTo(x + dx * u, y + u * 0.2);
        ctx.lineTo(x + dx * u, y - u * 0.75);
      }
      ctx.moveTo(x - u * 0.7, y - u * 0.55);
      ctx.lineTo(x + u * 0.7, y - u * 0.55);
      ctx.moveTo(x - u * 0.7, y - u * 0.15);
      ctx.lineTo(x + u * 0.7, y - u * 0.15);
      ctx.stroke();
      break;
    }
    default: {
      ctx.fillStyle = d.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(x, y - u * 0.3, u * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.stroke();
      if (u >= 5) {
        ctx.font = `${Math.round(u * 1.05)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#000';
        ctx.fillText(d.icon, x, y - u * 0.25);
      }
    }
  }
}

/** Cells in drawing order: back to front, so things nearer the viewer overlap those behind. */
export function paintOrder(g: Grid): number[] {
  if (g.type !== 'iso') return Array.from({ length: g.size }, (_, i) => i);
  const out: number[] = [];
  for (let sum = 0; sum <= g.width + g.height - 2; sum++) {
    for (let c = Math.max(0, sum - g.height + 1); c <= Math.min(g.width - 1, sum); c++) out.push(g.idx(c, sum - c));
  }
  return out;
}
