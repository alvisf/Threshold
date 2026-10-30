// Pure rules for Airtable sync. One Airtable row per record: id ("daily:2026-10-29"), kind, json, updatedAt, deleted.
// Deletes are rows with deleted = true, so every change is an upsert. The newest updatedAt wins.
// updatedAt lives in a side table on the device (stamps), so the stored records keep their shape.
import { KEYS, type Coll } from '../db';
import type { UserProfile } from './model';

export type SyncColl = Coll | 'profile';
export const PROFILE_ID = 'profile:me';

export interface Row { id: string; kind: SyncColl; json: string; updatedAt: number; deleted: boolean }
/** A change waiting to be sent. json null means deleted. */
export interface QueueEntry { coll: SyncColl; json: string | null; at: number }

const COLLS = Object.keys(KEYS) as Coll[];
const isColl = (k: string): k is Coll => (COLLS as string[]).includes(k);

export const rowId = (coll: SyncColl, key: string) => `${coll}:${key}`;

export function recordKey(coll: Coll, rec: object): string {
  return String((rec as Record<string, unknown>)[KEYS[coll]]);
}

export function toFields(id: string, e: QueueEntry): Record<string, unknown> {
  return { id, kind: e.coll, json: e.json ?? '', updatedAt: e.at, deleted: e.json === null };
}

/** Airtable leaves empty fields out, and a false checkbox too. */
export function parseRow(f: Record<string, unknown>): Row | null {
  const id = typeof f.id === 'string' ? f.id : '';
  const kind = typeof f.kind === 'string' ? f.kind : '';
  const updatedAt = Number(f.updatedAt);
  if (!id || !Number.isFinite(updatedAt)) return null;
  if (kind !== 'profile' && !isColl(kind)) return null;
  if (kind === 'profile' ? id !== PROFILE_ID : !id.startsWith(`${kind}:`)) return null;
  return { id, kind: kind as SyncColl, json: typeof f.json === 'string' ? f.json : '', updatedAt, deleted: f.deleted === true };
}

// Only the settings that belong to the person. Location, alerts and pressure stay on each device.
export function syncedProfile(p: UserProfile) {
  return {
    baseline_wake_time: p.baseline_wake_time,
    menstrual_tracking_enabled: p.menstrual_tracking_enabled,
    suspect_items: p.suspect_items,
    medications: p.medications,
    rescue_plan: p.rescue_plan,
  };
}
export const profileJson = (p: UserProfile) => JSON.stringify(syncedProfile(p));

const strList = (x: unknown): string[] | null =>
  Array.isArray(x) && x.length <= 200 && x.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 80) ? (x as string[]) : null;

/** Takes only fields that look right. Anything else is ignored, so a bad row cannot break the profile. */
export function pickProfile(raw: unknown): Partial<UserProfile> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: Partial<UserProfile> = {};
  if (typeof o.baseline_wake_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.baseline_wake_time)) out.baseline_wake_time = o.baseline_wake_time;
  if (typeof o.menstrual_tracking_enabled === 'boolean') out.menstrual_tracking_enabled = o.menstrual_tracking_enabled;
  for (const k of ['suspect_items', 'medications', 'rescue_plan'] as const) {
    const l = strList(o[k]);
    if (l) out[k] = l;
  }
  return Object.keys(out).length ? out : null;
}

export interface Plan {
  puts: Partial<Record<Coll, object[]>>;
  dels: Partial<Record<Coll, string[]>>;
  profile: Partial<UserProfile> | null;
  /** New updatedAt per row id, for every row this plan took in. */
  stamps: Record<string, number>;
  skipped: number;
}

/**
 * What to take from Airtable. A row is taken only when it is newer than what this device has
 * seen (stamps) and newer than any change still waiting to be sent (queue).
 * Rows go in oldest first, so if one id appears twice the newest one wins.
 */
export function planPull(rows: readonly Row[], stamps: Readonly<Record<string, number>>, queue: Readonly<Record<string, QueueEntry>>): Plan {
  const plan: Plan = { puts: {}, dels: {}, profile: null, stamps: {}, skipped: 0 };
  const seen: Record<string, number> = { ...stamps };
  const ordered = [...rows].sort((a, b) => a.updatedAt - b.updatedAt);
  for (const r of ordered) {
    if ((seen[r.id] ?? 0) >= r.updatedAt) continue;
    if (queue[r.id] && queue[r.id].at >= r.updatedAt) continue;
    if (r.kind === 'profile') {
      if (r.deleted) { seen[r.id] = r.updatedAt; plan.stamps[r.id] = r.updatedAt; continue; }
      let picked: Partial<UserProfile> | null = null;
      try { picked = pickProfile(JSON.parse(r.json)); } catch { /* bad row */ }
      if (!picked) { plan.skipped++; continue; }
      plan.profile = picked;
    } else {
      const key = r.id.slice(r.kind.length + 1);
      if (r.deleted) {
        (plan.dels[r.kind] ??= []).push(key);
        plan.puts[r.kind] = (plan.puts[r.kind] ?? []).filter((x) => recordKey(r.kind as Coll, x) !== key);
      } else {
        let rec: unknown = null;
        try { rec = JSON.parse(r.json); } catch { /* bad row */ }
        const ok = typeof rec === 'object' && rec !== null && !Array.isArray(rec) && recordKey(r.kind, rec) === key;
        if (!ok) { plan.skipped++; continue; }
        plan.dels[r.kind] = (plan.dels[r.kind] ?? []).filter((k) => k !== key);
        plan.puts[r.kind] = [...(plan.puts[r.kind] ?? []).filter((x) => recordKey(r.kind as Coll, x) !== key), rec as object];
      }
    }
    seen[r.id] = r.updatedAt;
    plan.stamps[r.id] = r.updatedAt;
  }
  return plan;
}
