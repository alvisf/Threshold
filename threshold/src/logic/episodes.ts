import type { MedicationDose, MigraineEpisode, PainSide } from './model';
import { DAY, fromIso, toIso, uid } from './time';

export const openEpisode = (eps: readonly MigraineEpisode[]) =>
  eps.find((e) => e.status === 'prodrome' || e.status === 'active') ?? null;

const blank = (now: number): MigraineEpisode => ({
  episode_id: uid(), status: 'prodrome', prodrome_detected_at: toIso(now), headache_onset_at: null, ended_at: null,
  peak_pain_score: 0, pain_location: [], masked_by_fun_or_adrenaline: false, medications_taken: [],
});

/** A prodrome sign was seen. Reuses an open episode, else opens one in the prodrome phase. */
export function prodromeEpisode(eps: readonly MigraineEpisode[], now: number): MigraineEpisode {
  return openEpisode(eps) ?? blank(now);
}

export interface AttackInput { sides: PainSide[]; pain: number; meds: string[]; masked: boolean }

const dose = (drug: string, now: number, phase: MedicationDose['taken_during_phase']): MedicationDose =>
  ({ drug_name: drug, taken_at: toIso(now), taken_during_phase: phase, headache_aborted: null });

/**
 * Attack mode Save. Updates an active episode, turns a prodrome episode into the headache phase,
 * or starts a new episode. Never creates a duplicate while one is open.
 */
export function saveAttack(eps: readonly MigraineEpisode[], now: number, input: AttackInput): MigraineEpisode {
  const pain = Math.max(0, Math.min(10, Math.round(input.pain)));
  const newDoses = input.meds.map((m) => dose(m, now, 'HEADACHE'));
  const open = openEpisode(eps);
  if (open?.status === 'active') {
    return {
      ...open,
      peak_pain_score: Math.max(open.peak_pain_score, pain),
      pain_location: input.sides.length ? [...input.sides] : open.pain_location,
      medications_taken: [...open.medications_taken, ...newDoses],
    };
  }
  const base = open ?? { ...blank(now), prodrome_detected_at: null };
  return {
    ...base,
    status: 'active',
    headache_onset_at: toIso(now),
    peak_pain_score: pain,
    pain_location: [...input.sides],
    masked_by_fun_or_adrenaline: input.masked,
    // Prodrome medicines did not stop the headache.
    medications_taken: [
      ...base.medications_taken.map((d) => (d.taken_during_phase === 'PRODROME' ? { ...d, headache_aborted: false } : d)),
      ...newDoses,
    ],
  };
}

export function addProdromeDose(ep: MigraineEpisode, drug: string, now: number): MigraineEpisode {
  return { ...ep, medications_taken: [...ep.medications_taken, dose(drug, now, 'PRODROME')] };
}

/** "It's over". helped answers "did the medicine help" for headache-phase doses. */
export function endEpisode(ep: MigraineEpisode, now: number, helped: boolean | null): MigraineEpisode {
  return {
    ...ep,
    status: 'ended',
    ended_at: toIso(now),
    medications_taken: ep.medications_taken.map((d) =>
      d.taken_during_phase === 'HEADACHE' && d.headache_aborted === null ? { ...d, headache_aborted: helped } : d),
  };
}

/** Prodrome that never turned into a headache. Its medicines count as having stopped it. */
export function avertEpisode(ep: MigraineEpisode, at: number): MigraineEpisode {
  return {
    ...ep,
    status: 'averted',
    ended_at: toIso(at),
    medications_taken: ep.medications_taken.map((d) => ({ ...d, headache_aborted: true })),
  };
}

/** Prodrome episodes with no headache 24 h later become averted. Returns only the changed ones. */
export function settleEpisodes(eps: readonly MigraineEpisode[], now: number): MigraineEpisode[] {
  return eps
    .filter((e) => e.status === 'prodrome' && now - fromIso(e.prodrome_detected_at) >= DAY)
    .map((e) => avertEpisode(e, fromIso(e.prodrome_detected_at) + DAY));
}

/** Headache onset times (ms) of real attacks. Averted prodromes are not attacks. */
export const attackOnsets = (eps: readonly MigraineEpisode[]): number[] =>
  eps.filter((e) => e.headache_onset_at && (e.status === 'active' || e.status === 'ended'))
    .map((e) => fromIso(e.headache_onset_at))
    .sort((a, b) => a - b);
