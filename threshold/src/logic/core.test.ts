import { describe, expect, it } from 'vitest';
import { RESULT, classify, isProdrome, makeEvent } from './craving';
import { activeLetdown, endBlock, inLetdown, letdownHours, runningBlock, startBlock, toggleStep } from './letdown';
import { addProdromeDose, attackOnsets, avertEpisode, endEpisode, openEpisode, prodromeEpisode, saveAttack, settleEpisodes } from './episodes';
import { analyze } from './insights';
import { EMPTY_DATA, type MigraineEpisode } from './model';
import { HOUR } from './time';

const T = new Date(2026, 9, 29, 14, 15).getTime();

describe('craving routing', () => {
  it('sudden urge + a sign is a prodrome craving', () => expect(classify(true, ['yawning'])).toBe('PRODROME_CRAVING'));
  it('normal meal + a sign is prodrome signs', () => expect(classify(false, ['neck_stiffness'])).toBe('PRODROME_SIGNS'));
  it('no signs is a candidate trigger', () => {
    expect(classify(false, [])).toBe('CANDIDATE_TRIGGER');
    expect(classify(true, [])).toBe('CANDIDATE_TRIGGER');
  });
  it('flags prodrome classes', () => {
    expect(isProdrome('PRODROME_CRAVING')).toBe(true);
    expect(isProdrome('PRODROME_SIGNS')).toBe(true);
    expect(isProdrome('CANDIDATE_TRIGGER')).toBe(false);
  });
  it('builds the event like the brief', () => {
    const e = makeEvent({ item: 'dark_chocolate', suddenUrge: true, signs: ['yawning', 'neck_stiffness'], now: T });
    expect(e).toMatchObject({ item_name: 'dark_chocolate', was_strong_craving: true, classification: 'PRODROME_CRAVING', context: 'log' });
    expect(e.accompanying_prodrome_signs).toEqual(['yawning', 'neck_stiffness']);
    expect(Date.parse(e.timestamp)).toBe(T);
    expect(makeEvent({ item: 'citrus', suddenUrge: false, signs: [], context: 'challenge', now: T }).context).toBe('challenge');
  });
  it('keeps the brief wording, without jargon', () => {
    expect(RESULT.PRODROME_CRAVING.text).toBe('Your migraine likely started 1-3 hours ago. Enjoy the snack guilt-free and take your rescue steps now.');
  });
});

describe('let-down window', () => {
  it.each([[0, 1, 6], [0.5, 1, 6], [1, 1, 6], [2, 1, 8], [3, 2, 13], [1, 3, 12], [9, 3, 24]])('%s h, intensity %s -> %s h', (h, i, w) => {
    expect(letdownHours(T, T + h * HOUR, i as 1 | 2 | 3)).toBe(w);
  });

  it('opens a window when a block ends', () => {
    const b = startBlock('excitement', 2, T - 3 * HOUR);
    expect(runningBlock([b])).toBe(b);
    const done = endBlock(b, T);
    expect(Date.parse(done.letdown_window_ends_at!) - T).toBe(13 * HOUR);
    expect(runningBlock([done])).toBeNull();
    expect(activeLetdown([done], T + HOUR)).toBe(done);
    expect(activeLetdown([done], T + 14 * HOUR)).toBeNull();
    expect(inLetdown([done], T + 2 * HOUR)).toBe(true);
    expect(inLetdown([done], T - HOUR)).toBe(false);
    expect(inLetdown([b], T)).toBe(false);
  });

  it('picks the window that ends last', () => {
    const a = endBlock(startBlock('stress', 1, T - HOUR), T);
    const b = endBlock(startBlock('stress', 3, T - 5 * HOUR), T);
    expect(activeLetdown([a, b], T + HOUR)).toBe(b);
    expect(activeLetdown([b, a], T + HOUR)).toBe(b);
    expect(activeLetdown([startBlock('focus', 1, T)], T)).toBeNull();
  });

  it('ticks decompression steps on and off', () => {
    const b = startBlock('focus', 1, T);
    const on = toggleStep(b, 'water');
    expect(on.decompression_done).toEqual(['water']);
    expect(toggleStep(on, 'water').decompression_done).toEqual([]);
  });

  it('counts let-down attacks only inside the window', () => {
    const b = endBlock(startBlock('excitement', 2, T - 3 * HOUR), T);
    const inWindow = saveAttack([], T + 5 * HOUR, { sides: [], pain: 5, meds: [], masked: true });
    const after = saveAttack([], T + 20 * HOUR, { sides: [], pain: 5, meds: [], masked: false });
    const s = (eps: MigraineEpisode[]) => analyze({ ...EMPTY_DATA, blocks: [b], episodes: eps }, { suspects: [], cycle: false })
      .stats.find((x) => x.key === 'let_down')!;
    expect(s([inWindow])).toMatchObject({ total: 1, attack: 1 });
    expect(s([endEpisode(after, T + 22 * HOUR, null)])).toMatchObject({ total: 1, attack: 0 });
  });
});

