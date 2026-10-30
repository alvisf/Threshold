// Airtable sync. One table, "Threshold", one row per record. See logic/syncPlan.ts for the rules.
// Each cycle: read every row, take what is newer than this device, then send only the changes that are
// newer than the row Airtable already has. Reading first means a device that just turned sync on can
// never overwrite newer data from another device.
import { KEYS, type Coll } from './db';
import {
  PROFILE_ID, planPull, parseRow, profileJson, recordKey, rowId, toFields,
  type QueueEntry, type Row,
} from './logic/syncPlan';
import { applyRemote, asObj, createStore, data, flash, profile, removeLocal, setWriteHook, useStore } from './store';

export interface SyncConfig { enabled: boolean; token: string; baseId: string }
export interface SyncStatus { state: 'off' | 'idle' | 'syncing' | 'error'; at: number; error: string; pending: number }

const API = 'https://api.airtable.com/v0';
export const TABLE = 'Threshold';
const DEFAULT_CONFIG: SyncConfig = { enabled: false, token: '', baseId: '' };
const COLLS = Object.keys(KEYS) as Coll[];

export const syncConfig = createStore<SyncConfig>(DEFAULT_CONFIG, 'threshold.airtable', (s) => ({ ...DEFAULT_CONFIG, ...asObj(s) }));
export const syncStatus = createStore<SyncStatus>({ state: 'off', at: 0, error: '', pending: 0 });
export const useSyncStatus = () => useStore(syncStatus);
/** Changes waiting to be sent. Survives a reload. Key = row id, so repeated edits collapse into one. */
const queue = createStore<Record<string, QueueEntry>>({}, 'threshold.syncQueue', (s) => asObj(s) as Record<string, QueueEntry>);
/** When each row was last changed, here or in Airtable. Newest wins. */
const stamps = createStore<Record<string, number>>({}, 'threshold.syncStamps', (s) => asObj(s) as Record<string, number>);

const configured = (c: SyncConfig) => c.enabled && !!c.token && !!c.baseId;
const setStatus = (p: Partial<SyncStatus>) => syncStatus.set((s) => ({ ...s, ...p, pending: Object.keys(queue.get()).length }));

class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly type: string) { super(message); }
}

async function api(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const c = syncConfig.get();
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const e = body.error as { type?: string; message?: string } | string | undefined;
    const type = typeof e === 'string' ? e : e?.type ?? '';
    const message = r.status === 429 ? 'Airtable is busy. Trying again soon.' : typeof e === 'string' ? e : e?.message || e?.type || `HTTP ${r.status}`;
    throw new ApiError(message, r.status, type);
  }
  return body;
}

const tablePath = (c: SyncConfig) => `/${c.baseId}/${encodeURIComponent(TABLE)}`;

const FIELDS = [
  { name: 'id', type: 'singleLineText' },
  { name: 'kind', type: 'singleLineText' },
  { name: 'json', type: 'multilineText' },
  { name: 'updatedAt', type: 'number', options: { precision: 0 } },
  { name: 'deleted', type: 'checkbox', options: { icon: 'check', color: 'redBright' } },
];

/** Needs the schema.bases:write scope on the token. Runs by itself the first time the table is missing. */
async function createTable(): Promise<void> {
  const c = syncConfig.get();
  await api(`/meta/bases/${c.baseId}/tables`, { method: 'POST', body: JSON.stringify({ name: TABLE, fields: FIELDS }) });
}

async function fetchRows(): Promise<Row[]> {
  const c = syncConfig.get();
  const rows: Row[] = [];
  let offset: string | undefined;
  do {
    const p = new URLSearchParams({ pageSize: '100' });
    if (offset) p.set('offset', offset);
    const r = await api(`${tablePath(c)}?${p}`);
    for (const rec of r.records as { fields: Record<string, unknown> }[]) {
      const row = parseRow(rec.fields ?? {});
      if (row) rows.push(row);
    }
    offset = r.offset as string | undefined;
  } while (offset);
  return rows;
}

async function applyPlan(plan: ReturnType<typeof planPull>) {
  for (const c of COLLS) {
    const puts = plan.puts[c];
    if (puts?.length) await applyRemote(c, puts as never[]);
    const dels = plan.dels[c];
    if (dels?.length) await removeLocal(c, dels);
  }
  if (plan.profile) {
    profileSig = profileJson({ ...profile.get(), ...plan.profile });
    profile.set((x) => ({ ...x, ...plan.profile }));
  }
  if (Object.keys(plan.stamps).length) stamps.set((s) => ({ ...s, ...plan.stamps }));
}

