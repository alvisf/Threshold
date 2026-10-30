import { DATA_VERSION, type AppData, type UserProfile } from './model';

export interface Backup {
  app: 'threshold';
  version: number;
  exported_at: string;
  profile: UserProfile;
  data: AppData;
}

export function makeBackup(profile: UserProfile, data: AppData, now: number): Backup {
  return { app: 'threshold', version: DATA_VERSION, exported_at: new Date(now).toISOString(), profile, data };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown) => typeof x === 'string' && x.length > 0;
const isDate = (x: unknown) => typeof x === 'string' && !Number.isNaN(Date.parse(x));

const CHECKS: Record<keyof AppData, (r: Record<string, unknown>) => boolean> = {
  daily: (r) => isStr(r.log_id) && typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date),
  events: (r) => isStr(r.event_id) && isStr(r.item_name) && isDate(r.timestamp) && isStr(r.classification),
  episodes: (r) => isStr(r.episode_id) && isStr(r.status) && Array.isArray(r.medications_taken),
  blocks: (r) => isStr(r.block_id) && isDate(r.started_at),
  challenges: (r) => isStr(r.challenge_id) && isStr(r.item_name) && isDate(r.started_at),
};

export interface ParsedBackup { profile: Partial<UserProfile> | null; data: AppData; skipped: number }

/** Keeps every valid record, counts the rest. Throws only when the file is not a Threshold backup. */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('Not a JSON file.'); }
  if (!isObj(raw) || raw.app !== 'threshold' || !isObj(raw.data)) throw new Error('Not a Threshold backup.');
  const src = raw.data;
  let skipped = 0;
  const pick = <K extends keyof AppData>(k: K): AppData[K] => {
    const list = Array.isArray(src[k]) ? (src[k] as unknown[]) : [];
    const ok = list.filter((r) => isObj(r) && CHECKS[k](r));
    skipped += list.length - ok.length;
    return ok as unknown as AppData[K];
  };
  const data: AppData = { daily: pick('daily'), events: pick('events'), episodes: pick('episodes'), blocks: pick('blocks'), challenges: pick('challenges') };
  return { profile: isObj(raw.profile) ? (raw.profile as Partial<UserProfile>) : null, data, skipped };
}