describe('episodes', () => {
  const input = { sides: ['left' as const], pain: 7, meds: ['Sumatriptan 50mg'], masked: false };

  it('opens a prodrome episode once', () => {
    const p = prodromeEpisode([], T);
    expect(p).toMatchObject({ status: 'prodrome', headache_onset_at: null });
    expect(prodromeEpisode([p], T + HOUR)).toBe(p);
  });

  it('starts a new attack without a prodrome', () => {
    const e = saveAttack([], T, input);
    expect(e).toMatchObject({ status: 'active', prodrome_detected_at: null, peak_pain_score: 7, pain_location: ['left'] });
    expect(e.medications_taken[0]).toMatchObject({ drug_name: 'Sumatriptan 50mg', taken_during_phase: 'HEADACHE', headache_aborted: null });
  });

  it('turns a prodrome into the headache phase', () => {
    const p = addProdromeDose(prodromeEpisode([], T), 'Sumatriptan 50mg', T + 15 * 60_000);
    const e = saveAttack([p], T + 3 * HOUR, { ...input, meds: [], masked: true });
    expect(e.episode_id).toBe(p.episode_id);
    expect(e.status).toBe('active');
    expect(e.masked_by_fun_or_adrenaline).toBe(true);
    expect(e.medications_taken[0]).toMatchObject({ taken_during_phase: 'PRODROME', headache_aborted: false });
  });

  it('updates an active episode instead of duplicating it', () => {
    const a = saveAttack([], T, input);
    const b = saveAttack([a], T + HOUR, { sides: [], pain: 4, meds: ['Ibuprofen'], masked: false });
    expect(b.episode_id).toBe(a.episode_id);
    expect(b.peak_pain_score).toBe(7);
    expect(b.pain_location).toEqual(['left']);
    expect(b.medications_taken).toHaveLength(2);
    expect(saveAttack([a], T, { ...input, pain: 9, sides: ['both'] })).toMatchObject({ peak_pain_score: 9, pain_location: ['both'] });
  });

  it('clamps pain to 0..10', () => {
    expect(saveAttack([], T, { ...input, pain: 14 }).peak_pain_score).toBe(10);
    expect(saveAttack([], T, { ...input, pain: -2 }).peak_pain_score).toBe(0);
  });

  it('records whether the medicine helped', () => {
    const p = addProdromeDose(prodromeEpisode([], T), 'Rizatriptan', T);
    const a = saveAttack([p], T + HOUR, input);
    const done = endEpisode(a, T + 6 * HOUR, true);
    expect(done.status).toBe('ended');
    expect(done.medications_taken.map((d) => d.headache_aborted)).toEqual([false, true]);
    expect(openEpisode([done])).toBeNull();
  });

  it('averts prodromes with no headache after 24 h', () => {
    const p = addProdromeDose(prodromeEpisode([], T), 'Rizatriptan', T);
    expect(settleEpisodes([p], T + 23 * HOUR)).toEqual([]);
    const [s] = settleEpisodes([p], T + 25 * HOUR);
    expect(s).toMatchObject({ status: 'averted' });
    expect(Date.parse(s.ended_at!)).toBe(T + 24 * HOUR);
    expect(s.medications_taken[0].headache_aborted).toBe(true);
    expect(avertEpisode(p, T).status).toBe('averted');
  });

  it('lists only real attack onsets, sorted', () => {
    const a = saveAttack([], T + HOUR, input);
    const b = endEpisode(saveAttack([], T, input), T + 2 * HOUR, null);
    const p = prodromeEpisode([], T);
    expect(attackOnsets([a, b, p, avertEpisode(p, T)])).toEqual([T, T + HOUR]);
  });
});
