import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { O } from '../src/core/objects';
import { checkGameMaps } from '../src/core/rpgdc/checks';
import { toRpgdcMaps, type RpgdcMapsFile } from '../src/core/rpgdc/export';
import { createProject } from '../src/core/project';
import {
  buildingMask,
  buildings,
  dungeonTheme,
  gameKind,
  GROUND_LEGEND,
  GROUND_TILES,
  guardPosts,
  houseGuards,
  isGameGround,
  isWalkableAt,
  landmarkAt,
  landmarks,
  mapTheme,
  MONSTER_KINDS,
  normalRange,
  newPlaceProps,
  NPC_ROLES,
  OBJECT_LEGEND,
  reachable,
  withProp,
  ZONES,
} from '../src/core/rpgdc/game';
import { isWater, T } from '../src/core/tiles';
import { fromRpgdcMaps, isRpgdcMapsFile } from '../src/core/rpgdc/import';
import { emptyLayers, type Feature, type Project, type WorldMap } from '../src/core/types';
import { cacheFit, cacheRegion, MAX_CACHE_PIXELS } from '../src/ui/render';

/** The game's own map file (shared/maps/rpg-dc.maps.json in RPG-DC), with the town, its insides and the sewers. */
const FILE = readFileSync(new URL('./fixtures/rpg-dc.maps.json', import.meta.url), 'utf8');
const file = (): RpgdcMapsFile => JSON.parse(FILE);
const project = () => fromRpgdcMaps(file());
const byGameId = (p: Project, id: string) => Object.values(p.maps).find((m) => m.settings.rpgdcMapId === id)!;
const errors = (p: Project) => checkGameMaps(p).filter((i) => i.severity === 'error');

/** A map's cells as names (ground, object, zone), whatever the legend order. */
function decoded(m: RpgdcMapsFile['maps'][number]) {
  return {
    ground: m.ground.map((v) => m.groundLegend[v]),
    objects: m.objects.map((v) => m.objectLegend[v]),
    zones: m.zones?.map((v) => m.zoneLegend[v]) ?? null,
  };
}
const placeKey = (p: object) => JSON.stringify(Object.fromEntries(Object.entries(p).sort(([a], [b]) => a.localeCompare(b))));