async function cycle() {
  const c = syncConfig.get();
  const remote = await fetchRows();
  await applyPlan(planPull(remote, stamps.get(), queue.get()));

  // Send only what is newer than the row Airtable already has.
  const remoteAt = new Map<string, number>();
  remote.forEach((r) => remoteAt.set(r.id, Math.max(remoteAt.get(r.id) ?? 0, r.updatedAt)));
  const snap = queue.get();
  const entries = Object.entries(snap);
  const send = entries.filter(([id, e]) => e.at > (remoteAt.get(id) ?? 0));
  const drop = (ids: string[]) => queue.set((cur) => { const n = { ...cur }; ids.forEach((id) => { if (n[id] === snap[id]) delete n[id]; }); return n; });
  drop(entries.filter(([id, e]) => e.at <= (remoteAt.get(id) ?? 0)).map(([id]) => id));
  for (let i = 0; i < send.length; i += 10) {
    const chunk = send.slice(i, i + 10);
    await api(tablePath(c), {
      method: 'PATCH',
      body: JSON.stringify({ performUpsert: { fieldsToMergeOn: ['id'] }, records: chunk.map(([id, e]) => ({ fields: toFields(id, e) })), typecast: true }),
    });
    drop(chunk.map(([id]) => id));
    setStatus({});
    if (i + 10 < send.length) await new Promise((res) => setTimeout(res, 250)); // Airtable allows 5 requests a second
  }
}

let running = false;
let retry = 0;
export async function syncNow(): Promise<void> {
  const c = syncConfig.get();
  if (!configured(c)) { setStatus({ state: 'off', error: '' }); return; }
  if (running || !navigator.onLine) return;
  running = true;
  setStatus({ state: 'syncing', error: '' });
  try {
    try {
      await cycle();
    } catch (e) {
      if (!(e instanceof ApiError) || !(e.status === 404 || /NOT_FOUND/.test(e.type))) throw e;
      try { await createTable(); } catch (e2) { throw new Error(`No "${TABLE}" table, and it could not be made: ${(e2 as Error).message}`); }
      await cycle();
    }
    setStatus({ state: 'idle', at: Date.now(), error: '' });
  } catch (e) {
    const msg = (e as Error).message;
    if (syncStatus.get().error !== msg) flash(`Sync: ${msg}`);
    setStatus({ state: 'error', error: msg });
    if (e instanceof ApiError && e.status === 429) { clearTimeout(retry); retry = window.setTimeout(() => { void syncNow(); }, 30_000); }
  } finally { running = false; }
}

// ---- local changes -> queue ----

/** One write for the whole batch: the queue is saved to the phone each time it changes. */
function enqueue(items: [string, QueueEntry][]) {
  if (!items.length || !configured(syncConfig.get())) return;
  queue.set((q) => { const n = { ...q }; items.forEach(([id, e]) => { n[id] = e; }); return n; });
  setStatus({});
  schedule();
}

function stamp(ids: string[], at: number) {
  stamps.set((s) => { const n = { ...s }; ids.forEach((id) => { n[id] = at; }); return n; });
}

let profileSig = '';
function onProfile() {
  const sig = profileJson(profile.get());
  if (sig === profileSig) return;
  profileSig = sig;
  const at = Date.now();
  stamp([PROFILE_ID], at);
  enqueue([[PROFILE_ID, { coll: 'profile', json: sig, at }]]);
}

const hook = {
  put(coll: Coll, recs: readonly object[]) {
    const at = Date.now();
    const ids = recs.map((r) => rowId(coll, recordKey(coll, r)));
    stamp(ids, at);
    enqueue(recs.map((r, i): [string, QueueEntry] => [ids[i], { coll, json: JSON.stringify(r), at }]));
  },
  wipe() {
    const at = Date.now();
    const d = data.get();
    const items: [string, QueueEntry][] = [];
    for (const coll of COLLS) {
      const ids = (d[coll] as object[]).map((r) => rowId(coll, recordKey(coll, r)));
      stamp(ids, at);
      ids.forEach((id) => items.push([id, { coll, json: null, at }]));
    }
    enqueue(items);
  },
};

/** Turn on: queue everything this device has. The first cycle reads first, so only newer data is sent. */
export function setSyncEnabled(on: boolean) {
  syncConfig.set((x) => ({ ...x, enabled: on }));
  if (!on) { queue.set({}); setStatus({ state: 'off', error: '' }); return; }
  const st = stamps.get(); const d = data.get();
  const all: Record<string, QueueEntry> = {};
  for (const coll of COLLS) for (const r of d[coll] as object[]) {
    const id = rowId(coll, recordKey(coll, r));
    all[id] = { coll, json: JSON.stringify(r), at: st[id] ?? 1 };
  }
  all[PROFILE_ID] = { coll: 'profile', json: profileJson(profile.get()), at: st[PROFILE_ID] ?? 1 };
  queue.set(all);
  setStatus({ state: 'idle', error: '' });
  void syncNow();
}

let debounce = 0;
function schedule(ms = 1500) { clearTimeout(debounce); debounce = window.setTimeout(() => { void syncNow(); }, ms); }

let installed = false;
export function installSync() {
  if (installed) return;
  installed = true;
  profileSig = profileJson(profile.get());
  profile.subscribe(onProfile);
  setWriteHook(hook);
  window.addEventListener('online', () => schedule(500));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(500); });
  setInterval(() => { void syncNow(); }, 5 * 60 * 1000);
  setStatus({ state: configured(syncConfig.get()) ? 'idle' : 'off' });
  schedule(800);
}
