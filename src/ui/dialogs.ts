/** Modal workflows: zoom-in / detail map, export, stitching maps together, help. */
import { autoArrange, composeMaps, snapPlacement } from '../core/compose';
import { legendCsv, toCsv, toGameJson, toTiled } from '../core/export/formats';
import { CellRect, GRID_TYPES, Grid, GridType } from '../core/grid';
import { serializeProject } from '../core/project';
import { resampleMap } from '../core/resample';
import { parseSeed, randomSeed } from '../core/rng';
import { SCALES, getScale } from '../core/scales';
import type { Placement, WorldMap } from '../core/types';
import { gameMaps } from '../core/rpgdc/game';
import { RPGDC_EXPORT_NAME } from '../core/rpgdc/export';
import { createChildMap, suggestSize, suggestZoom } from '../core/zoom';
import type { App } from './app';
import { downloadCanvas, downloadText, h, settingsForm, showDialog, slug, toast } from './dom';
import { exportRpgdc, gameExportSummary, openCheckDialog } from './gameUi';
import { DEFAULT_VIEW, baseUnitPx, renderMapCanvas, renderTileset, safeScale } from './render';

function gridSelect(value: string, includeKeep = false): HTMLSelectElement {
  const sel = h('select');
  if (includeKeep) sel.append(h('option', { value: '' }, 'Same as map'));
  for (const g of GRID_TYPES) sel.append(h('option', { value: g.id }, g.label));
  sel.value = value;
  return sel;
}

// ---- zoom in --------------------------------------------------------------------------------

export function openZoomDialog(app: App, parent: WorldMap, rect: CellRect): void {
  let opts = suggestZoom(parent, rect);
  const body = h('div');
  const parentScale = getScale(parent.scaleId);

  const render = () => {
    const scaleSel = h('select');
    const preferred = new Set(parentScale.children);
    const og1 = h('optgroup', { label: 'Suggested' });
    const og2 = h('optgroup', { label: 'Other scales' });
    for (const s of SCALES) (preferred.has(s.id) ? og1 : og2).append(h('option', { value: s.id }, `${s.label} (${s.cell})`));
    scaleSel.append(og1, og2);
    scaleSel.value = opts.scaleId;
    scaleSel.onchange = () => {
      const grid = opts.grid;
      opts = suggestZoom(parent, rect, scaleSel.value);
      opts.grid = grid;
      Object.assign(opts, suggestSize(new Grid(parent.grid, parent.width, parent.height), rect, grid, opts.scaleId));
      render();
    };
    const grid = gridSelect(opts.grid);
    grid.onchange = () => {
      opts.grid = grid.value as GridType;
      Object.assign(opts, suggestSize(new Grid(parent.grid, parent.width, parent.height), rect, opts.grid, opts.scaleId));
      render();
    };
    const w = h('input', { type: 'number', min: 8, max: 256, value: opts.width });
    w.onchange = () => (opts.width = Math.max(8, Math.min(256, Number(w.value) || 8)));
    const hh = h('input', { type: 'number', min: 8, max: 256, value: opts.height });
    hh.onchange = () => (opts.height = Math.max(8, Math.min(256, Number(hh.value) || 8)));
    const seed = h('input', { value: opts.seed });
    seed.onchange = () => (opts.seed = parseSeed(seed.value));
    const name = h('input', { value: opts.name });
    name.onchange = () => (opts.name = name.value || opts.name);
    const scale = getScale(opts.scaleId);
    body.replaceChildren(
      h(
        'p',
        { class: 'hint' },
        scale.kind === 'overland'
          ? 'The new map keeps the coastlines, rivers, roads and places of the selected area and adds finer detail.'
          : scale.kind === 'settlement'
            ? 'Builds a street-level layout. River, coast and surroundings are taken from the parent map.'
            : 'Builds a dungeon / cave level for this place.',
      ),
      h('div', { class: 'cols' }, h('label', {}, 'Detail scale', scaleSel), h('label', {}, 'Grid', grid)),
      h('div', { class: 'cols' }, h('label', {}, 'Width', w), h('label', {}, 'Height', hh)),
      h('div', { class: 'cols' }, h('label', {}, 'Name', name), h('label', {}, 'Seed', seed)),
      settingsForm(scale.kind, opts.settings),
    );
  };
  render();
  showDialog(`Detail map of ${rect.c1 - rect.c0 + 1}×${rect.r1 - rect.r0 + 1} cells`, body, [
    { label: 'Cancel' },
    {
      label: '✨ Generate detail map',
      primary: true,
      action: () => {
        app.pushUndo();
        const child = createChildMap(app.project, parent.id, rect, opts);
        app.openMap(child.id);
        app.changed();
        toast(`Created ${child.name} — double-click its outline on ${parent.name} to return here later`);
      },
    },
  ]);
}

