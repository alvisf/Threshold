import { describe, expect, it, vi } from 'vitest';
import { makeBackup, parseBackup } from './backup';
import { calmDayEligible, resolveChallenge, startChallenge, suggestTestItem } from './calm';
import { makeEvent } from './craving';
import { derive } from './derive';
import { addProdromeDose, endEpisode, prodromeEpisode, saveAttack, avertEpisode } from './episodes';
import { analyze, dayDots, pTrigger, verdictOf, VERDICT_LABEL } from './insights';
import { endBlock, startBlock } from './letdown';
import { EMPTY_DATA, type AppData, type DailyBucketLog, type MigraineEpisode, type UserProfile } from './model';
import { buildReport } from './report';
import { DAY, HOUR, addDays, clockDiffMinutes, dayKey, duration, itemLabel, toSlug, uid } from './time';
import { fetchPressureDelta, pressureDelta, pressureUrl, roundCoord } from './weather';

const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime();
const key = (day: number) => dayKey(at(day, 12));

const dlog = (day: number, p: Partial<DailyBucketLog> = {}): DailyBucketLog => ({
  log_id: key(day), date: key(day), checked_in: true, sleep_hours: 8, wake_time: '07:00', wake_time_delta_minutes: 0,
  skipped_meal_flag: false, hydration_level: 'ok', caffeine_variance: 'usual', stress_state: 'calm', cycle_phase: null,
  barometric_delta_hpa: null, pressure_at: null, calculated_bucket_score: 0, updated_at: 0, ...p,
});

const attack = (t: number, prodromeAt?: number): MigraineEpisode => {
  const base = prodromeAt ? [prodromeEpisode([], prodromeAt)] : [];
  return endEpisode(saveAttack(base, t, { sides: ['left'], pain: 6, meds: [], masked: false }), t + 6 * HOUR, null);
};

const food = (item: string, t: number, prodrome = false) =>
  makeEvent({ item, suddenUrge: prodrome, signs: prodrome ? ['yawning'] : [], now: t });

const PROFILE: UserProfile = {
  user_id: 'u', baseline_wake_time: '07:00', baseline_caffeine_mg: 150, menstrual_tracking_enabled: false,
  suspect_items: ['red_wine', 'chocolate', 'aged_cheese', 'citrus', 'sweets'], medications: ['Sumatriptan 50mg'],
  rescue_plan: [], pressure_enabled: false, location: null, notifications_enabled: false,
};

/** 30 logged days in Oct 2026 shaped so each suspect food lands on one verdict. */
function month(days = 30): AppData {
  const poorSleep = new Set([25, 27, 29]);
  const daily = Array.from({ length: days }, (_, i) => dlog(i + 1, poorSleep.has(i + 1) ? { sleep_hours: 5 } : {}));
  const events = [
    // red wine: every time, an attack next morning.
    ...[2, 4, 6, 8, 10].map((d) => food('red_wine', at(d, 19))),
    // chocolate: 4 of 6 before attacks, 3 of those 4 were prodrome cravings.
    ...[13, 15, 17].map((d) => food('chocolate', at(d, 14), true)),
    food('chocolate', at(19, 12)), food('chocolate', at(21, 12)), food('chocolate', at(23, 12)),
    // aged cheese: attacks only on poor-sleep days.
    ...[25, 27, 29].map((d) => food('aged_cheese', at(d, 12))),
    ...[12, 14, 16].map((d) => food('aged_cheese', at(d, 12))),
    // citrus: never before an attack. Sweets: too few logs.
    ...[1, 20, 22, 24].map((d) => food('citrus', at(d, 9))),
    food('sweets', at(26, 10)), food('sweets', at(28, 10)),
  ];
  const episodes = [
    ...[3, 5, 7, 9, 11].map((d) => attack(at(d, 8))),
    ...[13, 15, 17].map((d) => attack(at(d, 18), at(d, 14))),
    attack(at(19, 20)),
    ...[25, 27, 29].map((d) => attack(at(d, 20))),
  ];
  return { ...EMPTY_DATA, daily, events, episodes };
}

