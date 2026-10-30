export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day, YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n).getTime());
}

/** Local midnight of a day key, in ms. */
export function dayStart(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export const toIso = (ms: number) => new Date(ms).toISOString();
export const fromIso = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

/** Minutes between two HH:MM clock times, the short way round the clock. */
export function clockDiffMinutes(a: string, b: string): number | null {
  const pa = /^(\d{1,2}):(\d{2})$/.exec(a), pb = /^(\d{1,2}):(\d{2})$/.exec(b);
  if (!pa || !pb) return null;
  const ma = Number(pa[1]) * 60 + Number(pa[2]), mb = Number(pb[1]) * 60 + Number(pb[2]);
  const d = Math.abs(ma - mb);
  return Math.min(d, 1440 - d);
}

export function uid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** "red_wine" -> "Red wine". */
export function itemLabel(slug: string): string {
  const s = slug.replace(/_/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "Red Wine!" -> "red_wine". */
export function toSlug(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Oct 29", in the phone's language. */
export const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** "5 h 20 min", "40 min". */
export function duration(msLeft: number): string {
  const m = Math.max(0, Math.round(msLeft / MINUTE));
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}
