import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { O, OBJECTS } from '../src/core/objects';
import { createProject, parseProject, parseProjectReport, serializeProject } from '../src/core/project';
import { checkGameMaps } from '../src/core/rpgdc/checks';
import { toRpgdcMaps } from '../src/core/rpgdc/export';
import { NEIGHBOURS, isWalkableAt, zoneByDistance } from '../src/core/rpgdc/game';
import { T, TILES } from '../src/core/tiles';
import { Feature, Project, WorldMap, emptyLayers } from '../src/core/types';
import { make } from './helpers';

const FIXTURE = readFileSync(new URL('./fixtures/rpg-dc.world.json', import.meta.url), 'utf8');
type Raw = { maps: Record<string, WorldMap & { layers: { rpgdcTile: number[] } }> };
const raw = (): Raw => JSON.parse(FIXTURE);
const load = (text = FIXTURE) => parseProjectReport(text);
const migrated = () => load().project;
const byGameId = (p: Project, id: string) => Object.values(p.maps).find((m) => m.settings.rpgdcMapId === id)!;
const cheb = (a: { c: number; r: number }, c: number, r: number) => Math.max(Math.abs(a.c - c), Math.abs(a.r - r));
const count = <T>(xs: T[], pred: (x: T) => boolean) => xs.reduce((n, x) => n + (pred(x) ? 1 : 0), 0);

/** Game tile → the ground and objects it may become. */
const EXPECT: Record<number, { ground: number[]; object: number[] }> = {
  0: { ground: [T.GRASS], object: [0] },
  1: { ground: [T.PATH], object: [0] },
  2: { ground: [T.WATER], object: [0] },
  3: { ground: [T.GRASS], object: [O.BOULDER, O.FENCE] },
  4: { ground: [T.GRASS], object: [O.TREE, O.OAK, O.WILLOW] },
  5: { ground: [T.TOWN_FLOOR], object: [0] },
  6: { ground: [T.GRASS], object: [O.COPPER_ROCK] },
  7: { ground: [T.GRASS], object: [O.TIN_ROCK] },
  8: { ground: [T.GRASS], object: [O.IRON_ROCK] },
  9: { ground: [T.TOWN_FLOOR], object: [O.BANK] },
  10: { ground: [T.CRYPT_WALL], object: [0] },
  11: { ground: [T.CRYPT_FLOOR], object: [0] },
  12: { ground: [T.GRASS], object: [O.CRYPT_ENTRANCE] },
  13: { ground: [T.CRYPT_FLOOR], object: [O.STAIRS_DOWN] },
  14: { ground: [T.CRYPT_FLOOR], object: [O.STAIRS_UP] },
  15: { ground: [T.TOWN_FLOOR], object: [O.SHOP] },
  16: { ground: [T.TOWN_FLOOR], object: [O.FURNACE] },
  17: { ground: [T.TOWN_FLOOR], object: [O.ANVIL] },
  18: { ground: [T.TOWN_FLOOR], object: [O.COOKING_FIRE] },
  19: { ground: [T.WATER], object: [O.FISHING_SHRIMP, O.FISHING_TROUT, O.FISHING_SALMON] },
};

