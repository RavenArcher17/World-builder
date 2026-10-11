/**
 * Editing tools for 3D maps: the storey switcher, the Height, Sky/Roof, Turn and Props paint
 * modes, the 2D overlay that shows heights, stairs, props and rooms, and named rooms. Only maps
 * with 3D on (scene3d/options.ts) ever see any of it.
 */
import { Grid, type CellRect } from '../core/grid';
import { PROPS, PROP_GROUPS, propDef } from '../core/scene3d/props';
import { FACING_STEP, HEIGHT_MAX, HEIGHT_MIN, MAX_STOREYS, addStorey, removeStorey, roomsOn, storey3d, storeyLayers, storeyNumbers } from '../core/scene3d/storeys';
import { T } from '../core/tiles';
import type { WorldMap } from '../core/types';
import type { App } from './app';
import { h, toast } from './dom';

export const PAINT_3D_MODES = ['height', 'roof', 'turn', 'prop'] as const;
export type Paint3dMode = (typeof PAINT_3D_MODES)[number];

export function is3dMode(mode: string): mode is Paint3dMode {
  return (PAINT_3D_MODES as readonly string[]).includes(mode);
}

/** Options of the 3D paint modes (kept between taps and maps). */
export const tool3d = {
  height: 'raise' as 'raise' | 'lower' | 'set' | 'flatten',
  /** Half metres, for "set". */
  level: 2,
  roof: 1,
  prop: PROPS.find((p) => p.key === 'brazier')!.id,
  /** Facing given to stairs and props as they are painted: 0 north … 3 west. */
  facing: 0,
};

const FACING_LABELS = ['↑ North', '→ East', '↓ South', '← West'];
const ARROWS = ['↑', '→', '↓', '←'];

/** Paint-mode choices added to the Paint tool on 3D maps. */
export function modeOptions3d(): [string, string][] {
  return [
    ['height', 'Height'],
    ['roof', 'Sky / roof'],
    ['prop', 'Props'],
    ['turn', 'Turn'],
  ];
}

/** The extra controls for a 3D paint mode (or for painting stairs), shown after the mode picker. */
export function paint3dOptions(app: App, mode: string, paintTile: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  const facingPicker = () => {
    const f = h('select', { 'aria-label': 'Facing' });
    FACING_LABELS.forEach((l, k) => f.append(h('option', { value: k }, l)));
    f.value = String(tool3d.facing);
    f.onchange = () => (tool3d.facing = Number(f.value));
    return f;
  };
  if (mode === 'height') {
    const op = h('select', { 'aria-label': 'Height' });
    for (const [v, l] of [
      ['raise', '▲ Raise ½ m'],
      ['lower', '▼ Lower ½ m'],
      ['set', '＝ Set to'],
      ['flatten', '⟂ Flatten (to 0)'],
    ]) op.append(h('option', { value: v }, l));
    op.value = tool3d.height;
    op.onchange = () => {
      tool3d.height = op.value as typeof tool3d.height;
      app.setTool('paint');
    };
    out.push(op);
    if (tool3d.height === 'set') {
      const lv = h('input', { type: 'number', step: 0.5, min: HEIGHT_MIN / 2, max: HEIGHT_MAX / 2, value: tool3d.level / 2, 'aria-label': 'Height in metres', inputmode: 'decimal', class: 'num' });
      lv.onchange = () => (tool3d.level = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, Math.round(Number(lv.value) * 2) || 0)));
      out.push(lv);
    }
  } else if (mode === 'roof') {
    const r = h('select', { 'aria-label': 'Sky or roof' });
    r.append(h('option', { value: 1 }, '🏠 Roofed (covered)'), h('option', { value: 0 }, '☁️ Open sky'));
    r.value = String(tool3d.roof);
    r.onchange = () => (tool3d.roof = Number(r.value));
    out.push(r);
  } else if (mode === 'prop') {
    const sel = h('select', { 'aria-label': 'Prop' });
    sel.append(h('option', { value: 0 }, '🧽 Remove props'));
    for (const [group, label] of PROP_GROUPS) {
      const og = h('optgroup', { label });
      for (const p of PROPS) if (p.id && p.group === group) og.append(h('option', { value: p.id }, `${p.icon} ${p.name}`));
      sel.append(og);
    }
    sel.value = String(tool3d.prop);
    sel.onchange = () => {
      tool3d.prop = Number(sel.value);
      app.setTool('paint');
    };
    out.push(sel);
    if (propDef(tool3d.prop)?.facing) out.push(facingPicker());
  } else if (mode === 'turn') {
    out.push(h('span', { class: 'hint inline' }, 'Tap stairs or a prop to turn it a quarter'));
  } else if (mode === 'tile' && (paintTile === T.STAIRS_UP || paintTile === T.STAIRS_DOWN)) {
    out.push(facingPicker());
  }
  return out;
}

const strokes = new WeakMap<object, Set<number>>();

/**
 * Paint a 3D mode on cells of storey z. `stroke` identifies the drag, so raising or lowering
 * changes each cell once per stroke; Turn acts on the first cell only.
 */
