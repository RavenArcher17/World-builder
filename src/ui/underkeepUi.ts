/**
 * Underkeep maps (settings.underkeep): the Map panel switch, Check for Underkeep, the Underkeep
 * map export, and Underkeep's places (the Great Stair, ways out, enemies, the clapper) in the
 * Place tool. Code for the format itself is in core/underkeep/; see docs/underkeep-export.md.
 */
import { featureDef } from '../core/features';
import { checkUnderkeepMap } from '../core/underkeep/checks';
import { UNDERKEEP_KEY, canBeUnderkeep, isUnderkeep, toUnderkeep, underkeepFileName } from '../core/underkeep/export';
import { ENEMY_TYPES, TIER_LABELS, UK_PLACE, UK_TYPES } from '../core/underkeep/format';
import type { Feature, WorldMap } from '../core/types';
import type { App } from './app';
import { downloadText, h, showDialog, toast } from './dom';

export { isUnderkeep };

/** What the Place tool puts down on an Underkeep map. */
const placing = { type: UK_PLACE.enemy as string, kind: 'shieldman', tier: -1, facing: 0 };

const EXIT_KINDS = ['rope', 'grate', 'lift', 'postern'];
const FACINGS = ['↑ North', '→ East', '↓ South', '← West'];
const label = (t: string) => UK_TYPES[t]?.label ?? t;
const short = (t: string) => label(t).split(' (')[0];

/** The Map panel's Underkeep section (3D maps on a square grid). */
export function underkeepPanel(app: App, map: WorldMap): HTMLElement {
  const box = h('div', { class: 'uk-panel' });
  const on = isUnderkeep(map);
  const toggle = h('input', { type: 'checkbox', checked: on, disabled: !on && !canBeUnderkeep(map) });
  toggle.onchange = () => {
    app.pushUndo();
    if (toggle.checked) map.settings[UNDERKEEP_KEY] = true;
    else delete map.settings[UNDERKEEP_KEY];
    app.changed();
    app.setTool(app.tool);
  };
  box.append(h('label', { class: 'check' }, toggle, '🗝 Underkeep map'));
  if (!on) {
    box.append(
      h(
        'p',
        { class: 'hint' },
        canBeUnderkeep(map)
          ? "For Underkeep: adds its Great Stair, ways out and enemies to Place, its own checks, and Export → Underkeep map."
          : 'Underkeep maps use square cells: convert this map to a square grid first (Export → Convert to grid).',
      ),
    );
    return box;
  }
  box.append(
    h('p', { class: 'hint' }, "Put the exported file in %APPDATA%\\Godot\\app_userdata\\Underkeep\\maps\\ on your PC: it shows up in the Gatehouse's map picker and the game's map editor."),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { onclick: () => openUnderkeepCheck(app, map) }, '✓ Check for Underkeep'),
      h('button', { class: 'primary', onclick: () => exportUnderkeep(map) }, '⬇ Underkeep map'),
    ),
  );
  return box;
}

export function exportUnderkeep(map: WorldMap): void {
  try {
    const { md } = toUnderkeep(map);
    const errors = checkUnderkeepMap(map).problems.filter((p) => p.level === 'error').length;
    downloadText(underkeepFileName(map.name), JSON.stringify(md, null, 2));
    toast(errors ? `Exported, but Underkeep will refuse it until ${errors} problem(s) are fixed: see Check for Underkeep` : 'Underkeep map exported');
  } catch (e) {
    toast((e as Error).message);
  }
}

/** The check report; tapping a problem jumps to its first cell. */
export function openUnderkeepCheck(app: App, map: WorldMap): void {
  const { problems, counts } = checkUnderkeepMap(map);
  const body = h('div');
  const errors = problems.filter((p) => p.level === 'error').length;
  body.append(
    h(
      'p',
      {},
      errors
        ? `⛔ ${errors} error(s): Underkeep will not play this map until they are fixed.`
        : problems.length
          ? '✅ No errors: Underkeep will play this map. Some advice below.'
          : '✅ No problems: Underkeep will play this map.',
    ),
  );
  if (counts) {
    body.append(h('p', { class: 'hint' }, `${counts.storeys} storey(s) · ${counts.floor} cells you can reach from the stair · ${counts.enemies} enemies · ${counts.chests} chests · ${counts.exits} ways out · ${counts.lights} lights · ${counts.fires} fires · ${counts.traps} traps`));
  }
  if (problems.length) {
    const list = h('div', { class: 'issue-list' });
    for (const p of problems) {
      const cell = p.cells[0];
      list.append(
        h(
          'button',
          {
            class: `issue ${p.level}`,
            onclick: () => {
              if (!cell) return;
              (document.getElementById('dialog') as HTMLDialogElement).close();
              app.setStorey(cell.z);
              app.focusCell(map.id, cell.c, cell.r);
            },
          },
          h('span', { class: 'issue-where' }, cell ? `${cell.c}, ${cell.r}${cell.z ? ` · storey ${cell.z}` : ''}` : p.level === 'error' ? 'error' : 'advice'),
          h('span', {}, p.message),
        ),
      );
    }
    body.append(list);
  }
  showDialog('Check for Underkeep', body, [{ label: 'Close', primary: true }]);
}

