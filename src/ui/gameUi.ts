/**
 * Editor panels for RPG-DC maps (maps whose settings carry `rpgdcMapId`): palettes for ground,
 * objects, groves, ore and zones; place fields; the zone legend; "Check for game"; the export.
 */
import { featureDef } from '../core/features';
import { O, OBJECTS, objectDef } from '../core/objects';
import { checkGameMaps, type GameIssue } from '../core/rpgdc/checks';
import { RPGDC_EXPORT_NAME, toRpgdcMaps } from '../core/rpgdc/export';
import {
  GAME_OBJECTS,
  GROUND_TILES,
  PLACE_FIELDS,
  PLACE_HELP,
  PLACE_TYPES,
  ZONES,
  findGameMap,
  gameKind,
  gameMapId,
  gameMaps,
  isWalkableAt,
  mapZone,
  placeProps,
  zoneByKey,
} from '../core/rpgdc/game';
import { tile } from '../core/tiles';
import type { Feature, WorldMap } from '../core/types';
import type { App } from './app';
import { byId, downloadText, h, showDialog, toast } from './dom';

export type GamePaintMode = 'tile' | 'object' | 'grove' | 'ore' | 'zone';

const GROVE_OBJECTS = [O.TREE, O.OAK, O.WILLOW];
const ORE_OBJECTS = [O.COPPER_ROCK, O.TIN_ROCK, O.IRON_ROCK];

function palButton(label: string, icon: HTMLElement | string, active: boolean, onclick: () => void, title?: string): HTMLButtonElement {
  return h('button', { class: `pal${active ? ' active' : ''}`, title: title ?? label, onclick }, typeof icon === 'string' ? h('span', { class: 'pal-icon' }, icon) : icon, h('span', { class: 'pal-label' }, label));
}

const swatch = (color: string) => h('span', { class: 'pal-swatch', style: `background:${color}` });

/** Tool options shown while painting an RPG-DC map. */
export function gamePaintOptions(app: App, map: WorldMap): HTMLElement[] {
  const modes: [GamePaintMode, string][] = [
    ['tile', 'Ground'],
    ['object', 'Objects'],
    ['grove', 'Grove'],
    ['ore', 'Ore'],
  ];
  if (gameKind(map) === 'overworld') modes.push(['zone', 'Zones']);
  const mode = app.paintMode as GamePaintMode;
  const modeRow = h('div', { class: 'seg' });
  for (const [m, label] of modes) {
    modeRow.append(h('button', { class: mode === m ? 'active' : '', onclick: () => app.setPaint({ paintMode: m }) }, label));
  }
  const out: HTMLElement[] = [modeRow];
  if (mode === 'tile' || mode === 'object' || mode === 'zone' || mode === 'grove') {
    const br = h('select', { title: mode === 'grove' ? 'Grove size' : 'Brush size', 'aria-label': 'Brush size' });
    for (const v of [0, 1, 2, 3]) br.append(h('option', { value: v }, mode === 'grove' ? `Grove ${['S', 'M', 'L', 'XL'][v]}` : `Brush ${v + 1}`));
    br.value = String(app.brush);
    br.onchange = () => app.setPaint({ brush: Number(br.value) });
    out.push(br);
  }

  const pal = h('div', { class: 'palette' });
  if (mode === 'tile') {
    for (const id of GROUND_TILES) pal.append(palButton(tile(id).name, swatch(tile(id).color), app.paintTile === id, () => app.setPaint({ paintTile: id })));
  } else if (mode === 'object') {
    pal.append(palButton('Remove', '🧽', app.paintObject === 0, () => app.setPaint({ paintObject: 0 }), 'Remove objects'));
    for (const d of GAME_OBJECTS) pal.append(palButton(d.name, d.icon, app.paintObject === d.id, () => app.setPaint({ paintObject: d.id })));
  } else if (mode === 'grove') {
    for (const id of GROVE_OBJECTS) pal.append(palButton(`${objectDef(id)!.name} grove`, objectDef(id)!.icon, app.groveObject === id, () => app.setPaint({ groveObject: id })));
  } else if (mode === 'ore') {
    for (const id of ORE_OBJECTS) pal.append(palButton(`${objectDef(id)!.name.replace(' rock', '')} cluster`, objectDef(id)!.icon, app.oreObject === id, () => app.setPaint({ oreObject: id })));
  } else if (mode === 'zone') {
    for (const z of ZONES) pal.append(palButton(z.name, swatch(z.color), app.paintZone === z.id, () => app.setPaint({ paintZone: z.id }), z.rules));
    pal.append(palButton('No zone', swatch('#555'), app.paintZone === 0, () => app.setPaint({ paintZone: 0 })));
  }
  out.push(pal);
  return out;
}

