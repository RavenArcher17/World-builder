import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { O, OBJECTS } from '../src/core/objects';
import { checkGameMaps } from '../src/core/rpgdc/checks';
import { toRpgdcMaps, type RpgdcMapsFile } from '../src/core/rpgdc/export';
import { createProject } from '../src/core/project';
import {
  boatFacing,
  buildingMask,
  buildings,
  doorFacing,
  doorLocks,
  dungeonTheme,
  ferries,
  GAME_OBJECTS,
  gameKind,
  GROUND_LEGEND,
  GROUND_TILES,
  guardPosts,
  houseGuards,
  isGameGround,
  isWalkableAt,
  landmarkAt,
  landmarks,
  leverWires,
  mapTheme,
  MONSTER_KINDS,
  namedLabel,
  normalRange,
  newPlaceProps,
  NPC_ROLES,
  OBJECT_LEGEND,
  passableTiles,
  placeLabel,
  placeProps,
  plotAt,
  plots,
  plotSign,
  reachable,
  walkableTiles,
  withProp,
  ZONES,
} from '../src/core/rpgdc/game';
import { isWater, T } from '../src/core/tiles';
import { fromRpgdcMaps, isRpgdcMapsFile } from '../src/core/rpgdc/import';
import { emptyLayers, type Feature, type Project, type WorldMap } from '../src/core/types';
import { cacheFit, cacheRegion, ferriesShown, MAX_CACHE_PIXELS, plotAreas, wiresShown } from '../src/ui/render';
import { caveGround, caveTheme, constructionFrame, farmFrame, icePatch, isWindmill, puzzleFrame, ruinPieces, seaFrame, thicketLooksLike } from '../src/ui/gameArt';
import { plotStatus } from '../src/ui/gameUi';

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
    // The town's 18, the windmill by Giles's Farm, Gullhaven's five and the hut on Wrecker's Isle.
    expect(world.features.filter((f) => f.type === 'building').length).toBe(25);
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
      'waystone', 'cache', 'thicket', 'ruin', 'gate', 'lever', 'locked_door',
      'boat', 'palm', 'wreck', 'fishing_swordfish',
      'patch_allotment', 'patch_herb', 'patch_tree', 'spinning_wheel', 'millstones',
      'sawbench', 'limestone_rock', 'guild_chest',
    ]);
  });

  it('reads each building’s roof and wall colours, and the street decorations', () => {
    const world = byGameId(project(), 'overworld');
    const bank = buildings(world).find((b) => b.sign === 'Bank')!;
    expect([bank.roof, bank.walls]).toEqual(['slate', 'grey']);
    expect(world.layers.object.filter((o) => o === O.LAMP_POST).length).toBeGreaterThan(4);
    // The town's well, and Gullhaven's.
    expect(world.layers.object.filter((o) => o === O.WELL).length).toBe(2);
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
    // tiles (Gullhaven's two gates and the town's four), criminals come back outside the town's
    // gate nearest the spawn point, at (383, 407), not Gullhaven's, and a guard stands two steps
    // from the mayor in the Town Hall.
    const { posts, outside } = guardPosts(byGameId(project(), 'overworld'));
    expect(posts.map((p) => [p.x, p.y])).toEqual([[81, 359], [383, 365], [65, 371], [365, 383], [403, 383], [383, 403]]);
    expect(outside).toEqual({ x: 383, y: 407 });
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
    // (A few cacti and dead trees fewer since the game's tool cleared its plots of land.)
    expect([O.CACTUS, O.DEAD_TREE, O.YEW, O.FISHING_EEL, O.FISHING_LOBSTER].map((o) => count(world, o))).toEqual([877, 1774, 70, 30, 41]);
    // They stand in the way, like everything else.
    const yew = world.layers.object.indexOf(O.YEW);
    expect(isWalkableAt(world, yew % world.width, Math.floor(yew / world.width))).toBe(false);
    const out = toRpgdcMaps(project()).maps.find((m) => m.id === 'overworld')!;
    expect(out.objectLegend.slice(56)).toEqual([
      'cactus', 'dead_tree', 'yew', 'fishing_eel', 'fishing_lobster', 'herb_duneflower', 'herb_bogmyrtle', 'herb_frostcap',
      'waystone', 'cache', 'thicket', 'ruin', 'gate', 'lever', 'locked_door', 'boat', 'palm', 'wreck', 'fishing_swordfish',
      'patch_allotment', 'patch_herb', 'patch_tree', 'spinning_wheel', 'millstones', 'sawbench', 'limestone_rock', 'guild_chest',
    ]);
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
    expect(warnings.some((m) => /wild herb\(s\): the game uses just these/.test(m))).toBe(true);
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
    // Seventeen with Gullhaven, and the ruined chapel, the smugglers' cove, the Frozen Peaks and
    // Wrecker's Isle (which have no waystone).
    expect(marks).toHaveLength(21);
    const town = marks.find((f) => f.props?.id === 'town')!;
    expect([town.c, town.r, town.name, town.props]).toEqual([384, 384, 'the Town', { id: 'town', name: 'the Town', radius: 22 }]);
    expect(marks.find((f) => f.props?.id === 'fisher_lake')!.name).toBe("Moira's Lake");
    // Ten waystones, the town's in town, each in a landmark of its own (as the game finds them),
    // standing in the way like any object.
    const stones = stonesIn(gameWorld());
    expect(stones).toHaveLength(10);
    expect(world.layers.object.filter((o) => o === O.WAYSTONE).length).toBe(10);
    expect(world.layers.object[382 * world.width + 387]).toBe(O.WAYSTONE);
    expect(isWalkableAt(world, 387, 382)).toBe(false);
    const list = landmarks(world);
    expect(stones.map(([x, y]) => landmarkAt(list, x, y)?.id).sort()).toEqual([
      'crypt', 'drowned_shrine', 'fisher_lake', 'frostmere', 'gullhaven', 'hermit_lake', 'oasis', 'town', 'trapper_lodge', 'westshore',
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

describe('secrets and the places outside town: caches, thickets, ruins and the windmill', () => {
  const gameMap = (id: string) => file().maps.find((m) => m.id === id)!;
  /** Where a map in the file has an object, [x, y] in row order (none if its legend hasn't it). */
  const cellsOf = (m: RpgdcMapsFile['maps'][number], key: string) => {
    const k = m.objectLegend.indexOf(key);
    return k < 0 ? [] : m.objects.flatMap((v, i) => (v === k ? [[i % m.width, Math.floor(i / m.width)]] : []));
  };
  const count = (m: WorldMap, id: number) => m.layers.object.filter((o) => o === id).length;

  it('opens the game’s caches, thickets and ruins as objects, and exports them as they were', () => {
    const p = project();
    const world = byGameId(p, 'overworld');
    expect([O.CACHE, O.THICKET, O.RUIN].map((o) => count(world, o))).toEqual([34, 16, 31]);
    for (const id of ['chapel_cellar', 'smugglers_cove']) expect(count(byGameId(p, id), O.CACHE)).toBe(1);
    // A cache and a ruin stand in the way like any object; a thicket doesn't.
    const ow = gameMap('overworld');
    const [cx, cy] = cellsOf(ow, 'cache')[0];
    expect(world.layers.object[cy * world.width + cx]).toBe(O.CACHE);
    expect(isWalkableAt(world, cx, cy)).toBe(false);
    const [rx, ry] = cellsOf(ow, 'ruin')[0];
    expect(isWalkableAt(world, rx, ry)).toBe(false);
    expect(cellsOf(ow, 'thicket').every(([x, y]) => isWalkableAt(world, x, y))).toBe(true);
    // Exported, and opened from that export, the same again.
    const out = toRpgdcMaps(p);
    const again = toRpgdcMaps(fromRpgdcMaps(out));
    for (const id of ['overworld', 'chapel_cellar', 'smugglers_cove']) {
      for (const key of ['cache', 'thicket', 'ruin']) {
        const before = cellsOf(gameMap(id), key);
        expect(cellsOf(out.maps.find((m) => m.id === id)!, key)).toEqual(before);
        expect(cellsOf(again.maps.find((m) => m.id === id)!, key)).toEqual(before);
      }
    }
    expect(out.maps[0].objectLegend.slice(64)).toEqual([
      'waystone', 'cache', 'thicket', 'ruin', 'gate', 'lever', 'locked_door', 'boat', 'palm', 'wreck', 'fishing_swordfish',
      'patch_allotment', 'patch_herb', 'patch_tree', 'spinning_wheel', 'millstones', 'sawbench', 'limestone_rock', 'guild_chest',
    ]);
  });

  it('opens the places outside town: the windmill and its miller, the chapel’s cellar, the smugglers’ cove', () => {
    const p = project();
    const world = byGameId(p, 'overworld');
    const mill = buildings(world).find((b) => b.sign === 'Mill')!;
    expect([mill.style, mill.w, mill.h, isWindmill(mill)]).toEqual(['tower', 3, 3, true]);
    expect(buildings(world).filter(isWindmill)).toHaveLength(1);
    const windmill = byGameId(p, 'windmill');
    expect([gameKind(windmill), windmill.settings.rpgdcZone]).toEqual(['interior', 'frontier']);
    const miller = windmill.features.find((f) => f.type === 'npc')!;
    expect([miller.props?.role, miller.name]).toEqual(['miller', 'Miller (Hob, in the windmill)']);
    const cellar = byGameId(p, 'chapel_cellar');
    expect([gameKind(cellar), mapTheme(cellar), dungeonTheme(cellar), cellar.settings.rpgdcZone]).toEqual(['dungeon', undefined, 'crypt', 'wilderness']);
    const cove = byGameId(p, 'smugglers_cove');
    expect([gameKind(cove), mapTheme(cove), dungeonTheme(cove), cove.settings.rpgdcZone]).toEqual(['dungeon', 'cave', 'cave', 'wilderness']);
    // Two landmarks without a waystone, and the chapel's walls are ruins inside its landmark.
    const marks = landmarks(world);
    expect(marks.filter((l) => l.id === 'chapel' || l.id === 'cove').map((l) => [l.id, l.name, l.radius])).toEqual([
      ['chapel', 'the Ruined Chapel', 10],
      ['cove', "Smugglers' Cove", 10],
    ]);
    expect(cellsOf(gameMap('overworld'), 'ruin').every(([x, y]) => landmarkAt(marks, x, y)?.id === 'chapel')).toBe(true);
    // Exported as they were.
    const out = toRpgdcMaps(p);
    expect(out.maps.find((m) => m.id === 'windmill')!.places).toContainEqual({ type: 'npc', x: 3, y: 3, role: 'miller' });
    expect(out.maps.find((m) => m.id === 'overworld')!.places).toContainEqual({ type: 'building', x: 341, y: 396, w: 3, h: 3, style: 'tower', sign: 'Mill', roof: 'brown', walls: 'cream' });
    expect(out.maps.find((m) => m.id === 'smugglers_cove')!.theme).toBe('cave');
    expect(NPC_ROLES.map((r) => r.value).slice(-10, -4)).toEqual(['hermit', 'fisher', 'farmer', 'trapper', 'miner', 'miller']);
  });

  it('knows a windmill: a tower whose sign says mill', () => {
    const b = (style: string, sign: string) => ({ x: 0, y: 0, w: 3, h: 3, style, sign, roof: '', walls: '' });
    expect(isWindmill(b('tower', 'Mill'))).toBe(true);
    expect(isWindmill(b('tower', 'The old windmill'))).toBe(true);
    expect(isWindmill(b('tower', 'Mage Tower'))).toBe(false);
    expect(isWindmill(b('stone', 'Mill'))).toBe(false);
  });

  /** A bare 128×128 overworld of grass: Safe round the spawn point (3, 3), Frontier beyond. */
  const bare = () => {
    const w = 128;
    const p = createProject('secrets');
    const L = emptyLayers(w * w);
    L.terrain.fill(T.GRASS);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) L.zone[y * w + x] = x < 8 && y < 8 ? 1 : 2;
    const map: WorldMap = {
      id: 'ow', name: 'World', kind: 'overland', scaleId: 'local', grid: 'iso', width: w, height: w, seed: 1,
      settings: { rpgdcMapId: 'overworld' }, layers: L, children: [],
      features: [{ id: 's', type: 'spawn_point', c: 3, r: 3, name: 'start' }],
    };
    p.maps[map.id] = map;
    return { p, map };
  };
  const put = (map: WorldMap, x: number, y: number, o: number) => (map.layers.object[y * map.width + x] = o);
  const errs = (p: Project) => errors(p).map((i) => i.message);
  const ring = (map: WorldMap, x: number, y: number, o: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) put(map, x + dx, y + dy, o);
  };

  it('needs a cache players can walk up to, on the overworld and below', () => {
    const { p, map } = bare();
    put(map, 40, 40, O.CACHE);
    expect(errs(p)).toEqual([]);
    ring(map, 40, 40, O.BOULDER);
    expect(errs(p)).toEqual(['Hidden cache (40, 40) has no walkable neighbour that can be reached from the spawn point.']);
    ring(map, 40, 40, 0);
    // A cellar under the overworld: from where players arrive.
    put(map, 10, 10, O.CRYPT_ENTRANCE);
    map.features.push({ id: 'down', type: 'link', c: 10, r: 10, name: 'down', props: { toMap: 'cellar', toX: 5, toY: 5 } });
    const L = emptyLayers(20 * 20);
    L.terrain.fill(T.CRYPT_FLOOR);
    const cellar: WorldMap = {
      id: 'cellar', name: 'Cellar', kind: 'dungeon', scaleId: 'dungeon', grid: 'iso', width: 20, height: 20, seed: 1,
      settings: { rpgdcMapId: 'cellar', rpgdcZone: 'wilderness' }, layers: L, children: [],
      features: [{ id: 'up', type: 'link', c: 4, r: 5, name: 'up', props: { toMap: 'overworld', toX: 11, toY: 10 } }],
    };
    put(cellar, 4, 5, O.STAIRS_UP);
    put(cellar, 15, 15, O.CACHE);
    p.maps[cellar.id] = cellar;
    expect(errs(p)).toEqual([]);
    for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) if (Math.max(Math.abs(x - 15), Math.abs(y - 15)) === 2) cellar.layers.terrain[y * 20 + x] = T.CRYPT_WALL;
    expect(errs(p)).toEqual(['Hidden cache (15, 15) has no walkable neighbour that can be reached from where players arrive.']);
  });

  it('lets players walk through a thicket: a glade behind one is reachable, behind a tree it isn’t', () => {
    const { p, map } = bare();
    // A hidden glade: a ring of oaks round a cache, with a thicket in it.
    for (let y = 36; y <= 44; y++) for (let x = 36; x <= 44; x++) if (Math.max(Math.abs(x - 40), Math.abs(y - 40)) === 4) put(map, x, y, O.OAK);
    put(map, 40, 40, O.CACHE);
    put(map, 44, 40, O.THICKET);
    expect(isWalkableAt(map, 44, 40)).toBe(true);
    expect(walkableTiles(map)[40 * map.width + 44]).toBe(1);
    expect(reachable(map, [{ x: 3, y: 3 }])[39 * map.width + 40]).toBe(1);
    expect(errs(p)).toEqual([]);
    // An oak there instead closes the glade.
    put(map, 44, 40, O.OAK);
    expect(errs(p)).toEqual(['Hidden cache (40, 40) has no walkable neighbour that can be reached from the spawn point.']);
    // Exported as a thicket, and opened again as one.
    put(map, 44, 40, O.THICKET);
    const out = toRpgdcMaps(p).maps[0];
    expect(out.objectLegend[out.objects[40 * map.width + 44]]).toBe('thicket');
    expect(Object.values(fromRpgdcMaps(toRpgdcMaps(p)).maps)[0].layers.object[40 * map.width + 44]).toBe(O.THICKET);
  });

  it('warns about a thicket on water, and counts a thicket as a tree that can hide an altar', () => {
    const { p, map } = bare();
    map.layers.terrain[50 * map.width + 50] = T.WATER;
    put(map, 50, 50, O.THICKET);
    // The game lets players through it wherever it stands.
    expect(isWalkableAt(map, 50, 50)).toBe(true);
    put(map, 60, 60, O.THICKET);
    put(map, 62, 61, O.AIR_ALTAR);
    expect(checkGameMaps(p).map((i) => [i.severity, i.message])).toEqual([
      ['warning', 'Thicket (50, 50) is on water: players can walk through a thicket wherever it stands, so they can cross the water there.'],
      ['warning', 'Altar: air (62, 61) is within 2 tiles of a tree, which can hide it in the game and take the taps meant for it.'],
    ]);
  });

  it('draws a thicket as the first tree beside it: west, north, east, then south', () => {
    const { map } = bare();
    put(map, 20, 20, O.THICKET);
    expect(thicketLooksLike(map, 20, 20)).toBe(O.TREE);
    put(map, 20, 21, O.YEW);
    expect(thicketLooksLike(map, 20, 20)).toBe(O.YEW);
    put(map, 21, 20, O.WILLOW);
    expect(thicketLooksLike(map, 20, 20)).toBe(O.WILLOW);
    put(map, 20, 19, O.OAK);
    expect(thicketLooksLike(map, 20, 20)).toBe(O.OAK);
    put(map, 19, 20, O.BOULDER);
    expect(thicketLooksLike(map, 20, 20)).toBe(O.OAK);
    put(map, 19, 20, O.TREE);
    expect(thicketLooksLike(map, 20, 20)).toBe(O.TREE);
    expect(thicketLooksLike(map, 0, 0)).toBe(O.TREE);
  });

  it('joins ruined walls up like the fence, and they block walking like a boulder', () => {
    const { p, map } = bare();
    // An L of wall from (50, 50): along the top to (52, 50), down the side to (50, 52); and a lone pillar.
    for (const [x, y] of [[50, 50], [51, 50], [52, 50], [50, 51], [50, 52], [60, 60]]) put(map, x, y, O.RUIN);
    expect(ruinPieces(map, 50, 50)).toEqual(['ruin-post']);
    expect(ruinPieces(map, 51, 50)).toEqual(['ruin-w']);
    expect(ruinPieces(map, 52, 50)).toEqual(['ruin-w']);
    expect(ruinPieces(map, 50, 51)).toEqual(['ruin-n']);
    expect(ruinPieces(map, 60, 60)).toEqual(['ruin-post']);
    put(map, 51, 51, O.RUIN);
    expect(ruinPieces(map, 51, 51)).toEqual(['ruin-n', 'ruin-w']);
    expect(ruinPieces(map, 0, 0)).toEqual(['ruin-post']);
    expect(isWalkableAt(map, 51, 50)).toBe(false);
    expect(errs(p)).toEqual([]);
    // And the game's chapel: its broken walls are lone pillars only where a stretch starts (a
    // corner, or after a gap); the rest join up.
    const world = byGameId(project(), 'overworld');
    const posts = cellsOf(gameMap('overworld'), 'ruin').filter(([x, y]) => ruinPieces(world, x, y)[0] === 'ruin-post');
    expect(posts).toEqual([[256, 404], [261, 404], [267, 405], [256, 408], [267, 409], [260, 410], [264, 410]]);
  });
});

/** The game's icePatch at (0, 0), (4, 0) and (6, 9), worked out with its own code (client/src/scenes/WorldScene.ts). */
const ICE_PATCH = ['0.294150', '0.074974', '0.365695'];

describe('the Frozen Peaks: gates, levers, locked doors and the frost look', () => {
  const gameMap = (id: string) => file().maps.find((m) => m.id === id)!;
  const cellsOf = (m: RpgdcMapsFile['maps'][number], key: string) => {
    const k = m.objectLegend.indexOf(key);
    return k < 0 ? [] : m.objects.flatMap((v, i) => (v === k ? [[i % m.width, Math.floor(i / m.width)]] : []));
  };
  const count = (m: WorldMap, id: number) => m.layers.object.filter((o) => o === id).length;
  const PEAKS = ['frozen1', 'frozen2', 'frozen3'];

  it('opens the three floors of the Frozen Peaks, their puzzles, monsters and boss, and exports them as they were', () => {
    const p = project();
    for (const id of PEAKS) {
      const m = byGameId(p, id);
      expect([gameKind(m), mapTheme(m), dungeonTheme(m), caveTheme(m), m.settings.rpgdcZone]).toEqual(['dungeon', 'frost', 'frost', 'frost', 'deep']);
    }
    // A gate and its levers on each floor, and the locked door on the second.
    expect(PEAKS.map((id) => [O.GATE, O.LEVER, O.LOCKED_DOOR].map((o) => count(byGameId(p, id), o)))).toEqual([[1, 2, 0], [1, 1, 1], [1, 2, 0]]);
    const first = byGameId(p, 'frozen1');
    expect(leverWires(first).map((l) => [l.x, l.y, l.toX, l.toY])).toEqual([[5, 32, 36, 29], [42, 7, 36, 29]]);
    expect(first.features.find((f) => f.type === 'lever')!.name).toBe('Lever → gate');
    expect(doorLocks(byGameId(p, 'frozen2')).map((l) => [l.x, l.y, l.key])).toEqual([[30, 29, 'frost_key']]);
    // The Ice Warden with the key, the frost wraiths and the Frost Giant on the top floor.
    const kinds = new Set(PEAKS.flatMap((id) => byGameId(p, id).features.filter((f) => f.type === 'monster_spawn').map((f) => f.props?.kind)));
    expect([...kinds].filter((k) => ['ice_warden', 'frost_wraith'].includes(String(k))).sort()).toEqual(['frost_wraith', 'ice_warden']);
    expect(byGameId(p, 'frozen3').features.find((f) => f.type === 'boss')!.props?.kind).toBe('frost_giant');
    expect(['ice_warden', 'frost_wraith', 'frost_giant'].map(normalRange)).toEqual([6, 8, 7]);
    expect(MONSTER_KINDS.filter((k) => k.key.startsWith('frost_') || k.key === 'ice_warden').map((k) => k.key)).toEqual(['frost_ant', 'ice_warden', 'frost_wraith', 'frost_giant']);
    // A gate, lever and locked door stand in the way, like any object, for monsters and players alike.
    const [gx, gy] = cellsOf(gameMap('frozen1'), 'gate')[0];
    expect(isWalkableAt(first, gx, gy)).toBe(false);
    // Exported, and opened from that export, the same again: objects, levers, lock and look.
    const out = toRpgdcMaps(p);
    const again = toRpgdcMaps(fromRpgdcMaps(out));
    for (const id of PEAKS) {
      const before = gameMap(id);
      for (const file of [out, again]) {
        const m = file.maps.find((x) => x.id === id)!;
        expect(m.theme).toBe('frost');
        for (const key of ['gate', 'lever', 'locked_door']) expect(cellsOf(m, key)).toEqual(cellsOf(before, key));
        const puzzles = (places: typeof m.places) => places.filter((pl) => pl.type === 'lever' || pl.type === 'lock').map(placeKey).sort();
        expect(puzzles(m.places)).toEqual(puzzles(before.places));
      }
    }
    expect(out.maps.find((m) => m.id === 'frozen2')!.places).toContainEqual({ type: 'lock', x: 30, y: 29, key: 'frost_key' });
    expect(out.maps.find((m) => m.id === 'frozen3')!.places.filter((pl) => pl.type === 'lever')).toEqual([
      { type: 'lever', x: 10, y: 5, toX: 22, toY: 13 },
      { type: 'lever', x: 34, y: 5, toX: 22, toY: 13 },
    ]);
  });

  /** A 20×20 dungeon floor of crypt floor, its stairs up at (2, 2) with players arriving at (3, 2), under a bare overworld. */
  const floor = () => {
    const p = createProject('puzzles');
    const w = 128;
    const L = emptyLayers(w * w);
    L.terrain.fill(T.GRASS);
    for (let i = 0; i < w * w; i++) L.zone[i] = 1;
    const world: WorldMap = {
      id: 'ow', name: 'World', kind: 'overland', scaleId: 'local', grid: 'iso', width: w, height: w, seed: 1,
      settings: { rpgdcMapId: 'overworld' }, layers: L, children: [],
      features: [
        { id: 's', type: 'spawn_point', c: 3, r: 3, name: 'start' },
        { id: 'down', type: 'link', c: 10, r: 10, name: 'down', props: { toMap: 'peak', toX: 3, toY: 2 } },
      ],
    };
    L.object[10 * w + 10] = O.CRYPT_ENTRANCE;
    for (let i = 0; i < w * w; i++) if (i % w >= 20 || Math.floor(i / w) >= 20) L.zone[i] = 2;
    const D = emptyLayers(20 * 20);
    D.terrain.fill(T.CRYPT_FLOOR);
    const map: WorldMap = {
      id: 'peak', name: 'Peak', kind: 'dungeon', scaleId: 'dungeon', grid: 'iso', width: 20, height: 20, seed: 1,
      settings: { rpgdcMapId: 'peak', rpgdcZone: 'deep', rpgdcTheme: 'frost' }, layers: D, children: [],
      features: [{ id: 'up', type: 'link', c: 2, r: 2, name: 'up', props: { toMap: 'overworld', toX: 11, toY: 10 } }],
    };
    D.object[2 * 20 + 2] = O.STAIRS_UP;
    p.maps[world.id] = world;
    p.maps[map.id] = map;
    return { p, map };
  };
  const put = (map: WorldMap, x: number, y: number, o: number) => (map.layers.object[y * map.width + x] = o);
  const wall = (map: WorldMap, x: number, y: number) => (map.layers.terrain[y * map.width + x] = T.CRYPT_WALL);
  const lever = (x: number, y: number, toX: number, toY: number, id = `lv-${x}-${y}-${toX}-${toY}`): Feature => ({ id, type: 'lever', c: x, r: y, name: 'Lever → gate', props: { toX, toY } });
  const lock = (x: number, y: number, key: string, id = `lk-${x}-${y}-${key}`): Feature => ({ id, type: 'lock', c: x, r: y, name: 'Lock', props: { key } });
  const issues = (p: Project) => checkGameMaps(p).map((i) => [i.severity, i.message]);
  /** A wall across the floor at row 10, with a gate in it at (10, 10) and a locked door at (14, 10). */
  const walledOff = () => {
    const { p, map } = floor();
    for (let x = 0; x < 20; x++) wall(map, x, 10);
    put(map, 10, 10, O.GATE);
    put(map, 14, 10, O.LOCKED_DOOR);
    put(map, 5, 5, O.LEVER);
    map.features.push(lever(5, 5, 10, 10), lock(14, 10, 'frost_key'));
    return { p, map };
  };

  it('passes a gate with its lever and a locked door with its lock, and exports and opens them', () => {
    const { p, map } = walledOff();
    expect(issues(p)).toEqual([]);
    const out = toRpgdcMaps(p).maps.find((m) => m.id === 'peak')!;
    expect(out.theme).toBe('frost');
    expect(['gate', 'lever', 'locked_door'].map((k) => out.objectLegend.indexOf(k))).toEqual([68, 69, 70]);
    expect([out.objects[10 * 20 + 10], out.objects[5 * 20 + 5], out.objects[10 * 20 + 14]]).toEqual([68, 69, 70]);
    expect(out.places.slice(-2)).toEqual([
      { type: 'lever', x: 5, y: 5, toX: 10, toY: 10 },
      { type: 'lock', x: 14, y: 10, key: 'frost_key' },
    ]);
    const back = Object.values(fromRpgdcMaps(toRpgdcMaps(p)).maps).find((m) => m.settings.rpgdcMapId === 'peak')!;
    expect([back.layers.object[10 * 20 + 10], back.layers.object[5 * 20 + 5], back.layers.object[10 * 20 + 14]]).toEqual([O.GATE, O.LEVER, O.LOCKED_DOOR]);
    expect(leverWires(back).map((l) => [l.x, l.y, l.toX, l.toY])).toEqual([[5, 5, 10, 10]]);
    expect(doorLocks(back).map((l) => [l.x, l.y, l.key])).toEqual([[14, 10, 'frost_key']]);
    expect(back.settings.rpgdcTheme).toBe('frost');
    expect(map.features.filter((f) => f.type === 'lever' || f.type === 'lock')).toHaveLength(2);
  });

  it('counts gates and locked doors as open for players, as the game’s checks do, but not for monsters', () => {
    const { p, map } = walledOff();
    // A cache and a lever beyond the wall: reached through the gate or the door.
    put(map, 4, 15, O.CACHE);
    put(map, 16, 15, O.LEVER);
    map.features.push(lever(16, 15, 10, 10));
    expect(issues(p)).toEqual([]);
    const walk = walkableTiles(map);
    expect([walk[10 * 20 + 10], walk[10 * 20 + 14]]).toEqual([0, 0]);
    expect([passableTiles(map, walk)[10 * 20 + 10], passableTiles(map, walk)[10 * 20 + 14]]).toEqual([1, 1]);
    expect(reachable(map, [{ x: 3, y: 2 }])[15 * 20 + 5]).toBe(1);
    expect(reachable(map, [{ x: 3, y: 2 }], walk)[15 * 20 + 5]).toBe(0);
    // Only the door now: still reached.
    put(map, 10, 10, 0);
    wall(map, 10, 10);
    map.features = map.features.filter((f) => f.type !== 'lever');
    put(map, 5, 5, 0);
    put(map, 16, 15, 0);
    expect(issues(p)).toEqual([]);
    // Nor through a boulder: the cache and the lever behind the wall can't be reached.
    put(map, 14, 10, O.BOULDER);
    map.features = map.features.filter((f) => f.type !== 'lock');
    put(map, 16, 15, O.LEVER);
    put(map, 10, 3, O.GATE);
    map.features.push(lever(16, 15, 10, 3));
    expect(issues(p)).toEqual([
      ['error', 'Hidden cache (4, 15) has no walkable neighbour that can be reached from where players arrive.'],
      ['error', 'Lever (16, 15) has no walkable neighbour that can be reached from where players arrive.'],
    ]);
    // A monster can't stand on a gate.
    map.features.push({ id: 'm', type: 'monster_spawn', c: 10, r: 3, name: 'yeti', props: { kind: 'yeti', count: 1, radius: 4 } });
    expect(issues(p).some(([, m]) => m === 'Monster spawn (10, 3) is on a tile you can\'t walk on.')).toBe(true);
  });

  it('catches every broken gate, lever and lock, as the game does', () => {
    const broken = (fn: (map: WorldMap) => void) => {
      const { p, map } = walledOff();
      fn(map);
      return issues(p);
    };
    // A lever place off its lever, and the lever left unwired.
    expect(broken((m) => { m.features[1].c = 6; })).toEqual([
      ['error', "The lever place (6, 5) isn't on a lever: put it on a Lever object."],
      ['error', "Lever (5, 5) isn't wired to a gate: put a lever place on it and point it at the gate it opens."],
    ]);
    // Wired to a tile that isn't a gate: the gate then has no lever.
    expect(broken((m) => { m.features[1].props!.toX = 11; })).toEqual([
      ['error', "The lever (5, 5) is wired to (11, 10), which isn't a gate: pick the gate it opens."],
      ['error', 'Gate (10, 10) has no lever to open it: put a lever place on a Lever and point it at this gate.'],
    ]);
    // Wired twice to the same gate (the game won't load that).
    expect(broken((m) => { m.features.push(lever(5, 5, 10, 10, 'again')); })).toEqual([
      ['error', 'The lever (5, 5) is wired to the gate at (10, 10) twice: keep one of the two places.'],
    ]);
    // A second lever with no gate, and a second gate with no lever (in rows from the top).
    expect(broken((m) => { put(m, 12, 10, O.GATE); put(m, 8, 5, O.LEVER); })).toEqual([
      ['error', "Lever (8, 5) isn't wired to a gate: put a lever place on it and point it at the gate it opens."],
      ['error', 'Gate (12, 10) has no lever to open it: put a lever place on a Lever and point it at this gate.'],
    ]);
    // One lever can open two gates, and a gate can need two levers.
    expect(broken((m) => { put(m, 12, 10, O.GATE); put(m, 8, 5, O.LEVER); m.features.push(lever(5, 5, 12, 10), lever(8, 5, 12, 10)); })).toEqual([]);
    // A locked door with no lock; a lock that isn't on a locked door.
    expect(broken((m) => { m.features[2].c = 13; })).toEqual([
      ['error', "The lock (13, 10) isn't on a locked door: put it on a Locked door object."],
      ['error', 'Locked door (14, 10) has no lock: put a lock place on it, naming the key that opens it.'],
    ]);
    // Two locks on one door.
    expect(broken((m) => { m.features.push(lock(14, 10, 'frost_key', 'second')); })).toEqual([
      ['error', "The lock (14, 10): there's already a lock on this door."],
    ]);
    // A lock with no key, or not an item id; one World Builder doesn't know is a warning.
    expect(broken((m) => { m.features[2].props!.key = ''; })).toEqual([['error', 'The lock (14, 10) needs a key: the id of an item in the game, like frost_key.']]);
    expect(broken((m) => { m.features[2].props!.key = 'Frost Key'; })).toEqual([['error', 'The lock (14, 10) needs a key: the id of an item in the game, like frost_key.']]);
    expect(broken((m) => { m.features[2].props!.key = 'ember_heart'; })).toEqual([
      ['warning', 'The lock (14, 10) wants "ember_heart", which isn\'t a key World Builder knows (frost_key): the game won\'t load a lock whose key isn\'t one of its items, so check it has one called that.'],
    ]);
  });

  it('wires a new lever place to the nearest gate, and gives a new lock the frost key', () => {
    const { map } = walledOff();
    expect(newPlaceProps(map, 'lever', { x: 3, y: 3 })).toEqual({ toX: 10, toY: 10 });
    put(map, 2, 12, O.GATE);
    expect(newPlaceProps(map, 'lever', { x: 3, y: 9 })).toEqual({ toX: 2, toY: 12 });
    expect(newPlaceProps(map, 'lever', { x: 9, y: 9 })).toEqual({ toX: 10, toY: 10 });
    expect(newPlaceProps(floor().map, 'lever', { x: 3, y: 3 })).toEqual({ toX: 0, toY: 0 });
    expect(newPlaceProps(map, 'lock', { x: 14, y: 10 })).toEqual({ key: 'frost_key' });
  });

  it('shows the wires of a selected lever, or of a tapped gate, and no others', () => {
    const first = byGameId(project(), 'frozen1');
    const [a, b] = first.features.filter((f) => f.type === 'lever');
    const at = (x: number, y: number) => y * first.width + x;
    const shown = (sel: string | null, focus?: number) => wiresShown(first, sel, focus).map((l) => [l.x, l.y]);
    expect(shown(null)).toEqual([]);
    // A lever selected: its gate's wires (the other lever too, which that gate also needs).
    expect(shown(a.id)).toEqual([[5, 32], [42, 7]]);
    // The gate tapped, or a lever.
    expect(shown(null, at(36, 29))).toEqual([[5, 32], [42, 7]]);
    expect(shown(null, at(42, 7))).toEqual([[5, 32], [42, 7]]);
    expect(shown(null, at(20, 20))).toEqual([]);
    // Two gates: only the wires of the gate in question.
    first.layers.object[at(40, 40)] = O.GATE;
    b.props = { toX: 40, toY: 40 };
    expect(shown(a.id)).toEqual([[5, 32]]);
    expect(shown(null, at(40, 40))).toEqual([[42, 7]]);
  });

  it('turns gates and doors the game’s way: along x between walls to the west or east, else along y', () => {
    const p = project();
    // The game's own: the gates on the first and third floors and the locked door run along x,
    // between walls; the second floor's gate runs along y, between walls north and south.
    expect(doorFacing(byGameId(p, 'frozen1'), 36, 29)).toBe('x');
    expect(doorFacing(byGameId(p, 'frozen3'), 22, 13)).toBe('x');
    expect(doorFacing(byGameId(p, 'frozen2'), 36, 17)).toBe('y');
    expect(doorFacing(byGameId(p, 'frozen2'), 30, 29)).toBe('x');
    expect([puzzleFrame(byGameId(p, 'frozen1'), 36, 29), puzzleFrame(byGameId(p, 'frozen2'), 36, 17), puzzleFrame(byGameId(p, 'frozen2'), 30, 29), puzzleFrame(byGameId(p, 'frozen1'), 5, 32)])
      .toEqual(['gate-x', 'gate-y', 'lockdoor-x', 'lever']);
    expect(puzzleFrame(byGameId(p, 'frozen1'), 8, 5)).toBeNull();
    const { map } = floor();
    put(map, 5, 5, O.GATE);
    expect(doorFacing(map, 5, 5)).toBe('y');
    wall(map, 5, 4);
    expect(doorFacing(map, 5, 5)).toBe('y');
    wall(map, 6, 5);
    expect(doorFacing(map, 5, 5)).toBe('x');
    // A wall with something standing on it isn't a wall to the game; nor is the edge of the map.
    put(map, 6, 5, O.BOULDER);
    expect(doorFacing(map, 5, 5)).toBe('y');
    put(map, 0, 7, O.LOCKED_DOOR);
    expect(doorFacing(map, 0, 7)).toBe('y');
    wall(map, 1, 7);
    expect(puzzleFrame(map, 0, 7)).toBe('lockdoor-x');
  });

  it('draws the Frozen Peaks like the caverns, from the frost sheet: snow with patches of ice, thin ice for water', () => {
    const p = project();
    expect(['frozen1', 'caves1', 'smugglers_cove', 'crypt1', 'sewer1', 'bank', 'overworld'].map((id) => caveTheme(byGameId(p, id)))).toEqual(['frost', 'cave', 'cave', null, null, null, null]);
    // A frost theme on an inside isn't drawn as one (insides have no look).
    const bank = byGameId(p, 'bank');
    bank.settings.rpgdcTheme = 'frost';
    expect(caveTheme(bank)).toBeNull();
    // Water: thin ice in the peaks, lava in the caverns.
    expect(caveGround('frost', true, 7, 3)).toEqual({ what: 'ice', salt: 0 });
    expect(caveGround('cave', true, 7, 3)).toEqual({ what: 'lava', salt: 0 });
    // Floors: snow, or glassy ice where the smooth patches run high; never rubble. The caverns: dirt
    // and rubble, never ice.
    const m = byGameId(p, 'frozen1');
    const peaks = new Map<string, number>();
    const caves = new Set<string>();
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const f = caveGround('frost', false, x, y);
        expect(f).toEqual(icePatch(x, y) > 0.7 ? { what: 'ice', salt: 4 } : { what: 'floor', salt: 2 });
        peaks.set(f.what, (peaks.get(f.what) ?? 0) + 1);
        caves.add(caveGround('cave', false, x, y).what);
      }
    }
    expect([...peaks.keys()].sort()).toEqual(['floor', 'ice']);
    expect(peaks.get('ice')! / (m.width * m.height)).toBeGreaterThan(0.03);
    expect(peaks.get('ice')!).toBeLessThan(peaks.get('floor')!);
    expect([...caves].sort()).toEqual(['floor', 'rubble']);
    // The patches are smooth: within 0 and 1, and next-door tiles close in value.
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        expect(icePatch(x, y)).toBeGreaterThanOrEqual(0);
        expect(icePatch(x, y)).toBeLessThanOrEqual(1);
        expect(Math.abs(icePatch(x + 1, y) - icePatch(x, y))).toBeLessThan(0.4);
      }
    }
    // As the game has them (its icePatch, on the same tile hash).
    expect([icePatch(0, 0), icePatch(4, 0), icePatch(6, 9)].map((v) => v.toFixed(6))).toEqual(ICE_PATCH);
  });
});

