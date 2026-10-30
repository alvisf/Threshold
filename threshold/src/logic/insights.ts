import { isProdrome } from './craving';
import { attackOnsets } from './episodes';
import type { AppData, DailyBucketLog } from './model';
import { DAY, addDays, dayKey, dayStart, fromIso, itemLabel } from './time';

export type Verdict = 'PRIMARY' | 'STACKING' | 'FALSE_SUSPECT' | 'WATCH' | 'LOW' | 'NEED_DATA';

export const MIN_DAYS = 30;
export const MIN_LOGS = 3;

export const VERDICT_LABEL: Record<Verdict, string> = {
  PRIMARY: 'Primary trigger',
  STACKING: 'Bucket filler',
  FALSE_SUSPECT: 'False suspect',
  WATCH: 'Keep watching',
  LOW: 'Not a trigger so far',
  NEED_DATA: 'Need more data',
};

export const VERDICT_ADVICE: Record<Verdict, string> = {
  PRIMARY: 'A trigger on its own. Avoid it.',
  STACKING: 'Fine on good days. Skip it when sleep or water is off.',
  FALSE_SUSPECT: 'Stop restricting it. Treat the craving as an early warning.',
  WATCH: 'Mixed signal. Keep logging.',
  LOW: 'No sign it is a trigger.',
  NEED_DATA: 'Log it a few more times.',
};

const ORDER: Verdict[] = ['PRIMARY', 'STACKING', 'FALSE_SUSPECT', 'WATCH', 'LOW', 'NEED_DATA'];

export interface Counts { total: number; attack: number; prodrome: number }

export interface FactorStat extends Counts {
  key: string;
  label: string;
  kind: 'food' | 'day';
  /** P_trigger = (N_attack - N_prodrome) / N_total */
  p: number;
  /** Raw correlation N_attack / N_total */
  r: number;
  soloP: number | null;
  pairedP: number | null;
  verdict: Verdict;
}

export interface Analysis {
  stats: FactorStat[];
  loggedDays: number;
  ready: boolean;
  primaryFoods: Set<string>;
}

interface Occ { t: number; day: string; prodrome: boolean; end?: number }

interface DayCtx { cycle: boolean }

const DAY_FACTORS: { key: string; label: string; auto?: boolean; test: (d: DailyBucketLog, c: DayCtx) => boolean }[] = [
  { key: 'short_sleep', label: 'Short sleep (under 6 h)', test: (d) => d.sleep_hours != null && d.sleep_hours < 6 },
  { key: 'wake_shift', label: 'Wake time off (45+ min)', test: (d) => d.wake_time_delta_minutes != null && Math.abs(d.wake_time_delta_minutes) >= 45 },
  { key: 'skipped_meal', label: 'Skipped or late meal', test: (d) => d.skipped_meal_flag },
  { key: 'low_water', label: 'Low water', test: (d) => d.hydration_level === 'low' },
  { key: 'caffeine_change', label: 'Caffeine change', test: (d) => d.caffeine_variance === 'less' || d.caffeine_variance === 'more' },
  { key: 'stress', label: 'Stress', test: (d) => d.stress_state === 'stressed' },
  { key: 'pressure_change', label: 'Pressure change (5+ hPa)', auto: true, test: (d) => d.barometric_delta_hpa != null && Math.abs(d.barometric_delta_hpa) >= 5 },
  { key: 'period', label: 'Pre-period or period', test: (d, c) => c.cycle && (d.cycle_phase === 'pre_period' || d.cycle_phase === 'period') },
];

export function pTrigger(c: Counts): number {
  return c.total ? Math.max(0, c.attack - c.prodrome) / c.total : 0;
}

export type DotState = 'none' | 'logged' | 'attack';
export interface Dot { date: string; state: DotState }

/** One dot per day, oldest first, ending today: attack day, checked-in day, or nothing logged. */
export function dayDots(data: AppData, today: string, n = MIN_DAYS): Dot[] {
  const attackDays = new Set(attackOnsets(data.episodes).map(dayKey));
  const logged = new Set(data.daily.filter((d) => d.checked_in).map((d) => d.date));
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(today, i - n + 1);
    return { date, state: attackDays.has(date) ? 'attack' : logged.has(date) ? 'logged' : 'none' };
  });
}