export function paint3dAt(map: WorldMap, z: number, mode: Paint3dMode, cells: number[], first: boolean, stroke: object): void {
  const E = storey3d(map, z, true) ?? storey3d(map, 0, true);
  let done = strokes.get(stroke);
  if (!done) strokes.set(stroke, (done = new Set()));
  for (const i of cells) {
    if (mode === 'height') {
      if (done.has(i)) continue;
      const v = tool3d.height === 'raise' ? E.height[i] + 1 : tool3d.height === 'lower' ? E.height[i] - 1 : tool3d.height === 'set' ? tool3d.level : 0;
      E.height[i] = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, v));
    } else if (mode === 'roof') {
      E.roof[i] = tool3d.roof;
    } else if (mode === 'prop') {
      E.prop[i] = tool3d.prop;
      if (tool3d.prop && propDef(tool3d.prop)?.facing) E.facing[i] = tool3d.facing;
    } else if (mode === 'turn' && first) {
      E.facing[i] = (Math.max(-1, E.facing[i]) + 1) % 4;
    }
    done.add(i);
  }
}

/** Stairs painted on a 3D map face the chosen way (the Turn mode changes it after). */
export function afterTilePaint(map: WorldMap, z: number, cells: number[], tileId: number): void {
  if (tileId !== T.STAIRS_UP && tileId !== T.STAIRS_DOWN) return;
  const E = storey3d(map, z, true);
  if (!E) return;
  for (const i of cells) E.facing[i] = tool3d.facing;
}

/** Status-bar details of a cell on a 3D map. */
export function status3d(map: WorldMap, z: number, cell: number): string[] {
  const out: string[] = [];
  if (storeyNumbers(map).length > 1) out.push(`storey ${z}`);
  const E = storey3d(map, z);
  if (!E) return out;
  if (E.height[cell]) out.push(`height ${(E.height[cell] / 2).toFixed(1)} m`);
  out.push(E.roof[cell] ? 'roofed' : 'open sky');
  const p = propDef(E.prop[cell]);
  if (p) out.push(`${p.icon} ${p.name}`);
  if (E.facing[cell] >= 0) out.push(`faces ${['north', 'east', 'south', 'west'][E.facing[cell]]}`);
  return out;
}

