import { useSyncExternalStore } from 'react';
import * as db from './db';
import type { LastAlert } from './logic/bucket';
import { resolveChallenge } from './logic/calm';
import { attackOnsets, settleEpisodes } from './logic/episodes';
import {
  DEFAULT_RESCUE_PLAN, DEFAULT_SUSPECTS, EMPTY_DATA,
  type AppData, type DailyBucketLog, type UserProfile,
} from './logic/model';
import { HOUR, addDays, clockDiffMinutes, dayKey, uid } from './logic/time';
import { fetchPressureDelta } from './logic/weather';

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(l: () => void): () => void;
}

function createStore<T>(initial: T, persistKey?: string, merge?: (saved: unknown) => T): Store<T> {
  let value = initial;
  if (persistKey) {
    try {
      const raw = localStorage.getItem(persistKey);
      if (raw) value = merge ? merge(JSON.parse(raw)) : (JSON.parse(raw) as T);
    } catch { /* keep defaults */ }
  }
  const ls = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? (next as (p: T) => T)(value) : next;
      if (persistKey) { try { localStorage.setItem(persistKey, JSON.stringify(value)); } catch { /* quota */ } }
      ls.forEach((l) => l());
    },
    subscribe(l) { ls.add(l); return () => { ls.delete(l); }; },
  };
}

export const useStore = <T,>(s: Store<T>): T => useSyncExternalStore(s.subscribe, s.get, s.get);

export const DEFAULT_PROFILE: UserProfile = {
  user_id: uid(),
  baseline_wake_time: '07:00',
  baseline_caffeine_mg: 150,
  menstrual_tracking_enabled: false,
  suspect_items: DEFAULT_SUSPECTS,
  medications: [],
  rescue_plan: DEFAULT_RESCUE_PLAN,
  pressure_enabled: false,
  location: null,
  notifications_enabled: false,
};

export interface Meta {
  firstUse: number;
  lastExport: number;
  exportSnooze: number;
  lastAlert: LastAlert | null;
  installDismissed: boolean;
}

const asObj = (x: unknown) => (typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {});

export const profile = createStore<UserProfile>(DEFAULT_PROFILE, 'threshold.profile', (s) => ({ ...DEFAULT_PROFILE, ...asObj(s) }));
export const meta = createStore<Meta>(
  { firstUse: Date.now(), lastExport: 0, exportSnooze: 0, lastAlert: null, installDismissed: false },
  'threshold.meta',
  (s) => ({ firstUse: Date.now(), lastExport: 0, exportSnooze: 0, lastAlert: null, installDismissed: false, ...asObj(s) }),
);
export const data = createStore<AppData>(EMPTY_DATA);
export const ready = createStore(false);
export const toast = createStore<string | null>(null);

export function flash(text: string) {
  toast.set(text);
  setTimeout(() => { if (toast.get() === text) toast.set(null); }, 2600);
}

type Rec<K extends db.Coll> = AppData[K][number];

/** Write-through: update memory first so the UI is instant, then IndexedDB. */
export function upsert<K extends db.Coll>(coll: K, recs: Rec<K>[]) {
  if (!recs.length) return;
  const k = db.KEYS[coll];
  const idOf = (r: unknown) => (r as Record<string, unknown>)[k];
  data.set((d) => {
    const incoming = new Map(recs.map((r) => [idOf(r), r] as const));
    const list = (d[coll] as Rec<K>[]).map((x) => {
      const r = incoming.get(idOf(x));
      if (r) incoming.delete(idOf(x));
      return r ?? x;
    });
    return { ...d, [coll]: [...list, ...incoming.values()] };
  });
  db.putRecords(coll, recs as object[]).catch(() => flash('Could not save. Storage is full or blocked.'));
}

export async function load() {
  try {
    data.set(await db.loadAll());
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    flash('Storage is blocked. Data will not be kept.');
  }
  ready.set(true);
  housekeeping();
}

/** Averted prodromes and finished calm-day tests. Runs on open and every minute. */
export function housekeeping(now = Date.now()) {
  const settled = settleEpisodes(data.get().episodes, now);
  if (settled.length) upsert('episodes', settled);
  const onsets = attackOnsets(data.get().episodes);
  const done = data.get().challenges.map((c) => resolveChallenge(c, onsets, now)).filter((c, i) => c !== data.get().challenges[i]);
  if (done.length) upsert('challenges', done);
}

export const todayLog = (now = Date.now()) => data.get().daily.find((d) => d.date === dayKey(now)) ?? null;

export function blankLog(date: string): DailyBucketLog {
  return {
    log_id: date, date, checked_in: false, sleep_hours: null, wake_time: null, wake_time_delta_minutes: null,
    skipped_meal_flag: false, hydration_level: null, caffeine_variance: null, stress_state: null, cycle_phase: null,
    barometric_delta_hpa: null, pressure_at: null, calculated_bucket_score: 0, updated_at: 0,
  };
}

/** Values the check-in shows before the first tap: yesterday's, or sensible ones. */
export function checkInDefaults(now = Date.now()): Partial<DailyBucketLog> {
  const p = profile.get();
  const y = data.get().daily.find((d) => d.date === addDays(dayKey(now), -1));
  return {
    sleep_hours: y?.sleep_hours ?? 7.5,
    wake_time: p.baseline_wake_time,
    hydration_level: 'ok',
    skipped_meal_flag: false,
    caffeine_variance: 'usual',
    stress_state: 'calm',
    cycle_phase: p.menstrual_tracking_enabled ? (y?.cycle_phase ?? 'other') : null,
  };
}

export function patchToday(patch: Partial<DailyBucketLog>, now = Date.now()) {
  const date = dayKey(now);
  const cur = todayLog(now) ?? blankLog(date);
  const next: DailyBucketLog = { ...cur, ...patch, updated_at: now };
  if (next.wake_time) next.wake_time_delta_minutes = clockDiffMinutes(next.wake_time, profile.get().baseline_wake_time);
  upsert('daily', [next]);
}

/** Every check-in tap saves the whole day, so untouched fields keep their shown defaults. */
export function checkIn(patch: Partial<DailyBucketLog>, now = Date.now()) {
  const cur = todayLog(now);
  patchToday({ ...(cur?.checked_in ? {} : checkInDefaults(now)), ...patch, checked_in: true }, now);
}

let pressureBusy = false;
export async function refreshPressure(force = false) {
  const p = profile.get();
  const log = todayLog();
  if (pressureBusy || !p.pressure_enabled || !p.location) return;
  if (!force && log?.pressure_at && Date.now() - log.pressure_at < HOUR) return;
  pressureBusy = true;
  try {
    const delta = await fetchPressureDelta(p.location.lat, p.location.lon);
    patchToday({ barometric_delta_hpa: delta, pressure_at: Date.now() });
    if (force) flash(delta == null ? 'No pressure data for this place.' : 'Pressure updated.');
  } catch {
    if (force) flash('Pressure lookup failed. Check your connection.');
  } finally {
    pressureBusy = false;
  }
}

export async function wipeAll() {
  data.set(EMPTY_DATA);
  await db.replaceAll(EMPTY_DATA);
}

export async function replaceData(next: AppData) {
  data.set(next);
  await db.replaceAll(next);
  housekeeping();
}
