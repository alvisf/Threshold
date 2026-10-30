import type { DailyBucketLog, UserProfile } from './model';

export type FactorKey =
  | 'sleep' | 'wake' | 'pressure' | 'meal' | 'water' | 'caffeine' | 'stress' | 'letdown' | 'cycle' | 'foods' | 'primary';

export interface Contribution {
  key: FactorKey;
  /** One word under the factor icon on Today ("Sleep"). */
  word: string;
  label: string;
  detail: string;
  points: number;
  /** Imperative phrase for the alert ("eat a protein snack"), when the factor can be fixed now. */
  action?: string;
}

export interface BucketInput {
  log: DailyBucketLog | null;
  profile: Pick<UserProfile, 'menstrual_tracking_enabled'>;
  /** Candidate-trigger foods logged in the last 24 h that are not confirmed primary triggers. */
  candidateFoods24h: number;
  /** Confirmed primary-trigger foods logged in the last 24 h. */
  primaryFoods24h: number;
  letdownActive: boolean;
  blockRunning: boolean;
}

export interface BucketResult { score: number; contributions: Contribution[] }

export const ALERT_AT = 75;
export const CALM_BELOW = 25;

const hrs = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(1));

export function scoreBucket(input: BucketInput): BucketResult {
  const out: Contribution[] = [];
  const add = (c: Contribution) => { if (c.points > 0) out.push(c); };
  const l = input.log;

  if (l?.sleep_hours != null) {
    const h = l.sleep_hours;
    if (h < 6) add({ key: 'sleep', word: 'Sleep', label: 'Short sleep', detail: `${hrs(h)} h`, points: 30, action: 'rest' });
    else if (h < 7) add({ key: 'sleep', word: 'Sleep', label: 'Short sleep', detail: `${hrs(h)} h`, points: 15, action: 'rest' });
    else if (h > 9.5) add({ key: 'sleep', word: 'Sleep', label: 'Long sleep', detail: `${hrs(h)} h`, points: 15 });
  }

  if (l?.wake_time_delta_minutes != null) {
    const d = Math.abs(l.wake_time_delta_minutes);
    const pts = d >= 90 ? 15 : d >= 45 ? 8 : 0;
    add({ key: 'wake', word: 'Woke', label: 'Wake time off', detail: `${d} min from usual`, points: pts });
  }

  if (l?.barometric_delta_hpa != null) {
    const v = l.barometric_delta_hpa, a = Math.abs(v);
    const pts = a >= 8 ? 25 : a >= 5 ? 15 : a >= 3 ? 8 : 0;
    add({ key: 'pressure', word: 'Pressure', label: v < 0 ? 'Pressure drop' : 'Pressure rise', detail: `${v > 0 ? '+' : ''}${v.toFixed(1)} hPa in 24 h`, points: pts });
  }

  if (l?.skipped_meal_flag) add({ key: 'meal', word: 'Meal', label: 'Skipped or late meal', detail: 'today', points: 25, action: 'eat a protein snack' });
  if (l?.hydration_level === 'low') add({ key: 'water', word: 'Water', label: 'Low water', detail: 'today', points: 15, action: 'hydrate' });

  if (l?.caffeine_variance === 'less') {
    add({ key: 'caffeine', word: 'Caffeine', label: 'Less caffeine than usual', detail: 'drop', points: 15, action: 'have your usual caffeine' });
  } else if (l?.caffeine_variance === 'more') {
    add({ key: 'caffeine', word: 'Caffeine', label: 'More caffeine than usual', detail: 'spike', points: 10, action: 'skip more caffeine' });
  }

  // Stress, excitement and let-down share one slot: the biggest one counts.
  const stress = l?.stress_state === 'stressed' ? 15 : l?.stress_state === 'excited' || input.blockRunning ? 10 : 0;
  if (input.letdownActive && 20 >= stress) {
    add({ key: 'letdown', word: 'Let-down', label: 'Let-down phase', detail: 'after a rush', points: 20, action: 'wind down slowly' });
  } else if (stress > 0) {
    const [word, label] = l?.stress_state === 'stressed' ? ['Stress', 'Stress'] : input.blockRunning ? ['Rush', 'Rush'] : ['Excited', 'High excitement'];
    add({ key: 'stress', word, label, detail: 'today', points: stress, action: 'take a 10-minute calm break' });
  }

  if (input.profile.menstrual_tracking_enabled && l?.cycle_phase) {
    const p = l.cycle_phase;
    const pts = p === 'pre_period' || p === 'period' ? 20 : p === 'ovulation' ? 10 : 0;
    add({ key: 'cycle', word: 'Cycle', label: p === 'ovulation' ? 'Ovulation' : p === 'period' ? 'Period' : 'Pre-period', detail: 'cycle', points: pts });
  }

  if (input.candidateFoods24h > 0) {
    add({ key: 'foods', word: 'Food', label: 'Possible trigger foods', detail: `${input.candidateFoods24h} in last 24 h`, points: Math.min(10, 5 * input.candidateFoods24h), action: 'skip other trigger foods' });
  }
  if (input.primaryFoods24h > 0) {
    add({ key: 'primary', word: 'Trigger', label: 'Known trigger eaten', detail: `${input.primaryFoods24h} in last 24 h`, points: Math.min(30, 15 * input.primaryFoods24h), action: 'skip other trigger foods' });
  }

  out.sort((a, b) => b.points - a.points);
  const score = Math.min(100, out.reduce((s, c) => s + c.points, 0));
  return { score, contributions: out };
}

export type Level = 'calm' | 'steady' | 'rising' | 'high';
export const levelOf = (score: number): Level =>
  score >= ALERT_AT ? 'high' : score >= 50 ? 'rising' : score >= CALM_BELOW ? 'steady' : 'calm';
export const LEVEL_LABEL: Record<Level, string> = { calm: 'Calm', steady: 'Steady', rising: 'Rising', high: 'High' };

/** Which fixable factors lead the alert text, most useful first. */
const ACTION_ORDER: FactorKey[] = ['meal', 'water', 'caffeine', 'sleep', 'letdown', 'stress', 'primary', 'foods'];

function topActions(contributions: Contribution[]): string[] {
  const acts: string[] = [];
  for (const k of ACTION_ORDER) {
    const a = contributions.find((c) => c.key === k)?.action;
    if (a && !acts.includes(a)) acts.push(a);
    if (acts.length === 2) break;
  }
  return acts;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The phone notification. */
export function alertText(score: number, contributions: Contribution[]): string {
  const acts = topActions(contributions);
  const lead = `Your migraine bucket is at ${score}%.`;
  if (!acts.length) return `${lead} Keep other triggers low today to prevent overflow.`;
  return `${lead} ${cap(acts.join(' and '))} now to prevent overflow.`;
}

/** The one line under the bucket on Today. The score is already drawn above it. */
export function tipText(contributions: Contribution[]): string {
  const acts = topActions(contributions);
  return acts.length ? `${cap(acts.join(' and '))} now.` : 'Keep other triggers low today.';
}

export interface LastAlert { date: string; score: number }

/** One alert per day, again only if the score climbs 10 more points. */
export function shouldAlert(score: number, today: string, last: LastAlert | null): boolean {
  if (score < ALERT_AT) return false;
  if (!last || last.date !== today) return true;
  return score >= last.score + 10;
}
