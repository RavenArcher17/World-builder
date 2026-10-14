/**
 * Optional preview of RPG-DC maps with the game's own art (Flare, CC BY-SA 3.0), loaded from the
 * game server. Mirrors how the game's client (client/src/scenes/WorldScene.ts) picks frames, so
 * the preview shows what players see. Needs the server to allow cross-origin requests.
 */
import { Grid } from '../core/grid';
import { O } from '../core/objects';
import {
  OPEN_GROUND,
  ROOF_COLOURS,
  WALL_COLOURS,
  boatFacing,
  buildingMask,
  buildings,
  doorFace,
  doorFacing,
  dungeonTheme,
  fortChest,
  gameKind,
  guardPosts,
  houseGuards,
  placeProps,
  plotSign,
  plotSizeOk,
  plots,
  type GameBuilding,
} from '../core/rpgdc/game';
import { T } from '../core/tiles';
import type { WorldMap } from '../core/types';
import { drawObject, paintOrder } from './drawObjects';
import type { OverviewColours } from './overview';

export const DEFAULT_ART_BASE = 'https://rpg-dc.onrender.com/art/';
export const ART_CREDITS_URL = 'https://rpg-dc.onrender.com/art/CREDITS.md';
/** Optional override of where the art lives (e.g. a local copy while testing). */
const ART_BASE_KEY = 'world-builder:rpgdc-art';

/** [page, x, y, width, height, anchor x, anchor y]; the anchor sits on the tile centre. */
type Frame = [number, number, number, number, number, number, number];
interface Sheet {
  pages: string[];
  frames: Record<string, Frame>;
  counts?: Record<string, number>;
}
interface GameArt {
  sheets: Record<string, Sheet>;
  images: Record<string, HTMLImageElement[]>;
  /** Hero layer drawing order for each of the 8 facings. */
  layerOrder: string[][];
  /** Single pages of the character sheets (monsters, heroes' clothes), loaded as they're needed. */
  pages: Map<string, HTMLImageElement>;
}

let loaded: GameArt | null = null;
let loading: Promise<GameArt> | null = null;

export function artBase(): string {
  try {
    return localStorage.getItem(ART_BASE_KEY) || DEFAULT_ART_BASE;
  } catch {
    return DEFAULT_ART_BASE;
  }
}

export function gameArtReady(): boolean {
  return loaded !== null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Anonymous CORS keeps the map canvas untainted, so PNG export still works.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load ${src}`));
    img.src = src;
  });
}

/** Load the art index and the scenery sheets once; later calls share the same promise. */
export function loadGameArt(): Promise<GameArt> {
  if (loaded) return Promise.resolve(loaded);
  if (!loading) {
    const base = artBase();
    loading = (async () => {
      const res = await fetch(`${base}art.json`, { mode: 'cors' });
      if (!res.ok) throw new Error(`The art index answered ${res.status}`);
      const index = (await res.json()) as { sheets: Record<string, Sheet>; layerOrder?: string[][] };
      const images: Record<string, HTMLImageElement[]> = {};
      for (const name of ['world', 'dungeon', 'indoor']) {
        const sheet = index.sheets[name];
        if (!sheet) {
          // Older game servers have no indoor sheet: insides are drawn without furniture.
          if (name === 'indoor') continue;
          throw new Error(`The art has no "${name}" sheet`);
        }
        images[name] = await Promise.all(sheet.pages.map((p) => loadImage(base + p)));
      }
      loaded = { sheets: index.sheets, images, layerOrder: index.layerOrder ?? [], pages: new Map() };
      return loaded;
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
}

let onChange: (() => void) | null = null;
/** Called when more art arrives (houses load as maps need them), so the map can be redrawn. */
export function onGameArtChange(fn: () => void): void {
  onChange = fn;
}
let changeTimer = 0;
/** Several sheets often arrive together: redraw once they're in, not after each. */
function changed(): void {
  clearTimeout(changeTimer);
  changeTimer = window.setTimeout(() => onChange?.(), 200);
}

const sheetLoads = new Set<string>();
/** Whether a sheet is loaded; if not, starts loading it and redraws when it's in. */
function haveSheet(name: string): boolean {
  const art = loaded;
  if (!art?.sheets[name]) return false;
  if (art.images[name]) return true;
  if (!sheetLoads.has(name)) {
    sheetLoads.add(name);
    const base = artBase();
    Promise.all(art.sheets[name].pages.map((p) => loadImage(base + p)))
      .then((imgs) => {
        art.images[name] = imgs;
        changed();
      })
      .catch(() => sheetLoads.delete(name));
  }
  return false;
}

/**
 * The page of a sheet a frame is on, if it's loaded; if not, starts loading just that page (a
 * monster's standing pose is on its first page, and the big sheets have more) and redraws when
 * it's in.
 */
function framePage(name: string, frame: string): { f: Frame; img: HTMLImageElement } | null {
  const art = loaded;
  const f = art?.sheets[name]?.frames[frame];
  if (!art || !f) return null;
  const whole = art.images[name]?.[f[0]];
  if (whole) return { f, img: whole };
  const key = `${name}#${f[0]}`;
  const img = art.pages.get(key);
  if (img) return { f, img };
  if (!sheetLoads.has(key)) {
    sheetLoads.add(key);
    loadImage(artBase() + art.sheets[name].pages[f[0]])
      .then((im) => {
        art.pages.set(key, im);
        changed();
      })
      .catch(() => sheetLoads.delete(key));
  }
  return null;
}

/** The game's stable per-tile hash (client/src/art.ts), so variants match the game. */
function tileHash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** West, north, east, south: the order of the game's `edge/*` and `shore/*` frames. */
const EDGE_NEIGHBOURS = [[-1, 0], [0, -1], [1, 0], [0, 1]] as const;

type Ground = 'grass' | 'path' | 'floor' | 'water' | 'sand' | 'mud' | 'bog' | 'snow' | 'stone' | 'ice';
const GROUND_OF: Partial<Record<number, Ground>> = {
  [T.PATH]: 'path',
  [T.WATER]: 'water',
  [T.TOWN_FLOOR]: 'floor',
  [T.CRYPT_FLOOR]: 'floor',
  [T.PLANKS]: 'floor',
  [T.SAND]: 'sand',
  [T.MUD]: 'mud',
  [T.BOG]: 'bog',
  [T.SNOW]: 'snow',
  [T.STONE]: 'stone',
  [T.ICE]: 'ice',
};
/**
 * Where two grounds meet, the one higher up this list creeps over the other's edge with a ragged
 * border: snow over grass, grass over sand, sand over mud, any of them over gravel, paths and
 * floors. Water and bog get shores instead (the game's EDGE_RANK and EDGE_ART).
 */
const EDGE_RANK: Partial<Record<Ground, number>> = { snow: 6, grass: 5, sand: 4, mud: 3, stone: 2, path: 1, floor: 1, ice: 0 };
const EDGE_ART: Partial<Record<Ground, string>> = { snow: 'snow-edge', grass: 'edge', sand: 'sand-edge', mud: 'mud-edge' };
const wet = (g: Ground) => g === 'water' || g === 'bog';
/**
 * Scenery scattered over open ground for looks (the game's SCENERY): which art, on what share of
 * tiles. Lily pads float. On grass only the first six plants: the others are wild herbs.
 */
