import { EMPTY_DATA, type AppData } from './logic/model';

const DB = 'threshold';
const VERSION = 1;

export const KEYS = {
  daily: 'log_id', events: 'event_id', episodes: 'episode_id', blocks: 'block_id', challenges: 'challenge_id',
} as const;
export type Coll = keyof typeof KEYS;
const NAMES = Object.keys(KEYS) as Coll[];

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      for (const n of NAMES) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n, { keyPath: KEYS[n] });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function tx(names: Coll[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => void): Promise<void> {
  return open().then((db) => new Promise<void>((res, rej) => {
    const t = db.transaction(names, mode);
    fn(t);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export async function loadAll(): Promise<AppData> {
  const out: AppData = { ...EMPTY_DATA };
  await tx(NAMES, 'readonly', (t) => {
    for (const n of NAMES) {
      const q = t.objectStore(n).getAll();
      q.onsuccess = () => { (out as unknown as Record<Coll, unknown[]>)[n] = q.result; };
    }
  });
  return out;
}

export const putRecords = (name: Coll, recs: readonly object[]) =>
  tx([name], 'readwrite', (t) => { const s = t.objectStore(name); recs.forEach((r) => s.put(r)); });

export const replaceAll = (data: AppData) =>
  tx(NAMES, 'readwrite', (t) => {
    for (const n of NAMES) {
      const s = t.objectStore(n);
      s.clear();
      (data[n] as object[]).forEach((r) => s.put(r));
    }
  });

export const deleteRecords = (name: Coll, ids: readonly string[]) =>
  tx([name], 'readwrite', (t) => { const s = t.objectStore(name); ids.forEach((id) => s.delete(id)); });