export function verdictOf(
  s: Counts & { p: number; r: number; soloP: number | null; pairedP: number | null }, ready: boolean,
): Verdict {
  if (!ready || s.total < MIN_LOGS) return 'NEED_DATA';
  if (s.attack > 0 && s.r >= 0.5 && s.prodrome / s.attack > 0.7) return 'FALSE_SUSPECT';
  if (s.p > 0.6) return 'PRIMARY';
  if (s.soloP !== null && s.pairedP !== null && s.soloP < 0.25 && s.pairedP > 0.65) return 'STACKING';
  if (s.p >= 0.25) return 'WATCH';
  return 'LOW';
}

export function analyze(data: AppData, opts: { suspects: readonly string[]; cycle: boolean }): Analysis {
  const onsets = attackOnsets(data.episodes);
  const onsetDays = new Set(onsets.map(dayKey));
  const byDay = new Map(data.daily.map((d) => [d.date, d] as const));
  const loggedDays = data.daily.filter((d) => d.checked_in).length;
  const ready = loggedDays >= MIN_DAYS;

  const build = (key: string, label: string, kind: 'food' | 'day', occs: Occ[]): FactorStat => {
    const precedes = (o: Occ) => (o.end !== undefined
      ? onsets.some((x) => x >= o.t && x <= o.end!)
      : kind === 'food'
        ? onsets.some((x) => x >= o.t && x - o.t <= DAY)
        : onsetDays.has(o.day) || onsetDays.has(addDays(o.day, 1)));
    const tally = (list: Occ[]): Counts => {
      let attack = 0, prodrome = 0;
      for (const o of list) if (precedes(o)) { attack++; if (o.prodrome) prodrome++; }
      return { total: list.length, attack, prodrome };
    };
    // Paired: the day also had poor sleep or low water. Days without a check-in are left out of the split.
    const paired = (o: Occ): boolean | null => {
      const d = byDay.get(o.day);
      if (!d?.checked_in) return null;
      const poorSleep = key !== 'short_sleep' && d.sleep_hours != null && d.sleep_hours < 6;
      const dry = key !== 'low_water' && d.hydration_level === 'low';
      return poorSleep || dry;
    };
    const all = tally(occs);
    const withPair = occs.filter((o) => paired(o) === true);
    const solo = occs.filter((o) => paired(o) === false);
    const s = {
      ...all,
      p: pTrigger(all),
      r: all.total ? all.attack / all.total : 0,
      soloP: solo.length >= 2 ? pTrigger(tally(solo)) : null,
      pairedP: withPair.length >= 2 ? pTrigger(tally(withPair)) : null,
    };
    return { key, label, kind, ...s, verdict: verdictOf(s, ready) };
  };

  const stats: FactorStat[] = [];
  const items = new Set([...opts.suspects, ...data.events.map((e) => e.item_name)]);
  for (const item of items) {
    const occs = data.events.filter((e) => e.item_name === item).map((e) => {
      const t = fromIso(e.timestamp);
      return { t, day: dayKey(t), prodrome: isProdrome(e.classification) };
    });
    stats.push(build(item, itemLabel(item), 'food', occs));
  }

  const ctx: DayCtx = { cycle: opts.cycle };
  for (const f of DAY_FACTORS) {
    if (f.key === 'period' && !opts.cycle) continue;
    const occs = data.daily
      .filter((d) => (d.checked_in || f.auto) && f.test(d, ctx))
      .map((d) => ({ t: dayStart(d.date), day: d.date, prodrome: false }));
    stats.push(build(f.key, f.label, 'day', occs));
  }

  // Let-down: an attack counts only if it starts inside the window itself.
  const windows = data.blocks
    .filter((b) => b.ended_at && b.letdown_window_ends_at)
    .map((b) => {
      const t = fromIso(b.ended_at);
      return { t, end: fromIso(b.letdown_window_ends_at), day: dayKey(t), prodrome: false };
    });
  stats.push(build('let_down', 'Let-down window', 'day', windows));

  stats.sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || b.total - a.total || a.label.localeCompare(b.label));
  const primaryFoods = new Set(stats.filter((s) => s.kind === 'food' && s.verdict === 'PRIMARY').map((s) => s.key));
  return { stats, loggedDays, ready, primaryFoods };
}