// ---- export ---------------------------------------------------------------------------------

export function openExportDialog(app: App, map: WorldMap): void {
  const format = h('select');
  const hasGame = gameMaps(app.project).length > 0;
  if (hasGame) format.append(h('option', { value: 'rpgdc' }, `RPG-DC maps (${RPGDC_EXPORT_NAME})`));
  for (const [v, l] of [
    ['png', 'PNG image'],
    ['json', 'Game JSON (all layers + places)'],
    ['tiled', 'Tiled map (.tmj + tileset.png)'],
    ['csv', 'CSV tile grid + legend'],
    ['project', 'Whole project (.world.json)'],
  ]) format.append(h('option', { value: v }, l));
  const grid = gridSelect('', true);
  const w = h('input', { type: 'number', min: 8, max: 512, placeholder: 'auto' });
  const hh = h('input', { type: 'number', min: 8, max: 512, placeholder: 'auto' });
  const cellPx = h('input', { type: 'number', min: 2, max: 64, value: Math.round(baseUnitPx(map.grid) * 1.5) });
  const withPlaces = h('input', { type: 'checkbox', checked: true });
  const withGrid = h('input', { type: 'checkbox', checked: false });
  const pngOpts = h(
    'div',
    {},
    h('label', {}, 'Pixels per cell unit', cellPx),
    h('label', { class: 'check' }, withPlaces, 'Draw places & labels'),
    h('label', { class: 'check' }, withGrid, 'Draw grid lines'),
  );
  const note = h('p', { class: 'hint' });
  const convert = h(
    'div',
    {},
    h('div', { class: 'cols' }, h('label', {}, 'Convert to grid', grid), h('div', { class: 'cols' }, h('label', {}, 'Width', w), h('label', {}, 'Height', hh))),
    h('p', { class: 'hint' }, 'Converting re-samples terrain, roads, rivers and places onto the new layout — e.g. export a hex map as square tiles. Leave width/height empty to keep the same area.'),
  );
  const checkBtn = h('button', { onclick: () => openCheckDialog(app) }, '✓ Check for game');
  const update = () => {
    pngOpts.style.display = format.value === 'png' ? '' : 'none';
    convert.style.display = format.value === 'rpgdc' || format.value === 'project' ? 'none' : '';
    checkBtn.style.display = format.value === 'rpgdc' ? '' : 'none';
    note.textContent =
      format.value === 'rpgdc'
        ? `Every RPG-DC map in the project in one file for the game (format: docs/rpgdc-export.md). ${gameExportSummary(app)}`
        : format.value === 'tiled'
        ? 'Opens in the Tiled editor and imports into Godot, Unity (SuperTiled2Unity), GameMaker, Phaser, Defold and more. Roads, rivers and places are object layers.'
        : format.value === 'json'
          ? 'Plain JSON: terrain ids, elevation/moisture/temperature, road & river direction bitmasks, building ids, polylines and places — easy to load in any engine.'
          : format.value === 'csv'
            ? 'One row of tile ids per map row, plus a legend.csv mapping ids to tile names.'
            : format.value === 'project'
              ? 'Every map in the atlas with links, for re-opening in World Builder.'
              : 'A rendered picture of the map.';
  };
  format.onchange = update;
  update();
  const body = h(
    'div',
    {},
    h('label', {}, 'Format', format),
    convert,
    pngOpts,
    note,
    h('div', { class: 'btn-row' }, checkBtn),
  );
  showDialog(`Export ${map.name}`, body, [
    { label: 'Cancel' },
    {
      label: '⬇ Export',
      primary: true,
      action: async () => {
        if (format.value === 'rpgdc') return exportRpgdc(app);
        let out = map;
        const targetGrid = (grid.value || map.grid) as GridType;
        const tw = Number(w.value) || undefined;
        const th = Number(hh.value) || undefined;
        if (targetGrid !== map.grid || (tw && th)) out = resampleMap(map, targetGrid, tw, th);
        const base = slug(map.name);
        switch (format.value) {
          case 'png': {
            const s = safeScale(out, Number(cellPx.value) || 16, 12000);
            const canvas = renderMapCanvas(out, s, { ...DEFAULT_VIEW, grid: withGrid.checked, features: withPlaces.checked, labels: withPlaces.checked }, withPlaces.checked);
            await downloadCanvas(`${base}.png`, canvas);
            break;
          }
          case 'json':
            downloadText(`${base}.map.json`, JSON.stringify(toGameJson(out)));
            break;
          case 'tiled': {
            const img = `${base}-tileset.png`;
            downloadText(`${base}.tmj`, JSON.stringify(toTiled(out, img)));
            await downloadCanvas(img, renderTileset(out.grid));
            break;
          }
          case 'csv':
            downloadText(`${base}.csv`, toCsv(out), 'text/csv');
            downloadText('legend.csv', legendCsv(), 'text/csv');
            break;
          case 'project':
            downloadText(`${slug(app.project.name)}.world.json`, serializeProject(app.project));
            break;
        }
        toast('Export ready');
      },
    },
  ]);
}