describe('the sea: Gullhaven, Wrecker’s Isle and the ferry between them', () => {
  const gameMap = (id: string) => file().maps.find((m) => m.id === id)!;
  /** Where a map in the file has an object, [x, y] in row order (none if its legend hasn't it). */
  const cellsOf = (m: RpgdcMapsFile['maps'][number], key: string) => {
    const k = m.objectLegend.indexOf(key);
    return k < 0 ? [] : m.objects.flatMap((v, i) => (v === k ? [[i % m.width, Math.floor(i / m.width)]] : []));
  };
  const count = (m: WorldMap, id: number) => m.layers.object.filter((o) => o === id).length;
  const SEA = ['boat', 'palm', 'wreck', 'fishing_swordfish'];
  const INSIDES = ['port_bank', 'port_store', 'port_inn', 'port_home1', 'port_home2', 'isle_hut'];

  it('opens the port, the island and their insides, their boats, palms, wrecks, swordfish, people and monsters, and exports them as they were', () => {
    const p = project();
    const world = byGameId(p, 'overworld');
    expect(OBJECT_LEGEND.slice(71, 75)).toEqual(SEA);
    expect([O.BOAT, O.PALM, O.WRECK, O.FISHING_SWORDFISH]).toEqual([71, 72, 73, 74]);
    expect([O.BOAT, O.PALM, O.WRECK, O.FISHING_SWORDFISH].map((o) => count(world, o))).toEqual([2, 176, 3, 10]);
    // All four stand in the way, like any object but the thicket.
    for (const key of SEA) {
      const [x, y] = cellsOf(gameMap('overworld'), key)[0];
      expect(isWalkableAt(world, x, y), key).toBe(false);
    }
    for (const id of INSIDES) expect([gameKind(byGameId(p, id)), byGameId(p, id).settings.rpgdcZone], id).toEqual(['interior', 'safe']);
    // The two ferries, labelled with where they go.
    expect(ferries(world).map((f) => [f.x, f.y, f.toX, f.toY, f.fare, f.name, f.feature.name])).toEqual([
      [36, 360, 116, 624, 100, "Wrecker's Isle", "Ferry → Wrecker's Isle"],
      [116, 623, 37, 360, 0, 'Gullhaven', 'Ferry → Gullhaven'],
    ]);
    // The harbourmaster by the jetty, and the castaway in her hut.
    const npc = (m: WorldMap) => m.features.filter((f) => f.type === 'npc').map((f) => [f.c, f.r, f.props?.role, f.name]);
    expect(npc(world).filter(([, , role]) => role !== 'seeds' && role !== 'land_agent')).toEqual([[40, 357, 'harbourmaster', 'Harbourmaster (Bligh, by the ferry)']]);
    expect(npc(byGameId(p, 'isle_hut'))).toEqual([[3, 2, 'castaway', 'Castaway (Marooned Meg)']]);
    // Crabs, pirates and their captain, each roaming its normal range (the file gives them no radius).
    const spawns = world.features.filter((f) => f.type === 'monster_spawn' && ['giant_crab', 'pirate', 'pirate_captain'].includes(String(f.props?.kind)));
    expect(spawns.map((f) => f.props?.kind).sort()).toEqual(['giant_crab', 'giant_crab', 'giant_crab', 'giant_crab', 'pirate', 'pirate', 'pirate_captain']);
    expect(['giant_crab', 'pirate', 'pirate_captain'].map(normalRange)).toEqual([5, 8, 7]);
    for (const f of spawns) {
      expect(f.props?.radius).toBeUndefined();
      expect(placeProps(f).radius).toBe(normalRange(f.props?.kind));
    }
    // Exported, and opened from that export, the same again: objects, ferries, people and spawns.
    const out = toRpgdcMaps(p);
    const again = toRpgdcMaps(fromRpgdcMaps(out));
    const ours = (places: RpgdcMapsFile['maps'][number]['places']) =>
      places.filter((pl) => pl.type === 'ferry' || pl.type === 'npc' || (pl.type === 'monster_spawn' && ['giant_crab', 'pirate', 'pirate_captain'].includes(pl.kind))).map(placeKey).sort();
    for (const f of [out, again]) {
      const ow = f.maps.find((m) => m.id === 'overworld')!;
      for (const key of SEA) expect(cellsOf(ow, key), key).toEqual(cellsOf(gameMap('overworld'), key));
      expect(ours(ow.places)).toEqual(ours(gameMap('overworld').places));
      for (const id of INSIDES) expect(f.maps.find((m) => m.id === id)!.places.map(placeKey).sort(), id).toEqual(gameMap(id).places.map(placeKey).sort());
    }
    expect(out.maps[0].places).toContainEqual({ type: 'ferry', x: 36, y: 360, toX: 116, toY: 624, fare: 100, name: "Wrecker's Isle" });
    expect(out.maps[0].places).toContainEqual({ type: 'monster_spawn', x: 97, y: 656, kind: 'pirate_captain', count: 1 });
    // A spawn given a radius of its own writes it.
    spawns[0].props = withProp(spawns[0], 'radius', 3);
    expect(toRpgdcMaps(p).maps[0].places).toContainEqual(expect.objectContaining({ x: spawns[0].c, y: spawns[0].r, radius: 3 }));
  });

  it('reaches the island by the ferry, as the game does: without its ferries, nothing there can be reached', () => {
    const p = project();
    const world = byGameId(p, 'overworld');
    const spawn = world.features.find((f) => f.type === 'spawn_point')!;
    const reached = reachable(world, [{ x: spawn.c, y: spawn.r }]);
    expect([reached[624 * 768 + 116], reached[360 * 768 + 37]]).toEqual([1, 1]);
    expect(errors(p)).toEqual([]);
    world.features = world.features.filter((f) => f.type !== 'ferry');
    expect(reachable(world, [{ x: spawn.c, y: spawn.r }])[624 * 768 + 116]).toBe(0);
    const found = errors(p).map((i) => i.message);
    expect(found.filter((m) => /^Fishing spot: swordfish .* has no walkable neighbour that can be reached from the spawn point\.$/.test(m))).toHaveLength(10);
    expect(found).toContain('Hidden cache (91, 660) has no walkable neighbour that can be reached from the spawn point.');
    expect(found).toContain('Ferry boat (116, 623) has no walkable neighbour that can be reached from the spawn point.');
    expect(found.slice(-2)).toEqual([
      'Boat (36, 360) has no ferry place: put a ferry place on it, saying where it sails.',
      'Boat (116, 623) has no ferry place: put a ferry place on it, saying where it sails.',
    ]);
  });

  /**
   * A bare 128×128 overworld of grass, Safe round the spawn point (3, 3) and Frontier beyond, with a
   * channel of water down columns 60 to 69: a boat at (60, 10) by the west shore sails to (70, 10)
   * on the east, where a cache stands at (90, 20).
   */
  const ferry = (x: number, y: number, toX: number, toY: number, fare: number | string, name: string, id = `fy-${x}-${y}-${toX}-${toY}`): Feature => ({
    id, type: 'ferry', c: x, r: y, name: `Ferry → ${name}`, props: { toX, toY, fare, name },
  });
  const sea = () => {
    const w = 128;
    const p = createProject('sea');
    const L = emptyLayers(w * w);
    L.terrain.fill(T.GRASS);
    L.zone.fill(2);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) L.zone[y * w + x] = 1;
    for (let y = 0; y < w; y++) for (let x = 60; x < 70; x++) L.terrain[y * w + x] = T.WATER;
    L.object[10 * w + 60] = O.BOAT;
    L.object[20 * w + 90] = O.CACHE;
    const map: WorldMap = {
      id: 'ow', name: 'World', kind: 'overland', scaleId: 'local', grid: 'iso', width: w, height: w, seed: 1,
      settings: { rpgdcMapId: 'overworld' }, layers: L, children: [],
      features: [{ id: 's', type: 'spawn_point', c: 3, r: 3, name: 'start' }, ferry(60, 10, 70, 10, 50, 'the East Bank')],
    };
    p.maps[map.id] = map;
    return { p, map };
  };
  const issues = (p: Project) => checkGameMaps(p).map((i) => [i.severity, i.message]);
  const broken = (fn: (map: WorldMap) => void) => {
    const { p, map } = sea();
    fn(map);
    return issues(p);
  };
  const CACHE = ['error', 'Hidden cache (90, 20) has no walkable neighbour that can be reached from the spawn point.'];

  it('passes a boat with its ferry, and exports and opens it', () => {
    const { p, map } = sea();
    expect(issues(p)).toEqual([]);
    const out = toRpgdcMaps(p).maps[0];
    expect([out.objectLegend[out.objects[10 * 128 + 60]], out.objects[10 * 128 + 60]]).toEqual(['boat', 71]);
    expect(out.places).toContainEqual({ type: 'ferry', x: 60, y: 10, toX: 70, toY: 10, fare: 50, name: 'the East Bank' });
    const back = Object.values(fromRpgdcMaps(toRpgdcMaps(p)).maps)[0];
    expect(back.layers.object[10 * 128 + 60]).toBe(O.BOAT);
    expect(ferries(back).map((f) => [f.x, f.y, f.toX, f.toY, f.fare, f.name, f.feature.name])).toEqual([[60, 10, 70, 10, 50, 'the East Bank', 'Ferry → the East Bank']]);
    // Only from beside the boat: with the jetty gone (water all round it), neither the boat nor the far bank can be reached.
    expect(reachable(map, [{ x: 3, y: 3 }])[20 * 128 + 89]).toBe(1);
    for (let y = 0; y < 128; y++) map.layers.terrain[y * 128 + 59] = T.WATER;
    expect(issues(p)).toEqual([['error', 'Ferry boat (60, 10) has no walkable neighbour that can be reached from the spawn point.'], CACHE]);
  });

  it('catches every broken ferry and boat, as the game does', () => {
    // A ferry place off its boat (still beside the shore): the boat then has none.
    expect(broken((m) => { m.features[1].c = 59; })).toEqual([
      ['error', "The ferry to the East Bank (59, 10) isn't on a boat: put it on a Ferry boat object."],
      ['error', 'Boat (60, 10) has no ferry place: put a ferry place on it, saying where it sails.'],
    ]);
    // Two ferries from one boat (the game won't load that).
    expect(broken((m) => { m.features.push(ferry(60, 10, 71, 11, 0, 'the Far Bank')); })).toEqual([
      ['error', "The ferry to the Far Bank (60, 10): there's already a ferry from this boat."],
    ]);
    // Landing on water, or off the map: nothing over there is reached.
    expect(broken((m) => { m.features[1].props!.toX = 65; })).toEqual([
      CACHE,
      ['error', "The ferry to the East Bank (60, 10) lands on (65, 10), which you can't walk on: pick where it lands."],
    ]);
    expect(broken((m) => { m.features[1].props!.toX = 500; })).toEqual([
      CACHE,
      ['error', "The ferry to the East Bank (60, 10) lands on (500, 10), which you can't walk on: pick where it lands."],
    ]);
    // Landing on a boulder.
    expect(broken((m) => { m.layers.object[10 * 128 + 70] = O.BOULDER; })).toEqual([
      CACHE,
      ['error', "The ferry to the East Bank (60, 10) lands on (70, 10), which you can't walk on: pick where it lands."],
    ]);
    // A fare that isn't 0 to 10000 whole coins.
    for (const fare of [-1, 10001, 2.5, 'lots']) {
      expect(broken((m) => { m.features[1].props!.fare = fare; }), String(fare)).toEqual([
        ['error', "The ferry to the East Bank (60, 10)'s fare must be a whole number of coins from 0 to 10000."],
      ]);
    }
    expect(broken((m) => { m.features[1].props!.fare = 0; })).toEqual([]);
    expect(broken((m) => { m.features[1].props!.fare = 10000; })).toEqual([]);
    // No name, or one longer than 40 letters.
    expect(broken((m) => { m.features[1].props!.name = '  '; })).toEqual([['error', 'The ferry (60, 10) needs a name: where it goes, in up to 40 letters.']]);
    expect(broken((m) => { m.features[1].props!.name = 'x'.repeat(41); })).toEqual([['error', `The ferry to ${'x'.repeat(41)} (60, 10) needs a name: where it goes, in up to 40 letters.`]]);
    // A boat with no ferry.
    expect(broken((m) => { m.features.pop(); })).toEqual([CACHE, ['error', 'Boat (60, 10) has no ferry place: put a ferry place on it, saying where it sails.']]);
    // A boat and its ferry back from the far bank: still fine.
    expect(broken((m) => { m.layers.object[12 * 128 + 69] = O.BOAT; m.features.push(ferry(69, 12, 59, 12, 0, 'the West Bank')); })).toEqual([]);
  });

  it('gives a new ferry a landing beside the nearest other boat, named after the landmark there', () => {
    const world = byGameId(project(), 'overworld');
    expect(newPlaceProps(world, 'ferry', { x: 36, y: 360 })).toEqual({ toX: 116, toY: 624, fare: 0, name: "Wrecker's Isle" });
    expect(newPlaceProps(world, 'ferry', { x: 116, y: 623 })).toEqual({ toX: 37, toY: 360, fare: 0, name: 'Gullhaven' });
    // With no other boat, the defaults: pick the landing, and name it.
    const { map } = sea();
    expect(newPlaceProps(map, 'ferry', { x: 60, y: 10 })).toEqual({ toX: 0, toY: 0, fare: 0, name: '' });
    // A second boat: beside it (in the game's order: east first), with no landmark to name it after.
    map.layers.object[30 * 128 + 69] = O.BOAT;
    expect(newPlaceProps(map, 'ferry', { x: 60, y: 10 })).toEqual({ toX: 70, toY: 30, fare: 0, name: '' });
    expect([namedLabel('ferry', " Wrecker's Isle "), namedLabel('landmark', 'the Oasis'), namedLabel('ferry', ' '), namedLabel('lever', 'x')]).toEqual([
      "Ferry → Wrecker's Isle", 'the Oasis', null, null,
    ]);
  });

  it('shows the route of a selected ferry, or of a tapped boat or landing, and no others', () => {
    const world = byGameId(project(), 'overworld');
    const [out, back] = world.features.filter((f) => f.type === 'ferry');
    const at = (x: number, y: number) => y * world.width + x;
    const shown = (sel: string | null, focus?: number) => ferriesShown(world, sel, focus).map((f) => f.name);
    expect(shown(null)).toEqual([]);
    expect(shown(out.id)).toEqual(["Wrecker's Isle"]);
    expect(shown(back.id)).toEqual(['Gullhaven']);
    expect(shown(null, at(36, 360))).toEqual(["Wrecker's Isle"]);
    expect(shown(null, at(116, 624))).toEqual(["Wrecker's Isle"]);
    expect(shown(null, at(37, 360))).toEqual(['Gullhaven']);
    expect(shown(null, at(200, 200))).toEqual([]);
  });

  it('lays a boat along its jetty and picks palms and wrecks by tile, as the game draws them', () => {
    const world = byGameId(project(), 'overworld');
    // The jetty runs north–south east of Gullhaven's boat: it lies along y. The island's boat has
    // its jetty to the south: along x.
    expect([boatFacing(world, 36, 360), boatFacing(world, 116, 623)]).toEqual(['y', 'x']);
    expect([seaFrame(world, 36, 360), seaFrame(world, 116, 623)]).toEqual(['boat-y', 'boat-x']);
    const frames = (o: number, n: number) => {
      const seen = new Map<string, number>();
      world.layers.object.forEach((v, i) => {
        if (v !== o) return;
        const f = seaFrame(world, i % world.width, Math.floor(i / world.width), n)!;
        seen.set(f, (seen.get(f) ?? 0) + 1);
      });
      return [...seen.keys()].sort();
    };
    expect(frames(O.PALM, 3)).toEqual(['palm/0', 'palm/1', 'palm/2']);
    expect(frames(O.WRECK, 2)).toEqual(['wreck/0', 'wreck/1']);
    // Without counts in the art (an older game server), the first of each.
    expect(frames(O.PALM, 1)).toEqual(['palm/0']);
    expect(seaFrame(world, 384, 384)).toBeNull();
  });

  it('counts a palm as a tree that can hide an altar, as the game draws it', () => {
    const { p, map } = sea();
    map.layers.object[30 * 128 + 30] = O.AIR_ALTAR;
    expect(checkGameMaps(p).some((i) => /Altar: air .* within 2 tiles of a tree/.test(i.message))).toBe(false);
    map.layers.object[31 * 128 + 31] = O.PALM;
    expect(checkGameMaps(p).some((i) => /Altar: air \(30, 30\) is within 2 tiles of a tree/.test(i.message))).toBe(true);
  });
});

