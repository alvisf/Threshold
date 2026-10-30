import { describe, expect, it } from 'vitest';
import { alertText, levelOf, scoreBucket, shouldAlert, tipText, type BucketInput } from './bucket';
import type { DailyBucketLog } from './model';

const log = (p: Partial<DailyBucketLog> = {}): DailyBucketLog => ({
  log_id: '2026-10-29', date: '2026-10-29', checked_in: true, sleep_hours: 8, wake_time: '07:00',
  wake_time_delta_minutes: 0, skipped_meal_flag: false, hydration_level: 'ok', caffeine_variance: 'usual',
  stress_state: 'calm', cycle_phase: null, barometric_delta_hpa: 0, pressure_at: null,
  calculated_bucket_score: 0, updated_at: 0, ...p,
});

const input = (p: Partial<DailyBucketLog> = {}, x: Partial<BucketInput> = {}): BucketInput => ({
  log: log(p), profile: { menstrual_tracking_enabled: false },
  candidateFoods24h: 0, primaryFoods24h: 0, letdownActive: false, blockRunning: false, ...x,
});

const score = (p: Partial<DailyBucketLog> = {}, x: Partial<BucketInput> = {}) => scoreBucket(input(p, x)).score;

describe('scoreBucket', () => {
  it('is 0 on a good day', () => expect(score()).toBe(0));

  it('counts only automatic factors without a check-in', () => {
    expect(scoreBucket({ ...input(), log: null, letdownActive: true, candidateFoods24h: 1 }).score).toBe(25);
  });

  it('spec example: short sleep + 8 hPa drop + skipped lunch = 80%', () => {
    const r = scoreBucket(input({ sleep_hours: 5.5, barometric_delta_hpa: -8.2, skipped_meal_flag: true }));
    expect(r.score).toBe(80);
    expect(r.contributions.map((c) => c.key)).toEqual(['sleep', 'pressure', 'meal']);
    expect(r.contributions.map((c) => c.word)).toEqual(['Sleep', 'Pressure', 'Meal']);
    expect(r.contributions[1].label).toBe('Pressure drop');
  });

  it('caps the brief example day at 100', () => {
    expect(score({ sleep_hours: 5.5, wake_time_delta_minutes: 95, skipped_meal_flag: true, hydration_level: 'low', barometric_delta_hpa: -8.2 }, { letdownActive: true })).toBe(100);
  });

  it.each([[4, 30], [5.9, 30], [6, 15], [6.9, 15], [7, 0], [9.5, 0], [9.6, 15]])('sleep %s h -> %s', (h, pts) => {
    expect(score({ sleep_hours: h })).toBe(pts);
  });

  it('skips sleep when not entered', () => expect(score({ sleep_hours: null })).toBe(0));

  it.each([[44, 0], [45, 8], [89, 8], [90, 15], [-120, 15]])('wake %s min -> %s', (d, pts) => {
    expect(score({ wake_time_delta_minutes: d })).toBe(pts);
  });

  it.each([[2.9, 0], [3, 8], [-4.9, 8], [5, 15], [7.9, 15], [8, 25], [-12, 25]])('pressure %s hPa -> %s', (d, pts) => {
    expect(score({ barometric_delta_hpa: d })).toBe(pts);
  });

  it('labels a rise', () => {
    expect(scoreBucket(input({ barometric_delta_hpa: 6 })).contributions[0]).toMatchObject({ label: 'Pressure rise', detail: '+6.0 hPa in 24 h' });
  });

  it('scores meals, water and caffeine', () => {
    expect(score({ skipped_meal_flag: true })).toBe(25);
    expect(score({ hydration_level: 'low' })).toBe(15);
    expect(score({ hydration_level: 'good' })).toBe(0);
    expect(score({ caffeine_variance: 'less' })).toBe(15);
    expect(score({ caffeine_variance: 'more' })).toBe(10);
  });

  it('uses the biggest of stress, excitement, block and let-down', () => {
    expect(score({ stress_state: 'stressed' })).toBe(15);
    expect(score({ stress_state: 'excited' })).toBe(10);
    const block = scoreBucket(input({}, { blockRunning: true }));
    expect(block.contributions[0]).toMatchObject({ key: 'stress', word: 'Rush', label: 'Rush', points: 10 });
    expect(score({ stress_state: 'stressed' }, { letdownActive: true })).toBe(20);
    expect(scoreBucket(input({ stress_state: 'excited' })).contributions[0]).toMatchObject({ word: 'Excited', label: 'High excitement' });
  });

  it('scores the cycle only when tracking is on', () => {
    const on = { profile: { menstrual_tracking_enabled: true } };
    expect(score({ cycle_phase: 'period' })).toBe(0);
    expect(score({ cycle_phase: 'period' }, on)).toBe(20);
    expect(score({ cycle_phase: 'pre_period' }, on)).toBe(20);
    expect(score({ cycle_phase: 'ovulation' }, on)).toBe(10);
    expect(score({ cycle_phase: 'other' }, on)).toBe(0);
  });

  it('adds foods with caps', () => {
    expect(score({}, { candidateFoods24h: 1 })).toBe(5);
    expect(score({}, { candidateFoods24h: 3 })).toBe(10);
    expect(score({}, { primaryFoods24h: 1 })).toBe(15);
    expect(score({}, { primaryFoods24h: 3 })).toBe(30);
  });
});

