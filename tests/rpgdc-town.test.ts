import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { O } from '../src/core/objects';
import { checkGameMaps } from '../src/core/rpgdc/checks';
import { toRpgdcMaps, type RpgdcMapsFile } from '../src/core/rpgdc/export';
import { buildingMask, buildings, gameKind, guardPosts, isWalkableAt, OBJECT_LEGEND } from '../src/core/rpgdc/game';
import { fromRpgdcMaps, isRpgdcMapsFile } from '../src/core/rpgdc/import';
import type { Project, WorldMap } from '../src/core/types';

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
    expect(world.features.filter((f) => f.type === 'building').length).toBe(14);
  });

  it('passes every game check', () => {
    expect(checkGameMaps(project())).toEqual([]);
  });

  it('exports exactly what it opened', () => {
    const before = file();
    const after = toRpgdcMaps(project());
    expect(after.maps.map((m) => m.id).sort()).toEqual(before.maps.map((m) => m.id).sort());
    for (const m of before.maps) {
      const out = after.maps.find((o) => o.id === m.id)!;
      expect([out.name, out.kind, out.width, out.height, out.zone]).toEqual([m.name, m.kind, m.width, m.height, m.zone]);
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
    expect(roles).toEqual(expect.arrayContaining(['mayor', 'captain', 'villager']));
  });

  it('posts town guards where the game does, one at each gate', () => {
    // RPG-DC's server, on this file: guards at these tiles, and criminals come back at (63, 47).
    const { posts, outside } = guardPosts(byGameId(project(), 'overworld'));
    expect(posts.map((p) => [p.x, p.y])).toEqual([[63, 51], [51, 63], [77, 63], [63, 77]]);
    expect(outside).toEqual({ x: 63, y: 47 });
    expect(guardPosts(byGameId(project(), 'bank')).posts).toEqual([]);
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
    }).some((m) => /Bank \(57, 58\) has no door/.test(m))).toBe(true);
    expect(edit((p) => {
      const w = byGameId(p, 'overworld');
      const b = building(w, 'Bank');
      w.layers.object[b.r * w.width + b.c + 2] = O.DOOR;
    }).some((m) => /door at \(59, 58\) the camera can't see/.test(m))).toBe(true);
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
    expect(edit((p) => { building(byGameId(p, 'overworld'), 'Bank').props!.roof = 'pink'; }).some((m) => /Bank \(57, 58\) has an unknown roof colour "pink"/.test(m))).toBe(true);
    expect(edit((p) => { building(byGameId(p, 'overworld'), 'Bank').props!.walls = 'plaid'; }).some((m) => /unknown wall colour "plaid"/.test(m))).toBe(true);
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