/** Tool options shown while placing on an RPG-DC map. */
export function gamePlaceOptions(app: App): HTMLElement[] {
  const pal = h('div', { class: 'palette' });
  for (const type of PLACE_TYPES) {
    const d = featureDef(type);
    pal.append(palButton(d.label, d.icon, app.featureType === type, () => app.setPlaceType(type), PLACE_HELP[type]));
  }
  return [pal];
}

/** Typed fields for a place, written straight into `f.props`. */
export function gameFeatureFields(app: App, map: WorldMap, f: Feature): HTMLElement {
  const box = h('div');
  const fields = PLACE_FIELDS[f.type];
  if (!fields) return box;
  if (PLACE_HELP[f.type]) box.append(h('p', { class: 'hint' }, PLACE_HELP[f.type]));
  const props = placeProps(f);
  const set = (key: string, value: string | number) => {
    app.pushUndo();
    f.props = { ...placeProps(f), [key]: value };
    app.changed();
  };
  for (const field of fields) {
    if (field.type === 'select' || field.type === 'map') {
      const sel = h('select');
      const options =
        field.type === 'map'
          ? [{ value: '', label: '— choose a map —' }, ...gameMaps(app.project).map((m) => ({ value: gameMapId(m), label: `${m.name} (${gameMapId(m)})` }))]
          : field.options ?? [];
      for (const o of options) sel.append(h('option', { value: o.value }, o.label));
      sel.value = String(props[field.key] ?? '');
      sel.onchange = () => set(field.key, sel.value);
      box.append(h('label', {}, field.label, sel));
    } else {
      const input = h('input', { type: 'number', inputmode: 'numeric', min: field.min ?? 0, max: field.max ?? 9999, step: 1, value: Number(props[field.key] ?? field.default) });
      input.onchange = () => {
        const v = Math.round(Number(input.value));
        set(field.key, Math.max(field.min ?? -Infinity, Math.min(field.max ?? Infinity, Number.isFinite(v) ? v : Number(field.default))));
      };
      box.append(h('label', {}, field.label, input));
    }
  }
  if (f.type === 'link') {
    const target = findGameMap(app.project, props.toMap);
    const tx = Number(props.toX);
    const ty = Number(props.toY);
    const ok = target && isWalkableAt(target, tx, ty);
    box.append(
      target ? h('p', { class: 'hint' }, ok ? `Arrive on ${gameMapId(target)} at (${tx}, ${ty}).` : `⚠ (${tx}, ${ty}) on ${gameMapId(target)} can't be walked on.`) : '',
      h(
        'div',
        { class: 'btn-row' },
        h(
          'button',
          {
            class: 'primary',
            disabled: !target,
            title: target ? `Open ${target.name} and tap the tile players arrive on` : 'Choose the target map first',
            onclick: () => target && app.startPick(map, f, target),
          },
          '🎯 Pick arrival tile',
        ),
        target ? h('button', { onclick: () => app.focusCell(target.id, tx, ty) }, `Go to ${gameMapId(target)}`) : '',
      ),
    );
  }
  return box;
}