describe('Farming: the patches at Giles’s Farm, Martha, the spinning wheels and the millstones', () => {
  const gameMap = (id: string) => file().maps.find((m) => m.id === id)!;
  /** Where a map in the file has an object, [x, y] in row order (none if its legend hasn't it). */
  const cellsOf = (m: RpgdcMapsFile['maps'][number], key: string) => {
    const k = m.objectLegend.indexOf(key);
    return k < 0 ? [] : m.objects.flatMap((v, i) => (v === k ? [[i % m.width, Math.floor(i / m.width)]] : []));
  };
  const FARM = ['patch_allotment', 'patch_herb', 'patch_tree', 'spinning_wheel', 'millstones'];
  const ALLOTMENTS = [340, 341, 342, 344, 345, 346].map((x) => [x, 404]);
  const HERB_PATCHES = [340, 341, 345, 346].map((x) => [x, 408]);
  const TREE_PATCHES = [[341, 410], [345, 410]];

  it('opens the farm’s patches, Martha, the spinning wheels and the millstones, and exports them as they were', () => {
    const p = project();
    const world = byGameId(p, 'overworld');
    expect(OBJECT_LEGEND.slice(75, 80)).toEqual(FARM);
    expect([O.PATCH_ALLOTMENT, O.PATCH_HERB, O.PATCH_TREE, O.SPINNING_WHEEL, O.MILLSTONES]).toEqual([75, 76, 77, 78, 79]);
    const at = (m: WorldMap, x: number, y: number) => m.layers.object[y * m.width + x];
    expect(ALLOTMENTS.map(([x, y]) => at(world, x, y))).toEqual(ALLOTMENTS.map(() => O.PATCH_ALLOTMENT));
    expect(HERB_PATCHES.map(([x, y]) => at(world, x, y))).toEqual(HERB_PATCHES.map(() => O.PATCH_HERB));
    expect(TREE_PATCHES.map(([x, y]) => at(world, x, y))).toEqual(TREE_PATCHES.map(() => O.PATCH_TREE));
    // The patches lie on the field's mud, and players walk over them; the workbenches are in the way.
    for (const [x, y] of [...ALLOTMENTS, ...HERB_PATCHES, ...TREE_PATCHES]) {
      expect(world.layers.terrain[y * world.width + x], `${x}, ${y}`).toBe(T.MUD);
      expect(isWalkableAt(world, x, y), `${x}, ${y}`).toBe(true);
    }
    const mill = byGameId(p, 'windmill');
    expect(at(mill, 2, 2)).toBe(O.MILLSTONES);
    expect(isWalkableAt(mill, 2, 2)).toBe(false);
    for (const [id, x, y] of [['farmhouse', 6, 4], ['tailor', 7, 3]] as const) {
      expect(at(byGameId(p, id), x, y), id).toBe(O.SPINNING_WHEEL);
      expect(isWalkableAt(byGameId(p, id), x, y), id).toBe(false);
    }
    // Martha, who sells seeds, just outside the field's gate.
    const martha = world.features.find((f) => f.type === 'npc' && f.props?.role === 'seeds')!;
    expect([martha.c, martha.r, martha.name]).toEqual([349, 404, "Seed seller (Martha, at Giles's Farm)"]);
    expect(NPC_ROLES.at(-2)).toEqual({ value: 'seeds', label: "Seed seller (Martha, at Giles's Farm)" });
    // Exported, and opened from that export, the same again.
    const out = toRpgdcMaps(p);
    const again = toRpgdcMaps(fromRpgdcMaps(out));
    for (const f of [out, again]) {
      for (const id of ['overworld', 'windmill', 'farmhouse', 'tailor']) {
        for (const key of FARM) expect(cellsOf(f.maps.find((m) => m.id === id)!, key), `${id} ${key}`).toEqual(cellsOf(gameMap(id), key));
      }
      expect(f.maps[0].places).toContainEqual({ type: 'npc', x: 349, y: 404, role: 'seeds' });
    }
  });

  it('walks over a patch as over the ground under it, as the game does: a patch never changes the way', () => {
    const { p, map } = bareWorld();
    const w = map.width;
    // A row of patches across the whole map: the far side is still reached, and no error.
    for (let x = 0; x < w; x++) map.layers.object[40 * w + x] = [O.PATCH_ALLOTMENT, O.PATCH_HERB, O.PATCH_TREE][x % 3];
    map.layers.object[60 * w + 60] = O.CACHE;
    expect(reachable(map, [{ x: 3, y: 3 }])[60 * w + 59]).toBe(1);
    expect(errs(p)).toEqual([]);
    // On water a patch is water (it has no tile of its own), unlike a thicket, which is walkable anywhere.
    map.layers.terrain[20 * w + 20] = T.WATER;
    map.layers.object[20 * w + 20] = O.PATCH_HERB;
    map.layers.terrain[20 * w + 22] = T.WATER;
    map.layers.object[20 * w + 22] = O.THICKET;
    expect([isWalkableAt(map, 20, 20), isWalkableAt(map, 22, 20)]).toEqual([false, true]);
    expect([walkableTiles(map)[20 * w + 20], walkableTiles(map)[20 * w + 22]]).toEqual([0, 1]);
    // Inside a building's walls, an object's cell isn't wall: a patch there is the ground's, as in the game.
    map.features.push({ id: 'b', type: 'building', c: 30, r: 30, name: 'Shed', props: { w: 3, h: 3, style: 'timber', sign: 'Shed', roof: '', walls: '' } });
    map.layers.object[31 * w + 31] = O.PATCH_ALLOTMENT;
    expect([isWalkableAt(map, 31, 31), isWalkableAt(map, 30, 31)]).toEqual([true, false]);
    expect([walkableTiles(map)[31 * w + 31], walkableTiles(map)[31 * w + 30]]).toEqual([1, 0]);
  });

  it('needs every patch and workbench usable from a tile players can reach, as the game does', () => {
    for (const o of [O.PATCH_ALLOTMENT, O.PATCH_HERB, O.PATCH_TREE, O.SPINNING_WHEEL, O.MILLSTONES]) {
      const { p, map } = bareWorld();
      map.layers.object[50 * map.width + 50] = o;
      expect(errs(p), OBJECTS[o].key).toEqual([]);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) map.layers.object[(50 + dy) * map.width + 50 + dx] = O.BOULDER;
      expect(errs(p), OBJECTS[o].key).toEqual([`${OBJECTS[o].name} (50, 50) has no walkable neighbour that can be reached from the spawn point.`]);
    }
  });

  it('doesn’t count a herb patch as a wild herb: the game counts only its eight herb_ objects', () => {
    const { p, map } = bareWorld();
    // In town, on cobbles, beside a tree: all fine for a herb patch.
    map.layers.terrain[4 * map.width + 4] = T.TOWN_FLOOR;
    map.layers.object[4 * map.width + 4] = O.PATCH_HERB;
    map.layers.object[5 * map.width + 5] = O.OAK;
    expect(checkGameMaps(p)).toEqual([]);
    // A wild herb there is warned about.
    map.layers.object[4 * map.width + 4] = O.HERB_SUNLEAF;
    const warnings = checkGameMaps(p).map((i) => i.message);
    expect(warnings.some((m) => /wild herb\(s\): the game uses just these/.test(m))).toBe(true);
    expect(warnings.some((m) => /Sunleaf \(4, 4\) is in the safe zone/.test(m))).toBe(true);
  });

  it('lists the patches under Farming and the workbenches with the others', () => {
    expect(GAME_OBJECTS.filter((d) => d.group === 'farm').map((d) => [d.key, d.name, d.useFromNeighbour, d.blocks])).toEqual([
      ['patch_allotment', 'Allotment', true, false],
      ['patch_herb', 'Herb patch', true, false],
      ['patch_tree', 'Tree patch', true, false],
    ]);
    expect([O.SPINNING_WHEEL, O.MILLSTONES].map((o) => [OBJECTS[o].name, OBJECTS[o].group, OBJECTS[o].blocks])).toEqual([
      ['Spinning wheel', 'station', true],
      ['Millstones', 'station', true],
    ]);
  });

  it('draws them with the game’s frames: the patches flat from the world sheet, the workbenches from the indoor sheet', () => {
    expect([O.PATCH_ALLOTMENT, O.PATCH_HERB, O.PATCH_TREE, O.SPINNING_WHEEL, O.MILLSTONES].map(farmFrame)).toEqual([
      { sheet: 'world', frame: 'patch-allotment', flat: true },
      { sheet: 'world', frame: 'patch-herb', flat: true },
      { sheet: 'world', frame: 'patch-tree', flat: true },
      { sheet: 'indoor', frame: 'spinning_wheel', flat: false },
      { sheet: 'indoor', frame: 'millstones', flat: false },
    ]);
    expect([O.HERB_SUNLEAF, O.SEWING_TABLE, 0].map(farmFrame)).toEqual([null, null, null]);
  });

  /** A bare 128×128 overworld of grass: Safe round the spawn point (3, 3), Frontier beyond. */
  function bareWorld() {
    const w = 128;
    const p = createProject('farm');
    const L = emptyLayers(w * w);
    L.terrain.fill(T.GRASS);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) L.zone[y * w + x] = x < 8 && y < 8 ? 1 : 2;
    const map: WorldMap = {
      id: 'ow', name: 'World', kind: 'overland', scaleId: 'local', grid: 'iso', width: w, height: w, seed: 1,
      settings: { rpgdcMapId: 'overworld' }, layers: L, children: [],
      features: [{ id: 's', type: 'spawn_point', c: 3, r: 3, name: 'start' }],
    };
    p.maps[map.id] = map;
    return { p, map };
  }
  function errs(p: Project) {
    return errors(p).map((i) => i.message);
  }
});