describe('opening the game’s map file', () => {
  it('recognises it', () => {
    expect(isRpgdcMapsFile(file())).toBe(true);
    expect(isRpgdcMapsFile({ format: 'world-builder-project', maps: {} })).toBe(false);
  });

  it('makes a map per game map, with interiors and dungeons told apart', () => {
    const p = project();
    expect(Object.keys(p.maps).length).toBe(file().maps.length);
    expect(gameKind(byGameId(p, 'overworld'))).toBe('overworld');
    expect(gameKind(byGameId(p, 'crypt2'))).toBe('dungeon');
    expect(gameKind(byGameId(p, 'sewer1'))).toBe('dungeon');
    expect(gameKind(byGameId(p, 'bank'))).toBe('interior');
    expect(byGameId(p, 'bank').settings.rpgdcZone).toBe('safe');
    expect(byGameId(p, 'sewer1').settings.rpgdcZone).toBe('frontier');
    const bank = byGameId(p, 'bank');
    expect(bank.features.filter((f) => f.type === 'npc').map((f) => f.props?.role)).toEqual(['banker', 'banker']);
    const world = byGameId(p, 'overworld');
    expect(world.features.filter((f) => f.type === 'building').length).toBe(18);
  });

  it('passes every game check, with no warnings', () => {
    // The game's tool keeps quarry rocks 2 tiles clear of trees now, so the essence rock that stood
    // beside an oak has gone too.
    expect(checkGameMaps(project()).map((i) => i.message)).toEqual([]);
  });

  it('exports exactly what it opened', () => {
    const before = file();
    const after = toRpgdcMaps(project());
    expect(after.maps.map((m) => m.id).sort()).toEqual(before.maps.map((m) => m.id).sort());
    for (const m of before.maps) {
      const out = after.maps.find((o) => o.id === m.id)!;
      expect([out.name, out.kind, out.width, out.height, out.zone, out.theme]).toEqual([m.name, m.kind, m.width, m.height, m.zone, m.theme]);
      expect(decoded(out)).toEqual(decoded(m));
      expect(out.places.map(placeKey).sort()).toEqual(m.places.map(placeKey).sort());
    }
  });

  it('knows every object the game does, in the game’s order', () => {
    expect(OBJECT_LEGEND.slice(20)).toEqual([
      'herb_sunleaf', 'herb_silverweed', 'herb_thornberry', 'herb_nightshade', 'herb_emberbloom',
      'door', 'sewer_grate', 'alchemy_table', 'sewing_table', 'fletching_bench',
      'counter', 'bookshelf', 'table', 'bed', 'barrel', 'crate', 'lectern',
      'well', 'lamp_post', 'market_stall', 'flower_bed', 'bench', 'signpost', 'notice_board',
      'gold_rock', 'mithril_rock', 'adamant_rock', 'runite_rock',
      'essence_rock', 'air_altar', 'mind_altar', 'water_altar', 'earth_altar', 'fire_altar', 'chaos_altar', 'law_altar',
      'cactus', 'dead_tree', 'yew', 'fishing_eel', 'fishing_lobster', 'herb_duneflower', 'herb_bogmyrtle', 'herb_frostcap',
      'waystone',
    ]);
  });

  it('reads each building’s roof and wall colours, and the street decorations', () => {
    const world = byGameId(project(), 'overworld');
    const bank = buildings(world).find((b) => b.sign === 'Bank')!;
    expect([bank.roof, bank.walls]).toEqual(['slate', 'grey']);
    expect(world.layers.object.filter((o) => o === O.LAMP_POST).length).toBeGreaterThan(4);
    expect(world.layers.object.filter((o) => o === O.WELL).length).toBe(1);
    // Townspeople who just talk.
    const roles = Object.values(project().maps).flatMap((m) => m.features.filter((f) => f.type === 'npc').map((f) => f.props?.role));
    expect(roles).toEqual(expect.arrayContaining(['mayor', 'captain', 'villager', 'slayer']));
  });

  it('keeps the Slayer monsters’ lairs, with their counts and radii', () => {
    const p = project();
    const lairs = Object.values(p.maps).flatMap((m) => m.features.filter((f) => f.type === 'monster_spawn' && ['cave_crawler', 'banshee', 'basilisk', 'gargoyle'].includes(String(f.props?.kind))));
    expect(lairs.map((f) => f.props?.kind).sort()).toEqual(['banshee', 'basilisk', 'cave_crawler', 'gargoyle']);
    expect(lairs.find((f) => f.props?.kind === 'banshee')!.props).toMatchObject({ count: 3, radius: 3 });
    const out = toRpgdcMaps(p).maps.flatMap((m) => m.places).filter((pl) => pl.type === 'monster_spawn' && pl.kind === 'gargoyle');
    expect(out).toEqual([expect.objectContaining({ count: 4, radius: 4 })]);
    expect(errors(p)).toEqual([]);
  });

  it('keeps the Ember Caverns: cave floors with lava, their monsters and the Cinder Wyrm', () => {
    const p = project();
    for (const id of ['caves1', 'caves2', 'caves3']) {
      const m = byGameId(p, id);
      expect([gameKind(m), mapTheme(m), dungeonTheme(m)]).toEqual(['dungeon', 'cave', 'cave']);
    }
    expect([dungeonTheme(byGameId(p, 'crypt1')), dungeonTheme(byGameId(p, 'sewer1'))]).toEqual(['crypt', 'sewer']);
    expect(mapTheme(byGameId(p, 'crypt1'))).toBeUndefined();
    const kinds = new Set(['caves1', 'caves2', 'caves3'].flatMap((id) => byGameId(p, id).features.filter((f) => f.type === 'monster_spawn' || f.type === 'boss').map((f) => f.props?.kind)));
    expect([...kinds].sort()).toEqual(['cinder_wyrm', 'fire_ant', 'fire_wyvern', 'hobgoblin']);
    // The crypt and the sewers export no theme, as before.
    const out = toRpgdcMaps(p).maps;
    expect(out.find((m) => m.id === 'caves2')!.theme).toBe('cave');
    expect('theme' in out.find((m) => m.id === 'crypt1')!).toBe(false);
  });

  it('posts town guards where the game does, one at each gate, and one with the mayor', () => {
    // RPG-DC's server (World.placeGuards and placeHouseGuards), on this file: guards at these
    // tiles, criminals come back at (383, 361), and a guard stands two steps from the mayor in the
    // Town Hall.
    const { posts, outside } = guardPosts(byGameId(project(), 'overworld'));
    expect(posts.map((p) => [p.x, p.y])).toEqual([[383, 365], [365, 383], [403, 383], [383, 403]]);
    expect(outside).toEqual({ x: 383, y: 361 });
    expect(guardPosts(byGameId(project(), 'bank')).posts).toEqual([]);
    expect(houseGuards(byGameId(project(), 'town_hall'))).toEqual([{ x: 4, y: 1 }]);
    expect(houseGuards(byGameId(project(), 'bank'))).toEqual([]);
    expect(houseGuards(byGameId(project(), 'overworld'))).toEqual([]);
  });

  it('treats a building’s walls as blocked, except its door', () => {
    const world = byGameId(project(), 'overworld');
    const bank = world.features.find((f) => f.type === 'building' && f.props?.sign === 'Bank')!;
    expect(isWalkableAt(world, bank.c + 1, bank.r + 1)).toBe(false);
    expect(buildingMask(world)[bank.r * world.width + bank.c]).toBe(1);
    // Without the building, the same tile is open.
    world.features = world.features.filter((f) => f !== bank);
    expect(isWalkableAt(world, bank.c + 1, bank.r + 1)).toBe(true);
  });
});

