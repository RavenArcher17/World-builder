/** The editor: viewport, tools, panels, atlas, undo and persistence. */
import { FEATURE_DEFS, featureDef } from '../core/features';
import { generateMap } from '../core/generate';
import { CellRect, GRID_TYPES, Grid, GridType, inRect, normalizeRect } from '../core/grid';
import { link, linkPath, traceLine, unlinkCell } from '../core/links';
import { featureName } from '../core/names';
import { paintCluster, paintGrove } from '../core/brushes';
import { O, OBJECTS, objectDef } from '../core/objects';
import { createProject, deleteMap, parseProjectReport, rootMaps, serializeProject } from '../core/project';
import { PLACE_TYPES, defaultProps, gameMapId, isRpgdc, isWalkableAt, placeProps, zoneAt } from '../core/rpgdc/game';
import { cloneMap, regenerateRegion } from '../core/region';
import { Rng, parseSeed, randomSeed } from '../core/rng';
import { SCALES, getScale } from '../core/scales';
import { defaultSettings } from '../core/settings';
import { T, TILES, tile } from '../core/tiles';
import { Feature, MapSpec, Project, SEA_LEVEL, Settings, WorldMap, layerMax, newId } from '../core/types';
import { guideForMap } from '../core/zoom';
import type * as CloudModule from '../cloud/cloud';
import { openCloudDialog, openSignInDialog } from './cloudDialog';
import { openComposeDialog, openExportDialog, openHelpDialog, openZoomDialog } from './dialogs';
import { byId, downloadText, h, settingsForm, slug, toast } from './dom';
import { artBase, gameArtReady, loadGameArt } from './gameArt';
import { gameFeatureFields, gameMapPanel, gamePaintOptions, gamePlaceOptions, objectLegendEntries } from './gameUi';
import { DEFAULT_VIEW, ViewOptions, baseUnitPx, drawFeatures, renderMapCanvas, safeScale } from './render';

type Tool = 'select' | 'pan' | 'paint' | 'feature';
type PaintMode = 'tile' | 'road' | 'river' | 'erase-lines' | 'object' | 'grove' | 'ore' | 'zone';
const GAME_PAINT_MODES: PaintMode[] = ['tile', 'object', 'grove', 'ore', 'zone'];
const GENERIC_PAINT_MODES: PaintMode[] = ['tile', 'road', 'river', 'erase-lines', 'object'];
/** Objects that clear away when a path, floor or water is painted over them. */
const NATURE_GROUPS = new Set(['tree', 'rock', 'ore', 'wall']);
const OBJECTS_LIST = OBJECTS.slice(1);

const STORAGE_KEY = 'world-builder:project';
/** `${uid}:${projectId}` of the project that auto-syncs to the cloud. */
const CLOUD_LINK_KEY = 'world-builder:cloud-link';
const CLOUD_SAVE_DELAY = 8000;
const KIND_ICON: Record<string, string> = { overland: '🌍', settlement: '🏘️', dungeon: '💀' };

/** Typical elevation for painted overland tiles so hill shading still makes sense. */
const PAINT_ELEVATION: Partial<Record<number, number>> = {
  [T.DEEP_OCEAN]: 0.2,
  [T.OCEAN]: 0.35,
  [T.BEACH]: 0.41,
  [T.HILLS]: 0.62,
  [T.MOUNTAINS]: 0.76,
  [T.PEAKS]: 0.9,
};

export class App {
  project: Project;
  currentId: string | null = null;
  tool: Tool = 'select';
  view: ViewOptions = { ...DEFAULT_VIEW };
  scale = 10;
  ox = 0;
  oy = 0;
  selection: CellRect | null = null;
  selectedFeature: string | null = null;
  hoverCell = -1;
  paintMode: PaintMode = 'tile';
  paintTile: number = T.GRASSLAND;
  brush = 0;
  roadLevel = 2;
  featureType = 'village';
  paintObject: number = O.TREE;
  groveObject: number = O.TREE;
  oreObject: number = O.COPPER_ROCK;
  paintZone = 1;
  /** Choosing the arrival tile of a stairs link: the link lives on `sourceId`, the tile on `targetId`. */
  private pick: { sourceId: string; featureId: string; targetId: string } | null = null;
  /** A tile to highlight after jumping to a problem from the checks. */
  private flash: { mapId: string; cell: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d0: number; mx: number; my: number; scale0: number; ox0: number; oy0: number } | null = null;
  /** A finger left on the screen after a pinch: ignored until lifted. */
  private ignored = new Set<number>();
  private tapStart: { x: number; y: number; t: number; cell: number } | null = null;
  private lastTap: { t: number; cell: number } | null = null;
  private viewInputs: Partial<Record<keyof ViewOptions, HTMLInputElement>> = {};
  private lastPointerType = 'mouse';
  private refreshing = false;
  private refreshAgain = false;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private version = 0;
  private cache: { canvas: HTMLCanvasElement; s: number; key: string } | null = null;
  private cacheTimer = 0;
  private saveTimer = 0;
  private genSettings: Settings = {};
  private canvas = byId<HTMLCanvasElement>('map-canvas');
  private ctx = this.canvas.getContext('2d')!;
  private drag:
    | { kind: 'pan'; x: number; y: number; ox: number; oy: number }
    | { kind: 'select'; start: number }
    | { kind: 'paint'; last: number; buildingId: number; cells: number; stamp: number }
    | { kind: 'move-feature'; id: string; created: boolean }
    | null = null;
  private spaceDown = false;
  private needsFit = false;
  cloud: typeof CloudModule | null = null;
  user: CloudModule.CloudUser | null = null;
  private cloudLink: string | null = null;
  private cloudTimer = 0;
  private cloudState: 'idle' | 'pending' | 'saving' | 'saved' | 'error' = 'idle';
  private cloudBusy = false;
  private cloudAgain = false;

  constructor() {
    this.project = this.loadSaved() ?? createProject('My World');
    this.buildStaticUi();
    this.bindCanvas();
    this.bindKeys();
    new ResizeObserver(() => this.resize()).observe(byId('canvas-wrap'));
    this.resize();
    const first = rootMaps(this.project)[0];
    if (first) this.openMap(first.id);
    else {
      this.loadSpecIntoPanel(null);
      this.generateNew();
    }
    this.refreshPanels();
    this.initCloud();
  }

  get map(): WorldMap | null {
    return this.currentId ? this.project.maps[this.currentId] ?? null : null;
  }

  // ---- persistence & undo -----------------------------------------------------------------

  private loadSaved(): Project | null {
    try {
      const text = localStorage.getItem(STORAGE_KEY);
      return text ? parseProjectReport(text).project : null;
    } catch {
      return null;
    }
  }

