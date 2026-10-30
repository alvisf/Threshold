import { ALERT_AT, alertText, levelOf, scoreBucket, tipText, type BucketResult, type Level } from './bucket';
import { calmDayEligible, suggestTestItem } from './calm';
import { openEpisode } from './episodes';
import { analyze, type Analysis } from './insights';
import { activeLetdown, runningBlock } from './letdown';
import type { AppData, CalmDayChallenge, DailyBucketLog, EngagementBlock, MigraineEpisode, UserProfile } from './model';
import { DAY, dayKey, fromIso } from './time';

export interface View {
  now: number;
  today: string;
  log: DailyBucketLog | null;
  analysis: Analysis;
  bucket: BucketResult;
  level: Level;
  /** Full sentence for the phone notification, at 75% or more. */
  alert: string | null;
  /** Short line under the bucket, at 75% or more. */
  tip: string | null;
  letdown: EngagementBlock | null;
  running: EngagementBlock | null;
  episode: MigraineEpisode | null;
  challenge: CalmDayChallenge | null;
  calmEligible: boolean;
  testSuggestion: string | null;
}

export function derive(data: AppData, profile: UserProfile, now: number): View {
  const today = dayKey(now);
  const log = data.daily.find((d) => d.date === today) ?? null;
  const analysis = analyze(data, { suspects: profile.suspect_items, cycle: profile.menstrual_tracking_enabled });

  const recent = data.events.filter((e) => {
    const t = fromIso(e.timestamp);
    return e.classification === 'CANDIDATE_TRIGGER' && t <= now && now - t < DAY;
  });
  const primaryFoods24h = recent.filter((e) => analysis.primaryFoods.has(e.item_name)).length;
  const letdown = activeLetdown(data.blocks, now);
  const running = runningBlock(data.blocks);
  const bucket = scoreBucket({
    log, profile, candidateFoods24h: recent.length - primaryFoods24h, primaryFoods24h,
    letdownActive: !!letdown, blockRunning: !!running,
  });

  const episode = openEpisode(data.episodes);
  const challenge = data.challenges.find((c) => c.status === 'active') ?? null;
  const calmEligible = calmDayEligible(data.daily, today, bucket.score, {
    episodeOpen: !!episode, letdownActive: !!letdown, challengeActive: !!challenge,
  });
  const high = bucket.score >= ALERT_AT;

  return {
    now, today, log, analysis, bucket,
    level: levelOf(bucket.score),
    alert: high ? alertText(bucket.score, bucket.contributions) : null,
    tip: high ? tipText(bucket.contributions) : null,
    letdown, running, episode, challenge, calmEligible,
    testSuggestion: calmEligible ? suggestTestItem(profile.suspect_items, data.challenges) : null,
  };
}