const SCENERY: Partial<Record<Ground, { frame: string; share: number; flat?: boolean; only?: number }>> = {
  grass: { frame: 'plant', share: 0.06, only: 6 },
  sand: { frame: 'dryplant', share: 0.05 },
  mud: { frame: 'reed', share: 0.12 },
  snow: { frame: 'snowplant', share: 0.04 },
  bog: { frame: 'lily', share: 0.1, flat: true },
};
const TREES: Partial<Record<number, string>> = { [O.TREE]: 'tree', [O.OAK]: 'oak', [O.WILLOW]: 'willow', [O.YEW]: 'yew' };
/** Ore rocks: Flare's boulder with veins, from the world sheet wherever they are (the caverns too). */
const ORE_ART: Partial<Record<number, string>> = {
  [O.COPPER_ROCK]: 'ore-copper',
  [O.TIN_ROCK]: 'ore-tin',
  [O.IRON_ROCK]: 'ore-iron',
  [O.GOLD_ROCK]: 'ore-gold',
  [O.MITHRIL_ROCK]: 'ore-mithril',
  [O.ADAMANT_ROCK]: 'ore-adamant',
  [O.RUNITE_ROCK]: 'ore-runite',
  [O.ESSENCE_ROCK]: 'ore-essence',
  // Construction's limestone, in the Old Quarry.
  [O.LIMESTONE_ROCK]: 'ore-limestone',
};
const ART_FOR: Partial<Record<number, string>> = {
  ...ORE_ART,
  [O.BANK]: 'bank',
  [O.SHOP]: 'shop',
  [O.FURNACE]: 'furnace',
  [O.ANVIL]: 'anvil',
  [O.COOKING_FIRE]: 'range',
  [O.SEWER_GRATE]: 'sewer-grate',
};
/** Stations, workbenches and furniture from the indoor sheet (the game draws them so outside too). */
const INDOOR_ART: Partial<Record<number, string>> = {
  [O.BANK]: 'bank',
  [O.SHOP]: 'shop',
  [O.FURNACE]: 'furnace',
  [O.ANVIL]: 'anvil',
  [O.COOKING_FIRE]: 'hearth',
  [O.ALCHEMY_TABLE]: 'alchemy_table',
  [O.SEWING_TABLE]: 'sewing_table',
  [O.FLETCHING_BENCH]: 'fletching_bench',
  [O.COUNTER]: 'counter',
  [O.TABLE]: 'table',
  [O.BED]: 'bed',
  [O.BARREL]: 'barrel',
  [O.CRATE]: 'crate',
  [O.LECTERN]: 'lectern',
  [O.BOOKSHELF]: 'crate',
  // Farming's workbenches: the spinning wheel (in the farmhouse and the Tailor's) and the windmill's millstones.
  [O.SPINNING_WHEEL]: 'spinning_wheel',
  [O.MILLSTONES]: 'millstones',
  // Construction's workbench, in the carpenter's yard in town.
  [O.SAWBENCH]: 'sawbench',
};
/** Farming's patches, from the world sheet: bare tilled beds, drawn flat on the ground (players walk over them). */
const PATCH_ART: Partial<Record<number, string>> = {
  [O.PATCH_ALLOTMENT]: 'patch-allotment',
  [O.PATCH_HERB]: 'patch-herb',
  [O.PATCH_TREE]: 'patch-tree',
};

/**
 * The sheet and frame the game draws a Farming object with, or null for anything else: a patch
 * flat on the ground from the world sheet (`patch-allotment`, `patch-herb`, `patch-tree`), the
 * spinning wheel and the millstones from the indoor sheet like the other workbenches.
 */
export function farmFrame(o: number): { sheet: 'world' | 'indoor'; frame: string; flat: boolean } | null {
  if (PATCH_ART[o]) return { sheet: 'world', frame: PATCH_ART[o]!, flat: true };
  if (o === O.SPINNING_WHEEL || o === O.MILLSTONES) return { sheet: 'indoor', frame: INDOOR_ART[o]!, flat: false };
  return null;
}
/**
 * The sheet and frame the game draws Construction's objects with, or null for anything else: the
 * sawbench from the indoor sheet like the other workbenches, limestone from the world sheet like
 * the ore rocks.
 */
export function constructionFrame(o: number): { sheet: 'world' | 'indoor'; frame: string } | null {
  if (o === O.SAWBENCH) return { sheet: 'indoor', frame: INDOOR_ART[o]! };
  if (o === O.LIMESTONE_ROCK) return { sheet: 'world', frame: ORE_ART[o]! };
  return null;
}
/** Things in the streets, from the world sheet wherever they stand (indoors too). */
const DECOR_ART: Partial<Record<number, string>> = {
  [O.WELL]: 'well',
  [O.LAMP_POST]: 'lamp_post',
  [O.MARKET_STALL]: 'market_stall',
  [O.FLOWER_BED]: 'flower_bed',
  [O.BENCH]: 'bench',
  [O.SIGNPOST]: 'signpost',
  [O.NOTICE_BOARD]: 'notice_board',
  // Runecrafting altars, glowing in their rune's colour.
  [O.AIR_ALTAR]: 'altar-air',
  [O.MIND_ALTAR]: 'altar-mind',
  [O.WATER_ALTAR]: 'altar-water',
  [O.EARTH_ALTAR]: 'altar-earth',
  [O.FIRE_ALTAR]: 'altar-fire',
  [O.CHAOS_ALTAR]: 'altar-chaos',
  [O.LAW_ALTAR]: 'altar-law',
  // Waystones: a grey standing stone with a column of glowing blue runes.
  [O.WAYSTONE]: 'waystone',
};
/** Sewer stone is damp and greenish (the game tints it so). */
const SEWER_TINT = '#c4cdb4';
/** Herb patches: the game's leafier plants, tinted per herb and drawn a little larger. */
const HERB_ART: Partial<Record<number, { frame: string; tint: string }>> = {
  [O.HERB_SUNLEAF]: { frame: 'plant/6', tint: '#e8ff9a' },
  [O.HERB_SILVERWEED]: { frame: 'plant/10', tint: '#e0f0ff' },
  [O.HERB_THORNBERRY]: { frame: 'plant/12', tint: '#ff9a8a' },
  [O.HERB_NIGHTSHADE]: { frame: 'plant/8', tint: '#ffffff' },
  [O.HERB_EMBERBLOOM]: { frame: 'plant/9', tint: '#ffa060' },
  // The new lands' herbs: a gold flower on the sand, a purple bush in the mud, pale-blue leaves on the snow.
  [O.HERB_DUNEFLOWER]: { frame: 'plant/8', tint: '#ffd060' },
  [O.HERB_BOGMYRTLE]: { frame: 'plant/13', tint: '#d8a0ff' },
  [O.HERB_FROSTCAP]: { frame: 'plant/7', tint: '#b0e8ff' },
};
const FISHING = new Set<number>([O.FISHING_SHRIMP, O.FISHING_TROUT, O.FISHING_SALMON, O.FISHING_EEL, O.FISHING_LOBSTER, O.FISHING_SWORDFISH]);
/** The sea's things, from the world sheet: palms and wrecks (one of each kind's, picked by tile, like cacti) and the ferry's boat. */
const SEA_ART: Partial<Record<number, string>> = { [O.PALM]: 'palm', [O.WRECK]: 'wreck', [O.BOAT]: 'boat' };

/**
 * The world sheet's frame for a palm, wreck or boat at (x, y), as the game picks it: `palm/0` to
 * `palm/<count - 1>` and the same for wrecks, by the tile's hash; a boat lying along y (`boat-y`)
 * when its jetty is west or east of it, else along x (`boat-x`). Null for anything else.
 */
export function seaFrame(map: WorldMap, x: number, y: number, count = 1): string | null {
  const o = map.layers.object[y * map.width + x];
  if (o === O.BOAT) return `boat-${boatFacing(map, x, y)}`;
  const what = SEA_ART[o];
  return what ? `${what}/${Math.floor(tileHash(x, y) * count)}` : null;
}
/** A thicket is drawn as one of the trees beside it, a shade darker (the game's setTint(0xdce6d2)). */
const THICKET_TINT = '#dce6d2';

/** A windmill: a tower whose sign says so, any case (the game turns four sails on its east wall). */
export const isWindmill = (b: GameBuilding): boolean => b.style === 'tower' && /mill/i.test(b.sign);

/**
 * The tree a thicket on (x, y) looks like, as the game picks it: the first tree, oak, willow or
 * yew west, north, east or south of it; a tree (a pine) if there's none.
 */
export function thicketLooksLike(map: WorldMap, x: number, y: number): number {
  for (const [dx, dy] of EDGE_NEIGHBOURS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
    const o = map.layers.object[ny * map.width + nx];
    if (TREES[o]) return o;
  }
  return O.TREE;
}

/**
 * The pieces of ruined wall the game draws on (x, y), joined up like the fence: a stretch towards
 * a ruin to the north, one towards a ruin to the west, or a lone pillar with neither.
 */