describe('insights', () => {
  const a = analyze(month(), { suspects: PROFILE.suspect_items, cycle: false });
  const v = (k: string) => a.stats.find((s) => s.key === k)!;

  it('unlocks at 30 logged days', () => {
    expect(a.loggedDays).toBe(30);
    expect(a.ready).toBe(true);
    const early = analyze(month(29), { suspects: [], cycle: false });
    expect(early.ready).toBe(false);
    expect(early.stats.every((s) => s.verdict === 'NEED_DATA')).toBe(true);
  });

  it('flags a primary independent trigger', () => {
    expect(v('red_wine')).toMatchObject({ total: 5, attack: 5, prodrome: 0, p: 1, verdict: 'PRIMARY' });
    expect(a.primaryFoods.has('red_wine')).toBe(true);
  });

  it('exonerates a prodrome craving as a false suspect', () => {
    const c = v('chocolate');
    expect(c).toMatchObject({ total: 6, attack: 4, prodrome: 3, verdict: 'FALSE_SUSPECT' });
    expect(c.p).toBeCloseTo(1 / 6);
  });

  it('finds a stacking trigger', () => {
    expect(v('aged_cheese')).toMatchObject({ total: 6, attack: 3, soloP: 0, pairedP: 1, verdict: 'STACKING' });
  });

  it('clears a food that never precedes attacks', () => expect(v('citrus')).toMatchObject({ attack: 0, verdict: 'LOW' }));
  it('waits for 3 logs', () => expect(v('sweets').verdict).toBe('NEED_DATA'));

  it('evaluates day factors on the same or next day', () => {
    expect(v('short_sleep')).toMatchObject({ kind: 'day', total: 3, attack: 3 });
    expect(a.stats.some((s) => s.key === 'period')).toBe(false);
    expect(analyze(month(), { suspects: [], cycle: true }).stats.some((s) => s.key === 'period')).toBe(true);
  });

  it('sorts primary first and labels verdicts', () => {
    expect(a.stats[0].verdict).toBe('PRIMARY');
    expect(VERDICT_LABEL.STACKING).toBe('Bucket filler');
  });

  it('uses a 24 h lookback for foods', () => {
    const data: AppData = {
      ...EMPTY_DATA,
      events: [food('x', at(1, 8)), food('x', at(3, 8)), food('x', at(5, 20))],
      episodes: [attack(at(2, 8)), attack(at(4, 8, 1)), attack(at(5, 19))],
    };
    // 24 h exactly counts, 24 h + 1 min does not, an attack before the food does not.
    expect(analyze(data, { suspects: [], cycle: false }).stats.find((s) => s.key === 'x')).toMatchObject({ total: 3, attack: 1 });
  });

  it('ignores averted prodromes as attacks', () => {
    const p = avertEpisode(prodromeEpisode([], at(2, 9)), at(3, 9));
    const data: AppData = { ...EMPTY_DATA, events: [food('x', at(2, 8))], episodes: [p] };
    expect(analyze(data, { suspects: [], cycle: false }).stats.find((s) => s.key === 'x')!.attack).toBe(0);
  });

  it('computes P_trigger and the verdict order', () => {
    expect(pTrigger({ total: 0, attack: 0, prodrome: 0 })).toBe(0);
    expect(pTrigger({ total: 10, attack: 7, prodrome: 1 })).toBeCloseTo(0.6);
    const base = { total: 10, attack: 4, prodrome: 0, r: 0.4, soloP: null, pairedP: null };
    expect(verdictOf({ ...base, p: 0.4 }, true)).toBe('WATCH');
    expect(verdictOf({ ...base, p: 0.1 }, true)).toBe('LOW');
    expect(verdictOf({ ...base, p: 0.1, soloP: 0.1, pairedP: 0.7 }, true)).toBe('STACKING');
    expect(verdictOf({ ...base, p: 0.61 }, true)).toBe('PRIMARY');
    expect(verdictOf({ ...base, p: 0.61 }, false)).toBe('NEED_DATA');
  });
});

describe('calm days', () => {
  const open = { episodeOpen: false, letdownActive: false, challengeActive: false };
  const daily = [dlog(28, { calculated_bucket_score: 10 }), dlog(29, { calculated_bucket_score: 20 })];

  it('needs two days under 25%', () => {
    expect(calmDayEligible(daily, key(29), 20, open)).toBe(true);
    expect(calmDayEligible(daily, key(29), 25, open)).toBe(false);
    expect(calmDayEligible([dlog(28, { calculated_bucket_score: 30 }), daily[1]], key(29), 10, open)).toBe(false);
    expect(calmDayEligible([daily[1]], key(29), 10, open)).toBe(false);
    expect(calmDayEligible(daily, key(29), 10, { ...open, letdownActive: true })).toBe(false);
  });

  it('suggests a food that has not passed yet', () => {
    const passed = { ...startChallenge('chocolate', at(1, 9)), status: 'passed' as const };
    expect(suggestTestItem(['chocolate', 'citrus'], [passed])).toBe('citrus');
    expect(suggestTestItem(['chocolate'], [passed])).toBe('chocolate');
    expect(suggestTestItem([], [])).toBeNull();
  });

  it('resolves a test after 24 h', () => {
    const c = startChallenge('aged_cheese', at(10, 12));
    expect(resolveChallenge(c, [], at(11, 11)).status).toBe('active');
    expect(resolveChallenge(c, [at(9, 12)], at(11, 13))).toMatchObject({ status: 'passed' });
    expect(resolveChallenge(c, [at(11, 2)], at(11, 3))).toMatchObject({ status: 'failed' });
    const done = { ...c, status: 'cancelled' as const };
    expect(resolveChallenge(done, [at(11, 2)], at(12, 3))).toBe(done);
  });
});