/** The RPG-DC section of the Map panel: game id, zones and their rules, checks and export. */
export function gameMapPanel(app: App, map: WorldMap): HTMLElement {
  const box = h('div', { class: 'game-panel' }, h('h3', {}, `🎮 RPG-DC map “${gameMapId(map)}”`));
  if (gameKind(map) === 'dungeon') {
    const sel = h('select');
    for (const z of ZONES) sel.append(h('option', { value: z.key }, z.name));
    sel.value = mapZone(map)?.key ?? 'deep';
    sel.onchange = () => {
      app.pushUndo();
      map.settings.rpgdcZone = sel.value;
      app.changed();
    };
    const z = mapZone(map) ?? zoneByKey('deep')!;
    box.append(h('label', {}, 'Zone for the whole floor', sel), h('p', { class: 'hint' }, z.rules));
  } else {
    const toggle = h('input', { type: 'checkbox', checked: app.view.zones });
    toggle.onchange = () => app.setView('zones', toggle.checked);
    const legend = h('div', { class: 'zone-legend' });
    for (const z of ZONES) {
      legend.append(h('div', {}, h('span', { class: 'swatch', style: `background:${z.color}` }), h('b', {}, z.name), h('span', {}, z.rules)));
    }
    box.append(h('label', { class: 'check' }, toggle, 'Show zones on the map'), legend, h('p', { class: 'hint' }, 'Paint zones with Paint → Zones.'));
  }
  box.append(
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'primary', onclick: () => openCheckDialog(app) }, '✓ Check for game'),
      h('button', { onclick: () => exportRpgdc(app) }, '⬇ RPG-DC maps'),
    ),
  );
  return box;
}

function issueLabel(i: GameIssue): string {
  return `${i.severity === 'error' ? '⛔' : '⚠️'} ${i.gameMapId} (${i.c}, ${i.r})`;
}

export function openCheckDialog(app: App): void {
  const issues = checkGameMaps(app.project);
  const body = h('div');
  if (!issues.length) {
    body.append(h('p', {}, `✅ All ${gameMaps(app.project).length} RPG-DC maps pass every check.`));
  } else {
    const errors = issues.filter((i) => i.severity === 'error').length;
    body.append(h('p', { class: 'hint' }, `${errors} error(s), ${issues.length - errors} warning(s). Tap one to go there.`));
    const list = h('div', { class: 'issue-list' });
    for (const i of issues) {
      list.append(
        h(
          'button',
          {
            class: `issue ${i.severity}`,
            onclick: () => {
              byId<HTMLDialogElement>('dialog').close();
              app.focusCell(i.mapId, i.c, i.r);
            },
          },
          h('span', { class: 'issue-where' }, issueLabel(i)),
          h('span', {}, i.message),
        ),
      );
    }
    body.append(list);
  }
  showDialog('Check for game', body, [{ label: 'Close', primary: true }]);
}

/** Download rpg-dc.maps.json, warning (without blocking) when checks fail. */
export function exportRpgdc(app: App): void {
  const maps = gameMaps(app.project);
  if (!maps.length) {
    toast('No RPG-DC maps in this project');
    return;
  }
  const issues = checkGameMaps(app.project);
  downloadText(RPGDC_EXPORT_NAME, JSON.stringify(toRpgdcMaps(app.project)));
  const errors = issues.filter((i) => i.severity === 'error').length;
  if (issues.length) toast(`Exported ${maps.length} maps — ${errors} error(s), ${issues.length - errors} warning(s): see Check for game`);
  else toast(`Exported ${maps.length} maps — all checks pass`);
}

export function gameExportSummary(app: App): string {
  const issues = checkGameMaps(app.project);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const n = gameMaps(app.project).length;
  if (!issues.length) return `✅ ${n} RPG-DC maps, all checks pass.`;
  return `⚠️ ${n} RPG-DC maps: ${errors} error(s), ${issues.length - errors} warning(s). You can still export; use Check for game to fix them.`;
}

export function objectLegendEntries(map: WorldMap): number[] {
  const used = new Set(map.layers.object);
  return OBJECTS.filter((d) => d.id && used.has(d.id)).map((d) => d.id);
}