describe('RPG-DC migration of the attached project', () => {
  it('converts every map once and drops the rpgdcTile layer', () => {
    const { project, migrated: ids } = load();
    expect(ids.sort()).toEqual(['rpgdc-crypt1', 'rpgdc-crypt2', 'rpgdc-crypt3', 'rpgdc-overworld']);
    for (const m of Object.values(project.maps)) expect('rpgdcTile' in m.layers).toBe(false);
    const again = parseProjectReport(serializeProject(project));
    expect(again.migrated).toEqual([]);
    expect(again.project).toEqual(project);
  });

  it('gives every cell the ground and object of its game tile', () => {
    const before = raw();
    const p = migrated();
    for (const [id, src] of Object.entries(before.maps)) {
      const m = p.maps[id];
      const tiles = src.layers.rpgdcTile;
      const town = src.features.find((f) => f.type === 'town');
      for (let i = 0; i < tiles.length; i++) {
        const e = EXPECT[tiles[i]];
        expect(e.ground, `${id} cell ${i}`).toContain(m.layers.terrain[i]);
        expect(e.object, `${id} cell ${i}`).toContain(m.layers.object[i]);
        if (tiles[i] === 3) expect(m.layers.object[i]).toBe(town && cheb(town, i % m.width, Math.floor(i / m.width)) <= 6 ? O.FENCE : O.BOULDER);
      }
      // Per-kind counts match the game's tiles.
      for (const [game, e] of Object.entries(EXPECT)) {
        const n = count(tiles, (t) => t === Number(game));
        const got = count(m.layers.object.map((o, i) => [o, m.layers.terrain[i]]), ([o, g]) => e.object.includes(o) && e.ground.includes(g) && (e.object[0] !== 0 || o === 0));
        if (e.object[0] !== 0) expect(got, `${id} game tile ${game}`).toBe(n);
      }
    }
  });

  it('keeps tree species and fishing kinds', () => {
    const src = raw().maps['rpgdc-overworld'];
    const m = migrated().maps['rpgdc-overworld'];
    const terr = src.layers.terrain;
    expect(count(m.layers.object, (o) => o === O.TREE)).toBe(count(terr, (t) => t === T.TAIGA));
    expect(count(m.layers.object, (o) => o === O.OAK)).toBe(count(terr, (t) => t === T.FOREST));
    expect(count(m.layers.object, (o) => o === O.WILLOW)).toBe(count(terr, (t) => t === T.SWAMP));
    expect(count(m.layers.object, (o) => o === O.FENCE)).toBe(count(terr, (t) => t === T.WALL));
    const fish: Record<string, number> = { shrimp_spot: O.FISHING_SHRIMP, trout_spot: O.FISHING_TROUT, salmon_spot: O.FISHING_SALMON };
    const spots = src.features.filter((f) => f.type === 'fishing_spot');
    expect(spots.length).toBe(28);
    for (const f of spots) expect(m.layers.object[f.r * m.width + f.c]).toBe(fish[f.tags![0]]);
  });

  it('sets zones by distance from town, and one zone per crypt floor', () => {
    const p = migrated();
    const ow = byGameId(p, 'overworld');
    const town = ow.features.find((f) => f.type === 'town')!;
    for (let i = 0; i < ow.layers.zone.length; i++) {
      expect(ow.layers.zone[i]).toBe(zoneByDistance(cheb(town, i % ow.width, Math.floor(i / ow.width))));
    }
    expect(count(ow.layers.zone, (z) => z === 1)).toBe(13 * 13);
    expect(byGameId(p, 'crypt1').settings.rpgdcZone).toBe('wilderness');
    expect(byGameId(p, 'crypt2').settings.rpgdcZone).toBe('deep');
    expect(byGameId(p, 'crypt3').settings.rpgdcZone).toBe('deep');
  });

  it('turns markers into typed places and pairs the stairs with links', () => {
    const src = raw();
    const p = migrated();
    for (const [id, s] of Object.entries(src.maps)) {
      const m = p.maps[id];
      const monsters = s.features.filter((f) => f.type === 'monster');
      const spawns = m.features.filter((f) => f.type === 'monster_spawn');
      expect(spawns.map((f) => [f.c, f.r, f.props?.kind, f.props?.count, f.props?.radius])).toEqual(
        monsters.map((f) => [f.c, f.r, f.tags![0], 1, 0]),
      );
      expect(count(m.features, (f) => f.type === 'brazier')).toBe(count(s.features, (f) => f.type === 'brazier'));
      for (const gone of ['bank', 'shop', 'furnace', 'anvil', 'cooking_fire', 'fishing_spot', 'mine', 'monster', 'dungeon', 'stairs_down', 'entrance']) {
        expect(m.features.some((f) => f.type === gone), `${id} still has ${gone}`).toBe(false);
      }
    }
    expect(byGameId(p, 'crypt3').features.find((f) => f.type === 'boss')?.props).toEqual({ kind: 'bone_king' });
    expect(count(byGameId(p, 'overworld').features, (f) => f.type === 'spawn_point')).toBe(1);

    const link = (gid: string, c: number, r: number) => byGameId(p, gid).features.find((f) => f.type === 'link' && f.c === c && f.r === r)!.props;
    // Down: arrive just east of the stairs up. Up: first walkable tile beside the stairs down.
    expect(link('overworld', 36, 44)).toEqual({ toMap: 'crypt1', toX: 19, toY: 7 });
    expect(link('crypt1', 18, 7)).toEqual({ toMap: 'overworld', toX: 37, toY: 44 });
    expect(link('crypt1', 27, 40)).toEqual({ toMap: 'crypt2', toX: 19, toY: 11 });
    expect(link('crypt2', 18, 11)).toEqual({ toMap: 'crypt1', toX: 28, toY: 40 });
    expect(link('crypt2', 41, 33)).toEqual({ toMap: 'crypt3', toX: 7, toY: 15 });
    expect(link('crypt3', 6, 15)).toEqual({ toMap: 'crypt2', toX: 42, toY: 33 });
    for (const m of Object.values(p.maps)) {
      for (const f of m.features.filter((x) => x.type === 'link')) {
        const target = byGameId(p, String(f.props!.toMap));
        expect(isWalkableAt(target, Number(f.props!.toX), Number(f.props!.toY))).toBe(true);
      }
    }
    // The atlas link to the child map survives.
    expect(byGameId(p, 'overworld').features.find((f) => f.type === 'link')?.childMapId).toBe('rpgdc-crypt1');
  });

  it('passes every game check', () => {
    expect(checkGameMaps(migrated())).toEqual([]);
  });

  it('maps edited stand-in terrain back', () => {
    const src = raw();
    const ow = src.maps['rpgdc-overworld'];
    const w = ow.width;
    const cells = (game: number, n: number, pred: (i: number) => boolean = () => true) =>
      ow.layers.rpgdcTile.map((t, i) => (t === game && pred(i) ? i : -1)).filter((i) => i >= 0).slice(0, n);
    const [lakeTree] = cells(4, 1);
    const [mtn, wall, plaza, forest, desert, roadGrass] = cells(0, 6, (i) => ow.layers.road[i] === 0);
    const [bareRoad] = cells(1, 1, (i) => ow.layers.terrain[i] === T.GRASSLAND);
    const mines = ow.features.filter((f) => f.type === 'mine');
    const [bad] = cells(0, 1, (i) => cheb(mines[5], i % w, Math.floor(i / w)) === 2);
    ow.layers.terrain[lakeTree] = T.LAKE;
    ow.layers.terrain[mtn] = T.MOUNTAINS;
    ow.layers.terrain[wall] = T.WALL;
    ow.layers.terrain[plaza] = T.PLAZA;
    ow.layers.terrain[forest] = T.FOREST;
    ow.layers.terrain[desert] = T.DESERT;
    ow.layers.road[roadGrass] = 1;
    ow.layers.road[bareRoad] = 0;
    ow.layers.terrain[bad] = T.BADLANDS;
    const crypt = src.maps['rpgdc-crypt1'];
    const wallCell = crypt.layers.rpgdcTile.indexOf(10);
    const floorCell = crypt.layers.rpgdcTile.indexOf(11);
    crypt.layers.terrain[wallCell] = T.FLOOR;
    crypt.layers.terrain[floorCell] = T.STAIRS_UP;

    const p = parseProject(JSON.stringify(src));
    const L = p.maps['rpgdc-overworld'].layers;
    const at = (i: number) => [TILES[L.terrain[i]].key, OBJECTS[L.object[i]].key];
    expect(at(lakeTree)).toEqual(['water', '']);
    expect(at(mtn)).toEqual(['grass', 'boulder']);
    expect(at(wall)).toEqual(['grass', 'fence']);
    expect(at(plaza)).toEqual(['town_floor', '']);
    expect(at(forest)).toEqual(['grass', 'oak']);
    expect(at(desert)).toEqual(['grass', '']);
    expect(at(roadGrass)).toEqual(['path', '']);
    expect(at(bareRoad)).toEqual(['grass', '']);
    const nearest = [...mines].sort((a, b) => Math.hypot(a.c - (bad % w), a.r - Math.floor(bad / w)) - Math.hypot(b.c - (bad % w), b.r - Math.floor(bad / w)))[0];
    expect(at(bad)).toEqual(['grass', `${nearest.tags![0]}_rock`]);
    const C = p.maps['rpgdc-crypt1'].layers;
    expect([TILES[C.terrain[wallCell]].key, C.object[wallCell]]).toEqual(['crypt_floor', 0]);
    expect([TILES[C.terrain[floorCell]].key, OBJECTS[C.object[floorCell]].key]).toEqual(['crypt_floor', 'stairs_up']);
  });
});