/** Draw heights, stairs arrows, props, roofs (in the Sky/Roof mode) and rooms over the 2D map. */
export function draw3dOverlay(ctx: CanvasRenderingContext2D, app: App, map: WorldMap, z: number): void {
  const g = new Grid(map.grid, map.width, map.height);
  const E = storey3d(map, z);
  const L = storeyLayers(map, z);
  const s = app.scale;
  const sx = (x: number) => app.ox + x * s;
  const sy = (y: number) => app.oy + y * s;
  const mode = app.tool === 'paint' ? app.paintMode : '';
  const cellPx = s * (g.isHex ? 1.5 : 1);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (E) {
    for (let i = 0; i < g.size; i++) {
      const [cx, cy] = g.center(i);
      if (mode === 'roof') {
        const pts = g.corners(i);
        ctx.beginPath();
        pts.forEach(([x, y], k) => (k ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
        ctx.closePath();
        ctx.fillStyle = E.roof[i] ? 'rgba(20,16,12,0.45)' : 'rgba(140,200,255,0.22)';
        ctx.fill();
      }
      const t = L.terrain[i];
      const stairs = (t === T.STAIRS_UP || t === T.STAIRS_DOWN) && E.facing[i] >= 0;
      const prop = propDef(E.prop[i]);
      const showHeight = E.height[i] !== 0 && (cellPx >= 16 || mode === 'height');
      if (!stairs && !prop && !showHeight) continue;
      if (cellPx < 7) continue;
      const fs = Math.max(8, Math.min(22, cellPx * 0.55));
      if (prop) {
        ctx.font = `${fs}px system-ui, sans-serif`;
        ctx.fillText(prop.icon, sx(cx), sy(cy));
        if (prop.facing && E.facing[i] >= 0) {
          const [dx, dy] = FACING_STEP[E.facing[i]];
          ctx.fillStyle = '#ffd778';
          ctx.beginPath();
          ctx.arc(sx(cx) + dx * cellPx * 0.36, sy(cy) + dy * cellPx * 0.36, Math.max(2, cellPx * 0.08), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (stairs) {
        const f = t === T.STAIRS_UP ? E.facing[i] : (E.facing[i] + 2) % 4;
        ctx.font = `700 ${fs * 1.2}px system-ui, sans-serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(ARROWS[f], sx(cx), sy(cy));
        ctx.fillStyle = '#fff';
        ctx.fillText(ARROWS[f], sx(cx), sy(cy));
      }
      if (showHeight) {
        const label = `${E.height[i] > 0 ? '+' : ''}${E.height[i] / 2}`;
        ctx.font = `600 ${Math.max(8, fs * 0.6)}px system-ui, sans-serif`;
        const y = sy(cy) + (prop || stairs ? cellPx * 0.3 : 0);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(label, sx(cx), y);
        ctx.fillStyle = E.height[i] > 0 ? '#ffe6a0' : '#a0d8ff';
        ctx.fillText(label, sx(cx), y);
      }
    }
  }
  for (const room of roomsOn(map, z)) {
    const a = g.corners(g.idx(room.c0, room.r0));
    const b = g.corners(g.idx(room.c1, room.r1));
    const x0 = Math.min(...a.map((p) => p[0]));
    const y0 = Math.min(...a.map((p) => p[1]));
    const x1 = Math.max(...b.map((p) => p[0]));
    const y1 = Math.max(...b.map((p) => p[1]));
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(180,220,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx(x0), sy(y0), (x1 - x0) * s, (y1 - y0) * s);
    ctx.setLineDash([]);
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(room.name, sx(x0) + 4, sy(y0) + 3);
    ctx.fillStyle = '#cfe8ff';
    ctx.fillText(room.name, sx(x0) + 4, sy(y0) + 3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  }
  ctx.restore();
}

/** Toolbar control: the storey being edited, with buttons to go down and up. */
export function storeyControls(app: App, map: WorldMap | null): HTMLElement | null {
  let box = document.getElementById('storey-bar');
  if (!box) {
    box = h('div', { id: 'storey-bar', class: 'storey-bar' });
    document.getElementById('view-toggles')?.prepend(box);
  }
  const zs = map ? storeyNumbers(map) : [0];
  if (!map || zs.length < 2) {
    box.style.display = 'none';
    return box;
  }
  box.style.display = '';
  const k = zs.indexOf(app.storey);
  box.replaceChildren(
    h('button', { class: 'icon', title: 'Storey below', 'aria-label': 'Storey below', disabled: k <= 0, onclick: () => app.setStorey(zs[k - 1]) }, '▼'),
    h('span', { class: 'storey-label', title: 'Storey being edited' }, `🏢 ${app.storey}`),
    h('button', { class: 'icon', title: 'Storey above', 'aria-label': 'Storey above', disabled: k >= zs.length - 1, onclick: () => app.setStorey(zs[k + 1]) }, '▲'),
  );
  return box;
}

/** Map panel: storeys and rooms of a 3D map. */
export function storeyPanel(app: App, map: WorldMap): HTMLElement {
  const zs = storeyNumbers(map);
  const z = app.storey;
  const add = (dir: 1 | -1) => {
    app.pushUndo();
    const nz = addStorey(map, dir);
    if (nz === null) {
      toast(`A map can have ${MAX_STOREYS} storeys at most`);
      return;
    }
    app.changed();
    app.setStorey(nz);
    toast(`Storey ${nz} added: paint its floors (everything starts as Nothing)`);
  };
  const box = h(
    'div',
    { class: 'storeys' },
    h(
      'p',
      { class: 'hint' },
      zs.length > 1
        ? `Storeys ${zs.join(', ')} · editing storey ${z} (switch with ▼ ▲ in the toolbar). Each storey sits one wall height plus a 0.5 m floor above the last.`
        : 'One storey. Add more to build upwards (towers, galleries) or downwards (crypts).',
    ),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { onclick: () => add(1), disabled: zs.length >= MAX_STOREYS }, '＋ Storey above'),
      h('button', { onclick: () => add(-1), disabled: zs.length >= MAX_STOREYS }, '＋ Storey below'),
      z !== 0
        ? h(
            'button',
            {
              class: 'danger',
              onclick: () => {
                if (!confirm(`Remove storey ${z} with everything on it?`)) return;
                app.pushUndo();
                removeStorey(map, z);
                app.setStorey(0);
                app.changed();
              },
            },
            `Remove storey ${z}`,
          )
        : null,
    ),
  );
  const rooms = map.rooms ?? [];
  if (rooms.length) {
    const list = h('div', { class: 'room-list' });
    rooms.forEach((room, k) =>
      list.append(
        h(
          'div',
          {},
          h('span', {}, `🏷 ${room.name}`),
          h('span', { class: 'meta' }, `storey ${room.z} · ${room.c0},${room.r0} → ${room.c1},${room.r1}`),
          h(
            'button',
            {
              class: 'icon',
              'aria-label': `Delete room ${room.name}`,
              onclick: () => {
                app.pushUndo();
                map.rooms = rooms.filter((_, j) => j !== k);
                if (!map.rooms.length) delete map.rooms;
                app.changed();
              },
            },
            '✕',
          ),
        ),
      ),
    );
    box.append(h('h3', {}, 'Rooms'), list);
  } else {
    box.append(h('p', { class: 'hint' }, 'Name a room: drag a box with Select, then “Name as room”.'));
  }
  return box;
}

/** Selection panel button: name the selected area as a room on the storey being edited. */
export function roomButton(app: App, map: WorldMap, rect: CellRect): HTMLElement {
  return h(
    'button',
    {
      onclick: () => {
        const name = prompt('Room name', 'Hall')?.trim();
        if (!name) return;
        app.pushUndo();
        map.rooms = [...(map.rooms ?? []), { name, z: app.storey, ...rect }];
        app.changed();
        toast(`Room “${name}” named`);
      },
    },
    '🏷 Name as room',
  );
}
