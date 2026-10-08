/** Tiny DOM helpers, dialogs, downloads and the settings-form builder shared by panels. */
import { SETTING_SCHEMAS } from '../core/settings';
import type { MapKind, Settings } from '../core/types';

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
    else if (k === 'checked' && 'checked' in el) (el as HTMLInputElement).checked = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
}

let toastTimer = 0;
export function toast(msg: string): void {
  const el = byId('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
}

export interface DialogButton {
  label: string;
  primary?: boolean;
  /** Return false to keep the dialog open. */
  action?: () => boolean | void | Promise<boolean | void>;
}

export function showDialog(title: string, body: HTMLElement, buttons: DialogButton[]): void {
  const dlg = byId<HTMLDialogElement>('dialog');
  dlg.replaceChildren();
  const footer = h('footer');
  for (const b of buttons) {
    footer.append(
      h(
        'button',
        {
          class: b.primary ? 'primary' : '',
          onclick: async () => {
            const keep = b.action ? (await b.action()) === false : false;
            if (!keep) dlg.close();
          },
        },
        b.label,
      ),
    );
  }
  dlg.append(h('div', { class: 'dlg' }, h('header', {}, title), h('div', { class: 'body' }, body), footer));
  dlg.showModal();
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(name: string, text: string, mime = 'application/json'): void {
  downloadBlob(name, new Blob([text], { type: mime }));
}

export function downloadCanvas(name: string, canvas: HTMLCanvasElement): Promise<void> {
  return new Promise((resolve) =>
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(name, blob);
      resolve();
    }, 'image/png'),
  );
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
}

/** Build grouped controls for a map kind's settings; edits are written into `settings`. */
export function settingsForm(kind: MapKind, settings: Settings, onChange?: () => void): HTMLElement {
  const root = h('div');
  const groups = new Map<string, HTMLElement>();
  const checksFor = new Map<string, HTMLElement>();
  for (const s of SETTING_SCHEMAS[kind]) {
    let body = groups.get(s.group);
    if (!body) {
      body = h('div');
      groups.set(s.group, body);
      const open = ['Landform', 'Layout', 'Settlements', 'Structures'].includes(s.group);
      root.append(h('details', { class: 'group', open }, h('summary', {}, s.group), body));
    }
    const changed = () => onChange?.();
    if (s.type === 'bool') {
      let grid = checksFor.get(s.group);
      if (!grid) {
        grid = h('div', { class: 'checks' });
        checksFor.set(s.group, grid);
        body.append(grid);
      }
      const input = h('input', { type: 'checkbox', checked: Boolean(settings[s.key]) });
      input.addEventListener('change', () => {
        settings[s.key] = input.checked;
        changed();
      });
      grid.append(h('label', { class: 'check', title: s.help }, input, s.label));
    } else if (s.type === 'range') {
      const val = h('span', {}, fmt(Number(settings[s.key] ?? 0)));
      const input = h('input', { type: 'range', min: s.min ?? 0, max: s.max ?? 1, step: s.step ?? 0.05, value: Number(settings[s.key] ?? 0) });
      input.addEventListener('input', () => {
        settings[s.key] = Number(input.value);
        val.textContent = fmt(Number(input.value));
        changed();
      });
      body.append(h('label', { title: s.help }, h('span', { class: 'range-label' }, s.label, val), input));
    } else {
      const sel = h('select');
      for (const o of s.options ?? []) sel.append(h('option', { value: o.value }, o.label));
      sel.value = String(settings[s.key] ?? s.options?.[0]?.value ?? '');
      sel.addEventListener('change', () => {
        settings[s.key] = sel.value;
        changed();
      });
      body.append(h('label', { title: s.help }, s.label, sel));
    }
  }
  return root;
}

function fmt(v: number): string {
  return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2);
}