describe('alertText', () => {
  it('matches the spec notification', () => {
    const r = scoreBucket(input({ skipped_meal_flag: true, hydration_level: 'low', barometric_delta_hpa: -8.2, stress_state: 'stressed' }));
    expect(r.score).toBe(80);
    expect(alertText(r.score, r.contributions)).toBe('Your migraine bucket is at 80%. Eat a protein snack and hydrate now to prevent overflow.');
  });

  it('falls back when nothing can be fixed now', () => {
    const r = scoreBucket(input({ barometric_delta_hpa: -9, wake_time_delta_minutes: 100, sleep_hours: 10 }));
    expect(alertText(r.score, r.contributions)).toBe(`Your migraine bucket is at ${r.score}%. Keep other triggers low today to prevent overflow.`);
  });

  it('orders caffeine before sleep', () => {
    const r = scoreBucket(input({ caffeine_variance: 'more', sleep_hours: 5 }));
    expect(alertText(r.score, r.contributions)).toContain('Skip more caffeine and rest now');
  });

  it('does not repeat the same action', () => {
    const r = scoreBucket(input({}, { candidateFoods24h: 1, primaryFoods24h: 1 }));
    expect(alertText(r.score, r.contributions)).toContain('Skip other trigger foods now to prevent overflow.');
  });
});

describe('tipText', () => {
  it('names the two most useful fixes without the score', () => {
    const r = scoreBucket(input({ sleep_hours: 5.5, barometric_delta_hpa: -8.2, skipped_meal_flag: true }));
    expect(tipText(r.contributions)).toBe('Eat a protein snack and rest now.');
  });

  it('falls back when nothing can be fixed now', () => {
    const r = scoreBucket(input({ barometric_delta_hpa: -9, wake_time_delta_minutes: 100 }));
    expect(tipText(r.contributions)).toBe('Keep other triggers low today.');
  });

  it('says to wind down in a let-down window', () => {
    expect(tipText(scoreBucket(input({}, { letdownActive: true })).contributions)).toBe('Wind down slowly now.');
  });
});

describe('levelOf', () => {
  it.each([[0, 'calm'], [24, 'calm'], [25, 'steady'], [49, 'steady'], [50, 'rising'], [74, 'rising'], [75, 'high'], [100, 'high']])('%s -> %s', (s, l) => {
    expect(levelOf(s)).toBe(l);
  });
});

describe('shouldAlert', () => {
  it('needs 75 or more', () => expect(shouldAlert(74, '2026-10-29', null)).toBe(false));
  it('fires once a day', () => {
    expect(shouldAlert(80, '2026-10-29', null)).toBe(true);
    expect(shouldAlert(85, '2026-10-29', { date: '2026-10-29', score: 80 })).toBe(false);
    expect(shouldAlert(90, '2026-10-29', { date: '2026-10-29', score: 80 })).toBe(true);
    expect(shouldAlert(76, '2026-10-30', { date: '2026-10-29', score: 95 })).toBe(true);
  });
});