export function ruinPieces(map: WorldMap, x: number, y: number): ('ruin-n' | 'ruin-w' | 'ruin-post')[] {
  const ruin = (rx: number, ry: number) => rx >= 0 && ry >= 0 && rx < map.width && ry < map.height && map.layers.object[ry * map.width + rx] === O.RUIN;
  const out: ('ruin-n' | 'ruin-w' | 'ruin-post')[] = [];
  if (ruin(x, y - 1)) out.push('ruin-n');
  if (ruin(x - 1, y)) out.push('ruin-w');
  return out.length ? out : ['ruin-post'];
}

// ---- dungeon looks and puzzles (WorldScene's drawCave and drawPuzzle) ---------------------------

/**
 * The sheet a dungeon floor is drawn from like a cavern (the game's drawCave): `cave` for the
 * caverns' rock, `frost` for the Frozen Peaks' ice; null for the crypt, the sewers and the rest.
 */
export function caveTheme(map: WorldMap): 'cave' | 'frost' | null {
  if (gameKind(map) !== 'dungeon') return null;
  const theme = dungeonTheme(map);
  return theme === 'cave' || theme === 'frost' ? theme : null;
}

/** Smooth patches, 0 to 1 over a few tiles: where the Frozen Peaks' floor is glassy ice (the game's icePatch). */
export function icePatch(x: number, y: number): number {
  const fx = x / 4;
  const fy = y / 4;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = tileHash(x0, y0, 21);
  const b = tileHash(x0 + 1, y0, 21);
  const c = tileHash(x0, y0 + 1, 21);
  const d = tileHash(x0 + 1, y0 + 1, 21);
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * The ground a cavern's open tile is drawn with, as the game picks it: the frames' name in the
 * theme's sheet and the salt that picks a variant. The caverns: lava for the map's water, dirt
 * with rubble here and there. The Frozen Peaks: thin ice for water, snow with patches of glassy ice.
 */
export function caveGround(theme: 'cave' | 'frost', water: boolean, x: number, y: number): { what: string; salt: number } {
  if (water) return { what: theme === 'frost' ? 'ice' : 'lava', salt: 0 };
  if (theme === 'frost') return icePatch(x, y) > 0.7 ? { what: 'ice', salt: 4 } : { what: 'floor', salt: 2 };
  return tileHash(x, y, 2) < 0.15 ? { what: 'rubble', salt: 3 } : { what: 'floor', salt: 2 };
}

/**
 * The dungeon sheet's frame for a gate, lever or locked door at (x, y), as the game draws it before
 * anyone opens it: a shut gate or door across its passage (`gate-x`, `lockdoor-y`, …, by
 * doorFacing) and a lever not yet pulled. Null for anything else.
 */
export function puzzleFrame(map: WorldMap, x: number, y: number): string | null {
  const o = map.layers.object[y * map.width + x];
  if (o === O.LEVER) return 'lever';
  if (o === O.GATE) return `gate-${doorFacing(map, x, y)}`;
  if (o === O.LOCKED_DOOR) return `lockdoor-${doorFacing(map, x, y)}`;
  return null;
}
const PUZZLES = new Set<number>([O.GATE, O.LEVER, O.LOCKED_DOOR]);

// ---- characters (client/src/actors.ts) -------------------------------------------------------

/** One sheet of a character, tinted (heroes are several: body parts and gear). */
type Layer = { sheet: string; tint?: string };
/** Monsters drawn with another's art: [sheet, tint] (the game's MONSTER_ART). */
const MONSTER_ART: Partial<Record<string, [string, string]>> = { sewer_rat: ['mon/rat', '#9a958a'] };
/** Monsters drawn see-through. */
const GHOSTLY = new Set(['ghost', 'banshee', 'frost_wraith']);
/** What each townsperson wears: a sheet per body part, and its tint (the game's NPC_OUTFITS). */
const NPC_OUTFITS: Record<string, Record<string, [string, string?]>> = {
  banker: { head: ['head_bald'], chest: ['cloth_shirt', '#ffe8a0'], hands: ['default_hands'], legs: ['cloth_pants', '#9a8ab8'], feet: ['leather_boots'] },
  general: { head: ['head_short'], chest: ['leather_chest', '#e0b080'], hands: ['default_hands'], legs: ['cloth_pants'], feet: ['leather_boots'] },
  smith: { head: ['head_bald'], chest: ['leather_chest', '#8a8a8a'], hands: ['leather_gloves', '#8a8a8a'], legs: ['cloth_pants'], feet: ['leather_boots'] },
  mage: { head: ['mage_hood_alt1'], chest: ['mage_vest_alt1'], hands: ['mage_sleeves_alt1'], legs: ['mage_skirt_alt1'], feet: ['mage_boots_alt1'], main: ['staff'] },
  alchemist: { head: ['head_short'], chest: ['cloth_shirt', '#a8f0a8'], hands: ['default_hands'], legs: ['cloth_pants', '#80a080'], feet: ['cloth_sandals'] },
  tailor: { head: ['head_short'], chest: ['cloth_shirt', '#ff9ac8'], hands: ['default_hands'], legs: ['cloth_pants', '#c8a0ff'], feet: ['cloth_sandals'] },
  fletcher: { head: ['leather_hood', '#a8d080'], chest: ['leather_chest', '#a8d080'], hands: ['leather_gloves'], legs: ['leather_pants'], feet: ['leather_boots'], main: ['longbow'] },
  inn: { head: ['head_bald'], chest: ['cloth_shirt', '#ffffff'], hands: ['default_hands'], legs: ['cloth_pants', '#c89a6a'], feet: ['cloth_sandals'] },
  mayor: { head: ['head_short'], chest: ['mage_vest_alt1', '#d890e8'], hands: ['mage_sleeves_alt1', '#d890e8'], legs: ['mage_skirt_alt1', '#b070c8'], feet: ['leather_boots'] },
  captain: { head: ['plate_helm', '#ffd27a'], chest: ['plate_cuirass', '#ffd27a'], hands: ['plate_gauntlets', '#ffd27a'], legs: ['plate_greaves', '#ffd27a'], feet: ['plate_boots', '#ffd27a'], main: ['longsword'] },
  villager: { head: ['head_short'], chest: ['cloth_shirt'], hands: ['default_hands'], legs: ['cloth_pants'], feet: ['cloth_sandals'] },
  merchant: { head: ['leather_hood', '#40c0b0'], chest: ['mage_vest_alt1', '#e8a040'], hands: ['mage_sleeves_alt1', '#e8a040'], legs: ['mage_skirt_alt1', '#a060e0'], feet: ['leather_boots', '#8a5a3a'] },
  slayer: { head: ['leather_hood', '#6a5058'], chest: ['leather_chest', '#7a5a5a'], hands: ['leather_gloves', '#5a4444'], legs: ['leather_pants', '#5a4444'], feet: ['leather_boots', '#5a4444'], main: ['greatsword'] },
  // Outside town: the hermit in an old brown robe with a staff, the fisher in oilskins, the farmer in
  // a straw-coloured smock, the trapper in leathers with a bow, and Dobbs grimy from the mine.
  hermit: { head: ['mage_hood_alt1', '#9a8a6a'], chest: ['mage_vest_alt1', '#8a7a5a'], hands: ['mage_sleeves_alt1', '#8a7a5a'], legs: ['mage_skirt_alt1', '#6a5a48'], feet: ['cloth_sandals'], main: ['staff'] },
  fisher: { head: ['leather_hood', '#e8c040'], chest: ['leather_chest', '#e8c040'], hands: ['default_hands'], legs: ['cloth_pants', '#506878'], feet: ['leather_boots', '#405060'], main: ['staff', '#8a5a2b'] },
  farmer: { head: ['head_short'], chest: ['cloth_shirt', '#f0e0a8'], hands: ['default_hands'], legs: ['cloth_pants', '#7a6a40'], feet: ['leather_boots'], main: ['hand_axe'] },
  trapper: { head: ['leather_hood', '#8a6a40'], chest: ['leather_chest', '#9a7a50'], hands: ['leather_gloves', '#7a5a3a'], legs: ['leather_pants', '#7a5a3a'], feet: ['leather_boots'], main: ['shortbow'] },
  miner: { head: ['head_bald'], chest: ['leather_chest', '#707070'], hands: ['leather_gloves', '#5a5a5a'], legs: ['cloth_pants', '#5a5040'], feet: ['leather_boots', '#5a5a5a'], main: ['war_hammer'] },
  // Hob the miller, in the windmill, white with flour.
  miller: { head: ['leather_hood', '#f4f0e4'], chest: ['cloth_shirt', '#f4f0e4'], hands: ['default_hands'], legs: ['cloth_pants', '#d8d0bc'], feet: ['leather_boots', '#b8a888'] },
  // Martha, who sells seeds at Giles's Farm, in a green smock and a straw-coloured headscarf.
  seeds: { head: ['leather_hood', '#f0d890'], chest: ['cloth_shirt', '#9ac070'], hands: ['default_hands'], legs: ['cloth_pants', '#7a6a48'], feet: ['leather_boots', '#6a5038'] },
  // Pemberton, the land agent, in a dark green coat and grey trousers: a man of business.
  land_agent: { head: ['head_short'], chest: ['mage_vest_alt1', '#4a6a40'], hands: ['mage_sleeves_alt1', '#4a6a40'], legs: ['cloth_pants', '#6a6a70'], feet: ['leather_boots', '#3a3430'] },
  // Gullhaven's harbourmaster in a navy coat and cap; the castaway on Wrecker's Isle in sun-faded rags.
  harbourmaster: { head: ['leather_hood', '#34466a'], chest: ['leather_chest', '#3a5480'], hands: ['default_hands'], legs: ['cloth_pants', '#e0d8c4'], feet: ['leather_boots', '#3a3430'] },
  castaway: { head: ['head_short'], chest: ['cloth_shirt', '#e0d0a8'], hands: ['default_hands'], legs: ['cloth_pants', '#9a8a68'], feet: ['cloth_sandals'] },
};
/** Villagers' shirts and trousers, so no two neighbours look alike (the game varies them by id). */
const VILLAGER_CLOTHES: [string, string][] = [
  ['#b8d0ff', '#a08060'], ['#ffc890', '#707890'], ['#c8f0a8', '#8a6a4a'], ['#f0b0b0', '#606870'], ['#fff0c0', '#8a8a6a'],
];
/** Town guards: heroes in steel plate with a longsword (the game's GUARD_LOOK). */
const GUARD: Record<string, Layer> = {
  head: { sheet: 'hero/plate_helm' }, chest: { sheet: 'hero/plate_cuirass' }, hands: { sheet: 'hero/plate_gauntlets' },
  legs: { sheet: 'hero/plate_greaves' }, feet: { sheet: 'hero/plate_boots' }, main: { sheet: 'hero/longsword' },
};

/** A townsperson's layers: their work clothes (villagers vary, here by where they stand). */
function npcLayers(role: string, variant: number): Record<string, Layer> | null {
  const outfit = NPC_OUTFITS[role];
  if (!outfit) return null;
  const layers: Record<string, Layer> = Object.fromEntries(Object.entries(outfit).map(([slot, [name, tint]]) => [slot, { sheet: `hero/${name}`, tint }]));
  if (role === 'villager') {
    const [shirt, trousers] = VILLAGER_CLOTHES[variant % VILLAGER_CLOTHES.length];
    layers.chest.tint = shirt;
    layers.legs.tint = trousers;
    if (variant % 2) layers.head = { sheet: 'hero/head_bald' };
  }
  return layers;
}

/** Flare's eight facings as map steps: SW, W, NW, N, NE, E, SE, S. */
const FACINGS = [[-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1]];
/** The facing the game turns everyone to by default (south-east, towards the camera). */
const FACING_SE = 6;

/** A frame tinted like Phaser's setTint (multiplied), cached. */
const tinted = new Map<string, HTMLCanvasElement>();
function tintedFrame(img: HTMLImageElement, f: Frame, tint: string): HTMLCanvasElement {
  const key = `${img.src}|${f.join(',')}|${tint}`;
  let c = tinted.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = f[3];
  c.height = f[4];
  const x = c.getContext('2d')!;
  x.drawImage(img, f[1], f[2], f[3], f[4], 0, 0, f[3], f[4]);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = tint;
  x.fillRect(0, 0, f[3], f[4]);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(img, f[1], f[2], f[3], f[4], 0, 0, f[3], f[4]);
  tinted.set(key, c);
  return c;
}

/** Below this many pixels a tile, characters are specks: they're left out (and their art isn't loaded). */
const CHARACTER_MIN_TILE_PX = 20;

/**
 * Draw the map with the game's art at `s` pixels per render unit. Returns false (and draws
 * nothing) when the art isn't loaded or the map isn't an isometric game map. With `cells` (in
 * paint order), only those are drawn (a big overworld is drawn just around what's on screen, as
 * the game draws it a chunk at a time). `stamp` names the map's state, so the guards' posts
 * worked out for it can be kept.
 */
export function drawGameArt(ctx: CanvasRenderingContext2D, map: WorldMap, s: number, cells: number[] | null = null, stamp?: number): boolean {
  const art = loaded;
  if (!art || map.grid !== 'iso') return false;
  const g = new Grid(map.grid, map.width, map.height);
  const L = map.layers;
  const w = map.width;
  // Frames are drawn for 96-pixel-wide tiles; an iso cell here is 2 units wide.
  const k = (2 * s) / 96;
  const kind = gameKind(map);
  const home = kind === 'overworld' ? 'world' : 'dungeon';
  /** Draws a frame of a sheet with its anchor on point (cx, cy) in render units. */
  const drawAt = (sheetName: string, frame: string, cx: number, cy: number, opts: { tint?: string; scale?: number } = {}) => {
    const f = art.sheets[sheetName]?.frames[frame];
    const img = f && art.images[sheetName]?.[f[0]];
    if (!f || !img) return;
    const z = k * (opts.scale ?? 1);
    const x = cx * s - f[5] * z;
    const y = cy * s - f[6] * z;
    if (opts.tint) ctx.drawImage(tintedFrame(img, f, opts.tint), x, y, f[3] * z, f[4] * z);
    else ctx.drawImage(img, f[1], f[2], f[3], f[4], x, y, f[3] * z, f[4] * z);
  };
  const putFrom = (sheetName: string, frame: string, i: number, opts?: { tint?: string; scale?: number }) => {
    const [cx, cy] = g.center(i);
    drawAt(sheetName, frame, cx, cy, opts);
  };
  const put = (frame: string, i: number, opts?: { tint?: string }) => putFrom(home, frame, i, opts);
  /** Object o's plain symbol on cell i, for when the game server has no art for it. */
  const symbol = (o: number, i: number) => {
    const [cx, cy] = g.center(i);
    drawObject(ctx, o, cx * s, cy * s, s * 0.5);
  };
  /** A frame of a sheet on cell i, or object o's plain symbol when an older game server hasn't that art, so it doesn't vanish. */
  const putOr = (sheetName: string, frame: string, o: number, i: number) => {
    if (art.sheets[sheetName]?.frames[frame] && art.images[sheetName]) putFrom(sheetName, frame, i);
    else symbol(o, i);
  };
  /** A thing from the streets (or an altar, or a waystone), from the world sheet. */
  const putDecor = (o: number, i: number) => putOr('world', DECOR_ART[o]!, o, i);
  /**
   * A station, workbench or piece of furniture from the indoor sheet; its plain symbol when the
   * game server's indoor sheet hasn't that frame yet (Farming's spinning wheel and millstones),
   * and nothing on an older server with no indoor sheet at all.
   */
  const putIndoor = (o: number, i: number) => {
    if (art.images.indoor && !art.sheets.indoor?.frames[INDOOR_ART[o]!]) symbol(o, i);
    else putFrom('indoor', INDOOR_ART[o]!, i);
  };
  /** An ore rock (limestone too), from the world sheet wherever it is; its plain symbol until the game server has its art. */
  const putOre = (o: number, i: number) => putOr('world', ORE_ART[o]!, o, i);
  /** A Farming patch, flat on the ground, from the world sheet; its plain symbol (a tilled bed) until the game server has the art. */
  const putPatch = (i: number) => putOr('world', PATCH_ART[L.object[i]]!, L.object[i], i);
  /** A gate, lever or locked door, from the dungeon sheet (in dungeons of any look, and insides). */
  const putPuzzle = (i: number) => putOr('dungeon', puzzleFrame(map, i % w, Math.floor(i / w))!, L.object[i], i);
  /**
   * A palm, wreck or boat, from the world sheet (wherever it stands); its plain symbol until the
   * game server has the art for it.
   */
  const putSea = (i: number) => {
    const what = SEA_ART[L.object[i]]!;
    putOr('world', seaFrame(map, i % w, Math.floor(i / w), art.sheets.world?.counts?.[what] ?? 1)!, L.object[i], i);
  };
  const count = (sheetName: string, what: string) => art.sheets[sheetName]?.counts?.[what] ?? 1;
  const variant = (what: string, x: number, y: number, salt = 0, sheetName = home) => `${what}/${Math.floor(tileHash(x, y, salt) * count(sheetName, what))}`;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < map.height ? y * w + x : -1);
  const order = cells ?? paintOrder(g);
  const characters = s * 2 >= CHARACTER_MIN_TILE_PX ? charactersOf(map, stamp) : new Map<number, Character>();
  /** The monster, townsperson or guard standing on cell i, if any, in the game's clothes and pose. */
  const drawCharacter = (i: number) => {
    const c = characters.get(i);
    if (!c) return;
    const [cx, cy] = g.center(i);
    const slots = c.hero ? art.layerOrder[c.dir] ?? Object.keys(c.layers) : Object.keys(c.layers);
    ctx.save();
    ctx.globalAlpha = c.alpha;
    for (const slot of slots) {
      const layer = c.layers[slot];
      const page = layer && framePage(layer.sheet, `stance/${c.dir}/0`);
      if (!page) continue;
      const { f, img } = page;
      const x = cx * s - f[5] * k;
      const y = cy * s - f[6] * k;
      if (layer.tint) ctx.drawImage(tintedFrame(img, f, layer.tint), x, y, f[3] * k, f[4] * k);
      else ctx.drawImage(img, f[1], f[2], f[3], f[4], x, y, f[3] * k, f[4] * k);
    }
    ctx.restore();
  };

  // The caverns: rock walls, lava, embers and mine clutter; the Frozen Peaks: the same in ice
  // (client/src/scenes/WorldScene.ts drawCave). Until its sheet is in, a floor looks like the crypt.
  const cave = caveTheme(map);
  if (cave && haveSheet(cave)) {
    drawCave(cave);
    return true;
  }

  if (kind !== 'overworld') {
    const inside = kind === 'interior';
    // Indoors, doors and bookshelves stand in the line of the walls.
    const isWall = (x: number, y: number) => {
      const i = at(x, y);
      return i < 0 || L.terrain[i] === T.CRYPT_WALL || (inside && (L.object[i] === O.DOOR || L.object[i] === O.BOOKSHELF));
    };
    const lights = new Set(map.features.filter((f) => f.type === 'brazier').map((f) => f.r * w + f.c));
    const pieces = new Map<number, string>();
    const anyPlanks = L.terrain.includes(T.PLANKS);
    // The sewers: damp, mossy stone, with drains in the walls.
    const sewer = !inside && dungeonTheme(map) === 'sewer';
    const damp = sewer ? { tint: SEWER_TINT } : undefined;
    const floor = (i: number, x: number, y: number) => {
      if (!inside) {
        put(tileHash(x, y, 2) < 0.2 ? variant('cobble', x, y) : variant('floor', x, y), i, damp);
        if (sewer && L.terrain[i] === T.CRYPT_FLOOR && !pieces.has(i) && tileHash(x, y, 11) < 0.14) put(variant('moss', x, y, 12), i);
        return;
      }
      // Bare earth (the Duel Arena's pits), from outdoors; under fences too.
      if (L.terrain[i] === T.PATH || L.object[i] === O.FENCE) {
        putFrom('world', variant('path', x, y, 0, 'world'), i);
        return;
      }
      const near = [at(x - 1, y), at(x, y - 1), at(x + 1, y), at(x, y + 1)].map((n) => (n < 0 ? -1 : L.terrain[n]));
      const t = L.terrain[i];
      const kindOf = t === T.PLANKS ? 'planks' : t === T.TOWN_FLOOR ? 'stone' : near.includes(T.PLANKS) || anyPlanks ? 'planks' : 'stone';
      putFrom('indoor', `${kindOf}/${Math.floor(tileHash(x, y, 2) * 4)}`, i);
    };
    // Ground: floor everywhere players can see, including under the walls that face a room.
    for (const i of order) {
      const x = i % w;
      const y = Math.floor(i / w);
      const wall = isWall(x, y) && L.object[i] !== O.DOOR;
      if (wall) {
        const piece = wallPiece((dx, dy) => !isWall(x + dx, y + dy));
        if (!piece) continue;
        pieces.set(i, piece);
      }
      if (!wall && L.terrain[i] === T.WATER) {
        // Sewer water, with scum where it meets the walkway.
        put(variant('muck', x, y), i);
        EDGE_NEIGHBOURS.forEach(([dx, dy], e) => {
          const n = at(x + dx, y + dy);
          if (n >= 0 && L.terrain[n] !== T.WATER && L.terrain[n] !== T.CRYPT_WALL) put(`muck-edge/${e}`, i);
        });
        continue;
      }
      floor(i, x, y);
      if (L.object[i] === O.STAIRS_DOWN) put('stairs-down', i);
      else if (L.object[i] === O.DOOR) putFrom('indoor', 'doormat', i);
      else if (PATCH_ART[L.object[i]]) putPatch(i);
      else if (!inside && !pieces.has(i) && !L.object[i] && !lights.has(i) && tileHash(x, y, 6) < 0.035) put(variant('bones', x, y, 7), i);
    }
    for (const i of order) {
      const x = i % w;
      const y = Math.floor(i / w);
      const piece = pieces.get(i);
      if (piece) {
        const face = piece === 'e' || piece === 's';
        if (face && L.object[i] === O.BOOKSHELF) putFrom('indoor', `wall-${piece}-books`, i);
        else if (face && inside && tileHash(x, y, 4) < 0.2) putFrom('indoor', `wall-${piece}-hanging`, i);
        else {
          put(variant(face && !inside && !sewer && tileHash(x, y, 4) < 0.12 ? `wall-${piece}-deco` : `wall-${piece}`, x, y, 5), i, damp);
          if (sewer && face && tileHash(x, y, 13) < 0.2) put(`drain-${piece}`, i);
        }
      } else if (L.object[i] === O.FENCE) {
        const fenced = (fx: number, fy: number) => at(fx, fy) >= 0 && L.object[at(fx, fy)] === O.FENCE;
        if (fenced(x, y - 1)) putFrom('world', 'fence-n', i);
        if (fenced(x - 1, y)) putFrom('world', 'fence-w', i);
        if (!fenced(x, y - 1) && !fenced(x - 1, y)) putFrom('world', 'fence-post', i);
      } else if (L.object[i] === O.CACHE) {
        // A cache's cairn of stones, from the dungeon sheet (insides too).
        putOr(home, 'cairn', O.CACHE, i);
      } else if (PUZZLES.has(L.object[i])) {
        putPuzzle(i);
      } else if (SEA_ART[L.object[i]]) {
        putSea(i);
      } else if (DECOR_ART[L.object[i]]) {
        putDecor(L.object[i], i);
      } else if (ORE_ART[L.object[i]]) {
        putOre(L.object[i], i);
      } else if (L.object[i] !== O.DOOR && INDOOR_ART[L.object[i]]) {
        putIndoor(L.object[i], i);
      }
      if (L.object[i] === O.STAIRS_UP) put('stairs-up', i);
      if (lights.has(i)) put('brazier', i);
      drawCharacter(i);
    }
    return true;
  }

  const groundAt = (x: number, y: number): Ground | null => {
    const i = at(x, y);
    return i < 0 ? null : GROUND_OF[L.terrain[i]] ?? 'grass';
  };
  /** Whether the art has something (an older game server has none of the new lands' art). */
  const has = (what: string) => !!(art.sheets[home]?.counts?.[what] || art.sheets[home]?.frames[`${what}/0`]);
  const either = (what: string, instead: string) => (has(what) ? what : instead);
  // Houses are drawn when the loop reaches their front corner, with their doors over them.
  const houses = new Map<number, GameBuilding>();
  for (const b of buildings(map)) {
    const corner = at(Math.min(w - 1, b.x + b.w - 1), Math.min(map.height - 1, b.y + b.h - 1));
    if (corner >= 0) houses.set(corner, b);
  }
  const inHouse = (x: number, y: number) => [...houses.values()].find((b) => x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h);
  const walls = buildingMask(map);
  // With tiles only a few pixels wide (a big map zoomed right out), edges and wild plants don't show.
  const detail = 2 * s >= 10;
  /** Wild plants on open ground and lily pads on the bog, just for looks, as the game scatters them. */
  const scenery = (i: number, x: number, y: number, ground: Ground) => {
    const sc = SCENERY[ground];
    const t = L.terrain[i];
    if (!detail || !sc || L.object[i] || walls[i] || !(OPEN_GROUND.has(t) || t === T.WATER || t === T.BOG) || tileHash(x, y, 9) >= sc.share || !has(sc.frame)) return null;
    return { frame: `${sc.frame}/${Math.floor(tileHash(x, y, 10) * (sc.only ?? count(home, sc.frame)))}`, flat: !!sc.flat };
  };
  for (const i of order) {
    const x = i % w;
    const y = Math.floor(i / w);
    const ground = groundAt(x, y)!;
    put(variant(either(ground, wet(ground) ? 'water' : 'grass'), x, y), i);
    // Soft edges where grounds meet: foam on lake shores (murky on bogs), and grass over paths, snow
    // over grass and so on (see EDGE_RANK).
    if (detail) EDGE_NEIGHBOURS.forEach(([dx, dy], e) => {
      const n = groundAt(x + dx, y + dy);
      if (!n) return;
      if (wet(ground)) {
        if (!wet(n)) put(`${ground === 'bog' ? either('bogshore', 'shore') : 'shore'}/${e}`, i);
      } else if (EDGE_ART[n] && (EDGE_RANK[n] ?? 0) > (EDGE_RANK[ground] ?? 0)) {
        put(`${EDGE_ART[n]}/${e}`, i);
      }
    });
    if (L.object[i] === O.CRYPT_ENTRANCE) put('entrance', i);
    if (L.object[i] === O.SEWER_GRATE) put('sewer-grate', i);
    if (FISHING.has(L.object[i])) fishRing(ctx, g, i, s);
    // Farming's patches lie flat on the ground, like the entrance and the grate.
    if (PATCH_ART[L.object[i]]) putPatch(i);
    const plant = scenery(i, x, y, ground);
    if (plant?.flat) put(plant.frame, i);
  }
  const fence = (x: number, y: number) => at(x, y) >= 0 && L.object[at(x, y)] === O.FENCE;
  // Guild forts: the game draws a banner on the fort's tile and a chest just east of it.
  const banners = new Set<number>();
  const chests = new Set<number>();
  for (const f of map.features) {
    if (f.type !== 'fort') continue;
    banners.add(at(f.c, f.r));
    const c = fortChest(f.c, f.r);
    chests.add(at(c.x, c.y));
  }
  // Plots of land: the game draws a signpost in the middle of each one's south edge (its outline
  // on the ground is drawn over the map, with the places).
  const signs = new Set<number>();
  for (const p of plots(map)) {
    if (!plotSizeOk(p.size)) continue;
    const sign = plotSign(p);
    signs.add(at(sign.x, sign.y));
  }
  for (const i of order) {
    const x = i % w;
    const y = Math.floor(i / w);
    const o = L.object[i];
    // Trees and boulders on snow are snowy pines (and yews) and snowy rocks.
    const snow = L.terrain[i] === T.SNOW;
    if (TREES[o]) put(variant(snow ? either(o === O.YEW ? 'snowyew' : 'snowtree', TREES[o]!) : either(TREES[o]!, 'tree'), x, y, 3), i);
    else if (o === O.BOULDER) put(variant(snow ? either('snowrock', 'rock') : 'rock', x, y), i);
    else if (o === O.CACTUS) put(variant(either('cactus', 'rock'), x, y), i);
    else if (o === O.DEAD_TREE) put(variant(either('deadtree', 'tree'), x, y), i);
    // Wrecker's Isle's palms and wrecks, and the ferry's boat (along its jetty).
    else if (SEA_ART[o]) putSea(i);
    else if (o === O.THICKET) drawThicket(i, x, y, snow);
    else if (o === O.CACHE) putOr('world', 'cairn', o, i);
    else if (o === O.RUIN) drawRuin(i, x, y);
    // The game draws no gates, levers or locked doors on the overworld: their plain symbol shows they're there.
    else if (PUZZLES.has(o)) symbol(o, i);
    else if (HERB_ART[o]) putFrom('world', HERB_ART[o]!.frame, i, { tint: HERB_ART[o]!.tint, scale: 1.3 });
    else if (DECOR_ART[o]) putDecor(o, i);
    else if (o === O.DOOR) {
      if (!inHouse(x, y)) put('door-timber-s', i);
    } else if (ORE_ART[o]) putOre(o, i);
    else if (o !== O.SEWER_GRATE && ART_FOR[o]) put(ART_FOR[o]!, i);
    else if (INDOOR_ART[o]) putIndoor(o, i);
    else if (o === O.FENCE) {
      if (fence(x, y - 1)) put('fence-n', i);
      if (fence(x - 1, y)) put('fence-w', i);
      if (!fence(x, y - 1) && !fence(x - 1, y)) put('fence-post', i);
    } else if (!o) {
      const plant = scenery(i, x, y, groundAt(x, y)!);
      if (plant && !plant.flat) put(plant.frame, i);
    }
    if (chests.has(i)) put('bank', i, { tint: '#ffd27a' });
    if (banners.has(i)) drawBanner(i);
    if (signs.has(i)) put('signpost', i);
    drawCharacter(i);
    const b = houses.get(i);
    if (b) drawHouse(b);
  }
  return true;

  /**
   * A thicket, as the game draws it: as the first tree beside it (west, north, east, south; a pine
   * if none), a shade darker, snowy on snow. Here it's marked with a dashed ring round its foot too,
   * so it can be told from the trees: it can be walked through.
   */
  function drawThicket(i: number, x: number, y: number, snow: boolean) {
    const tree = thicketLooksLike(map, x, y);
    const frame = snow ? either(tree === O.YEW ? 'snowyew' : 'snowtree', TREES[tree]!) : either(TREES[tree]!, 'tree');
    put(variant(frame, x, y, 3), i, { tint: THICKET_TINT });
    thicketRing(ctx, g, i, s);
  }

  /**
   * Ruined walls, joined up like the fence (the game's drawRuin): towards a ruin to the north and
   * one to the west, or a lone pillar; three of each, picked by tile. The plain symbol on an older
   * game server without their art.
   */
  function drawRuin(i: number, x: number, y: number) {
    if (!art!.sheets.world?.frames['ruin-post/0']) return symbol(O.RUIN, i);
    const salt = { 'ruin-n': 14, 'ruin-w': 15, 'ruin-post': 16 };
    for (const piece of ruinPieces(map, x, y)) putFrom('world', variant(piece, x, y, salt[piece], 'world'), i);
  }

  /** A fort's banner, as the game draws it before any guild holds the fort: a pole and a grey pennant. */
  function drawBanner(i: number) {
    const [cx, cy] = g.center(i);
    const px = (n: number) => n * k;
    const x0 = cx * s;
    const y0 = cy * s;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x0, y0, px(9), px(4), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a4128';
    ctx.fillRect(x0 - px(2), y0 - px(76), px(4), px(76));
    ctx.fillStyle = '#9a9a92';
    ctx.beginPath();
    ctx.moveTo(x0 + px(2), y0 - px(72));
    ctx.lineTo(x0 + px(34), y0 - px(62));
    ctx.lineTo(x0 + px(2), y0 - px(50));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * A cave floor: Flare's rock walls (low ledges where a wall has floor north or west of it too,
   * nothing on a chamber's near side), dirt floors with rubble, bones and glowing cracks, mine
   * clutter along the walls, and lava (the map's water) with a crust along its edges. The Frozen
   * Peaks (`frost`) are drawn the same way from their own sheet: ice walls, snow with patches of
   * glassy ice, frozen clutter along the walls and thin ice for water, with no cracks or bones.
   */
  function drawCave(theme: 'cave' | 'frost') {
    const frost = theme === 'frost';
    const isWall = (x: number, y: number) => {
      const i = at(x, y);
      return i < 0 || L.terrain[i] === T.CRYPT_WALL;
    };
    const open = (x: number, y: number) => at(x, y) >= 0 && !isWall(x, y);
    const isLava = (x: number, y: number) => at(x, y) >= 0 && L.terrain[at(x, y)] === T.WATER;
    const lights = new Set(map.features.filter((f) => f.type === 'brazier').map((f) => f.r * w + f.c));
    const caveFrames = art!.sheets[theme].frames;
    const pick = (what: string, x: number, y: number, salt: number) => variant(what, x, y, salt, theme);
    const ground = (i: number, x: number, y: number, water: boolean) => {
      const { what, salt } = caveGround(theme, water, x, y);
      putFrom(theme, pick(what, x, y, salt), i);
    };
    const pieces = new Map<number, string>();
    // Ground: floors (under walls that are drawn too), lava or thin ice, cracks and bones.
    for (const i of order) {
      const x = i % w;
      const y = Math.floor(i / w);
      if (isWall(x, y)) {
        const piece = wallPiece((dx, dy) => open(x + dx, y + dy));
        if (!piece || !caveFrames[`wall-${piece}/0`]) continue;
        pieces.set(i, piece);
        putFrom(theme, pick('floor', x, y, 2), i);
        continue;
      }
      if (isLava(x, y)) {
        ground(i, x, y, true);
        if (!frost) {
          EDGE_NEIGHBOURS.forEach(([dx, dy], e) => {
            const n = at(x + dx, y + dy);
            if (n >= 0 && L.terrain[n] !== T.WATER && L.terrain[n] !== T.CRYPT_WALL) putFrom('cave', `lava-edge/${e}`, i);
          });
        }
        continue;
      }
      ground(i, x, y, false);
      if (L.object[i] === O.STAIRS_DOWN) put('stairs-down', i);
      else if (!frost && !L.object[i] && L.terrain[i] === T.CRYPT_FLOOR && !lights.has(i)) {
        if (tileHash(x, y, 11) < 0.1) putFrom('cave', pick('embers', x, y, 12), i);
        if (tileHash(x, y, 6) > 0.97) putFrom('cave', pick('bones', x, y, 8), i);
      }
    }
    // Standing things, back to front: walls, clutter, stairs up, gates, levers, doors and braziers.
    for (const i of order) {
      const x = i % w;
      const y = Math.floor(i / w);
      const piece = pieces.get(i);
      if (piece) {
        const kind = open(x, y - 1) || open(x - 1, y) ? 'ledge' : 'wall';
        putFrom(theme, pick(`${kind}-${piece}`, x, y, 5), i);
        continue;
      }
      if (!L.object[i] && L.terrain[i] === T.CRYPT_FLOOR && !lights.has(i)) {
        const byWall = EDGE_NEIGHBOURS.some(([dx, dy]) => isWall(x + dx, y + dy));
        if (byWall && tileHash(x, y, 6) < 0.22) putFrom(theme, pick('prop', x, y, 7), i);
      }
      if (L.object[i] === O.STAIRS_UP) put('stairs-up', i);
      if (PUZZLES.has(L.object[i])) putPuzzle(i);
      // A cache's cairn of stones, from the theme's sheet.
      if (L.object[i] === O.CACHE) putOr(theme, 'cairn', O.CACHE, i);
      if (lights.has(i)) put('brazier', i);
      drawCharacter(i);
    }
  }

  function drawHouse(b: GameBuilding) {
    const sheet = `house/${b.style}-${b.w}x${b.h}`;
    if (haveSheet(sheet)) {
      const [ax, ay] = g.center(b.y * w + b.x);
      const [bx, by] = g.center((b.y + b.h - 1) * w + b.x + b.w - 1);
      const cx = (ax + bx) / 2;
      const cy = (ay + by) / 2;
      drawAt(sheet, 'house', cx, cy);
      // Its colours: the walls and the roof drawn again over it, tinted.
      const walls = WALL_COLOURS.find((c) => c.value === b.walls)?.hex;
      const roof = ROOF_COLOURS.find((c) => c.value === b.roof)?.hex;
      if (walls) drawAt(sheet, 'walls', cx, cy, { tint: walls });
      if (roof) drawAt(sheet, 'roof', cx, cy, { tint: roof });
    }
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const i = at(x, y);
        if (i < 0 || L.object[i] !== O.DOOR) continue;
        put(`door-${b.style}-${doorFace(b, x, y) ?? 's'}`, i);
      }
    }
    if (isWindmill(b)) drawSails(b);
  }

  /**
   * A windmill's four sails, flat on its east wall about three quarters of the way up, as the game
   * draws them (its drawSails), at the angle they start at in the game (they turn there).
   */
  function drawSails(b: GameBuilding) {
    // Game pixels (64 to a tile's width) to ours, and the height of a unit up (Flare's camera looks down 30°).
    const px = s / 32;
    const up = ((32 / Math.SQRT1_2) * Math.cos(Math.PI / 6)) / 32;
    const X = b.x + b.w - 0.5 + 0.12;
    const Y = b.y + (b.h - 1) / 2;
    const Z = b.w * 0.78;
    const R = b.w * 0.75;
    const W = R * 0.27;
    const angle = (b.x * 7 + b.y) % 6;
    /** A point on the sails: `u` along the wall (northwards), `v` up. */
    const pt = (u: number, v: number): [number, number] => {
      const [cx, cy] = g.centerCR(X, Y - u);
      return [cx * s, (cy - (Z + v) * up) * s];
    };
    ctx.save();
    const line = (a: [number, number], b2: [number, number]) => {
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b2[0], b2[1]);
    };
    for (let q = 0; q < 4; q++) {
      const a = angle + (q * Math.PI) / 2;
      const [dx, dy, nx, ny] = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)];
      const p = (r: number, wd: number) => pt(dx * r + nx * wd, dy * r + ny * wd);
      // The canvas on its lattice, then the spar down the middle.
      const corners = [p(R * 0.25, 0), p(R, 0), p(R, W), p(R * 0.25, W)];
      ctx.fillStyle = 'rgba(232,220,192,0.95)';
      ctx.beginPath();
      corners.forEach(([cx, cy], n) => (n ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy)));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,65,40,0.9)';
      ctx.lineWidth = Math.max(0.5, px);
      ctx.beginPath();
      for (const r of [0.25, 0.44, 0.62, 0.81, 1]) line(p(R * r, 0), p(R * r, W));
      line(p(R * 0.25, W), p(R, W));
      ctx.stroke();
      ctx.strokeStyle = '#4a3420';
      ctx.lineWidth = Math.max(1, 2 * px);
      ctx.beginPath();
      line(p(0, 0), p(R * 1.04, 0));
      ctx.stroke();
    }
    const [hx, hy] = pt(0, 0);
    ctx.fillStyle = '#3a2a1a';
    ctx.beginPath();
    ctx.arc(hx, hy, Math.max(1, 3 * px), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Someone standing on a tile: a monster (one sheet) or a hero (body parts in Flare's order for the way they face). */
interface Character {
  layers: Record<string, Layer>;
  hero: boolean;
  dir: number;
  alpha: number;
}

/**
 * Who stands where on a map, as the game draws them: the first monster of each spawn (on the
 * spawn's tile) and each boss, townspeople in their work clothes (turned to the counter in front
 * of them), the travelling merchant, and the guards the game posts (at the town's gates, and
 * indoors with the mayor).
 */
function charactersOf(map: WorldMap, stamp?: number): Map<number, Character> {
  const out = new Map<number, Character>();
  const w = map.width;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < map.height;
  const hero = (layers: Record<string, Layer>, x: number, y: number, dir = FACING_SE) => {
    if (inside(x, y)) out.set(y * w + x, { layers, hero: true, dir, alpha: 1 });
  };
  for (const p of townGuards(map, stamp).posts) hero(GUARD, p.x, p.y);
  for (const f of map.features) {
    if (!inside(f.c, f.r)) continue;
    if (f.type === 'monster_spawn' || f.type === 'boss') {
      const kind = String(placeProps(f).kind);
      const [sheet, tint] = MONSTER_ART[kind] ?? [`mon/${kind}`, undefined];
      out.set(f.r * w + f.c, { layers: { body: { sheet, tint } }, hero: false, dir: FACING_SE, alpha: GHOSTLY.has(kind) ? 0.6 : 1 });
    } else if (f.type === 'npc' || f.type === 'merchant') {
      const role = f.type === 'merchant' ? 'merchant' : String(placeProps(f).role);
      const layers = npcLayers(role, Math.floor(tileHash(f.c, f.r, 21) * VILLAGER_CLOTHES.length));
      if (!layers) continue;
      // Shopkeepers and bankers face the counter in front of them.
      const counter = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].find(
        ([dx, dy]) => inside(f.c + dx, f.r + dy) && map.layers.object[(f.r + dy) * w + f.c + dx] === O.COUNTER,
      );
      hero(layers, f.c, f.r, counter ? FACINGS.findIndex(([dx, dy]) => dx === counter[0] && dy === counter[1]) : FACING_SE);
    }
  }
  return out;
}

const guardMemo = new WeakMap<WorldMap, { stamp: number; value: ReturnType<typeof guardPosts> }>();
/**
 * The guards the game posts on a map (at the town's gates on the overworld, with the mayor
 * indoors) and where criminals come back. Finding the gates means a look at every tile, so with
 * a `stamp` (the editor's count of changes) the answer is kept until the map changes.
 */
export function townGuards(map: WorldMap, stamp?: number): ReturnType<typeof guardPosts> {
  const kept = stamp === undefined ? undefined : guardMemo.get(map);
  if (kept && kept.stamp === stamp) return kept.value;
  const value = gameKind(map) === 'overworld' ? guardPosts(map) : { posts: houseGuards(map), outside: null };
  if (stamp !== undefined) guardMemo.set(map, { stamp, value });
  return value;
}

/** The map changed (to `to`) in a way that can't move the guards: keep the posts worked out at `from`. */
export function keepGuards(map: WorldMap, from: number, to: number): void {
  const kept = guardMemo.get(map);
  if (kept && kept.stamp === from) kept.stamp = to;
}

/** The average colour of a frame's solid pixels, as 0xRRGGBB (null if the art can't be read). */
const frameColours = new Map<string, number | null>();
function frameColour(sheetName: string, frame: string): number | null {
  const key = `${sheetName}|${frame}`;
  if (frameColours.has(key)) return frameColours.get(key)!;
  let out: number | null = null;
  const f = loaded?.sheets[sheetName]?.frames[frame];
  const img = f && loaded?.images[sheetName]?.[f[0]];
  if (f && img) {
    try {
      const c = document.createElement('canvas');
      c.width = 24;
      c.height = 24;
      const x = c.getContext('2d', { willReadFrequently: true })!;
      x.drawImage(img, f[1], f[2], f[3], f[4], 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let k = 0; k < d.length; k += 4) {
        if (d[k + 3] < 128) continue;
        r += d[k];
        g += d[k + 1];
        b += d[k + 2];
        n++;
      }
      if (n) out = (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
    } catch {
      out = null;
    }
  }
  frameColours.set(key, out);
  return out;
}

/**
 * Colours for a big map's overview (zoomed out) with the game's art on: each ground and tree the
 * average colour of its art, so the map keeps its look as you zoom out.
 */
export function gameArtColours(map: WorldMap): OverviewColours | null {
  if (!loaded || gameKind(map) !== 'overworld') return null;
  const home = 'world';
  const grounds = new Map<number, number | null>();
  const things = new Map<number, number | null>();
  const groundOf = (t: number) => {
    const ground = GROUND_OF[t] ?? (OPEN_GROUND.has(t) || t === T.GRASS ? 'grass' : null);
    return ground ? frameColour(home, `${ground}/0`) ?? frameColour(home, `${wet(ground) ? 'water' : 'grass'}/0`) : null;
  };
  const objectOf = (o: number, snow: boolean): number | null => {
    if (TREES[o]) return frameColour(home, `${snow ? (o === O.YEW ? 'snowyew' : 'snowtree') : TREES[o]}/0`) ?? frameColour(home, 'tree/0');
    // A thicket looks like the trees round it, a shade darker.
    if (o === O.THICKET) {
      const c = objectOf(O.TREE, snow);
      return c === null ? null : multiply(c, parseInt(THICKET_TINT.slice(1), 16));
    }
    if (o === O.RUIN) return frameColour(home, 'ruin-post/0');
    if (o === O.DEAD_TREE) return frameColour(home, 'deadtree/0');
    if (o === O.CACTUS) return frameColour(home, 'cactus/0');
    if (o === O.PALM || o === O.WRECK) return frameColour(home, `${SEA_ART[o]}/0`);
    if (o === O.BOAT) return frameColour(home, 'boat-x');
    // Farming's patches: their tilled soil (their plain colour until the game server has the art).
    if (PATCH_ART[o]) return frameColour(home, PATCH_ART[o]!);
    if (o === O.BOULDER) return frameColour(home, `${snow ? 'snowrock' : 'rock'}/0`);
    return null;
  };
  // Looked up once per kind of ground and object (a big map asks for each of its cells).
  const groundColour = (t: number) => {
    if (!grounds.has(t)) grounds.set(t, groundOf(t));
    return grounds.get(t)!;
  };
  return {
    ground: groundColour,
    object: (o, t) => {
      // A cache is a secret: like the game's minimap, the overview shows the ground under it.
      if (o === O.CACHE) return groundColour(t);
      const key = o * 2 + (t === T.SNOW ? 1 : 0);
      if (!things.has(key)) things.set(key, objectOf(o, t === T.SNOW));
      return things.get(key)!;
    },
  };
}

/** Two colours (0xRRGGBB) multiplied, as a tint is. */
function multiply(a: number, b: number): number {
  const ch = (shift: number) => Math.round((((a >> shift) & 255) * ((b >> shift) & 255)) / 255) << shift;
  return ch(16) | ch(8) | ch(0);
}

/** A thicket's mark, so it can be told from the trees it looks like: a dashed ring round its foot. */
function thicketRing(ctx: CanvasRenderingContext2D, g: Grid, i: number, s: number): void {
  const [cx, cy] = g.center(i);
  ctx.save();
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.setLineDash([s * 0.16, s * 0.11]);
  ctx.beginPath();
  ctx.ellipse(cx * s, cy * s, s * 0.6, s * 0.3, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(20,40,10,0.55)';
  ctx.stroke();
  ctx.lineWidth = Math.max(0.5, s * 0.035);
  ctx.strokeStyle = 'rgba(240,255,215,0.95)';
  ctx.stroke();
  ctx.restore();
}

/** The game draws fishing spots as a pale ring on the water. */
function fishRing(ctx: CanvasRenderingContext2D, g: Grid, i: number, s: number): void {
  const [cx, cy] = g.center(i);
  ctx.save();
  ctx.strokeStyle = 'rgba(235,248,255,0.85)';
  ctx.lineWidth = Math.max(1, s * 0.08);
  ctx.beginPath();
  ctx.ellipse(cx * s, cy * s, s * 0.55, s * 0.27, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Which wall piece fits a crypt wall cell, from where the floor is (client/src/walls.ts). */
function wallPiece(floor: (dx: number, dy: number) => boolean): string | null {
  const n = floor(0, -1);
  const e = floor(1, 0);
  const s = floor(0, 1);
  const w = floor(-1, 0);
  if (e && s) return 'es';
  if (n && e) return 'ne';
  if (s && w) return 'sw';
  if (n && w) return 'nw';
  if (e) return 'e';
  if (s) return 's';
  if (w) return 'w';
  if (n) return 'n';
  if (floor(1, 1)) return 'd-se';
  if (floor(1, -1)) return 'd-ne';
  if (floor(-1, 1)) return 'd-sw';
  if (floor(-1, -1)) return 'd-nw';
  return null;
}
