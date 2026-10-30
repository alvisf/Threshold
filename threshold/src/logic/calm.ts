import { CALM_BELOW } from './bucket';
import type { CalmDayChallenge, DailyBucketLog } from './model';
import { DAY, addDays, fromIso, toIso, uid } from './time';

export interface CalmBlockers { episodeOpen: boolean; letdownActive: boolean; challengeActive: boolean }

/** Yesterday and today checked in, both under 25%, and nothing else open. */
export function calmDayEligible(
  daily: readonly DailyBucketLog[], today: string, todayScore: number, b: CalmBlockers,
): boolean {
  if (b.episodeOpen || b.letdownActive || b.challengeActive) return false;
  const y = daily.find((d) => d.date === addDays(today, -1));
  const t = daily.find((d) => d.date === today);
  return !!y?.checked_in && !!t?.checked_in && y.calculated_bucket_score < CALM_BELOW && todayScore < CALM_BELOW;
}

/** First suspect food that has not passed a calm-day test yet. */
export function suggestTestItem(suspects: readonly string[], challenges: readonly CalmDayChallenge[]): string | null {
  const passed = new Set(challenges.filter((c) => c.status === 'passed').map((c) => c.item_name));
  return suspects.find((s) => !passed.has(s)) ?? suspects[0] ?? null;
}

export function startChallenge(item: string, now: number): CalmDayChallenge {
  return { challenge_id: uid(), item_name: item, started_at: toIso(now), status: 'active', resolved_at: null };
}

/** Failed if a headache starts within 24 h of the test, passed once 24 h go by without one. */
export function resolveChallenge(ch: CalmDayChallenge, onsets: readonly number[], now: number): CalmDayChallenge {
  if (ch.status !== 'active') return ch;
  const s = fromIso(ch.started_at);
  const hit = onsets.find((t) => t >= s && t <= s + DAY);
  if (hit !== undefined) return { ...ch, status: 'failed', resolved_at: toIso(hit) };
  if (now >= s + DAY) return { ...ch, status: 'passed', resolved_at: toIso(s + DAY) };
  return ch;
}