// ---- compose --------------------------------------------------------------------------------

export function openComposeDialog(app: App): void {
  const maps = Object.values(app.project.maps);
  if (!maps.length) {
    toast('Generate some maps first');
    return;
  }
  const current = app.map ?? maps[0];
  const chosen = new Map<string, Placement>();
  let grid: GridType = current.grid;
  let width = 128;
  let height = 96;
  const nameIn = h('input', { value: 'Stitched map' });
  const scaleSel = h('select');
  for (const s of SCALES.filter((s) => s.kind === 'overland')) scaleSel.append(h('option', { value: s.id }, s.label));
  scaleSel.value = 'kingdom';
  const gridSel = gridSelect(grid);
  const wIn = h('input', { type: 'number', min: 8, max: 512, value: width });
  const hIn = h('input', { type: 'number', min: 8, max: 512, value: height });
  const fill = h('input', { type: 'checkbox', checked: true });
  const roads = h('input', { type: 'checkbox', checked: true });
  const preview = h('canvas', { width: 600, height: 300 });
  const table = h('table');

  const drawPreview = () => {
    const ctx = preview.getContext('2d')!;
    const k = Math.min(preview.width / width, preview.height / height);
    ctx.fillStyle = '#0e1014';
    ctx.fillRect(0, 0, preview.width, preview.height);
    ctx.strokeStyle = '#555';
    ctx.strokeRect(0, 0, width * k, height * k);
    const palette = ['#e0b04a', '#6fa8dc', '#8fbc5c', '#c27ba0', '#d0604a', '#9a8cd8'];
    let n = 0;
    for (const p of chosen.values()) {
      const m = app.project.maps[p.mapId];
      ctx.fillStyle = palette[n % palette.length] + '55';
      ctx.strokeStyle = palette[n++ % palette.length];
      ctx.fillRect(p.c * k, p.r * k, m.width * k, m.height * k);
      ctx.strokeRect(p.c * k, p.r * k, m.width * k, m.height * k);
      ctx.fillStyle = '#fff';
      ctx.font = '12px system-ui';
      ctx.fillText(m.name, p.c * k + 4, p.r * k + 14);
    }
  };
  const renderTable = () => {
    table.replaceChildren(h('tr', {}, h('th', {}, 'Use'), h('th', {}, 'Map'), h('th', {}, 'Size'), h('th', {}, 'Col'), h('th', {}, 'Row')));
    for (const m of maps) {
      const p = chosen.get(m.id);
      const use = h('input', { type: 'checkbox', checked: !!p });
      const c = h('input', { type: 'number', value: p?.c ?? 0, disabled: !p });
      const r = h('input', { type: 'number', value: p?.r ?? 0, disabled: !p });
      use.onchange = () => {
        if (use.checked) chosen.set(m.id, { mapId: m.id, c: 0, r: 0 });
        else chosen.delete(m.id);
        renderTable();
        drawPreview();
      };
      const move = () => {
        const s = snapPlacement(grid, Number(c.value) || 0, Number(r.value) || 0);
        chosen.set(m.id, { mapId: m.id, ...s });
        c.value = String(s.c);
        r.value = String(s.r);
        drawPreview();
      };
      c.onchange = move;
      r.onchange = move;
      table.append(h('tr', {}, h('td', {}, use), h('td', {}, m.name), h('td', {}, `${m.width}×${m.height}${m.grid !== grid ? ' *' : ''}`), h('td', {}, c), h('td', {}, r)));
    }
  };
  gridSel.onchange = () => {
    grid = gridSel.value as GridType;
    renderTable();
  };
  wIn.onchange = () => {
    width = Math.max(8, Math.min(512, Number(wIn.value) || 8));
    drawPreview();
  };
  hIn.onchange = () => {
    height = Math.max(8, Math.min(512, Number(hIn.value) || 8));
    drawPreview();
  };
  const arrange = h(
    'button',
    {
      onclick: () => {
        const sel = [...chosen.keys()].map((id) => app.project.maps[id]);
        if (!sel.length) return toast('Tick some maps first');
        const res = autoArrange(sel, grid, 2);
        chosen.clear();
        for (const p of res.placements) chosen.set(p.mapId, p);
        width = res.width + 4;
        height = res.height + 4;
        for (const p of chosen.values()) Object.assign(p, snapPlacement(grid, p.c + 2, p.r + 2));
        wIn.value = String(width);
        hIn.value = String(height);
        renderTable();
        drawPreview();
      },
    },
    'Auto-arrange',
  );
  chosen.set(current.id, { mapId: current.id, c: 0, r: 0 });
  renderTable();
  drawPreview();
  const body = h(
    'div',
    {},
    h('p', { class: 'hint' }, 'Place existing maps onto one bigger board. Gaps can be filled with blended terrain and settlements joined by roads. Maps on a different grid (*) are converted.'),
    h('div', { class: 'cols' }, h('label', {}, 'Name', nameIn), h('label', {}, 'Scale', scaleSel)),
    h('div', { class: 'cols' }, h('label', {}, 'Grid', gridSel), h('div', { class: 'cols' }, h('label', {}, 'Board width', wIn), h('label', {}, 'Board height', hIn))),
    table,
    h('div', { class: 'btn-row' }, arrange, h('label', { class: 'check' }, fill, 'Fill gaps with terrain'), h('label', { class: 'check' }, roads, 'Connect with roads')),
    preview,
  );
  showDialog('Stitch maps together', body, [
    { label: 'Cancel' },
    {
      label: '🧩 Build map',
      primary: true,
      action: () => {
        if (!chosen.size) {
          toast('Tick at least one map');
          return false;
        }
        app.pushUndo();
        const map = composeMaps(app.project, {
          name: nameIn.value || 'Stitched map',
          grid,
          width,
          height,
          seed: randomSeed(),
          scaleId: scaleSel.value,
          placements: [...chosen.values()],
          fillGaps: fill.checked,
          connectRoads: roads.checked,
        });
        app.addMap(map);
        toast(`Built ${map.name}`);
      },
    },
  ]);
}