describe('game checks for the town', () => {
  const edit = (fn: (p: Project) => void) => {
    const p = project();
    fn(p);
    return errors(p).map((i) => i.message);
  };
  const building = (m: WorldMap, sign: string) => m.features.find((f) => f.type === 'building' && f.props?.sign === sign)!;

  it('catches a building without a door, or with one the camera can’t see', () => {
    expect(edit((p) => {
      const w = byGameId(p, 'overworld');
      const b = building(w, 'Bank');
      for (let i = 0; i < w.layers.object.length; i++) if (w.layers.object[i] === O.DOOR && Math.floor(i / w.width) === b.r + 4) w.layers.object[i] = 0;
    }).some((m) => /Bank \(375, 376\) has no door/.test(m))).toBe(true);
    expect(edit((p) => {
      const w = byGameId(p, 'overworld');
      const b = building(w, 'Bank');
      w.layers.object[b.r * w.width + b.c + 2] = O.DOOR;
    }).some((m) => /door at \(377, 376\) the camera can't see/.test(m))).toBe(true);
  });

  it('catches sizes there’s no art for', () => {
    expect(edit((p) => { building(byGameId(p, 'overworld'), 'Bank').props!.w = 9; }).some((m) => /buildings are 3 to 8 tiles a side/.test(m))).toBe(true);
    expect(edit((p) => { building(byGameId(p, 'overworld'), 'Mage Tower').props!.h = 4; }).some((m) => /towers are square/.test(m))).toBe(true);
  });

  it('catches a door that doesn’t lead back', () => {
    expect(edit((p) => {
      const bank = byGameId(p, 'bank');
      bank.features = bank.features.filter((f) => f.type !== 'link');
    }).some((m) => /leads into bank, but no door on bank leads back/.test(m))).toBe(true);
  });

  it('catches a townsperson nobody can reach', () => {
    expect(edit((p) => {
      // The counter in front of the bankers becomes a wall.
      const bank = byGameId(p, 'bank');
      for (let x = 1; x <= 9; x++) {
        const i = 2 * bank.width + x;
        bank.layers.object[i] = 0;
        bank.layers.terrain[i] = byGameId(p, 'bank').layers.terrain[0];
      }
    }).some((m) => /can't reach townsperson \(3, 1\)/.test(m))).toBe(true);
  });

  it('catches colours the game doesn’t have', () => {
    expect(edit((p) => { building(byGameId(p, 'overworld'), 'Bank').props!.roof = 'pink'; }).some((m) => /Bank \(375, 376\) has an unknown roof colour "pink"/.test(m))).toBe(true);
    expect(edit((p) => { building(byGameId(p, 'overworld'), 'Bank').props!.walls = 'plaid'; }).some((m) => /unknown wall colour "plaid"/.test(m))).toBe(true);
  });

  it('catches a look (theme) the game doesn’t have, or on a map that isn’t a dungeon floor', () => {
    expect(edit((p) => { byGameId(p, 'crypt2').settings.rpgdcTheme = 'swamp'; }).some((m) => /look \(theme\) "swamp" isn't one the game knows/.test(m))).toBe(true);
    expect(edit((p) => { byGameId(p, 'bank').settings.rpgdcTheme = 'cave'; }).some((m) => /Only dungeon floors have a look/.test(m))).toBe(true);
    expect(edit((p) => { byGameId(p, 'crypt2').settings.rpgdcTheme = 'cave'; })).toEqual([]);
  });

  it('warns when the town has no gate, so no guards', () => {
    const p = project();
    byGameId(p, 'overworld').layers.zone.fill(1);
    expect(checkGameMaps(p).some((i) => i.severity === 'warning' && /no gate/.test(i.message))).toBe(true);
  });

  it('catches insides and dungeon floors of the wrong size', () => {
    expect(edit((p) => {
      const m = byGameId(p, 'home1');
      m.width = 3;
    }).some((m) => /buildings' insides to be 4 to 32 tiles a side/.test(m))).toBe(true);
  });
});

describe('the rarer ores and Runecrafting', () => {
  const count = (m: WorldMap, id: number) => m.layers.object.filter((o) => o === id).length;
  const where = (m: WorldMap, id: number) => {
    const i = m.layers.object.indexOf(id);
    return { i, x: i % m.width, y: Math.floor(i / m.width) };
  };
  const issues = (fn: (p: Project) => void) => {
    const p = project();
    fn(p);
    return checkGameMaps(p);
  };
  const ALTARS = [O.AIR_ALTAR, O.MIND_ALTAR, O.WATER_ALTAR, O.EARTH_ALTAR, O.FIRE_ALTAR, O.CHAOS_ALTAR, O.LAW_ALTAR];

  it('opens the rocks and altars the game placed', () => {
    const p = project();
    const world = byGameId(p, 'overworld');
    expect(count(world, O.ESSENCE_ROCK)).toBe(4);
    for (const a of ALTARS) expect(count(world, a)).toBe(1);
    expect(count(world, O.RUNITE_ROCK)).toBe(10);
    expect(count(byGameId(p, 'caves1'), O.GOLD_ROCK)).toBe(4);
    expect(count(byGameId(p, 'caves2'), O.MITHRIL_ROCK)).toBe(4);
    expect(count(byGameId(p, 'caves3'), O.ADAMANT_ROCK)).toBe(3);
  });

  it('catches stairs hidden behind a wall', () => {
    const found = issues((p) => {
      const m = byGameId(p, 'crypt2');
      const link = m.features.find((f) => f.type === 'link')!;
      m.layers.terrain[(link.r + 1) * m.width + link.c + 1] = T.CRYPT_WALL;
    });
    expect(found.some((i) => i.severity === 'error' && /are hidden behind the wall/.test(i.message))).toBe(true);
  });

  it('warns about an altar in town or beside a tree, and runite outside the Deep', () => {
    const warnings = issues((p) => {
      const world = byGameId(p, 'overworld');
      const air = where(world, O.AIR_ALTAR);
      world.layers.zone[air.i] = ZONES.find((z) => z.key === 'safe')!.id;
      world.layers.object[(air.y + 2) * world.width + air.x] = O.TREE;
      world.layers.object[where(world, O.ESSENCE_ROCK).i] = O.RUNITE_ROCK;
    }).filter((i) => i.severity === 'warning').map((i) => i.message);
    expect(warnings.some((m) => /Altar: air .* is in the Safe zone/.test(m))).toBe(true);
    expect(warnings.some((m) => /Altar: air .* is within 2 tiles of a tree/.test(m))).toBe(true);
    expect(warnings.some((m) => /Runite rock .* is in the frontier zone; the game keeps runite in the Deep/.test(m))).toBe(true);
  });

  it('an altar nobody can reach is an error', () => {
    const found = issues((p) => {
      const world = byGameId(p, 'overworld');
      const law = where(world, O.LAW_ALTAR);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) world.layers.object[(law.y + dy) * world.width + law.x + dx] = O.BOULDER;
      }
    });
    expect(found.some((i) => i.severity === 'error' && /Altar: law .* has no walkable neighbour/.test(i.message))).toBe(true);
  });
});

describe('the Duel Arena, the guild fort and the travelling merchant', () => {
  const issues = (fn: (p: Project) => void) => {
    const p = project();
    fn(p);
    return checkGameMaps(p);
  };
  const fortOf = (m: WorldMap) => m.features.find((f) => f.type === 'fort')!;

  it('opens the forts and the merchant’s spot as places, and exports them as they were', () => {
    const world = byGameId(project(), 'overworld');
    const fort = fortOf(world);
    expect([fort.c, fort.r, fort.props?.id, fort.props?.name, fort.name]).toEqual([194, 574, 'deep_keep', 'the Deep Keep', 'the Deep Keep']);
    const merchant = world.features.find((f) => f.type === 'merchant')!;
    expect([merchant.c, merchant.r]).toEqual([392, 398]);
    const out = toRpgdcMaps(project()).maps.find((m) => m.id === 'overworld')!;
    expect(out.places.filter((p) => p.type === 'fort' || p.type === 'merchant')).toEqual([
      { type: 'fort', x: 194, y: 574, id: 'deep_keep', name: 'the Deep Keep' },
      { type: 'fort', x: 424, y: 122, id: 'frost_hold', name: 'the Frost Hold' },
      { type: 'fort', x: 643, y: 344, id: 'mire_keep', name: 'the Mire Keep' },
      { type: 'fort', x: 344, y: 646, id: 'dune_keep', name: 'the Dune Keep' },
      { type: 'merchant', x: 392, y: 398 },
    ]);
  });

  it('opens the arena with its pits, and the Guard House’s door to it', () => {
    const p = project();
    const arena = byGameId(p, 'arena');
    expect(gameKind(arena)).toBe('interior');
    expect(arena.layers.object.filter((o) => o === O.FENCE).length).toBeGreaterThan(60);
    const house = byGameId(p, 'guard_house');
    expect(house.features.some((f) => f.type === 'link' && f.props?.toMap === 'arena')).toBe(true);
  });

  it('catches a fort outside the Deep, in a dungeon, or with a bad id; warns of a gap in its palisade', () => {
    const found = issues((p) => {
      const world = byGameId(p, 'overworld');
      const fort = fortOf(world);
      const spawn = world.features.find((f) => f.type === 'spawn_point')!;
      world.features.push({ ...fort, id: 'f-x', c: spawn.c, r: spawn.r + 3, props: { id: 'Bad Id', name: 'Town keep' } });
      // A gap in the real fort's palisade, on its north side away from the gate.
      world.layers.object[(fort.r - 5) * world.width + fort.c - 3] = 0;
      byGameId(p, 'crypt1').features.push({ id: 'f-y', type: 'fort', c: 5, r: 5, name: 'x', props: { id: 'crypt_keep', name: 'x' } });
    });
    const errs = found.filter((i) => i.severity === 'error').map((i) => i.message);
    expect(errs.some((m) => /The fort Town keep needs an id/.test(m))).toBe(true);
    expect(errs.some((m) => /The fort Town keep's yard .* isn't all in the Deep/.test(m))).toBe(true);
    expect(errs.some((m) => /The fort x isn't on the overworld/.test(m))).toBe(true);
    const warnings = found.filter((i) => i.severity === 'warning').map((i) => i.message);
    expect(warnings.some((m) => /The fort the Deep Keep's palisade has a gap at \(191, 569\)/.test(m))).toBe(true);
  });

  it('catches the merchant out of town, or two of her', () => {
    const errs = (fn: (world: WorldMap) => void) => issues((p) => fn(byGameId(p, 'overworld'))).filter((i) => i.severity === 'error').map((i) => i.message);
    // Out at a fort's banner: open ground, but in the Deep.
    expect(errs((w) => { const m = w.features.find((f) => f.type === 'merchant')!; Object.assign(m, { c: fortOf(w).c, r: fortOf(w).r }); }).some((m) => /isn't in the Safe zone/.test(m))).toBe(true);
    expect(errs((w) => { const m = w.features.find((f) => f.type === 'merchant')!; w.features.push({ ...m, id: 'f-z', c: m.c + 1 }); }).some((m) => /more than one spot for the travelling merchant/.test(m))).toBe(true);
  });

  it('warns when the arena has no pit', () => {
    const found = issues((p) => {
      const arena = byGameId(p, 'arena');
      arena.layers.object = arena.layers.object.map((o) => (o === O.FENCE ? 0 : o));
    });
    expect(found.some((i) => i.severity === 'warning' && /The Duel Arena has no pit/.test(i.message))).toBe(true);
  });
});

describe('the new lands: a 768-tile world, its grounds, objects, monsters and people', () => {
  const issues = (fn: (p: Project) => void) => {
    const p = project();
    fn(p);
    return checkGameMaps(p);
  };
  const count = (m: WorldMap, id: number) => m.layers.object.filter((o) => o === id).length;
  /** A bare overworld of n×m grass tiles: the town (Safe) round the spawn point, Frontier beyond. */
  const bareWorld = (w: number, h = w) => {
    const p = createProject('size');
    const L = emptyLayers(w * h);
    L.terrain.fill(T.GRASS);
    L.zone.fill(2);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) L.zone[y * w + x] = 1;
    const map: WorldMap = {
      id: 'ow', name: 'World', kind: 'overland', scaleId: 'local', grid: 'iso', width: w, height: h, seed: 1,
      settings: { rpgdcMapId: 'overworld' }, layers: L, children: [],
      features: [{ id: 's', type: 'spawn_point', c: 3, r: 3, name: 'start' }],
    };
    p.maps[map.id] = map;
    return { p, map };
  };

  it('opens the 768×768 overworld, a continent in the ocean, with every ground the game file uses', () => {
    const before = file().maps.find((m) => m.id === 'overworld')!;
    const world = byGameId(project(), 'overworld');
    expect([world.width, world.height]).toEqual([768, 768]);
    // About three fifths of it is land.
    const land = world.layers.terrain.filter((t) => t !== T.WATER).length / world.layers.terrain.length;
    expect(land).toBeGreaterThan(0.5);
    expect(land).toBeLessThan(0.7);
    const want = new Map<string, number>();
    for (const v of before.ground) want.set(before.groundLegend[v], (want.get(before.groundLegend[v]) ?? 0) + 1);
    for (const [name, n] of want) {
      const t = GROUND_TILES[GROUND_LEGEND.indexOf(name as (typeof GROUND_LEGEND)[number])];
      expect(world.layers.terrain.filter((x) => x === t).length, name).toBe(n);
    }
    expect([...want.keys()].sort()).toEqual(['bog', 'grass', 'ice', 'mud', 'path', 'sand', 'snow', 'stone', 'town_floor', 'water']);
  });

  it('takes any square overworld from 128 to 1024 tiles a side, as the game does', () => {
    const sizeErrors = (w: number, h = w) => checkGameMaps(bareWorld(w, h).p).filter((i) => i.severity === 'error').map((i) => i.message);
    for (const n of [128, 256, 512, 768, 1024]) expect(sizeErrors(n), `${n}`).toEqual([]);
    expect(sizeErrors(127)).toEqual(['The game needs the overworld to be square, 128 to 1024 tiles a side; this map is 127×127.']);
    expect(sizeErrors(1025)).toEqual(['The game needs the overworld to be square, 128 to 1024 tiles a side; this map is 1025×1025.']);
    expect(sizeErrors(768, 512)).toEqual(['The game needs the overworld to be square, 128 to 1024 tiles a side; this map is 768×512.']);
    expect(sizeErrors(1024, 1025)).toEqual(['The game needs the overworld to be square, 128 to 1024 tiles a side; this map is 1024×1025.']);
  });

  it('walks the new lands as the game does: bog is water, the rest is open ground', () => {
    expect(GROUND_LEGEND.slice(7)).toEqual(['sand', 'mud', 'bog', 'snow', 'stone', 'ice']);
    const { p, map } = bareWorld(128);
    const grounds = [T.SAND, T.MUD, T.BOG, T.SNOW, T.STONE, T.ICE];
    grounds.forEach((t, k) => (map.layers.terrain[20 * 128 + 20 + k] = t));
    expect(grounds.map((_, k) => isWalkableAt(map, 20 + k, 20))).toEqual([true, true, false, true, true, true]);
    expect(isWater(T.BOG)).toBe(true);
    expect(grounds.every(isGameGround)).toBe(true);
    // A monster in the bog is stuck; one on the sand is fine.
    map.features.push({ id: 'm1', type: 'monster_spawn', c: 22, r: 20, name: 'x', props: { kind: 'drowned', count: 1, radius: 7 } });
    map.features.push({ id: 'm2', type: 'monster_spawn', c: 20, r: 20, name: 'x', props: { kind: 'scarab', count: 1, radius: 7 } });
    const errs = checkGameMaps(p).filter((i) => i.severity === 'error').map((i) => i.message);
    expect(errs).toEqual(['Monster spawn (22, 20) is on a tile you can\'t walk on.']);
    // They export under the game's names and open again as the same ground, with no warnings.
    const out = toRpgdcMaps(p).maps[0];
    expect(grounds.map((_, k) => out.groundLegend[out.ground[20 * 128 + 20 + k]])).toEqual(['sand', 'mud', 'bog', 'snow', 'stone', 'ice']);
    const back = Object.values(fromRpgdcMaps(toRpgdcMaps(p)).maps)[0];
    expect(back.layers.terrain).toEqual(map.layers.terrain);
    expect(checkGameMaps(p).some((i) => /ground or objects the game doesn't have/.test(i.message))).toBe(false);
  });

  it('opens the new lands’ objects the game placed: yews, cacti, dead trees, eels and lobsters', () => {
    const world = byGameId(project(), 'overworld');
    expect([O.CACTUS, O.DEAD_TREE, O.YEW, O.FISHING_EEL, O.FISHING_LOBSTER].map((o) => count(world, o))).toEqual([881, 1775, 70, 30, 35]);
    // They stand in the way, like everything else.
    const yew = world.layers.object.indexOf(O.YEW);
    expect(isWalkableAt(world, yew % world.width, Math.floor(yew / world.width))).toBe(false);
    const out = toRpgdcMaps(project()).maps.find((m) => m.id === 'overworld')!;
    expect(out.objectLegend.slice(56)).toEqual(['cactus', 'dead_tree', 'yew', 'fishing_eel', 'fishing_lobster', 'herb_duneflower', 'herb_bogmyrtle', 'herb_frostcap', 'waystone']);
  });

  it('needs eel and lobster spots reachable, like every fishing spot', () => {
    const found = issues((p) => {
      const world = byGameId(p, 'overworld');
      const w = world.width;
      const eel = world.layers.object.indexOf(O.FISHING_EEL);
      const x = eel % w;
      const y = Math.floor(eel / w);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) world.layers.object[(y + dy) * w + x + dx] = O.BOULDER;
      }
    });
    expect(found.some((i) => i.severity === 'error' && /Fishing spot: eel .* has no walkable neighbour/.test(i.message))).toBe(true);
  });

  it('warns about the new herbs off their own ground or in town, and hidden by a yew', () => {
    const warnings = issues((p) => {
      const world = byGameId(p, 'overworld');
      const spawn = world.features.find((f) => f.type === 'spawn_point')!;
      // A duneflower on the town's cobbles; a frostcap on open snow out of town, with a yew beside it.
      world.layers.object[(spawn.r + 1) * world.width + spawn.c + 1] = O.HERB_DUNEFLOWER;
      const reached = reachable(world, [{ x: spawn.c, y: spawn.r }]);
      const snow = world.layers.terrain.findIndex((t, i) => t === T.SNOW && reached[i] === 1);
      world.layers.object[snow] = O.HERB_FROSTCAP;
      world.layers.object[snow - 2] = O.YEW;
    }).filter((i) => i.severity === 'warning').map((i) => i.message);
    expect(warnings.some((m) => /Duneflower .* is in the safe zone; it grows anywhere out of town/.test(m))).toBe(true);
    expect(warnings.some((m) => /Duneflower .* is on town cobbles; it grows on sand\./.test(m))).toBe(true);
    expect(warnings.some((m) => /Frostcap .* is in the/.test(m) || /Frostcap .* is on/.test(m))).toBe(false);
    expect(warnings.some((m) => /Frostcap .* is within 2 tiles of a tree/.test(m))).toBe(true);
    expect(warnings.some((m) => /herb patch\(es\): the game uses just these/.test(m))).toBe(true);
  });

  it('knows the new lands’ monsters, each with its normal range', () => {
    const ranges = { scarab: 7, bog_goblin: 7, frost_ant: 7, mummy: 7, drowned: 7, yeti: 8, antlion: 6, swamp_wyvern: 8, ice_wyvern: 8 };
    for (const [kind, range] of Object.entries(ranges)) {
      expect(MONSTER_KINDS.some((k) => k.key === kind), kind).toBe(true);
      expect(normalRange(kind), kind).toBe(range);
    }
    const spawns = byGameId(project(), 'overworld').features.filter((f) => f.type === 'monster_spawn').map((f) => String(f.props?.kind));
    for (const kind of Object.keys(ranges)) expect(spawns, kind).toContain(kind);
    const f: Feature = { id: 'f', type: 'monster_spawn', c: 0, r: 0, name: 'x', props: { kind: 'rat', count: 1, radius: 6 } };
    expect(withProp(f, 'kind', 'antlion').radius).toBe(6);
    expect(withProp(f, 'kind', 'yeti').radius).toBe(8);
  });

  it('knows the people outside town, and Dobbs in the caverns', () => {
    const p = project();
    const roles = (id: string) => byGameId(p, id).features.filter((f) => f.type === 'npc').map((f) => [f.props?.role, f.name]);
    expect(roles('hermit_hut')).toEqual([['hermit', 'Hermit (Old Ansel)']]);
    expect(roles('fisher_hut')).toEqual([['fisher', 'Fisher (Moira)']]);
    expect(roles('farmhouse')).toEqual([['farmer', 'Farmer (Giles)']]);
    expect(roles('trapper_lodge')).toEqual([['trapper', 'Trapper (Rook)']]);
    expect(roles('caves1')).toEqual([['miner', 'Miner (Dobbs)']]);
    for (const r of ['hermit', 'fisher', 'farmer', 'trapper', 'miner']) expect(NPC_ROLES.some((n) => n.value === r), r).toBe(true);
    // An unknown role is still an error.
    const hut = byGameId(p, 'hermit_hut');
    hut.features.find((f) => f.type === 'npc')!.props = { role: 'wizard' };
    expect(errors(p).map((i) => i.message)).toContain('Townsperson (3, 2) has an unknown role "wizard".');
  });

  it('keeps just the part of a big map around the view rendered, at a size phones can hold', () => {
    const map = bareWorld(256).map;
    // Zoomed in on the middle: only around the view (a quarter of a screen more each way), a
    // little sharper than it's shown.
    const view = { x0: 250, y0: 120, x1: 270, y1: 160 };
    const near = cacheRegion(map, view, 30);
    expect(near.whole).toBe(false);
    expect(near.s).toBe(36);
    expect(near.region).toEqual({ x0: 245, y0: 110, x1: 275, y1: 170 });
    expect(cacheFit(map, near, view, 30)).toBe('ok');
    // Panned off it, or zoomed in past its detail: it's rendered again.
    expect(cacheFit(map, near, { x0: 280, y0: 120, x1: 300, y1: 160 }, 30)).toBe('outside');
    expect(cacheFit(map, near, { x0: 255, y0: 130, x1: 265, y1: 150 }, 60)).toBe('detail');
    // Zoomed out over all of it: the whole map, at a little more than the screen shows.
    const far = cacheRegion(map, { x0: -50, y0: -20, x1: 560, y1: 280 }, 2);
    expect(far.region).toEqual({ x0: 0, y0: 0, x1: 512, y1: 256 });
    expect(far.s).toBeCloseTo(2.4);
    // A small map is kept whole with detail to spare, as before.
    const small = cacheRegion(bareWorld(128).map, { x0: 100, y0: 50, x1: 120, y1: 70 }, 2);
    expect([small.whole, small.s]).toEqual([true, 11]);
    expect(cacheFit(bareWorld(128).map, small, { x0: 0, y0: 0, x1: 5, y1: 5 }, 40)).toBe('ok');
    // Never more pixels than phones allow a canvas.
    for (const scale of [1, 5, 20, 48, 100]) {
      const r = cacheRegion(map, { x0: 0, y0: 0, x1: 2000 / scale, y1: 3000 / scale }, scale);
      expect((r.region.x1 - r.region.x0) * (r.region.y1 - r.region.y0) * r.s * r.s, `${scale}`).toBeLessThanOrEqual(MAX_CACHE_PIXELS + 1);
    }
  });
});

describe('landmarks and waystones (fast travel)', () => {
  const gameWorld = () => file().maps.find((m) => m.id === 'overworld')!;
  /** Where a map in the file has waystones, [x, y] in row order. */
  const stonesIn = (m: RpgdcMapsFile['maps'][number]) => {
    const k = m.objectLegend.indexOf('waystone');
    return m.objects.flatMap((v, i) => (v === k ? [[i % m.width, Math.floor(i / m.width)]] : []));
  };

  it('opens the game’s landmarks as places and its waystones as objects, and exports them as they were', () => {
    const p = project();
    const world = byGameId(p, 'overworld');
    const marks = world.features.filter((f) => f.type === 'landmark');
    expect(marks).toHaveLength(16);
    const town = marks.find((f) => f.props?.id === 'town')!;
    expect([town.c, town.r, town.name, town.props]).toEqual([384, 384, 'the Town', { id: 'town', name: 'the Town', radius: 22 }]);
    expect(marks.find((f) => f.props?.id === 'fisher_lake')!.name).toBe("Moira's Lake");
    // Nine waystones, the town's in town, each in a landmark of its own (as the game finds them),
    // standing in the way like any object.
    const stones = stonesIn(gameWorld());
    expect(stones).toHaveLength(9);
    expect(world.layers.object.filter((o) => o === O.WAYSTONE).length).toBe(9);
    expect(world.layers.object[382 * world.width + 387]).toBe(O.WAYSTONE);
    expect(isWalkableAt(world, 387, 382)).toBe(false);
    const list = landmarks(world);
    expect(stones.map(([x, y]) => landmarkAt(list, x, y)?.id).sort()).toEqual([
      'crypt', 'drowned_shrine', 'fisher_lake', 'frostmere', 'hermit_lake', 'oasis', 'town', 'trapper_lodge', 'westshore',
    ]);
    // Exported again: the same landmark places (id, name, radius), in the same order, and the same waystones.
    const out = toRpgdcMaps(p).maps.find((m) => m.id === 'overworld')!;
    expect(out.places.filter((pl) => pl.type === 'landmark')).toEqual(gameWorld().places.filter((pl) => pl.type === 'landmark'));
    expect(out.places.find((pl) => pl.type === 'landmark')).toEqual({ type: 'landmark', x: 384, y: 384, id: 'town', name: 'the Town', radius: 22 });
    expect(stonesIn(out)).toEqual(stones);
    // And opened from that export, the same again.
    const again = toRpgdcMaps(fromRpgdcMaps(toRpgdcMaps(p))).maps.find((m) => m.id === 'overworld')!;
    expect(again.places.filter((pl) => pl.type === 'landmark')).toEqual(out.places.filter((pl) => pl.type === 'landmark'));
    expect(stonesIn(again)).toEqual(stones);
  });

  /** A bare 128×128 overworld of grass: Safe round the spawn point (3, 3), the Deep from x = 100, Frontier between. */
  const bare = () => {
    const w = 128;
    const p = createProject('fast travel');
    const L = emptyLayers(w * w);
    L.terrain.fill(T.GRASS);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) L.zone[y * w + x] = x < 8 && y < 8 ? 1 : x >= 100 ? 4 : 2;
    const map: WorldMap = {
      id: 'ow', name: 'World', kind: 'overland', scaleId: 'local', grid: 'iso', width: w, height: w, seed: 1,
      settings: { rpgdcMapId: 'overworld' }, layers: L, children: [],
      features: [{ id: 's', type: 'spawn_point', c: 3, r: 3, name: 'start' }],
    };
    p.maps[map.id] = map;
    return { p, map };
  };
  const landmark = (id: string, name: string, c: number, r: number, radius?: number | string): Feature => ({
    id: `l-${id}-${c}-${r}`, type: 'landmark', c, r, name, props: { id, name, ...(radius !== undefined && { radius }) },
  });
  const stone = (map: WorldMap, x: number, y: number) => (map.layers.object[y * map.width + x] = O.WAYSTONE);
  const errs = (p: Project) => errors(p).map((i) => i.message);

  it('passes a waystone in a landmark; a landmark without a radius reaches 10 tiles', () => {
    const { p, map } = bare();
    map.features.push(landmark('meadow', 'the Meadow', 40, 40, 10), landmark('glade', 'the Glade', 60, 60));
    stone(map, 45, 40);
    // Exactly 10 tiles from the Glade's middle: in it.
    stone(map, 60, 70);
    expect(errs(p)).toEqual([]);
    expect(toRpgdcMaps(p).maps[0].places.filter((pl) => pl.type === 'landmark')).toEqual([
      { type: 'landmark', x: 40, y: 40, id: 'meadow', name: 'the Meadow', radius: 10 },
      { type: 'landmark', x: 60, y: 60, id: 'glade', name: 'the Glade', radius: 10 },
    ]);
    // Measured in a straight line, not a square: (67, 67) is 9.9 tiles off, (68, 67) 10.6.
    map.layers.object[70 * map.width + 60] = 0;
    stone(map, 67, 67);
    expect(errs(p)).toEqual([]);
    map.layers.object[67 * map.width + 67] = 0;
    stone(map, 68, 67);
    expect(errs(p)).toEqual(["Waystone (68, 67) isn't in a landmark: put a landmark place round it."]);
  });

  it('catches a waystone outside any landmark, two in one landmark, and one in the Deep', () => {
    const { p, map } = bare();
    map.features.push(landmark('meadow', 'the Meadow', 40, 40, 10), landmark('keep', 'the Keep', 110, 40, 8));
    stone(map, 20, 20);
    stone(map, 45, 40);
    stone(map, 40, 45);
    stone(map, 110, 44);
    expect(errs(p)).toEqual([
      "Waystone (20, 20) isn't in a landmark: put a landmark place round it.",
      "The waystone in the Keep (110, 44) is in the Deep, where waystones don't work.",
      'A second waystone in the Meadow (40, 45): the first is at (45, 40).',
    ]);
  });

  it('puts a waystone where landmarks overlap in the one with the nearest middle', () => {
    const { p, map } = bare();
    map.features.push(landmark('east_wood', 'East Wood', 40, 40, 10), landmark('west_wood', 'West Wood', 50, 40, 10));
    // 6 tiles from East Wood's middle, 4 from West Wood's: West Wood's, which has one already.
    stone(map, 46, 40);
    stone(map, 52, 40);
    expect(errs(p)).toEqual(['A second waystone in West Wood (52, 40): the first is at (46, 40).']);
    // Nearer East Wood's middle, it's East Wood's own.
    map.layers.object[40 * map.width + 46] = 0;
    stone(map, 44, 40);
    expect(errs(p)).toEqual([]);
  });

  it('needs a waystone players can walk up to', () => {
    const { p, map } = bare();
    map.features.push(landmark('meadow', 'the Meadow', 40, 40, 10));
    stone(map, 45, 40);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) map.layers.object[(40 + dy) * map.width + 45 + dx] = O.BOULDER;
    expect(errs(p)).toEqual(['Waystone (45, 40) has no walkable neighbour that can be reached from the spawn point.']);
  });

  it('catches a landmark or a waystone off the overworld', () => {
    const { p, map } = bare();
    const L = emptyLayers(20 * 20);
    L.terrain.fill(T.CRYPT_FLOOR);
    const crypt: WorldMap = {
      id: 'crypt', name: 'Crypt', kind: 'dungeon', scaleId: 'dungeon', grid: 'iso', width: 20, height: 20, seed: 1,
      settings: { rpgdcMapId: 'crypt1', rpgdcZone: 'deep' }, layers: L, children: [],
      features: [landmark('crypt_hall', 'the Crypt Hall', 10, 10, 5)],
    };
    stone(crypt, 12, 10);
    p.maps[crypt.id] = crypt;
    const found = errs(p);
    expect(found).toContain("The landmark the Crypt Hall isn't on the overworld: landmarks go on the overworld.");
    expect(found).toContain("Waystone (12, 10) isn't on the overworld: waystones go on the overworld.");
    expect(map.features.some((f) => f.type === 'landmark')).toBe(false);
  });

  it('catches a bad id, name or radius, and two landmarks with one id', () => {
    const { p, map } = bare();
    map.features.push(
      landmark('Bad Id', 'Somewhere', 20, 40, 5),
      landmark('x', 'Too short an id', 20, 60, 5),
      landmark('no_name', '   ', 40, 20, 5),
      landmark('long_name', 'A name far too long for the banner the game shows', 40, 40, 5),
      landmark('too_big', 'Too big', 60, 20, 41),
      landmark('too_small', 'Too small', 60, 40, 1),
      landmark('halfway', 'Halfway', 60, 60, 2.5),
      landmark('twice', 'Twice', 80, 20, 5),
      landmark('twice', 'Twice again', 80, 40, 5),
    );
    expect(errs(p)).toEqual([
      'The landmark Somewhere needs an id of lower-case letters, digits and _ (like hermit_lake).',
      'The landmark Too short an id needs an id of lower-case letters, digits and _ (like hermit_lake).',
      'The landmark no_name needs a name of up to 40 letters.',
      'The landmark A name far too long for the banner the game shows needs a name of up to 40 letters.',
      "The landmark Too big's radius must be a whole number from 2 to 40.",
      "The landmark Too small's radius must be a whole number from 2 to 40.",
      "The landmark Halfway's radius must be a whole number from 2 to 40.",
      "The landmark Twice again (80, 40): there's already a landmark called twice, at (80, 20).",
    ]);
  });

  it('gives a new landmark an id and a name of its own, and the usual radius', () => {
    const { map } = bare();
    expect(newPlaceProps(map, 'landmark')).toEqual({ id: 'landmark_1', name: 'Landmark 1', radius: 10 });
    map.features.push(landmark('landmark_1', 'Landmark 1', 40, 40), landmark('landmark_2', 'Somewhere', 60, 60));
    expect(newPlaceProps(map, 'landmark')).toEqual({ id: 'landmark_3', name: 'Landmark 3', radius: 10 });
    expect(newPlaceProps(map, 'fort')).toEqual({ id: '', name: '' });
    expect(newPlaceProps(map, 'merchant')).toBeUndefined();
  });
});