  private scheduleSave(): void {
    this.scheduleCloudSave();
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, serializeProject(this.project));
      } catch {
        toast('Autosave skipped (project too large for browser storage) — use Save.');
      }
    }, 600);
  }

  /** Swap in a whole project (opened from a file or the cloud, or a new one). */
  replaceProject(project: Project, opts: { cloud?: boolean } = {}): void {
    this.pushUndo();
    this.project = project;
    byId<HTMLInputElement>('project-name').value = project.name;
    this.currentId = null;
    const first = rootMaps(project)[0];
    if (first) this.openMap(first.id);
    this.changed();
    // Link after changed() so opening a cloud copy does not immediately write it back.
    if (opts.cloud && this.user) {
      this.cloudState = 'saved';
      this.setCloudLink(`${this.user.uid}:${project.id}`);
    }
  }

  // ---- cloud ------------------------------------------------------------------------------

  private initCloud(): void {
    try {
      this.cloudLink = localStorage.getItem(CLOUD_LINK_KEY);
    } catch {
      this.cloudLink = null;
    }
    this.updateCloudButton();
    import('../cloud/cloud')
      .then((m) => {
        this.cloud = m;
        m.onUserChanged((u) => {
          this.user = u;
          this.cloudState = 'idle';
          this.updateCloudButton();
        });
      })
      .catch(() => {
        const btn = byId<HTMLButtonElement>('btn-cloud');
        btn.textContent = '☁ Offline';
        btn.title = 'Cloud saving could not be loaded';
      });
  }

  isCloudLinked(): boolean {
    return !!this.user && this.cloudLink === `${this.user.uid}:${this.project.id}`;
  }

  unlinkCloud(): void {
    this.setCloudLink(null);
  }

  private setCloudLink(link: string | null): void {
    this.cloudLink = link;
    try {
      if (link) localStorage.setItem(CLOUD_LINK_KEY, link);
      else localStorage.removeItem(CLOUD_LINK_KEY);
    } catch {
      // Not critical: syncing just has to be re-enabled after a reload.
    }
    this.updateCloudButton();
  }

  private scheduleCloudSave(): void {
    if (!this.isCloudLinked()) return;
    clearTimeout(this.cloudTimer);
    this.cloudState = 'pending';
    this.updateCloudButton();
    this.cloudTimer = window.setTimeout(() => void this.saveToCloud(), CLOUD_SAVE_DELAY);
  }

  /** Save the open project to the cloud and keep it synced from now on. */
  async saveToCloud(): Promise<boolean> {
    const cloud = this.cloud;
    const user = this.user;
    if (!cloud || !user) return false;
    clearTimeout(this.cloudTimer);
    if (this.cloudBusy) {
      this.cloudAgain = true;
      return true;
    }
    this.cloudBusy = true;
    this.cloudState = 'saving';
    this.updateCloudButton();
    try {
      await cloud.saveProject(this.project);
      this.setCloudLink(`${user.uid}:${this.project.id}`);
      this.cloudState = 'saved';
      return true;
    } catch (e) {
      this.cloudState = 'error';
      toast(`Cloud save failed: ${cloud.describeError(e)}`);
      return false;
    } finally {
      this.cloudBusy = false;
      this.updateCloudButton();
      if (this.cloudAgain) {
        this.cloudAgain = false;
        void this.saveToCloud();
      }
    }
  }

  private updateCloudButton(): void {
    const btn = byId<HTMLButtonElement>('btn-cloud');
    if (!this.user) {
      btn.textContent = '☁ Sign in';
      btn.title = 'Sign in with Google to save projects to the cloud';
      return;
    }
    const first = this.user.guest ? 'Guest' : this.user.name.split(' ')[0];
    const status = this.isCloudLinked()
      ? { idle: ' · synced', pending: ' · unsaved', saving: ' · saving…', saved: ' · saved', error: ' · not saved' }[this.cloudState]
      : '';
    btn.textContent = `☁ ${first}${status}`;
    btn.title = this.isCloudLinked() ? 'This project syncs to the cloud — click for cloud saves' : 'Signed in — click to save this project to the cloud';
  }

  private async onCloudClick(): Promise<void> {
    if (!this.cloud) {
      toast('Connecting to the cloud…');
      return;
    }
    if (this.user) openCloudDialog(this);
    else openSignInDialog(this);
  }

  /** Upgrade a guest to a Google account, keeping its cloud projects. */
  async upgradeGuest(): Promise<void> {
    const cloud = this.cloud;
    if (!cloud) return;
    const wasLinked = this.isCloudLinked();
    try {
      const copied = await cloud.upgradeGuest();
      this.user = cloud.currentUser();
      if (wasLinked && this.user) this.setCloudLink(`${this.user.uid}:${this.project.id}`);
      this.updateCloudButton();
      toast(copied ? `Signed in — copied ${copied} guest project(s) to your Google account` : 'Guest account linked to Google');
    } catch (e) {
      toast(cloud.describeError(e));
    }
  }

  /** Snapshot the project before a change. */
  pushUndo(): void {
    this.undoStack.push(JSON.stringify({ p: this.project, c: this.currentId }));
    if (this.undoStack.length > 25) this.undoStack.shift();
    this.redoStack = [];
    this.updateUndoButtons();
  }

  private restore(snapshot: string): void {
    const { p, c } = JSON.parse(snapshot) as { p: Project; c: string | null };
    this.project = p;
    byId<HTMLInputElement>('project-name').value = p.name;
    this.currentId = c && p.maps[c] ? c : rootMaps(p)[0]?.id ?? null;
    this.selectedFeature = null;
    this.changed();
    if (this.map) this.loadSpecIntoPanel(this.map);
    this.setTool(this.tool);
  }

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(JSON.stringify({ p: this.project, c: this.currentId }));
    this.restore(s);
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(JSON.stringify({ p: this.project, c: this.currentId }));
    this.restore(s);
  }

  private updateUndoButtons(): void {
    byId<HTMLButtonElement>('btn-undo').disabled = !this.undoStack.length;
    byId<HTMLButtonElement>('btn-redo').disabled = !this.redoStack.length;
  }

  /** Call after any change to the project. */
  changed(): void {
    this.version++;
    this.cache = null;
    this.scheduleSave();
    this.refreshPanels();
    this.draw();
  }

  // ---- maps -------------------------------------------------------------------------------

  openMap(id: string, fit = true): void {
    if (!this.project.maps[id]) return;
    if (this.pick && id !== this.pick.targetId) this.cancelPick();
    this.currentId = id;
    this.selection = null;
    this.selectedFeature = null;
    this.cache = null;
    if (this.flash && this.flash.mapId !== id) this.flash = null;
    this.loadSpecIntoPanel(this.map);
    if (fit) this.fit();
    this.setTool(this.tool);
    this.refreshPanels();
    this.draw();
  }

  /** Open a map and centre on one of its tiles, highlighting it (used by the game checks). */
  focusCell(mapId: string, c: number, r: number): void {
    const map = this.project.maps[mapId];
    if (!map) return;
    if (mapId !== this.currentId) this.openMap(mapId);
    const g = new Grid(map.grid, map.width, map.height);
    const cell = g.idx(Math.max(0, Math.min(map.width - 1, c)), Math.max(0, Math.min(map.height - 1, r)));
    const dpr = window.devicePixelRatio || 1;
    // About 36 CSS pixels per cell, unless already zoomed in further.
    const unit = g.isHex ? Math.sqrt(3) : g.type === 'iso' ? 1.4 : 1;
    this.scale = Math.max(this.scale, (36 * dpr) / unit);
    const [x, y] = g.center(cell);
    this.ox = this.canvas.width / 2 - x * this.scale;
    this.oy = this.canvas.height / 2 - y * this.scale;
    this.flash = { mapId, cell };
    const f = featureAt(map, g, cell);
    this.selectedFeature = f?.id ?? null;
    this.cache = null;
    this.refreshPanels();
    this.draw();
    if (window.matchMedia('(max-width: 900px)').matches) byId('canvas-wrap').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // ---- link targets -------------------------------------------------------------------------

  /** Open the target map so the arrival tile of a stairs link can be tapped. */
  startPick(source: WorldMap, f: Feature, target: WorldMap): void {
    this.pick = { sourceId: source.id, featureId: f.id, targetId: target.id };
    this.openMap(target.id);
    const props = f.props ?? {};
    if (props.toMap === gameMapId(target)) {
      const g = new Grid(target.grid, target.width, target.height);
      const x = Number(props.toX);
      const y = Number(props.toY);
      if (g.inBounds(x, y)) this.focusCell(target.id, x, y);
    }
    this.showPickBanner();
  }

  private showPickBanner(): void {
    const banner = byId('pick-banner');
    const target = this.pick ? this.project.maps[this.pick.targetId] : null;
    if (!this.pick || !target) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.replaceChildren(
      h('span', {}, `🎯 Tap the tile players arrive on in ${target.name}. Drag or pinch to move around.`),
      h('button', { onclick: () => this.cancelPick(true) }, 'Cancel'),
    );
  }

  private cancelPick(goBack = false): void {
    const pick = this.pick;
    this.pick = null;
    this.showPickBanner();
    if (goBack && pick) {
      this.openMap(pick.sourceId);
      this.selectFeature(pick.featureId);
    }
  }

  private completePick(cell: number): void {
    const pick = this.pick;
    const target = this.map;
    const source = pick ? this.project.maps[pick.sourceId] : undefined;
    const f = source?.features.find((x) => x.id === pick!.featureId);
    if (!pick || !target || !source || !f) return this.cancelPick();
    const x = cell % target.width;
    const y = Math.floor(cell / target.width);
    this.pushUndo();
    f.props = { ...(f.props ?? {}), toMap: gameMapId(target), toX: x, toY: y };
    this.pick = null;
    this.showPickBanner();
    this.openMap(source.id);
    this.focusCell(source.id, f.c, f.r);
    this.changed();
    toast(isWalkableAt(target, x, y) ? `Link now arrives at (${x}, ${y}) on ${gameMapId(target)}` : `⚠ (${x}, ${y}) on ${gameMapId(target)} can't be walked on — pick another tile`);
  }

  addMap(map: WorldMap, open = true): void {
    this.project.maps[map.id] = map;
    if (open) this.openMap(map.id);
    this.changed();
  }

  private specFromPanel(): MapSpec {
    const scale = getScale(byId<HTMLSelectElement>('gen-scale').value);
    const clampN = (v: number) => Math.max(8, Math.min(256, Math.round(v) || 8));
    return {
      name: byId<HTMLInputElement>('gen-name').value.trim() || scale.label,
      kind: scale.kind,
      scaleId: scale.id,
      grid: byId<HTMLSelectElement>('gen-grid').value as GridType,
      width: clampN(Number(byId<HTMLInputElement>('gen-width').value)),
      height: clampN(Number(byId<HTMLInputElement>('gen-height').value)),
      seed: parseSeed(byId<HTMLInputElement>('gen-seed').value || String(randomSeed())),
      settings: { ...this.genSettings },
    };
  }

  generateNew(): void {
    const spec = this.specFromPanel();
    this.pushUndo();
    const map = generateMap(spec);
    this.addMap(map);
    toast(`Generated ${spec.name}`);
  }

  regenerateCurrent(): void {
    const old = this.map;
    if (!old) return this.generateNew();
    if (isRpgdc(old)) {
      toast('RPG-DC maps are hand-made: regenerating would replace the game map. Generate a new map instead.');
      return;
    }
    const spec = this.specFromPanel();
    this.pushUndo();
    const fresh = generateMap({ ...spec, kind: getScale(spec.scaleId).kind }, guideForMap(this.project, { ...old, ...spec }));
    const map: WorldMap = { ...fresh, id: old.id, parent: old.parent, children: old.children, composedFrom: old.composedFrom };
    this.project.maps[old.id] = map;
    this.selection = null;
    this.selectedFeature = null;
    if (old.grid !== map.grid || old.width !== map.width || old.height !== map.height) this.fit();
    this.changed();
  }

  rerollSelection(): void {
    const map = this.map;
    if (!map || !this.selection || isRpgdc(map)) return;
    this.pushUndo();
    this.project.maps[map.id] = regenerateRegion(this.project, map, this.selection, randomSeed());
    this.changed();
    toast('Area re-rolled');
  }

  // ---- static UI --------------------------------------------------------------------------

  private buildStaticUi(): void {
    const scaleSel = byId<HTMLSelectElement>('gen-scale');
    const groups: Record<string, HTMLOptGroupElement> = {};
    for (const s of SCALES) {
      const label = s.kind === 'overland' ? 'Overland' : s.kind === 'settlement' ? 'Settlements' : 'Dungeons';
      groups[label] ??= scaleSel.appendChild(h('optgroup', { label }) as HTMLOptGroupElement);
      groups[label].append(h('option', { value: s.id }, `${s.label} (${s.cell})`));
    }
    scaleSel.addEventListener('change', () => {
      const s = getScale(scaleSel.value);
      byId<HTMLInputElement>('gen-width').value = String(s.width);
      byId<HTMLInputElement>('gen-height').value = String(s.height);
      byId<HTMLInputElement>('gen-name').value = s.label;
      this.genSettings = defaultSettings(s.kind, s.id);
      this.renderGenSettings();
    });
    const gridSel = byId<HTMLSelectElement>('gen-grid');
    for (const g of GRID_TYPES) gridSel.append(h('option', { value: g.id }, g.label));
    byId('gen-dice').onclick = () => (byId<HTMLInputElement>('gen-seed').value = String(randomSeed()));
    byId('btn-generate').onclick = () => {
      if (!byId<HTMLInputElement>('gen-seed').value) byId<HTMLInputElement>('gen-seed').value = String(randomSeed());
      this.generateNew();
      byId<HTMLInputElement>('gen-seed').value = String(randomSeed());
    };
    byId('btn-regenerate').onclick = () => this.regenerateCurrent();

    const nameInput = byId<HTMLInputElement>('project-name');
    nameInput.value = this.project.name;
    nameInput.onchange = () => {
      this.project.name = nameInput.value || 'My World';
      this.scheduleSave();
    };
    byId('btn-new-project').onclick = () => {
      if (!confirm('Start a new empty project? Unsaved maps in this browser will be replaced (use Save first to keep them).')) return;
      this.replaceProject(createProject('My World'));
    };
    byId('btn-save').onclick = () => downloadText(`${slug(this.project.name)}.world.json`, serializeProject(this.project));
    const fileInput = byId<HTMLInputElement>('file-open');
    byId('btn-open').onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const { project: p, migrated } = parseProjectReport(await file.text());
        this.replaceProject(p);
        toast(
          migrated.length
            ? `Opened ${p.name} — updated ${migrated.length} RPG-DC map(s) for the game (saved in this browser; use Save to download)`
            : `Opened ${p.name}`,
        );
      } catch (e) {
        toast(`Could not open: ${(e as Error).message}`);
      }
    };
    byId('btn-cloud').onclick = () => void this.onCloudClick();
    byId('btn-menu').onclick = () => {
      const open = document.querySelector('.topbar')!.classList.toggle('menu-open');
      byId('btn-menu').setAttribute('aria-expanded', String(open));
    };
    byId('btn-undo').onclick = () => this.undo();
    byId('btn-redo').onclick = () => this.redo();
    byId('btn-export').onclick = () => this.map && openExportDialog(this, this.map);
    byId('btn-compose').onclick = () => openComposeDialog(this);
    byId('btn-help').onclick = () => openHelpDialog();
    byId('btn-fit').onclick = () => {
      this.fit();
      this.draw();
    };

    // Tools.
    const tools: [Tool, string, string][] = [
      ['select', '⬚ Select', 'Drag to select an area; click a place to inspect it (S)'],
      ['pan', '✋ Pan', 'Drag to move the map (H, or hold Space / right-drag)'],
      ['paint', '🖌 Paint', 'Paint terrain, roads or rivers (P)'],
      ['feature', '📍 Place', 'Click to place a feature, drag one to move it (F)'],
    ];
    const toolBox = byId('tools');
    for (const [id, label, title] of tools) {
      toolBox.append(h('button', { 'data-tool': id, title, onclick: () => this.setTool(id) }, label));
    }
    const toggles: [keyof ViewOptions, string][] = [
      ['grid', 'Grid'],
      ['hillshade', 'Relief'],
      ['rivers', 'Rivers'],
      ['roads', 'Roads'],
      ['objects', 'Objects'],
      ['zones', 'Zones'],
      ['features', 'Places'],
      ['labels', 'Labels'],
    ];
    const menu = h('div', { class: 'view-menu' });
    for (const [k, label] of toggles) {
      const cb = h('input', { type: 'checkbox', checked: this.view[k] });
      cb.addEventListener('change', () => this.setView(k, cb.checked));
      this.viewInputs[k] = cb;
      menu.append(h('label', { class: 'check' }, cb, label));
    }
    const viewMenu = h('details', { class: 'view-details' }, h('summary', {}, '👁 View'), menu);
    byId('view-toggles').append(viewMenu);
    // Open under the button, shifted sideways as needed to stay on screen (on a phone the
    // button can sit at either edge depending on how the toolbar wraps).
    viewMenu.addEventListener('toggle', () => {
      if (!viewMenu.open) return;
      menu.style.left = '0px';
      const box = viewMenu.getBoundingClientRect();
      const width = menu.offsetWidth;
      const margin = 8;
      const rightAligned = box.width - width;
      const min = margin - box.left;
      const max = document.documentElement.clientWidth - margin - width - box.left;
      menu.style.left = `${Math.max(min, Math.min(max, rightAligned))}px`;
    });
    // Close the menu when tapping anywhere else.
    document.addEventListener('pointerdown', (e) => {
      if (viewMenu.open && !viewMenu.contains(e.target as Node)) viewMenu.open = false;
    });
    this.setTool('select');
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
    const opts = byId('tool-options');
    opts.replaceChildren();
    const map = this.map;
    const game = isRpgdc(map);
    // Keep the paint mode, tile and place type valid for the kind of map that is open.
    if (game && map) {
      if (!GAME_PAINT_MODES.includes(this.paintMode) || (this.paintMode === 'zone' && map.kind === 'dungeon')) this.paintMode = 'tile';
      if (this.paintTile < T.GRASS) this.paintTile = T.GRASS;
      if (!(PLACE_TYPES as readonly string[]).includes(this.featureType)) this.featureType = 'monster_spawn';
    } else {
      if (!GENERIC_PAINT_MODES.includes(this.paintMode)) this.paintMode = 'tile';
      if (featureDef(this.featureType).scope === 'game') this.featureType = 'village';
    }
    if (tool === 'paint' && game && map) {
      opts.append(...gamePaintOptions(this, map));
    } else if (tool === 'paint') {
      const mode = h('select', { 'aria-label': 'Paint mode' });
      for (const [v, l] of [
        ['tile', 'Terrain'],
        ['object', 'Objects'],
        ['road', 'Road'],
        ['river', 'River'],
        ['erase-lines', 'Erase roads/rivers'],
      ]) mode.append(h('option', { value: v }, l));
      mode.value = this.paintMode;
      mode.onchange = () => this.setPaint({ paintMode: mode.value as PaintMode });
      opts.append(mode);
      if (this.paintMode === 'tile') {
        const tsel = h('select', { 'aria-label': 'Terrain' });
        for (const t of TILES) tsel.append(h('option', { value: t.id }, t.name));
        tsel.value = String(this.paintTile);
        tsel.onchange = () => this.setPaint({ paintTile: Number(tsel.value) });
        opts.append(tsel);
      }
      if (this.paintMode === 'object') {
        const osel = h('select', { 'aria-label': 'Object' });
        osel.append(h('option', { value: 0 }, '🧽 Remove objects'));
        for (const d of OBJECTS_LIST) osel.append(h('option', { value: d.id }, `${d.icon} ${d.name}`));
        osel.value = String(this.paintObject);
        osel.onchange = () => this.setPaint({ paintObject: Number(osel.value) });
        opts.append(osel);
      }
      if (this.paintMode === 'road') {
        const lv = h('select', { 'aria-label': 'Road type' });
        for (const [v, l] of [
          ['1', 'Trail'],
          ['2', 'Road'],
          ['3', 'Highway'],
        ]) lv.append(h('option', { value: v }, l));
        lv.value = String(this.roadLevel);
        lv.onchange = () => (this.roadLevel = Number(lv.value));
        opts.append(lv);
      }
      if (this.paintMode === 'tile' || this.paintMode === 'erase-lines' || this.paintMode === 'object') {
        const br = h('select', { title: 'Brush size', 'aria-label': 'Brush size' });
        for (const v of [0, 1, 2, 3]) br.append(h('option', { value: v }, `Brush ${v + 1}`));
        br.value = String(this.brush);
        br.onchange = () => (this.brush = Number(br.value));
        opts.append(br);
      }
    } else if (tool === 'feature' && game) {
      opts.append(...gamePlaceOptions(this));
    } else if (tool === 'feature') {
      const sel = h('select', { 'aria-label': 'Place type' });
      const scopes: Record<string, HTMLOptGroupElement> = {};
      for (const d of FEATURE_DEFS) {
        if (d.scope === 'game') continue;
        scopes[d.scope] ??= sel.appendChild(h('optgroup', { label: d.scope }) as HTMLOptGroupElement);
        scopes[d.scope].append(h('option', { value: d.type }, `${d.icon} ${d.label}`));
      }
      sel.value = this.featureType;
      sel.onchange = () => (this.featureType = sel.value);
      opts.append(sel);
    }
    this.canvas.style.cursor = tool === 'pan' ? 'grab' : tool === 'select' ? 'crosshair' : 'cell';
  }

  /** Change paint settings (mode, tile, object, zone, brush) and refresh the palette. */
  setPaint(change: Partial<Pick<App, 'paintMode' | 'paintTile' | 'paintObject' | 'groveObject' | 'oreObject' | 'paintZone' | 'brush'>>): void {
    Object.assign(this, change);
    if (change.paintMode === 'zone' && !this.view.zones) this.setView('zones', true);
    this.setTool('paint');
    this.refreshLegend();
  }

  setPlaceType(type: string): void {
    this.featureType = type;
    this.setTool('feature');
  }

  /** Draw game maps with the game's own art, loading it from the game server the first time. */
  setGameArt(on: boolean): void {
    if (!on) return this.setView('gameArt', false);
    this.setView('gameArt', true);
    if (gameArtReady()) return;
    toast("Loading the game's art…");
    loadGameArt()
      .then(() => {
        this.cache = null;
        this.draw();
        toast("Showing the game's art");
      })
      .catch((e: Error) => {
        this.setView('gameArt', false);
        toast(`Couldn't load the game's art from ${artBase()} (${e.message}). The game server has to allow cross-origin requests.`);
      });
  }

  setView(key: keyof ViewOptions, value: boolean): void {
    this.view[key] = value;
    const input = this.viewInputs[key];
    if (input) input.checked = value;
    if (key !== 'features' && key !== 'labels') this.cache = null;
    this.refreshPanels();
    this.draw();
  }

  private renderGenSettings(): void {
    const scale = getScale(byId<HTMLSelectElement>('gen-scale').value);
    byId('gen-scale-hint').textContent = scale.description;
    byId('gen-settings').replaceChildren(settingsForm(scale.kind, this.genSettings));
  }

  loadSpecIntoPanel(map: WorldMap | null): void {
    const scale = getScale(map?.scaleId ?? 'world');
    byId<HTMLSelectElement>('gen-scale').value = scale.id;
    byId<HTMLSelectElement>('gen-grid').value = map?.grid ?? 'hex-pointy';
    byId<HTMLInputElement>('gen-width').value = String(map?.width ?? scale.width);
    byId<HTMLInputElement>('gen-height').value = String(map?.height ?? scale.height);
    byId<HTMLInputElement>('gen-seed').value = String(map?.seed ?? randomSeed());
    byId<HTMLInputElement>('gen-name').value = map?.name ?? scale.label;
    this.genSettings = { ...defaultSettings(scale.kind, scale.id), ...(map?.settings ?? {}) };
    this.renderGenSettings();
  }

  // ---- panels -----------------------------------------------------------------------------

  refreshPanels(): void {
    // A field losing focus while its panel is rebuilt fires `change`, which refreshes again:
    // finish this rebuild first, then run once more.
    if (this.refreshing) {
      this.refreshAgain = true;
      return;
    }
    this.refreshing = true;
    try {
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest('.panel')) active.blur();
      byId('empty-state').style.display = this.map ? 'none' : 'flex';
      this.refreshAtlas();
      this.refreshMapInfo();
      this.refreshSelection();
      this.refreshFeature();
      this.refreshLegend();
      this.updateUndoButtons();
    } finally {
      this.refreshing = false;
    }
    if (this.refreshAgain) {
      this.refreshAgain = false;
      this.refreshPanels();
    }
  }

  private refreshAtlas(): void {
    const atlas = byId('atlas');
    atlas.replaceChildren();
    const add = (m: WorldMap, depth: number) => {
      atlas.append(
        h(
          'div',
          {
            class: `atlas-item${m.id === this.currentId ? ' current' : ''}`,
            style: `padding-left:${6 + depth * 14}px`,
            title: `${getScale(m.scaleId).label} · ${m.width}×${m.height}`,
            onclick: () => this.openMap(m.id),
          },
          `${KIND_ICON[m.kind] ?? '🗺️'} ${m.name}`,
          h('span', { class: 'meta' }, getScale(m.scaleId).label.split(' ')[0]),
        ),
      );
      for (const c of m.children) if (this.project.maps[c]) add(this.project.maps[c], depth + 1);
    };
    const roots = rootMaps(this.project);
    for (const r of roots) add(r, 0);
    if (!roots.length) atlas.append(h('p', { class: 'hint' }, 'No maps yet — generate one.'));
  }

  private refreshMapInfo(): void {
    const box = byId('map-info');
    box.replaceChildren();
    const map = this.map;
    if (!map) return;
    const name = h('input', { value: map.name });
    name.onchange = () => {
      this.pushUndo();
      map.name = name.value || map.name;
      this.changed();
    };
    const parent = map.parent ? this.project.maps[map.parent.mapId] : undefined;
    const regen = byId<HTMLButtonElement>('btn-regenerate');
    regen.disabled = isRpgdc(map);
    regen.title = isRpgdc(map) ? 'RPG-DC maps are hand-made and are not regenerated' : 'Re-generate the open map with these settings';
    box.append(
      h('h2', {}, 'Map'),
      h('label', {}, 'Name', name),
      h('p', { class: 'hint' }, `${getScale(map.scaleId).label} · ${GRID_TYPES.find((g) => g.id === map.grid)?.label} · ${map.width}×${map.height} · seed ${map.seed}`),
      h(
        'div',
        { class: 'btn-row' },
        parent ? h('button', { onclick: () => this.openMap(parent.id) }, `↑ ${parent.name}`) : null,
        h(
          'button',
          {
            onclick: () => {
              this.pushUndo();
              const copy = cloneMap(map);
              copy.id = newId('map');
              copy.name = `${map.name} copy`;
              copy.parent = undefined;
              copy.children = [];
              for (const f of copy.features) delete f.childMapId;
              this.addMap(copy);
            },
          },
          'Duplicate',
        ),
        h(
          'button',
          {
            class: 'danger',
            onclick: () => {
              const n = map.children.length;
              if (!confirm(`Delete "${map.name}"${n ? ` and its ${n} detail map(s)` : ''}?`)) return;
              this.pushUndo();
              deleteMap(this.project, map.id);
              this.currentId = null;
              const next = parent ?? rootMaps(this.project)[0];
              if (next) this.openMap(next.id);
              this.changed();
            },
          },
          'Delete',
        ),
      ),
      isRpgdc(map) ? gameMapPanel(this, map) : '',
    );
  }

  private refreshSelection(): void {
    const box = byId('selection-panel');
    box.replaceChildren();
    const map = this.map;
    const sel = this.selection;
    if (!map || !sel) return;
    const inside = map.features.filter((f) => inRect(sel, f.c, f.r));
    const list = h('div', { class: 'feature-list' });
    for (const f of inside.sort((a, b) => featureDef(b.type).rank - featureDef(a.type).rank)) {
      list.append(h('div', { onclick: () => this.selectFeature(f.id) }, `${featureDef(f.type).icon} ${f.name || featureDef(f.type).label}`));
    }
    box.append(
      sheetHeader('Selected area', () => {
        this.selection = null;
        this.refreshPanels();
        this.draw();
      }),
      h('p', { class: 'hint' }, `Cells ${sel.c0},${sel.r0} → ${sel.c1},${sel.r1} (${sel.c1 - sel.c0 + 1}×${sel.r1 - sel.r0 + 1})`),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'primary', title: 'Generate a detailed child map of this area', onclick: () => openZoomDialog(this, map, sel) }, '🔍 Zoom in / detail map'),
        isRpgdc(map) ? '' : h('button', { title: 'Regenerate just this area with a new seed, keeping the rest', onclick: () => this.rerollSelection() }, '🎲 Re-roll area'),
        h(
          'button',
          {
            onclick: () => {
              this.selection = null;
              this.refreshPanels();
              this.draw();
            },
          },
          'Clear',
        ),
      ),
      inside.length ? h('h3', {}, `${inside.length} place(s) here`) : '',
      list,
    );
  }

  selectFeature(id: string | null): void {
    this.selectedFeature = id;
    this.refreshPanels();
    this.draw();
  }

  private refreshFeature(): void {
    const box = byId('feature-panel');
    box.replaceChildren();
    const map = this.map;
    const f = map?.features.find((x) => x.id === this.selectedFeature);
    if (!map || !f) return;
    const game = isRpgdc(map);
    const typeSel = h('select');
    const types = game ? FEATURE_DEFS.filter((d) => (PLACE_TYPES as readonly string[]).includes(d.type) || d.type === f.type) : FEATURE_DEFS.filter((d) => d.scope !== 'game' || d.type === f.type);
    for (const d of types) typeSel.append(h('option', { value: d.type }, `${d.icon} ${d.label}`));
    typeSel.value = f.type;
    typeSel.onchange = () => {
      this.pushUndo();
      f.type = typeSel.value;
      if (game) f.props = { ...(defaultProps(f.type) ?? {}), ...(f.props ?? {}) };
      this.changed();
    };
    const name = h('input', { value: f.name });
    name.onchange = () => {
      this.pushUndo();
      f.name = name.value;
      this.changed();
    };
    const notes = h('textarea', { placeholder: 'Notes, hooks, NPCs…' });
    notes.value = f.notes ?? '';
    notes.onchange = () => {
      this.pushUndo();
      f.notes = notes.value;
      this.changed();
    };
    const child = f.childMapId ? this.project.maps[f.childMapId] : undefined;
    box.append(
      sheetHeader(`${featureDef(f.type).icon} Place at (${f.c}, ${f.r})`, () => this.selectFeature(null)),
      h('label', {}, 'Type', typeSel),
      h('label', {}, 'Name', name),
      game ? gameFeatureFields(this, map, f) : '',
      h('label', {}, 'Notes', notes),
      f.tags?.length ? h('p', { class: 'hint' }, `Tags: ${f.tags.join(', ')}`) : '',
      h(
        'div',
        { class: 'btn-row' },
        child
          ? h('button', { onclick: () => this.openMap(child.id) }, `Open ${child.name}`)
          : game
            ? ''
            : h(
                'button',
                {
                  class: 'primary',
                  onclick: () => {
                    const rect = { c0: f.c - 1, r0: f.r - 1, c1: f.c + 1, r1: f.r + 1 };
                    const r = clampRect(rect, map);
                    this.selection = r;
                    openZoomDialog(this, map, r);
                  },
                },
                'Create detail map…',
              ),
        h(
          'button',
          {
            class: 'danger',
            onclick: () => this.deleteFeature(f.id),
          },
          'Delete',
        ),
      ),
    );
  }

  private deleteFeature(id: string): void {
    const map = this.map;
    if (!map) return;
    this.pushUndo();
    map.features = map.features.filter((x) => x.id !== id);
    this.selectedFeature = null;
    this.changed();
  }

  private refreshLegend(): void {
    const box = byId('legend');
    box.replaceChildren();
    const used = new Set(this.map?.layers.terrain ?? []);
    for (const t of TILES) {
      if (used.size && !used.has(t.id) && t.id !== this.paintTile) continue;
      box.append(
        h(
          'div',
          {
            class: t.id === this.paintTile && this.tool === 'paint' ? 'active' : '',
            title: 'Click to paint with this tile',
            onclick: () => {
              this.paintTile = t.id;
              this.paintMode = 'tile';
              this.setTool('paint');
              this.refreshLegend();
            },
          },
          h('span', { class: 'swatch', style: `background:${t.color}` }),
          t.name,
        ),
      );
    }
    for (const id of this.map ? objectLegendEntries(this.map) : []) {
      const d = objectDef(id)!;
      box.append(
        h(
          'div',
          {
            class: id === this.paintObject && this.tool === 'paint' && this.paintMode === 'object' ? 'active' : '',
            title: 'Click to paint this object',
            onclick: () => {
              this.setPaint({ paintMode: 'object', paintObject: id });
              this.setTool('paint');
            },
          },
          h('span', { class: 'swatch obj' }, d.icon),
          d.name,
        ),
      );
    }
  }

  // ---- viewport ---------------------------------------------------------------------------

  private resize(): void {
    const wrap = byId('canvas-wrap');
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(wrap.clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(wrap.clientHeight * dpr));
    if (this.needsFit) this.fit();
    this.draw();
  }

  fit(): void {
    const map = this.map;
    if (!map) return;
    const b = new Grid(map.grid, map.width, map.height).renderBounds();
    const w = this.canvas.width;
    const hgt = this.canvas.height;
    if (w < 50 || hgt < 50) {
      this.needsFit = true;
      return;
    }
    this.needsFit = false;
    this.scale = Math.min(w / b.w, hgt / b.h) * 0.94;
    this.ox = (w - b.w * this.scale) / 2;
    this.oy = (hgt - b.h * this.scale) / 2;
    this.cache = null;
  }

  private toRender(sx: number, sy: number): [number, number] {
    return [(sx - this.ox) / this.scale, (sy - this.oy) / this.scale];
  }

  private eventCell(e: MouseEvent): number {
    const map = this.map;
    if (!map) return -1;
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    const [x, y] = this.toRender((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    return new Grid(map.grid, map.width, map.height).pixelToCell(x, y);
  }

  private ensureCache(map: WorldMap): void {
    const v = this.view;
    const key = `${map.id}:${this.version}:${v.grid}:${v.hillshade}:${v.rivers}:${v.roads}:${v.objects}:${v.zones}:${v.gameArt && gameArtReady()}`;
    const wanted = safeScale(map, Math.min(48, Math.max(baseUnitPx(map.grid), this.scale)));
    if (this.cache && this.cache.key === key) {
      if (wanted > this.cache.s * 1.4 || wanted < this.cache.s / 3) {
        clearTimeout(this.cacheTimer);
        this.cacheTimer = window.setTimeout(() => {
          this.cache = null;
          this.draw();
        }, 150);
      }
      return;
    }
    this.cache = { canvas: renderMapCanvas(map, wanted, this.view), s: wanted, key };
  }

  draw(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0e1014';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const map = this.map;
    if (!map) return;
    this.ensureCache(map);
    const cache = this.cache!;
    const k = this.scale / cache.s;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(cache.canvas, this.ox, this.oy, cache.canvas.width * k, cache.canvas.height * k);

    const g = new Grid(map.grid, map.width, map.height);
    // Child map regions.
    for (const cid of map.children) {
      const child = this.project.maps[cid];
      if (!child?.parent) continue;
      const pts = rectOutline(g, child.parent);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(255,215,120,0.9)';
      ctx.lineWidth = 1.5;
      this.pathScreen(pts);
      ctx.stroke();
      ctx.setLineDash([]);
      const [x, y] = pts[0];
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(`${KIND_ICON[child.kind]} ${child.name}`, this.ox + x * this.scale + 2, this.oy + y * this.scale - 2);
      ctx.fillStyle = '#ffd778';
      ctx.fillText(`${KIND_ICON[child.kind]} ${child.name}`, this.ox + x * this.scale + 2, this.oy + y * this.scale - 2);
    }
    // Selection.
    if (this.selection) {
      const pts = rectOutline(g, this.selection);
      this.pathScreen(pts);
      ctx.fillStyle = 'rgba(224,176,74,0.18)';
      ctx.fill();
      ctx.strokeStyle = '#e0b04a';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Hover.
    if (this.hoverCell >= 0 && this.hoverCell < g.size) {
      const cells = this.tool === 'paint' ? this.brushCells(g, this.hoverCell) : [this.hoverCell];
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.5;
      for (const i of cells) {
        this.pathScreen(g.corners(i));
        ctx.stroke();
      }
    }
    // Game overlays: a selected monster spawn's wander area, a selected link's arrival tile.
    const sel = map.features.find((f) => f.id === this.selectedFeature);
    if (sel && isRpgdc(map)) {
      const radius = Number(placeProps(sel).radius ?? 0);
      if (sel.type === 'monster_spawn' && radius > 0) {
        const r = clampRect({ c0: sel.c - radius, r0: sel.r - radius, c1: sel.c + radius, r1: sel.r + radius }, map);
        this.pathScreen(rectOutline(g, r));
        ctx.fillStyle = 'rgba(220,60,60,0.12)';
        ctx.fill();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(255,90,90,0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (this.flash && this.flash.mapId === map.id && this.flash.cell < g.size) {
      this.pathScreen(g.corners(this.flash.cell));
      ctx.strokeStyle = '#ff4d4d';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    drawFeatures(ctx, map, this.scale, this.ox, this.oy, this.view, this.selectedFeature);
  }

  private pathScreen(pts: [number, number][]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    pts.forEach(([x, y], k) => {
      const sx = this.ox + x * this.scale;
      const sy = this.oy + y * this.scale;
      if (k) ctx.lineTo(sx, sy);
      else ctx.moveTo(sx, sy);
    });
    if (pts.length) ctx.closePath();
  }

  private brushCells(g: Grid, center: number): number[] {
    if (this.brush <= 0) return [center];
    const [cx, cy] = g.pos(center);
    const out: number[] = [];
    const r = this.brush + 0.5;
    const c0 = g.col(center);
    const r0 = g.row(center);
    for (let rr = r0 - this.brush - 1; rr <= r0 + this.brush + 1; rr++) {
      for (let cc = c0 - this.brush - 1; cc <= c0 + this.brush + 1; cc++) {
        if (!g.inBounds(cc, rr)) continue;
        const [x, y] = g.posCR(cc, rr);
        if (Math.hypot(x - cx, y - cy) <= r) out.push(g.idx(cc, rr));
      }
    }
    return out;
  }

  // ---- input ------------------------------------------------------------------------------

  private bindCanvas(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS Safari ignores `touch-action: none` once the page can scroll, so a drag on the map would
    // scroll or zoom the page. Cancelling the touch events keeps every gesture on the map; the
    // pointer events below still fire.
    for (const type of ['touchstart', 'touchmove'] as const) c.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    for (const type of ['gesturestart', 'gesturechange']) c.addEventListener(type, (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dpr = window.devicePixelRatio || 1;
      const r = c.getBoundingClientRect();
      this.zoomAt((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr, this.scale * Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    const local = (e: PointerEvent) => {
      const dpr = window.devicePixelRatio || 1;
      const r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
    };

    c.addEventListener('pointerdown', (e) => {
      const map = this.map;
      if (!map) return;
      c.setPointerCapture(e.pointerId);
      this.lastPointerType = e.pointerType;
      const pt = local(e);
      this.pointers.set(e.pointerId, pt);
      if (this.pointers.size === 2) return this.beginPinch();
      if (this.pointers.size > 2) return;
      const cell = this.eventCell(e);
      const g = new Grid(map.grid, map.width, map.height);
      this.tapStart = { x: pt.x, y: pt.y, t: performance.now(), cell };
      if (cell >= 0) {
        this.hoverCell = cell;
        this.updateStatus(map, g, cell);
      }
      if (this.pick || e.button === 1 || e.button === 2 || this.tool === 'pan' || this.spaceDown) {
        this.drag = { kind: 'pan', x: pt.x, y: pt.y, ox: this.ox, oy: this.oy };
        c.style.cursor = 'grabbing';
        return;
      }
      if (cell < 0) return;
      if (this.tool === 'select') {
        this.drag = { kind: 'select', start: cell };
        this.selection = { c0: g.col(cell), r0: g.row(cell), c1: g.col(cell), r1: g.row(cell) };
        this.draw();
      } else if (this.tool === 'paint') {
        this.pushUndo();
        const d = { kind: 'paint' as const, last: cell, buildingId: layerMax(map.layers.building) + 1, cells: 1, stamp: -1 };
        this.drag = d;
        this.paintAt(map, g, cell, -1, d);
      } else if (this.tool === 'feature') {
        const existing = featureAt(map, g, cell);
        this.pushUndo();
        if (existing) {
          this.selectFeature(existing.id);
          this.drag = { kind: 'move-feature', id: existing.id, created: false };
        } else {
          const f = this.placeFeature(map, g, cell);
          this.drag = { kind: 'move-feature', id: f.id, created: true };
        }
      }
    });

    c.addEventListener('pointermove', (e) => {
      const map = this.map;
      if (!map) return;
      const pt = local(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, pt);
      if (this.ignored.has(e.pointerId)) return;
      if (this.pinch) {
        if (this.pointers.size < 2) return;
        const [a, b] = [...this.pointers.values()];
        const p = this.pinch;
        const ns = Math.max(0.5, Math.min(400, (p.scale0 * Math.hypot(a.x - b.x, a.y - b.y)) / p.d0));
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        this.ox = mx - ((p.mx - p.ox0) * ns) / p.scale0;
        this.oy = my - ((p.my - p.oy0) * ns) / p.scale0;
        this.scale = ns;
        this.draw();
        return;
      }
      const d = this.drag;
      if (d?.kind === 'pan') {
        this.ox = d.ox + pt.x - d.x;
        this.oy = d.oy + pt.y - d.y;
        this.draw();
        return;
      }
      const cell = this.eventCell(e);
      const g = new Grid(map.grid, map.width, map.height);
      if (cell !== this.hoverCell) {
        this.hoverCell = cell;
        this.updateStatus(map, g, cell);
      }
      if (cell < 0) {
        this.draw();
        return;
      }
      if (d?.kind === 'select') {
        this.selection = normalizeRect({ c0: g.col(d.start), r0: g.row(d.start), c1: g.col(cell), r1: g.row(cell) });
      } else if (d?.kind === 'paint' && cell !== d.last) {
        d.cells++;
        this.paintAt(map, g, cell, d.last, d);
        d.last = cell;
      } else if (d?.kind === 'move-feature') {
        const f = map.features.find((x) => x.id === d.id);
        if (f) {
          f.c = g.col(cell);
          f.r = g.row(cell);
        }
      }
      this.draw();
    });

    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      if (this.ignored.delete(e.pointerId)) return;
      if (this.pinch) {
        if (this.pointers.size < 2) {
          this.pinch = null;
          // The finger still down belongs to the pinch: ignore it until it lifts.
          for (const id of this.pointers.keys()) this.ignored.add(id);
          this.draw();
        }
        return;
      }
      const d = this.drag;
      this.drag = null;
      this.canvas.style.cursor = this.tool === 'pan' ? 'grab' : this.tool === 'select' ? 'crosshair' : 'cell';
      const map = this.map;
      const start = this.tapStart;
      this.tapStart = null;
      const pt = local(e);
      const dpr = window.devicePixelRatio || 1;
      const tap = !!start && e.type === 'pointerup' && Math.hypot(pt.x - start.x, pt.y - start.y) < 12 * dpr && performance.now() - start.t < 700;
      if (!map) return;
      if (this.pick) {
        if (tap && start!.cell >= 0) this.completePick(start!.cell);
        return;
      }
      if (!d) return;
      if (d.kind === 'select' && this.selection) {
        const s = this.selection;
        if (s.c0 === s.c1 && s.r0 === s.r1) {
          // A tap or click: inspect the place under it; a double tap opens its detail map.
          const g = new Grid(map.grid, map.width, map.height);
          const cell = g.idx(s.c0, s.r0);
          const f = featureAt(map, g, cell);
          this.selection = null;
          this.selectedFeature = f?.id ?? null;
          this.flash = null;
          const now = performance.now();
          if (e.pointerType !== 'mouse' && this.lastTap && this.lastTap.cell === cell && now - this.lastTap.t < 400) {
            this.lastTap = null;
            if (this.openChildAt(map, g, cell)) return;
          } else {
            this.lastTap = { t: now, cell };
          }
        }
        this.refreshPanels();
        this.draw();
      } else if (d.kind === 'paint' || d.kind === 'move-feature') {
        this.changed();
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.hoverCell = -1;
      this.draw();
    });

    c.addEventListener('dblclick', (e) => {
      const map = this.map;
      if (!map || this.lastPointerType !== 'mouse') return;
      const cell = this.eventCell(e);
      if (cell >= 0) this.openChildAt(map, new Grid(map.grid, map.width, map.height), cell);
    });

    // Zoom buttons for touch screens without a wheel (pinch works too).
    byId('btn-zoom-in').onclick = () => this.zoomAt(this.canvas.width / 2, this.canvas.height / 2, this.scale * 1.5);
    byId('btn-zoom-out').onclick = () => this.zoomAt(this.canvas.width / 2, this.canvas.height / 2, this.scale / 1.5);
  }

  private zoomAt(sx: number, sy: number, scale: number): void {
    const ns = Math.max(0.5, Math.min(400, scale));
    this.ox = sx - ((sx - this.ox) * ns) / this.scale;
    this.oy = sy - ((sy - this.oy) * ns) / this.scale;
    this.scale = ns;
    this.draw();
  }

  /** Two fingers down: start pinch-zooming, dropping a stroke the first finger had only just begun. */
  private beginPinch(): void {
    const d = this.drag;
    if (d?.kind === 'paint') {
      if (d.cells <= 1) this.undoQuietly();
      else this.changed();
    } else if (d?.kind === 'move-feature') {
      if (d.created) this.undoQuietly();
      else this.changed();
    } else if (d?.kind === 'select') {
      this.selection = null;
      this.refreshPanels();
    }
    this.drag = null;
    this.tapStart = null;
    const [a, b] = [...this.pointers.values()];
    this.pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, scale0: this.scale, ox0: this.ox, oy0: this.oy };
  }

  /** Undo the last change without offering it for redo (an accidental stroke). */
  private undoQuietly(): void {
    const view = { scale: this.scale, ox: this.ox, oy: this.oy };
    this.undo();
    this.redoStack.pop();
    Object.assign(this, view);
    this.updateUndoButtons();
  }

  /** Open the detail map of the place or outlined region at a cell. Returns true if one opened. */
  private openChildAt(map: WorldMap, g: Grid, cell: number): boolean {
    const f = featureAt(map, g, cell);
    if (f?.childMapId && this.project.maps[f.childMapId]) {
      this.openMap(f.childMapId);
      return true;
    }
    for (const cid of map.children) {
      const child = this.project.maps[cid];
      if (child?.parent && inRect(child.parent, g.col(cell), g.row(cell))) {
        this.openMap(cid);
        return true;
      }
    }
    return false;
  }

  private placeFeature(map: WorldMap, g: Grid, cell: number): Feature {
    const type = this.featureType;
    const game = isRpgdc(map);
    if (game && type === 'spawn_point') {
      // There is only ever one spawn point: move it.
      const existing = map.features.find((f) => f.type === 'spawn_point');
      if (existing) {
        existing.c = g.col(cell);
        existing.r = g.row(cell);
        this.selectedFeature = existing.id;
        toast('Spawn point moved');
        this.changed();
        return existing;
      }
    }
    const f: Feature = {
      id: newId('f'),
      type,
      name: game ? featureDef(type).label : featureName(new Rng(randomSeed()), type) || featureDef(type).label,
      c: g.col(cell),
      r: g.row(cell),
    };
    const props = game ? defaultProps(type) : undefined;
    if (props) f.props = props;
    map.features.push(f);
    this.selectedFeature = f.id;
    this.changed();
    return f;
  }

  private paintAt(map: WorldMap, g: Grid, cell: number, last: number, d: { buildingId: number; stamp: number }): void {
    const L = map.layers;
    const game = isRpgdc(map);
    if (this.paintMode === 'tile') {
      for (const i of this.brushCells(g, cell)) {
        L.terrain[i] = this.paintTile;
        L.building[i] = this.paintTile === T.BUILDING || this.paintTile === T.KEEP ? d.buildingId : 0;
        if (game && this.paintTile !== T.GRASS) {
          // Paths, floors and water clear away trees, rocks and fences, but not stations or stairs.
          const o = objectDef(L.object[i]);
          if (o && NATURE_GROUPS.has(o.group)) L.object[i] = 0;
        }
        const e = PAINT_ELEVATION[this.paintTile];
        if (map.kind === 'overland' && !game) {
          if (e !== undefined) L.elevation[i] = e;
          else if (L.elevation[i] < SEA_LEVEL && !tile(this.paintTile).category.includes('water')) L.elevation[i] = SEA_LEVEL + 0.03;
        }
      }
    } else if (this.paintMode === 'object') {
      for (const i of this.brushCells(g, cell)) L.object[i] = this.paintObject;
    } else if (this.paintMode === 'zone') {
      for (const i of this.brushCells(g, cell)) L.zone[i] = this.paintZone;
    } else if (this.paintMode === 'grove' || this.paintMode === 'ore') {
      // One grove or cluster per tap; dragging stamps another once the finger has moved far enough.
      const spacing = this.paintMode === 'grove' ? this.brush + 2 : 2;
      if (d.stamp >= 0 && g.dist(d.stamp, cell) < spacing) return;
      d.stamp = cell;
      const rng = new Rng(randomSeed());
      if (this.paintMode === 'grove') paintGrove(map, cell, this.groveObject, this.brush + 1, rng);
      else paintCluster(map, cell, this.oreObject, rng);
    } else if (this.paintMode === 'erase-lines') {
      for (const i of this.brushCells(g, cell)) {
        unlinkCell(g, L.road, i);
        unlinkCell(g, L.river, i);
        L.roadLevel[i] = 0;
        L.riverSize[i] = 0;
      }
    } else if (last >= 0) {
      const layer = this.paintMode === 'road' ? L.road : L.river;
      const path = g.dirBetween(last, cell) >= 0 ? [last, cell] : traceLine(g, g.pos(last), g.pos(cell));
      if (this.paintMode === 'road') linkPath(g, layer, path, L.roadLevel, this.roadLevel);
      else {
        for (let k = 1; k < path.length; k++) link(g, layer, path[k - 1], path[k]);
        for (const i of path) L.riverSize[i] = Math.max(L.riverSize[i], 60);
      }
    }
    this.version++;
    this.cache = null;
  }

  private updateStatus(map: WorldMap, g: Grid, cell: number): void {
    const el = byId('status');
    if (cell < 0) {
      el.textContent = `${map.name} · zoom ${Math.round(this.scale * 10)}%`;
      return;
    }
    const L = map.layers;
    const parts = [`col ${g.col(cell)}, row ${g.row(cell)}`, tile(L.terrain[cell]).name];
    if (map.kind === 'overland' && !isRpgdc(map)) parts.push(`elev ${L.elevation[cell].toFixed(2)}`, `moist ${L.moisture[cell].toFixed(2)}`, `temp ${L.temperature[cell].toFixed(2)}`);
    if (L.river[cell]) parts.push('river');
    if (L.road[cell]) parts.push(['', 'trail', 'road', 'highway'][L.roadLevel[cell]] || 'road');
    if (L.building[cell]) parts.push(`building #${L.building[cell]}`);
    const o = objectDef(L.object[cell]);
    if (o) parts.push(`${o.icon} ${o.name}`);
    if (isRpgdc(map)) {
      const z = zoneAt(map, cell);
      parts.push(z ? `${z.name} zone` : 'no zone', isWalkableAt(map, g.col(cell), g.row(cell)) ? 'walkable' : 'blocked');
    } else if (L.zone[cell]) {
      parts.push(`zone ${L.zone[cell]}`);
    }
    const f = featureAt(map, g, cell);
    if (f) parts.push(`${featureDef(f.type).icon} ${f.name}`);
    el.textContent = parts.join(' · ');
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target.matches('input, textarea, select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if (e.key === ' ') {
        this.spaceDown = true;
        this.canvas.style.cursor = 'grab';
        e.preventDefault();
      } else if (e.key === 'Escape') {
        this.selection = null;
        this.selectedFeature = null;
        this.refreshPanels();
        this.draw();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedFeature) {
        this.deleteFeature(this.selectedFeature);
      } else if (!e.ctrlKey && !e.metaKey) {
        const map: Record<string, Tool> = { s: 'select', h: 'pan', p: 'paint', f: 'feature' };
        const t = map[e.key.toLowerCase()];
        if (t) this.setTool(t);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') {
        this.spaceDown = false;
        this.setTool(this.tool);
      }
    });
  }
}

function featureAt(map: WorldMap, g: Grid, cell: number): Feature | undefined {
  const c = g.col(cell);
  const r = g.row(cell);
  return [...map.features].reverse().find((f) => f.c === c && f.r === r);
}

export function clampRect(r: CellRect, map: WorldMap): CellRect {
  const n = normalizeRect(r);
  return {
    c0: Math.max(0, n.c0),
    r0: Math.max(0, n.r0),
    c1: Math.min(map.width - 1, n.c1),
    r1: Math.min(map.height - 1, n.r1),
  };
}

/** Screen outline (render units) of a cell rectangle. */
export function rectOutline(g: Grid, rect: CellRect): [number, number][] {
  if (g.type === 'iso') {
    return [g.cornersCR(rect.c0, rect.r0)[0], g.cornersCR(rect.c1, rect.r0)[1], g.cornersCR(rect.c1, rect.r1)[2], g.cornersCR(rect.c0, rect.r1)[3]];
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const edge = (c: number, r: number) => {
    for (const [x, y] of g.cornersCR(c, r)) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  };
  for (let c = rect.c0; c <= rect.c1; c++) {
    edge(c, rect.r0);
    edge(c, rect.r1);
  }
  for (let r = rect.r0; r <= rect.r1; r++) {
    edge(rect.c0, r);
    edge(rect.c1, r);
  }
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** Panel heading with a close button (the panel becomes a bottom sheet on phones). */
function sheetHeader(title: string, onClose: () => void): HTMLElement {
  return h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon close', 'aria-label': 'Close', onclick: onClose }, '✕'));
}