describe('Land and houses: plots of land, the land agents, the sawbench and limestone', () => {
  const gameMap = (id: string) => file().maps.find((m) => m.id === id)!;
  /** Where a map in the file has an object, [x, y] in row order (none if its legend hasn't it). */
  const cellsOf = (m: RpgdcMapsFile['maps'][number], key: string) => {
    const k = m.objectLegend.indexOf(key);
    return k < 0 ? [] : m.objects.flatMap((v, i) => (v === k ? [[i % m.width, Math.floor(i / m.width)]] : []));
  };
  const LIMESTONE = [[323, 366], [327, 366], [331, 366], [325, 367], [321, 368], [333, 368], [324, 369], [335, 369]];
  const LARGE = ['plot3', 'plot5', 'plot13', 'plot17', 'plot25', 'plot29', 'plot30', 'plot31'];

  it('opens the plots, the land agents, the sawbench and the limestone, and exports them as they were', () => {
    const p = project();
    const world = byGameId(p, 'overworld');
    expect(OBJECT_LEGEND.slice(80, 82)).toEqual(['sawbench', 'limestone_rock']);
    expect([O.SAWBENCH, O.LIMESTONE_ROCK]).toEqual([80, 81]);
    const at = (x: number, y: number) => world.layers.object[y * world.width + x];
    // The sawbench in the carpenter's yard, the limestone in the Old Quarry: both in the way.
    expect(at(397, 396)).toBe(O.SAWBENCH);
    expect(isWalkableAt(world, 397, 396)).toBe(false);
    expect(cellsOf(gameMap('overworld'), 'limestone_rock')).toEqual(LIMESTONE);
    for (const [x, y] of LIMESTONE) {
      expect(at(x, y), `${x}, ${y}`).toBe(O.LIMESTONE_ROCK);
      expect(isWalkableAt(world, x, y), `${x}, ${y}`).toBe(false);
    }
    expect(landmarkAt(landmarks(world), 323, 366)?.name).toBe('the Old Quarry');
    // 36 plots, eight of them large, each labelled with its id.
    const land = plots(world);
    expect(land).toHaveLength(36);
    expect(land.map((q) => q.id)).toEqual(Array.from({ length: 36 }, (_, k) => `plot${k + 1}`));
    expect(land.filter((q) => q.size === 20).map((q) => q.id)).toEqual(LARGE);
    expect(land.every((q) => q.size === 12 || q.size === 20)).toBe(true);
    expect(land.every((q) => q.feature.name === q.id)).toBe(true);
    const p11 = land.find((q) => q.id === 'plot11')!;
    expect([p11.x, p11.y, p11.size]).toEqual([370, 344, 12]);
    // The land agents, in town by the bank and in Gullhaven.
    const agents = world.features.filter((f) => f.type === 'npc' && f.props?.role === 'land_agent').map((f) => [f.c, f.r, f.name]);
    expect(agents).toEqual([
      [380, 381, 'Land agent (Pemberton, sells plots of land)'],
      [58, 357, 'Land agent (Pemberton, sells plots of land)'],
    ]);
    expect(NPC_ROLES.at(-1)).toEqual({ value: 'land_agent', label: 'Land agent (Pemberton, sells plots of land)' });
    // Exported, and opened from that export, the same again.
    const out = toRpgdcMaps(p);
    const again = toRpgdcMaps(fromRpgdcMaps(out));
    const ours = (places: RpgdcMapsFile['maps'][number]['places']) => places.filter((pl) => pl.type === 'plot' || (pl.type === 'npc' && pl.role === 'land_agent')).map(placeKey).sort();
    for (const f of [out, again]) {
      const ow = f.maps.find((m) => m.id === 'overworld')!;
      for (const key of ['sawbench', 'limestone_rock']) expect(cellsOf(ow, key), key).toEqual(cellsOf(gameMap('overworld'), key));
      expect(ours(ow.places)).toEqual(ours(gameMap('overworld').places));
      expect(ow.places.filter((pl) => pl.type === 'plot')).toHaveLength(36);
    }
    expect(out.maps[0].places).toContainEqual({ type: 'plot', x: 370, y: 344, id: 'plot11', size: 12 });
    // Plots are written last, after the ferries.
    expect(out.maps[0].places.at(-1)).toEqual({ type: 'plot', x: land[35].x, y: land[35].y, id: 'plot36', size: land[35].size });
  });

  it('knows where a plot is, where its sign stands, and what the status bar says about it', () => {
    const world = byGameId(project(), 'overworld');
    expect(plotSign({ x: 370, y: 344, size: 12 })).toEqual({ x: 376, y: 355 });
    expect(plotSign({ x: 362, y: 158, size: 20 })).toEqual({ x: 372, y: 177 });
    const land = plots(world);
    expect(plotAt(land, 370, 344)?.id).toBe('plot11');
    expect(plotAt(land, 381, 355)?.id).toBe('plot11');
    expect(plotAt(land, 382, 355)).toBeNull();
    expect(plotAt(land, 384, 384)).toBeNull();
    expect(plotStatus(world, 376, 355)).toBe('plot plot11 (12×12), its sign');
    expect(plotStatus(world, 371, 345)).toBe('plot plot11 (12×12)');
    expect(plotStatus(world, 372, 177)).toBe('plot plot3 (20×20), its sign');
    expect(plotStatus(world, 384, 384)).toBeNull();
  });

  it('outlines every plot, the selected one or the one tapped stronger', () => {
    const world = byGameId(project(), 'overworld');
    const strong = (sel: string | null, focus?: number) => plotAreas(world, sel, focus).filter((a) => a.strong).map((a) => a.plot.id);
    expect(plotAreas(world, null)).toHaveLength(36);
    expect(strong(null)).toEqual([]);
    const p11 = plots(world).find((q) => q.id === 'plot11')!;
    expect(strong(p11.feature.id)).toEqual(['plot11']);
    expect(strong(null, 350 * world.width + 375)).toEqual(['plot11']);
    expect(strong(null, 200 * world.width + 200)).toEqual([]);
  });

  it('gives a new plot an id not used yet, and labels it with its id', () => {
    const world = byGameId(project(), 'overworld');
    expect(newPlaceProps(world, 'plot', { x: 100, y: 100 })).toEqual({ id: 'plot37', size: 12 });
    const { map } = bareWorld();
    expect(newPlaceProps(map, 'plot', { x: 40, y: 40 })).toEqual({ id: 'plot1', size: 12 });
    map.features.push(plot(70, 70, 'plot2'));
    expect(newPlaceProps(map, 'plot', { x: 40, y: 40 })).toEqual({ id: 'plot3', size: 12 });
    expect([placeLabel('plot', { id: ' plot9 ' }), placeLabel('plot', { id: '' }), placeLabel('fort', { name: 'the Deep Keep' }), placeLabel('ferry', { name: 'Gullhaven' }), placeLabel('npc', { role: 'banker' })]).toEqual([
      'plot9', null, 'the Deep Keep', 'Ferry → Gullhaven', null,
    ]);
  });

  it('exports a plot and opens it again', () => {
    const { p, map } = bareWorld();
    map.features.push(plot(40, 40, 'plot_mere', 20));
    expect(errs(p)).toEqual([]);
    const out = toRpgdcMaps(p).maps[0];
    expect(out.places).toContainEqual({ type: 'plot', x: 40, y: 40, id: 'plot_mere', size: 20 });
    const back = Object.values(fromRpgdcMaps(toRpgdcMaps(p)).maps)[0];
    expect(plots(back).map((q) => [q.x, q.y, q.id, q.size, q.feature.name])).toEqual([[40, 40, 'plot_mere', 20, 'plot_mere']]);
  });

  it('catches every broken plot, as the game does', () => {
    const plotErrs = (fn: (map: WorldMap, p: Project) => void) => {
      const { p, map } = bareWorld();
      map.features.push(plot(40, 40, 'plot_a'));
      fn(map, p);
      return errs(p).filter((m) => /plot/.test(m));
    };
    const w = 128;
    expect(plotErrs(() => {})).toEqual([]);
    // What the game won't load: an id, a size, the map's edge.
    expect(plotErrs((m) => { m.features[1].props!.id = ''; })).toEqual(['The plot (40, 40) needs an id of lower-case letters, digits and _ (like plot_mere).']);
    expect(plotErrs((m) => { m.features[1].props!.id = 'Plot A'; })).toEqual(['The plot Plot A needs an id of lower-case letters, digits and _ (like plot_mere).']);
    expect(plotErrs((m) => { m.features.push(plot(70, 40, 'plot_a')); })).toEqual(["The plot plot_a (70, 40): there's already a plot called plot_a, at (40, 40)."]);
    expect(plotErrs((m) => { m.features[1].props!.size = 16; })).toEqual(["The plot plot_a's size must be 12 or 20 (tiles a side)."]);
    expect(plotErrs((m) => { m.features[1].c = 120; })).toEqual(['The plot plot_a runs off the map.']);
    expect(plotErrs((m) => { m.features[1].props!.size = 20; m.features[1].r = 110; })).toEqual(['The plot plot_a runs off the map.']);
    // The game's checkMaps: the first thing wrong, scanning its tiles from the north-west.
    expect(plotErrs((m) => { m.features[1].c = 2; m.features[1].r = 2; })).toEqual(['The plot plot_a reaches into the Safe zone at (2, 2): plots are out in the wilds.']);
    expect(plotErrs((m) => { m.layers.object[45 * w + 46] = O.BOULDER; })).toEqual(['The plot plot_a has a boulder on it at (46, 45): a plot must be open ground.']);
    expect(plotErrs((m) => { m.layers.object[45 * w + 46] = O.PATCH_ALLOTMENT; })).toEqual(['The plot plot_a has an allotment on it at (46, 45): a plot must be open ground.']);
    expect(plotErrs((m) => { m.layers.terrain[44 * w + 41] = T.WATER; m.layers.object[45 * w + 46] = O.BOULDER; })).toEqual(["The plot plot_a has ground you can't walk on at (41, 44)."]);
    expect(plotErrs((m) => {
      m.features.push({ id: 'b', type: 'building', c: 48, r: 48, name: 'Shed', props: { w: 3, h: 3, style: 'timber', sign: 'Shed', roof: '', walls: '' } });
    }).at(-1)).toBe("The plot plot_a has ground you can't walk on at (48, 48).");
    // Walled off by a moat all round it: walkable, but out of reach.
    expect(plotErrs((m) => {
      for (let k = 39; k <= 52; k++) for (const [x, y] of [[k, 39], [k, 52], [39, k], [52, k]]) m.layers.terrain[y * w + x] = T.WATER;
    })).toEqual(["The plot plot_a can't be reached from the spawn point at (40, 40)."]);
    // Places standing on it.
    const on = (f: Feature) => plotErrs((m) => { m.features.push(f); });
    expect(on({ id: 'n', type: 'npc', c: 45, r: 45, name: 'x', props: { role: 'land_agent' } })).toEqual(['The plot plot_a has the land agent on it at (45, 45).']);
    expect(on({ id: 'm', type: 'monster_spawn', c: 45, r: 46, name: 'x', props: { kind: 'giant_crab', count: 2, radius: 3 } })).toEqual(['The plot plot_a has a giant crab spawn on it at (45, 46).']);
    expect(on({ id: 'f', type: 'fort', c: 45, r: 45, name: 'x', props: { id: 'deep_keep', name: 'the Deep Keep' } })).toContain('The plot plot_a has the fort deep_keep on it at (45, 45).');
    expect(on({ id: 't', type: 'merchant', c: 51, r: 51, name: 'x' })).toContain('The plot plot_a has the travelling merchant on it at (51, 51).');
    expect(on({ id: 'l', type: 'link', c: 40, r: 51, name: 'x', props: { toMap: 'overworld', toX: 3, toY: 3 } })).toContain('The plot plot_a has a door or stairs on it at (40, 51).');
    // Just outside it is fine.
    expect(on({ id: 'n', type: 'npc', c: 52, r: 45, name: 'x', props: { role: 'villager' } })).toEqual([]);
    // Overlapping another plot: both are wrong. Side by side is fine.
    expect(plotErrs((m) => { m.features.push(plot(51, 51, 'plot_b')); })).toEqual(['The plot plot_a overlaps the plot plot_b.', 'The plot plot_b overlaps the plot plot_a.']);
    expect(plotErrs((m) => { m.features.push(plot(52, 40, 'plot_b', 20)); })).toEqual([]);
    // Only on the overworld.
    expect(plotErrs((_, p) => {
      const L = emptyLayers(64);
      L.terrain.fill(T.PLANKS);
      p.maps.shed = {
        id: 'shed', name: 'Shed', kind: 'dungeon', scaleId: 'dungeon', grid: 'iso', width: 8, height: 8, seed: 1, layers: L, children: [],
        settings: { rpgdcMapId: 'shed', rpgdcKind: 'interior', rpgdcZone: 'safe' }, features: [plot(0, 0, 'plot_c')],
      };
    })).toEqual(["The plot plot_c isn't on the overworld: plots go on the overworld."]);
  });

  it('needs the sawbench usable from a tile players can reach, like every workbench', () => {
    const { p, map } = bareWorld();
    map.layers.object[50 * map.width + 50] = O.SAWBENCH;
    map.layers.object[60 * map.width + 60] = O.LIMESTONE_ROCK;
    expect(errs(p)).toEqual([]);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) map.layers.object[(50 + dy) * map.width + 50 + dx] = O.BOULDER;
    expect(errs(p)).toEqual(['Sawbench (50, 50) has no walkable neighbour that can be reached from the spawn point.']);
  });

  it('lists the sawbench with the workbenches and limestone with the ore', () => {
    expect([O.SAWBENCH, O.LIMESTONE_ROCK].map((o) => [OBJECTS[o].key, OBJECTS[o].name, OBJECTS[o].group, OBJECTS[o].blocks, OBJECTS[o].useFromNeighbour])).toEqual([
      ['sawbench', 'Sawbench', 'station', true, true],
      ['limestone_rock', 'Limestone rock', 'ore', true, false],
    ]);
    expect(GAME_OBJECTS.slice(-2).map((d) => d.key)).toEqual(['limestone_rock', 'guild_chest']);
  });

  it('draws them with the game’s frames: the sawbench from the indoor sheet, limestone from the world sheet', () => {
    expect([O.SAWBENCH, O.LIMESTONE_ROCK].map(constructionFrame)).toEqual([
      { sheet: 'indoor', frame: 'sawbench' },
      { sheet: 'world', frame: 'ore-limestone' },
    ]);
    expect([O.SPINNING_WHEEL, O.COPPER_ROCK, 0].map(constructionFrame)).toEqual([null, null, null]);
  });

  it('opens the guild chest beside the bank chest in each bank, and exports it as it was', () => {
    const p = project();
    expect(OBJECT_LEGEND[82]).toBe('guild_chest');
    expect(O.GUILD_CHEST).toBe(82);
    for (const [id, bank, guild] of [['bank', [1, 4], [9, 4]], ['port_bank', [1, 4], [7, 4]]] as const) {
      const m = byGameId(p, id);
      expect(m.layers.object[bank[1] * m.width + bank[0]], id).toBe(O.BANK);
      expect(m.layers.object[guild[1] * m.width + guild[0]], id).toBe(O.GUILD_CHEST);
      expect(isWalkableAt(m, guild[0], guild[1]), id).toBe(false);
      expect(cellsOf(gameMap(id), 'guild_chest'), id).toEqual([[...guild]]);
    }
    const out = toRpgdcMaps(p);
    for (const id of ['bank', 'port_bank']) {
      const m = out.maps.find((q) => q.id === id)!;
      expect(cellsOf(m, 'guild_chest'), id).toEqual(cellsOf(gameMap(id), 'guild_chest'));
      expect(cellsOf(m, 'bank'), id).toEqual(cellsOf(gameMap(id), 'bank'));
    }
    expect(errors(p)).toEqual([]);
  });

  it('lists the guild chest with the stations, used from beside it, and draws it as the game does', () => {
    expect([OBJECTS[O.GUILD_CHEST]].map((d) => [d.key, d.name, d.group, d.blocks, d.useFromNeighbour])).toEqual([['guild_chest', 'Guild chest', 'station', true, true]]);
    expect(constructionFrame(O.GUILD_CHEST)).toEqual({ sheet: 'indoor', frame: 'guild_chest' });
    const { p, map } = bareWorld();
    map.layers.object[50 * map.width + 50] = O.GUILD_CHEST;
    expect(errs(p)).toEqual([]);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) map.layers.object[(50 + dy) * map.width + 50 + dx] = O.BOULDER;
    expect(errs(p)).toEqual(['Guild chest (50, 50) has no walkable neighbour that can be reached from the spawn point.']);
  });

  /** A plot place: its north-west corner, id and size. */
  function plot(x: number, y: number, id: string, size = 12): Feature {
    return { id: `plot-${id}-${x}-${y}`, type: 'plot', c: x, r: y, name: id, props: { id, size } };
  }
  /** A bare 128×128 overworld of grass: Safe round the spawn point (3, 3), Frontier beyond. */
  function bareWorld() {
    const w = 128;
    const p = createProject('land');
    const L = emptyLayers(w * w);
    L.terrain.fill(T.GRASS);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) L.zone[y * w + x] = x < 8 && y < 8 ? 1 : 2;
    const map: WorldMap = {
      id: 'ow', name: 'World', kind: 'overland', scaleId: 'local', grid: 'iso', width: w, height: w, seed: 1,
      settings: { rpgdcMapId: 'overworld' }, layers: L, children: [],
      features: [{ id: 's', type: 'spawn_point', c: 3, r: 3, name: 'start' }],
    };
    p.maps[map.id] = map;
    return { p, map };
  }
  function errs(p: Project) {
    return errors(p).map((i) => i.message);
  }
});
