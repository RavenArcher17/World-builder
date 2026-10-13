/**
 * Keeping the open project in this browser between visits. It goes into IndexedDB, which holds
 * big projects (a game overworld of 768 tiles a side is about 18 MB as JSON, far more than the
 * ~5 MB localStorage allows), with its layers packed small (see core/snapshot.ts). Where IndexedDB
 * can't be used, a project small enough goes into localStorage instead, as before. Older
 * versions kept the project in localStorage: it's read from there once and moved.
 */
import { serializeProject, upgradeProject } from '../core/project';
import { restoreSnapshot, snapshotProject, type PackedLayer } from '../core/snapshot';
import type { Project } from '../core/types';

/** Where older versions (and the fallback) keep the project, as JSON. */
export const STORAGE_KEY = 'world-builder:project';
/** Where the project was last kept: { in: 'db' | 'local', savedAt, name }. */
export const POINTER_KEY = 'world-builder:autosave';

export interface AutosaveRecord {
  format: 'world-builder-autosave';
  version: 1;
  savedAt: number;
  name: string;
  json: string;
  layers: Map<string, PackedLayer>;
}

/** The IndexedDB side: one record. */
export interface RecordStore {
  get(): Promise<AutosaveRecord | undefined>;
  put(record: AutosaveRecord): Promise<void>;
}

/** The localStorage side (localStorage itself, or a stand-in). */
export type TextStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface Loaded {
  project: Project;
  migrated: string[];
  /** Read from localStorage where it was left by an older version: save it again to move it. */
  moveToDb: boolean;
}

/** Why a project couldn't be kept. */
export class AutosaveError extends Error {
  constructor(
    readonly reason: 'too-big' | 'unreadable',
    message: string,
  ) {
    super(message);
  }
}

export const TOO_BIG_MESSAGE =
  "This project is too big to keep in this browser (in private browsing, or with the browser's storage full, there's only room for small ones), so it isn't autosaved. It's safe while this page stays open: use Save to download it, or ☁ save it to the cloud.";
export const UNREADABLE_MESSAGE =
  "Couldn't open the project autosaved in this browser: its storage isn't available just now. Autosave is paused so that project isn't overwritten; reload the page to try again.";

/** IndexedDB, opened on first use: database "world-builder", store "autosave", key "project". */
export function indexedDbStore(): RecordStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'));
      const req = indexedDB.open('world-builder', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('autosave');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB could not be opened'));
      req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    });
    db.catch(() => (db = null));
    return db;
  };
  const run = <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> =>
    open().then(
      (d) =>
        new Promise<T | undefined>((resolve, reject) => {
          const tx = d.transaction('autosave', mode);
          const req = fn(tx.objectStore('autosave'));
          tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
          tx.onerror = () => reject(tx.error ?? new Error('IndexedDB failed'));
          tx.onabort = () => reject(tx.error ?? new Error('IndexedDB gave up (the browser may be out of space)'));
        }),
    );
  return {
    get: () => run<AutosaveRecord>('readonly', (s) => s.get('project')),
    put: (record) => run<void>('readwrite', (s) => s.put(record, 'project')).then(() => undefined),
  };
}

/** localStorage, or null where the browser won't let the page use it. */
export function browserTextStore(): TextStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export class Autosave {
  constructor(
    private db: RecordStore,
    private local: TextStore | null,
  ) {}

  private read(key: string): string | null {
    try {
      return this.local?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * The project kept in this browser, or null if there's none. A project left in localStorage
   * (by the fallback, or by an older version) comes first: it's the newer one. Throws an
   * AutosaveError ('unreadable') when there is one in IndexedDB that can't be read now.
   */
  async load(): Promise<Loaded | null> {
    let pointer: { in?: string } = {};
    try {
      pointer = JSON.parse(this.read(POINTER_KEY) ?? '{}') ?? {};
    } catch {
      pointer = {};
    }
    const text = this.read(STORAGE_KEY);
    if (text) {
      try {
        const { project, migrated } = upgradeProject(JSON.parse(text));
        return { project, migrated, moveToDb: true };
      } catch {
        // Not a project we can read: try the database.
      }
    }
    let record: AutosaveRecord | undefined;
    try {
      record = await this.db.get();
    } catch {
      // Kept there last time, but the database can't be opened now (it isn't gone: that reads as empty).
      if (pointer.in === 'db') throw new AutosaveError('unreadable', UNREADABLE_MESSAGE);
      return null;
    }
    if (!record || record.format !== 'world-builder-autosave') return null;
    const { project, migrated } = upgradeProject(restoreSnapshot(record));
    return { project, migrated, moveToDb: false };
  }

  /**
   * Keep the project: in IndexedDB, or (where that fails) in localStorage if it fits. Returns
   * where it went; throws an AutosaveError ('too-big') when neither could take it.
   */
  async save(project: Project): Promise<'db' | 'local'> {
    const snap = snapshotProject(project);
    const record: AutosaveRecord = { format: 'world-builder-autosave', version: 1, savedAt: Date.now(), name: project.name, ...snap };
    const point = (where: 'db' | 'local') => {
      try {
        this.local?.setItem(POINTER_KEY, JSON.stringify({ in: where, savedAt: record.savedAt, name: project.name }));
      } catch {
        // Only a hint for loading.
      }
    };
    try {
      await this.db.put(record);
      point('db');
      // The copy older versions (or the fallback) left there is out of date now.
      try {
        this.local?.removeItem(STORAGE_KEY);
      } catch {
        // Harmless: the pointer says where the project is.
      }
      return 'db';
    } catch {
      // No IndexedDB (or no room in it): localStorage, if the project fits.
    }
    try {
      if (!this.local) throw new Error('no localStorage');
      this.local.setItem(STORAGE_KEY, serializeProject(project));
      point('local');
      return 'local';
    } catch {
      throw new AutosaveError('too-big', TOO_BIG_MESSAGE);
    }
  }
}