// ---- help -----------------------------------------------------------------------------------

export function openHelpDialog(): void {
  const li = (b: string, t: string) => h('li', {}, h('b', {}, b), ' — ', t);
  showDialog(
    'How to use World Builder',
    h(
      'div',
      {},
      h(
        'ol',
        {},
        li('Generate', 'pick a scale (world → county → local, town layouts, dungeons), a grid (square, hex, isometric), toggle what you want on the map and press Generate.'),
        li('Select an area', 'drag with the Select tool. Then Re-roll it (new random content that blends into the rest) or Zoom in to create a detailed child map of just that area.'),
        li('Drill down', 'zooming into a region keeps its coastline, rivers, roads and places. Zoom into a town or dungeon icon to get a street or room layout. The Atlas shows the hierarchy; double-click an outlined region or a place with a gold dot to open its detail map.'),
        li('Edit', 'Paint terrain, roads and rivers; Place, drag, rename and annotate places. Ctrl+Z undoes anything.'),
        li('Stitch', 'combine several maps onto a larger board, fill the gaps and connect them with roads.'),
        li('Export', 'PNG, Tiled (.tmj + tileset), game JSON or CSV — optionally converting hex ↔ square ↔ isometric.'),
      ),
      h('h3', {}, 'RPG-DC maps'),
      h(
        'ul',
        {},
        li('Paint', 'Ground (grass, path, water, cobbles, crypt floor and wall), Objects (trees, rocks, ore, stations, fishing spots, stairs), Grove and Ore brushes, and Zones on the overworld.'),
        li('Place', 'spawn point, monster spawns (kind, count, radius), bosses, braziers and stairs links. Tap a place to edit its fields; for a link, choose the map and tap “Pick arrival tile”.'),
        li('Check for game', 'in the Map panel lists every problem; tap one to jump to its tile. Export → RPG-DC maps writes rpg-dc.maps.json for the game.'),
      ),
      h('p', { class: 'hint' }, 'Touch: one finger paints, places or selects; two fingers pinch to zoom and drag to pan; double-tap a linked place to open its map.'),
      h('p', { class: 'hint' }, 'Shortcuts: S select · H pan · P paint · F place · Space+drag or right-drag pans · wheel zooms · Esc clears · Del deletes the selected place.'),
      h('p', { class: 'hint' }, 'Your project autosaves in this browser. Use Save to download a project file you can re-open anywhere.'),
    ),
    [{ label: 'Got it', primary: true }],
  );
}
