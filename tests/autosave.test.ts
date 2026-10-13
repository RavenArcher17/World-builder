import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createProject, serializeProject } from '../src/core/project';
import { fromRpgdcMaps } from '../src/core/rpgdc/import';
import type { Project } from '../src/core/types';
import {
  Autosave,
  AutosaveError,
  POINTER_KEY,
  STORAGE_KEY,
  TOO_BIG_MESSAGE,
  UNREADABLE_MESSAGE,
  type AutosaveRecord,
  type RecordStore,
  type TextStore,
} from '../src/ui/autosave';
import { make } from './helpers';

/** The game's own maps: about 18 MB as JSON, far more than localStorage holds. */
const game = () => fromRpgdcMaps(JSON.parse(readFileSync(new URL('./fixtures/rpg-dc.maps.json', import.meta.url), 'utf8')));
const small = (): Project => {
  const p = createProject('Small');
  const m = make('town', 'square', 7);
  p.maps[m.id] = m;
  return p;
};

/** localStorage as browsers have it: a few MB in all (counted in characters, as they count). */
function fakeLocal(quota = 5_000_000): TextStore & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => {
      const used = [...items].reduce((n, [key, val]) => n + (key === k ? 0 : key.length + val.length), 0);
      if (used + k.length + v.length > quota) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      items.set(k, v);
    },
    removeItem: (k) => void items.delete(k),
  };
}

/** IndexedDB's store: working, or (in private browsing on some browsers) refusing every call. */
function fakeDb(works = true): RecordStore & { record?: AutosaveRecord } {
  const db: RecordStore & { record?: AutosaveRecord } = {
    get: async () => {
      if (!works) throw new Error('IndexedDB is not available');
      return db.record && structuredClone(db.record);
    },
    put: async (record) => {
      if (!works) throw new Error('IndexedDB is not available');
      db.record = structuredClone(record);
    },
  };
  return db;
}

describe('autosave in this browser', () => {
  it('keeps a big project (the game’s 768-tile world) in IndexedDB and opens it again as it was', async () => {
    const p = game();
    const local = fakeLocal();
    const db = fakeDb();
    expect(await new Autosave(db, local).save(p)).toBe('db');
    expect(JSON.parse(local.getItem(POINTER_KEY)!)).toMatchObject({ in: 'db', name: 'RPG-DC' });
    expect(local.getItem(STORAGE_KEY)).toBeNull();
    // A fresh page: the same project comes back.
    const loaded = await new Autosave(db, local).load();
    expect(loaded?.project).toEqual(p);
    expect(loaded?.moveToDb).toBe(false);
  }, 30_000);

  it('falls back to localStorage where IndexedDB can’t be used, for a project that fits', async () => {
    const p = small();
    const local = fakeLocal();
    const saver = new Autosave(fakeDb(false), local);
    expect(await saver.save(p)).toBe('local');
    expect(local.getItem(STORAGE_KEY)).toBe(serializeProject(p));
    expect(JSON.parse(local.getItem(POINTER_KEY)!).in).toBe('local');
    expect((await saver.load())?.project).toEqual(p);
  }, 30_000);

  it('says so in plain words when a project is too big to keep, and keeps what was there', async () => {
    const local = fakeLocal();
    const saver = new Autosave(fakeDb(false), local);
    const before = small();
    await saver.save(before);
    const err = await saver.save(game()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AutosaveError);
    expect((err as AutosaveError).reason).toBe('too-big');
    expect((err as AutosaveError).message).toBe(TOO_BIG_MESSAGE);
    expect(TOO_BIG_MESSAGE).toMatch(/too big to keep in this browser/);
    expect(TOO_BIG_MESSAGE).toMatch(/Save to download it/);
    // The last project that fitted is still there.
    expect((await saver.load())?.project).toEqual(before);
  }, 30_000);

  it('opens an older version’s autosave from localStorage once, then moves it into IndexedDB', async () => {
    const p = small();
    const local = fakeLocal();
    local.setItem(STORAGE_KEY, serializeProject(p));
    const db = fakeDb();
    const saver = new Autosave(db, local);
    const loaded = await saver.load();
    expect(loaded?.project).toEqual(p);
    expect(loaded?.moveToDb).toBe(true);
    expect(await saver.save(loaded!.project)).toBe('db');
    expect(local.getItem(STORAGE_KEY)).toBeNull();
    const again = await new Autosave(db, local).load();
    expect(again?.project).toEqual(p);
    expect(again?.moveToDb).toBe(false);
  }, 30_000);

  it('starts afresh with nothing kept, and pauses rather than overwrite a project it can’t read', async () => {
    expect(await new Autosave(fakeDb(), fakeLocal()).load()).toBeNull();
    expect(await new Autosave(fakeDb(false), fakeLocal()).load()).toBeNull();
    expect(await new Autosave(fakeDb(), null).load()).toBeNull();
    // Kept in IndexedDB last time, which won't open now (say, a private window on some browsers).
    const local = fakeLocal();
    local.setItem(POINTER_KEY, JSON.stringify({ in: 'db', savedAt: 1, name: 'x' }));
    const err = await new Autosave(fakeDb(false), local).load().catch((e: unknown) => e);
    expect((err as AutosaveError).reason).toBe('unreadable');
    expect((err as AutosaveError).message).toBe(UNREADABLE_MESSAGE);
  }, 30_000);
});