describe('pressure', () => {
  const t0 = Math.floor(at(28, 0) / 1000);
  const times = Array.from({ length: 48 }, (_, i) => t0 + i * 3600);
  const values = times.map((_, i) => 1015 - i * 0.35);

  it('compares with the same hour yesterday', () => {
    expect(pressureDelta(times, values, (t0 + 30 * 3600 + 600) * 1000)).toBe(-8.4);
    expect(pressureDelta(times, values, (t0 + 10 * 3600) * 1000)).toBeNull();
    expect(pressureDelta(times, values, (t0 - 10) * 1000)).toBeNull();
    expect(pressureDelta(times, values.map((x, i) => (i === 30 ? null : x)), (t0 + 30 * 3600) * 1000)).toBeNull();
  });

  it('rounds the location in the URL', () => {
    expect(roundCoord(47.6062)).toBe(47.61);
    const u = pressureUrl(47.6062, -122.3321);
    expect(u).toContain('latitude=47.61');
    expect(u).toContain('longitude=-122.33');
    expect(u).toContain('hourly=pressure_msl');
  });

  it('fetches from Open-Meteo', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ hourly: { time: times, pressure_msl: values } })));
    expect(await fetchPressureDelta(47.6, -122.3, (t0 + 30 * 3600) * 1000, ok as unknown as typeof fetch)).toBe(-8.4);
    const bad = vi.fn(async () => new Response('x', { status: 500 }));
    await expect(fetchPressureDelta(1, 1, 0, bad as unknown as typeof fetch)).rejects.toThrow('Open-Meteo 500');
    const empty = vi.fn(async () => new Response('{}'));
    await expect(fetchPressureDelta(1, 1, 0, empty as unknown as typeof fetch)).rejects.toThrow('no hourly');
  });
});

describe('neurologist report', () => {
  it('summarises the last 30 days', () => {
    const now = at(30, 12);
    const p = addProdromeDose(prodromeEpisode([], at(20, 9)), 'Rizatriptan', at(20, 9, 30));
    const withProdrome = endEpisode(saveAttack([p], at(20, 14), { sides: ['left'], pain: 8, meds: [], masked: true }), at(21, 10), null);
    const plain = endEpisode(saveAttack([], at(25, 18), { sides: ['right'], pain: 5, meds: ['Ibuprofen'], masked: false }), at(25, 23), true);
    const averted = avertEpisode(addProdromeDose(prodromeEpisode([], at(27, 9)), 'Rizatriptan', at(27, 9)), at(28, 9));
    const old = attack(at(1, 8) - 40 * DAY);
    const data: AppData = {
      ...EMPTY_DATA,
      episodes: [withProdrome, plain, averted, old],
      challenges: [
        { ...startChallenge('citrus', at(22, 12)), status: 'passed', resolved_at: new Date(at(23, 12)).toISOString() },
        { ...startChallenge('aged_cheese', at(26, 12)), status: 'failed', resolved_at: new Date(at(26, 20)).toISOString() },
      ],
    };
    const stats = analyze(month(), { suspects: PROFILE.suspect_items, cycle: false }).stats;
    const r = buildReport(data, stats, now);
    expect(r).toMatchObject({ attacks: 2, headacheDays: 3, avgPeak: 6.5, warnedByProdrome: 1, averted: 1, letdownAttacks: 1 });
    expect(r.meds).toEqual([
      { drug: 'Ibuprofen', prodromeDoses: 0, prodromeStopped: 0, headacheDoses: 1, headacheHelped: 1 },
      { drug: 'Rizatriptan', prodromeDoses: 2, prodromeStopped: 1, headacheDoses: 0, headacheHelped: 0 },
    ]);
    expect(r.factors.map((f) => f.key).sort()).toEqual(['aged_cheese', 'chocolate', 'red_wine', 'short_sleep']);
    expect(r.testsPassed).toEqual(['citrus']);
    expect(r.testsFailed).toEqual(['aged_cheese']);
    expect(buildReport(EMPTY_DATA, [], now).avgPeak).toBeNull();
  });

  it('counts an open attack up to today', () => {
    const now = at(30, 12);
    const open = saveAttack([], at(29, 20), { sides: [], pain: 3, meds: [], masked: false });
    expect(buildReport({ ...EMPTY_DATA, episodes: [open] }, [], now).headacheDays).toBe(2);
  });
});