/** Place tool options on an Underkeep map: what to place, its tier and facing. */
export function underkeepPlaceOptions(app: App): HTMLElement[] {
  const sel = h('select', { 'aria-label': 'Underkeep place' });
  const add = (group: string, items: [string, string][]) => {
    const og = h('optgroup', { label: group });
    for (const [v, l] of items) og.append(h('option', { value: v }, l));
    sel.append(og);
  };
  add('Exits', [[`${UK_PLACE.stair}:stair`, '🪜 Great Stair (entry and exit)'], ...EXIT_KINDS.map((k): [string, string] => [`${UK_PLACE.exit}:${k}`, `🚪 ${short(k)}`])]);
  add('Enemies', ENEMY_TYPES.map((k): [string, string] => [`${UK_PLACE.enemy}:${k}`, `⚔️ ${short(k)}`]));
  add('Loot and danger', [
    ['treasure:chest', '🧰 Chest (with a tier)'],
    [`${UK_PLACE.clapper}:clapper`, "🔔 The great bell's clapper"],
    ['trap:trap', '⚠️ Spike trap'],
  ]);
  sel.value = `${placing.type}:${placing.kind}`;
  sel.onchange = () => {
    const [type, kind] = sel.value.split(':');
    placing.type = type;
    placing.kind = kind;
    app.setPlaceType(type);
  };
  const out: HTMLElement[] = [sel];
  if (placing.type === UK_PLACE.enemy || placing.type === 'treasure' || placing.type === 'trap') {
    const tier = h('select', { 'aria-label': 'Tier' });
    TIER_LABELS.forEach((l, k) => tier.append(h('option', { value: k - 1 }, l)));
    tier.value = String(placing.tier);
    tier.onchange = () => (placing.tier = Number(tier.value));
    out.push(tier);
  }
  if (placing.type === UK_PLACE.stair || (placing.type === UK_PLACE.exit && ['lift', 'postern'].includes(placing.kind)) || placing.type === 'treasure') {
    const f = h('select', { 'aria-label': 'Facing' });
    if (placing.type === 'treasure') f.append(h('option', { value: -1 }, 'Faces open floor'));
    FACINGS.forEach((l, k) => f.append(h('option', { value: k }, l)));
    f.value = String(placing.type === 'treasure' && placing.facing === 0 ? -1 : placing.facing);
    f.onchange = () => (placing.facing = Number(f.value));
    out.push(f);
  }
  if (app.featureType !== placing.type) app.featureType = placing.type;
  return out;
}

/** The place type and fields a new Underkeep place gets. */
export function underkeepNewPlace(type: string): Pick<Feature, 'name' | 'props'> | null {
  if (type !== placing.type) return null;
  const props: Record<string, string | number> = {};
  if (type === UK_PLACE.exit || type === UK_PLACE.enemy) props.kind = placing.kind;
  if (type === UK_PLACE.enemy || type === 'treasure' || type === 'trap') props.tier = placing.tier;
  if (type === UK_PLACE.stair || type === UK_PLACE.exit || type === 'treasure') props.facing = placing.facing;
  const name = type === 'treasure' ? 'Chest' : type === 'trap' ? 'Spike trap' : type === UK_PLACE.stair ? 'Great Stair' : short(placing.kind);
  return { name, props };
}

/** Fields of a selected Underkeep place: what it is, its tier and facing. */
export function underkeepPlaceFields(app: App, f: Feature): HTMLElement | '' {
  const isUk = (Object.values(UK_PLACE) as string[]).includes(f.type) || f.type === 'treasure' || f.type === 'trap';
  if (!isUk) return '';
  const props = (f.props ??= {});
  const box = h('div', {});
  const set = (k: string, v: string | number) => {
    app.pushUndo();
    props[k] = v;
    if (k === 'kind') f.name = short(String(v));
    app.changed();
  };
  if (f.type === UK_PLACE.exit || f.type === UK_PLACE.enemy) {
    const kinds = f.type === UK_PLACE.exit ? EXIT_KINDS : ENEMY_TYPES;
    const k = h('select');
    for (const t of kinds) k.append(h('option', { value: t }, label(t)));
    k.value = String(props.kind ?? kinds[0]);
    k.onchange = () => set('kind', k.value);
    box.append(h('label', {}, f.type === UK_PLACE.exit ? 'Way out' : 'Enemy', k));
  }
  if (f.type === UK_PLACE.enemy || f.type === 'treasure' || f.type === 'trap') {
    const t = h('select');
    TIER_LABELS.forEach((l, k) => t.append(h('option', { value: k - 1 }, l)));
    t.value = String(props.tier ?? -1);
    t.onchange = () => set('tier', Number(t.value));
    box.append(h('label', {}, 'Tier', t));
  }
  if (f.type === UK_PLACE.stair || f.type === UK_PLACE.exit || f.type === 'treasure') {
    const d = h('select');
    if (f.type === 'treasure') d.append(h('option', { value: -1 }, 'Faces open floor'));
    FACINGS.forEach((l, k) => d.append(h('option', { value: k }, l)));
    d.value = String(props.facing ?? (f.type === 'treasure' ? -1 : 0));
    d.onchange = () => set('facing', Number(d.value));
    box.append(h('label', {}, 'Facing', d));
  }
  box.append(h('p', { class: 'hint' }, `${featureDef(f.type).icon} In Underkeep: ${label(f.type === UK_PLACE.stair ? 'stair' : f.type === UK_PLACE.clapper ? 'clapper' : f.type === 'treasure' ? 'chest' : f.type === 'trap' ? 'trap' : String(props.kind ?? ''))}`));
  return box;
}
