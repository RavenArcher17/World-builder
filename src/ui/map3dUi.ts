/**
 * 3D for maps that switch it on (Map panel → "3D map"): the 3D view over the map area, its
 * options, and the .glb export. Maps without the switch never see any of it, and the 3D code
 * (scene builder, .glb writer, three.js) only downloads once a 3D map is opened.
 */
import { MAP3D_KEYS, RELIEF_RANGE, TILE_RANGE, WALL_RANGE, is3d, options3d, set3d } from '../core/scene3d/options';
import type { WorldMap } from '../core/types';
import type { App } from './app';
import { byId, downloadBlob, h, slug, toast } from './dom';
import type { View3d } from './view3d';
import './view3d.css';

interface Open3d {
  map: WorldMap;
  host: HTMLElement;
  view: View3d | null;
}

let open: Open3d | null = null;
let loading = 0;

/** The Map panel's 3D section: the switch, and the options once it is on. */
export function map3dPanel(app: App, map: WorldMap): HTMLElement {
  const box = h('div', { class: 'map3d-panel' });
  const on = is3d(map);
  const toggle = h('input', { type: 'checkbox', checked: on });
  toggle.onchange = () => {
    app.pushUndo();
    set3d(map.settings, toggle.checked);
    if (!toggle.checked) close3d();
    app.changed();
    if (toggle.checked) toast('3D is on for this map: View in 3D, or Export → 3D model (.glb)');
  };
  box.append(h('label', { class: 'check' }, toggle, '🧊 3D map'));
  if (!on) {
    box.append(h('p', { class: 'hint' }, 'Adds a 3D view and a 3D model export (.glb for Godot, Unity, Blender). The 2D map stays as it is.'));
    return box;
  }
  // Fetch the 3D code in the background so View and Export start straight away.
  void import('../core/scene3d/glb');
  const o = options3d(map);
  const set = (key: string, value: string | number) => {
    app.pushUndo();
    map.settings[key] = value;
    app.changed();
    if (open?.map === map) void show3d(app, map);
  };
  const look = h('select', { 'aria-label': 'Ground' });
  look.append(h('option', { value: 'smooth' }, 'Smooth hills'), h('option', { value: 'blocks' }, 'Blocks (steps)'));
  look.value = o.look;
  look.onchange = () => set(MAP3D_KEYS.look, look.value);
  const number = (key: string, value: number, range: { min: number; max: number }, stepBy: number) => {
    const input = h('input', { type: 'number', min: range.min, max: range.max, step: stepBy, value, inputmode: 'decimal' });
    input.onchange = () => {
      const v = Number(input.value);
      if (Number.isFinite(v) && v > 0) set(key, Math.min(range.max, Math.max(range.min, v)));
    };
    return input;
  };
  const fields = [h('label', {}, 'Ground', look), h('label', {}, 'Cell size (m)', number(MAP3D_KEYS.tile, o.tile, TILE_RANGE, 0.5))];
  if (map.kind === 'overland') fields.push(h('label', {}, 'Highest ground (m)', number(MAP3D_KEYS.relief, o.relief, RELIEF_RANGE, 1)));
  else fields.push(h('label', {}, 'Wall height (m)', number(MAP3D_KEYS.wall, o.wall, WALL_RANGE, 0.5)));
  box.append(
    h('div', { class: 'cols' }, ...fields),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'primary', onclick: () => (open?.map === map ? close3d(app) : void show3d(app, map)) }, open?.map === map ? '🗺️ Back to 2D' : '🧊 View in 3D'),
      h('button', { onclick: () => void export3dModel(map) }, '⬇ 3D model (.glb)'),
    ),
  );
  return box;
}

/** Keep the toolbar's 3D button and the open view in step with the map that is open. */
export function sync3d(app: App): void {
  const map = app.map;
  if (open && (!map || open.map.id !== map.id || !is3d(map))) close3d();
  else if (open && map && open.map !== map) void show3d(app, map); // regenerated or undone: rebuild
  let btn = document.getElementById('btn-3d') as HTMLButtonElement | null;
  if (!btn) {
    btn = h('button', { id: 'btn-3d', class: 'view3d-toggle', title: 'Show this map in 3D' }, '🧊 3D');
    byId('view-toggles').prepend(btn);
  }
  btn.style.display = is3d(map) ? '' : 'none';
  btn.classList.toggle('active', !!open);
  btn.onclick = () => (open ? close3d(app) : map && void show3d(app, map));
}

export async function show3d(app: App, map: WorldMap): Promise<void> {
  const ticket = ++loading;
  const wrap = byId('canvas-wrap');
  if (!open) {
    const host = h('div', { class: 'view3d' });
    const bar = h(
      'div',
      { class: 'view3d-bar' },
      h('button', { onclick: () => close3d(app) }, '🗺️ 2D'),
      h('button', { title: 'Back to the starting view', onclick: () => open?.view?.reset() }, '⟲'),
      h('button', { onclick: () => open && void export3dModel(open.map) }, '⬇ .glb'),
    );
    host.append(bar, h('div', { class: 'view3d-hint' }, 'Drag to turn · two fingers to move and zoom'), h('div', { class: 'view3d-loading' }, 'Building 3D…'));
    wrap.append(host);
    wrap.classList.add('is-3d');
    open = { map, host, view: null };
  }
  open.map = map;
  open.host.classList.add('busy');
  try {
    const [{ createView3d }, { buildScene }] = await Promise.all([import('./view3d'), import('../core/scene3d/build')]);
    // Let the "Building 3D…" note paint before the work starts.
    await new Promise((r) => setTimeout(r, 30));
    if (ticket !== loading || !open) return;
    const scene = buildScene(map);
    open.view ??= createView3d(open.host);
    open.view.show(scene);
  } catch (e) {
    toast(`Couldn't show 3D: ${(e as Error).message}`);
    close3d(app);
    return;
  } finally {
    open?.host.classList.remove('busy');
  }
  app.refreshPanels();
}

/** Close the 3D view. Pass the app to refresh its panels (not needed while they are being refreshed). */
export function close3d(app?: App): void {
  loading++;
  if (!open) return;
  open.view?.dispose();
  open.host.remove();
  byId('canvas-wrap').classList.remove('is-3d');
  open = null;
  document.getElementById('btn-3d')?.classList.remove('active');
  app?.refreshPanels();
}

export async function export3dModel(map: WorldMap): Promise<void> {
  const [{ buildScene }, { sceneToGlb }] = await Promise.all([import('../core/scene3d/build'), import('../core/scene3d/glb')]);
  const glb = sceneToGlb(buildScene(map));
  downloadBlob(`${slug(map.name)}.glb`, new Blob([glb], { type: 'model/gltf-binary' }));
  toast(`3D model ready (${(glb.byteLength / 1048576).toFixed(1)} MB)`);
}