describe('backup', () => {
  it('round-trips and skips bad records', () => {
    const data = month(3);
    const text = JSON.stringify(makeBackup(PROFILE, data, at(30, 12)));
    const back = parseBackup(text);
    expect(back.data.daily).toHaveLength(3);
    expect(back.profile?.user_id).toBe('u');
    expect(back.skipped).toBe(0);
    const broken = JSON.parse(text);
    broken.data.events.push({ event_id: 'x' }, 'junk');
    broken.data.daily = 'nope';
    broken.profile = null;
    const r = parseBackup(JSON.stringify(broken));
    expect(r.skipped).toBe(2);
    expect(r.data.daily).toEqual([]);
    expect(r.profile).toBeNull();
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('{')).toThrow('Not a JSON file.');
    expect(() => parseBackup('{"app":"other"}')).toThrow('Not a Threshold backup.');
  });
});

describe('derive', () => {
  it('builds the Today view', () => {
    const now = at(29, 16);
    const data: AppData = {
      ...EMPTY_DATA,
      daily: [dlog(28, { calculated_bucket_score: 5 }), dlog(29, { skipped_meal_flag: true })],
      events: [food('chocolate', at(29, 12)), food('citrus', at(29, 13), true), food('citrus', at(29, 9))],
      blocks: [endBlock(startBlock('excitement', 1, at(29, 13)), at(29, 15))],
    };
    const v = derive(data, PROFILE, now);
    expect(v.bucket.score).toBe(25 + 20 + 10);
    expect(v.level).toBe('rising');
    expect(v.alert).toBeNull();
    expect(v.tip).toBeNull();
    expect(v.calmEligible).toBe(false);
  });

  it('gives a short tip and the full alert at 75% or more', () => {
    const now = at(29, 16);
    const v = derive({ ...EMPTY_DATA, daily: [dlog(29, { sleep_hours: 5.5, skipped_meal_flag: true, barometric_delta_hpa: -8.2 })] }, PROFILE, now);
    expect(v.bucket.score).toBe(80);
    expect(v.tip).toBe('Eat a protein snack and rest now.');
    expect(v.alert).toBe('Your migraine bucket is at 80%. Eat a protein snack and rest now to prevent overflow.');
  });

  it('offers a calm-day test and blocks it during an attack', () => {
    const now = at(29, 16);
    const calm: AppData = { ...EMPTY_DATA, daily: [dlog(28, { calculated_bucket_score: 5 }), dlog(29)] };
    const v = derive(calm, PROFILE, now);
    expect(v.calmEligible).toBe(true);
    expect(v.testSuggestion).toBe('red_wine');
    const busy = derive({ ...calm, episodes: [saveAttack([], at(29, 15), { sides: [], pain: 9, meds: [], masked: false })] }, PROFILE, now);
    expect(busy.calmEligible).toBe(false);
    expect(busy.episode?.status).toBe('active');
  });

  it('counts confirmed primary triggers higher', () => {
    const data = month();
    const now = at(30, 20);
    const v = derive({ ...data, events: [...data.events, food('red_wine', at(30, 19))] }, PROFILE, now);
    expect(v.bucket.contributions.find((c) => c.key === 'primary')?.points).toBe(15);
  });
});

describe('dayDots', () => {
  it('marks attack days over logged days, oldest first, ending today', () => {
    const data: AppData = { ...EMPTY_DATA, daily: [dlog(27), dlog(28), dlog(29, { checked_in: false })], episodes: [attack(at(28, 10))] };
    const dots = dayDots(data, key(29));
    expect(dots).toHaveLength(30);
    expect(dots[29]).toEqual({ date: key(29), state: 'none' });
    expect(dots[28]).toEqual({ date: key(28), state: 'attack' });
    expect(dots[27]).toEqual({ date: key(27), state: 'logged' });
    expect(dots[0].date).toBe(addDays(key(29), -29));
    expect(dots.filter((d) => d.state !== 'none')).toHaveLength(2);
  });
});

describe('time helpers', () => {
  it('handles clocks, days and labels', () => {
    expect(clockDiffMinutes('07:00', '08:35')).toBe(95);
    expect(clockDiffMinutes('23:30', '00:15')).toBe(45);
    expect(clockDiffMinutes('7', '08:00')).toBeNull();
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(itemLabel('red_wine')).toBe('Red wine');
    expect(itemLabel('')).toBe('');
    expect(toSlug('  Red Wine! ')).toBe('red_wine');
    expect(duration(5 * HOUR + 20 * 60_000)).toBe('5 h 20 min');
    expect(duration(2 * HOUR)).toBe('2 h');
    expect(duration(40 * 60_000)).toBe('40 min');
    expect(uid()).not.toBe(uid());
  });
});