describe('RPG-DC export', () => {
  it('writes every RPG-DC map in the documented format', () => {
    const p = migrated();
    const out = toRpgdcMaps(p, '2026-10-08T12:00:00Z');
    expect(Object.keys(out)).toEqual(['format', 'version', 'exportedAt', 'maps']);
    expect(out).toMatchObject({ format: 'rpgdc-maps', version: 1, exportedAt: '2026-10-08T12:00:00Z' });
    expect(out.maps.map((m) => m.id)).toEqual(['overworld', 'crypt1', 'crypt2', 'crypt3']);
    for (const m of out.maps) {
      expect(Object.keys(m)).toEqual(['id', 'name', 'kind', 'width', 'height', 'zone', 'groundLegend', 'ground', 'objectLegend', 'objects', 'zoneLegend', 'zones', 'places']);
      expect(m.groundLegend).toEqual(['grass', 'path', 'water', 'town_floor', 'crypt_floor', 'crypt_wall']);
      expect(m.objectLegend).toEqual(['', 'tree', 'oak', 'willow', 'boulder', 'fence', 'copper_rock', 'tin_rock', 'iron_rock', 'bank', 'shop', 'furnace', 'anvil', 'cooking_fire', 'fishing_shrimp', 'fishing_trout', 'fishing_salmon', 'crypt_entrance', 'stairs_down', 'stairs_up']);
      expect(m.zoneLegend).toEqual(['safe', 'frontier', 'wilderness', 'deep']);
      expect(m.ground).toHaveLength(m.width * m.height);
      expect(m.objects).toHaveLength(m.width * m.height);
      expect(m.ground.every((g) => g >= 0 && g < 6)).toBe(true);
      expect(m.objects.every((o) => o >= 0 && o < 20)).toBe(true);
    }
    const [ow, c1, , c3] = out.maps;
    expect(ow).toMatchObject({ kind: 'overworld', zone: null, width: 128, height: 128, name: 'RPG-DC overworld' });
    expect(ow.zones).toHaveLength(128 * 128);
    expect(ow.zones![64 * 128 + 64]).toBe(0);
    expect(ow.zones![0]).toBe(3);
    expect(c1).toMatchObject({ kind: 'dungeon', zone: 'wilderness', zones: null });
    expect(c3.zone).toBe('deep');
    // Cell values follow the legends: (x, y) is index y * width + x.
    const src = raw().maps['rpgdc-overworld'].layers.rpgdcTile;
    expect(ow.groundLegend[ow.ground[src.indexOf(1)]]).toBe('path');
    expect(ow.objectLegend[ow.objects[src.indexOf(9)]]).toBe('bank');
    expect(ow.places[0]).toEqual({ type: 'spawn_point', x: 64, y: 65 });
    expect(ow.places).toContainEqual({ type: 'link', x: 36, y: 44, toMap: 'crypt1', toX: 19, toY: 7 });
    expect(ow.places.find((pl) => pl.type === 'monster_spawn')).toEqual({ type: 'monster_spawn', x: expect.any(Number), y: expect.any(Number), kind: expect.any(String), count: 1, radius: 0 });
    expect(c3.places).toContainEqual({ type: 'boss', x: 31, y: 39, kind: 'bone_king' });
    expect(c1.places.filter((pl) => pl.type === 'brazier')[0]).toEqual({ type: 'brazier', x: expect.any(Number), y: expect.any(Number) });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it('only includes RPG-DC maps', () => {
    const p = migrated();
    const other = make('village', 'square', 1);
    p.maps[other.id] = other;
    expect(toRpgdcMaps(p).maps).toHaveLength(4);
  });
});

describe('game checks catch broken maps', () => {
  const ow = (p: Project) => byGameId(p, 'overworld');
  const messages = (p: Project) => checkGameMaps(p).map((i) => `${i.severity} ${i.gameMapId} (${i.c},${i.r}) ${i.message}`);
  const expectIssue = (p: Project, re: RegExp) => expect(messages(p).some((m) => re.test(m)), messages(p).join('\n')).toBe(true);
  const spawnOf = (p: Project) => ow(p).features.find((f) => f.type === 'spawn_point')!;
  const idx = (m: WorldMap, x: number, y: number) => y * m.width + x;

  it('needs exactly one spawn point', () => {
    const p = migrated();
    ow(p).features = ow(p).features.filter((f) => f.type !== 'spawn_point');
    expectIssue(p, /error overworld .*No spawn point/);
    const q = migrated();
    ow(q).features.push({ ...spawnOf(q), id: 'second', c: 63, r: 65 });
    expectIssue(q, /2 spawn points/);
  });

  it('needs the spawn point walkable and in the Safe zone', () => {
    const p = migrated();
    const m = ow(p);
    const water = m.layers.terrain.indexOf(T.WATER);
    Object.assign(spawnOf(p), { c: water % m.width, r: Math.floor(water / m.width) });
    expectIssue(p, /Spawn point .* can't walk on/);
    const q = migrated();
    const f = q.maps['rpgdc-overworld'].layers.zone.findIndex((z, i) => z === 2 && isWalkableAt(ow(q), i % 128, Math.floor(i / 128)));
    Object.assign(spawnOf(q), { c: f % 128, r: Math.floor(f / 128) });
    expectIssue(q, /Spawn point .* not in the Safe zone/);
  });

  it('needs every station and fishing spot usable from a reachable tile', () => {
    const p = migrated();
    const m = ow(p);
    const bank = m.layers.object.indexOf(O.BANK);
    const bx = bank % m.width;
    const by = Math.floor(bank / m.width);
    for (const [dx, dy] of NEIGHBOURS) if (m.layers.object[idx(m, bx + dx, by + dy)] === 0) m.layers.object[idx(m, bx + dx, by + dy)] = O.BOULDER;
    expectIssue(p, new RegExp(`Bank \\(${bx}, ${by}\\) has no walkable neighbour`));

    // Walling a fishing spot's shore off from town also counts.
    const q = migrated();
    const n = ow(q);
    const spot = n.layers.object.indexOf(O.FISHING_SALMON);
    const sx = spot % n.width;
    const sy = Math.floor(spot / n.width);
    for (let y = sy - 2; y <= sy + 2; y++) for (let x = sx - 2; x <= sx + 2; x++) {
      if (x < 0 || y < 0 || x >= n.width || y >= n.height) continue;
      if (Math.max(Math.abs(x - sx), Math.abs(y - sy)) === 2) n.layers.object[idx(n, x, y)] = O.FENCE;
    }
    expectIssue(q, new RegExp(`Fishing spot: salmon \\(${sx}, ${sy}\\) has no walkable neighbour`));
  });

  it('needs every staircase linked, in pairs, to a walkable tile on an existing map', () => {
    const p = migrated();
    const c1 = byGameId(p, 'crypt1');
    c1.features = c1.features.filter((f) => !(f.type === 'link' && f.c === 18 && f.r === 7));
    expectIssue(p, /error crypt1 \(18,7\) Stairs up .* has no link/);
    expectIssue(p, /error overworld \(36,44\) Stairs down .* no stairs up on crypt1 lead back to overworld/);

    const q = migrated();
    const down = ow(q).features.find((f) => f.type === 'link')!;
    down.props = { ...down.props, toX: 0, toY: 0 };
    expectIssue(q, /arrives on \(0, 0\) on crypt1, which you can't walk on/);
    down.props = { ...down.props, toMap: 'crypt9' };
    expectIssue(q, /goes to "crypt9", which isn't a map/);

    const r = migrated();
    const m = ow(r);
    m.features.push({ id: 'stray', type: 'link', c: 64, r: 66, name: 'stray', props: { toMap: 'crypt1', toX: 19, toY: 7 } });
    expectIssue(r, /Link \(64, 66\) is not on a crypt entrance or stairs/);
  });

  it('keeps monsters out of the Safe zone and off blocked tiles', () => {
    const p = migrated();
    const mon = ow(p).features.find((f) => f.type === 'monster_spawn')!;
    Object.assign(mon, { c: 64, r: 63 });
    expectIssue(p, /Monster spawn \(64, 63\) is in the Safe zone/);
    const q = migrated();
    const m = ow(q);
    const water = m.layers.terrain.indexOf(T.WATER);
    Object.assign(m.features.find((f) => f.type === 'monster_spawn')!, { c: water % m.width, r: Math.floor(water / m.width) });
    expectIssue(q, /Monster spawn .* can't walk on/);
  });

  it('needs a zone on every overworld cell and on every crypt floor', () => {
    const p = migrated();
    ow(p).layers.zone[5 * 128 + 7] = 0;
    expectIssue(p, /error overworld \(7,5\) 1 cell\(s\) have no zone/);
    delete byGameId(p, 'crypt2').settings.rpgdcZone;
    expectIssue(p, /error crypt2 .* no zone/);
  });

  it('warns about map sizes and ground the game lacks', () => {
    const p = createProject('tiny');
    const size = 20 * 20;
    const L = emptyLayers(size);
    L.terrain.fill(T.GRASS);
    L.zone.fill(1);
    L.terrain[5] = T.DESERT;
    const map: WorldMap = {
      id: 'tiny', name: 'Tiny', kind: 'overland', scaleId: 'local', grid: 'iso', width: 20, height: 20, seed: 1,
      settings: { rpgdcMapId: 'overworld' }, layers: L, children: [],
      features: [{ id: 's', type: 'spawn_point', c: 10, r: 10, name: 'start' } as Feature],
    };
    p.maps[map.id] = map;
    const issues = checkGameMaps(p);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(issues.map((i) => i.message).join('\n')).toMatch(/128×128; this map is 20×20/);
    expect(issues.map((i) => i.message).join('\n')).toMatch(/1 cell\(s\) use ground or objects the game doesn't have/);
  });
});

describe('older projects', () => {
  it('still open, gaining empty object and zone layers', () => {
    const p = createProject('old');
    const m = make('kingdom', 'hex-pointy', 5);
    p.maps[m.id] = m;
    const json = JSON.parse(serializeProject(p));
    for (const map of Object.values(json.maps) as { layers: Record<string, unknown> }[]) {
      delete map.layers.object;
      delete map.layers.zone;
    }
    const back = parseProject(JSON.stringify(json));
    const bm = back.maps[m.id];
    expect(bm.layers.terrain).toEqual(m.layers.terrain);
    expect(bm.layers.object).toEqual(new Array(m.width * m.height).fill(0));
    expect(bm.layers.zone).toEqual(new Array(m.width * m.height).fill(0));
    expect(bm.features).toEqual(m.features);
  });

  it('leave maps without RPG-DC settings alone even if they carry an rpgdcTile layer', () => {
    const p = createProject('x');
    const m = make('village', 'iso', 2);
    (m.layers as unknown as Record<string, unknown>).rpgdcTile = new Array(m.width * m.height).fill(0);
    p.maps[m.id] = m;
    const back = parseProjectReport(serializeProject(p));
    expect(back.migrated).toEqual([]);
    expect(back.project.maps[m.id].layers.terrain).toEqual(m.layers.terrain);
  });
});
