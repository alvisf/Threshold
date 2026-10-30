import type { FactorStat } from './insights';
import type { AppData } from './model';
import { DAY, addDays, dayKey, fromIso } from './time';

export interface MedRow {
  drug: string;
  prodromeDoses: number;
  prodromeStopped: number;
  headacheDoses: number;
  headacheHelped: number;
}

export interface Report {
  from: string;
  to: string;
  headacheDays: number;
  attacks: number;
  avgPeak: number | null;
  warnedByProdrome: number;
  averted: number;
  letdownAttacks: number;
  meds: MedRow[];
  factors: FactorStat[];
  testsPassed: string[];
  testsFailed: string[];
}

export function buildReport(data: AppData, stats: readonly FactorStat[], now: number, days = 30): Report {
  const fromMs = now - days * DAY;
  const inRange = (t: number) => t >= fromMs && t <= now;
  const eps = data.episodes;
  const attacks = eps.filter((e) => e.headache_onset_at && (e.status === 'active' || e.status === 'ended') && inRange(fromIso(e.headache_onset_at)));

  const daysSet = new Set<string>();
  for (const e of attacks) {
    const start = dayKey(fromIso(e.headache_onset_at));
    const end = dayKey(e.ended_at ? fromIso(e.ended_at) : now);
    for (let d = start; d <= end; d = addDays(d, 1)) daysSet.add(d);
  }

  const peaks = attacks.map((e) => e.peak_pain_score);
  const meds = new Map<string, MedRow>();
  for (const e of eps) {
    const t = fromIso(e.prodrome_detected_at ?? e.headache_onset_at);
    if (!inRange(t)) continue;
    for (const d of e.medications_taken) {
      const row = meds.get(d.drug_name) ?? { drug: d.drug_name, prodromeDoses: 0, prodromeStopped: 0, headacheDoses: 0, headacheHelped: 0 };
      if (d.taken_during_phase === 'PRODROME') { row.prodromeDoses++; if (d.headache_aborted) row.prodromeStopped++; }
      else { row.headacheDoses++; if (d.headache_aborted) row.headacheHelped++; }
      meds.set(d.drug_name, row);
    }
  }

  const tests = data.challenges.filter((c) => c.resolved_at && inRange(fromIso(c.resolved_at)));
  return {
    from: dayKey(fromMs),
    to: dayKey(now),
    headacheDays: daysSet.size,
    attacks: attacks.length,
    avgPeak: peaks.length ? Math.round((peaks.reduce((a, b) => a + b, 0) / peaks.length) * 10) / 10 : null,
    warnedByProdrome: attacks.filter((e) => e.prodrome_detected_at).length,
    averted: eps.filter((e) => e.status === 'averted' && inRange(fromIso(e.prodrome_detected_at))).length,
    letdownAttacks: attacks.filter((e) => e.masked_by_fun_or_adrenaline).length,
    meds: [...meds.values()].sort((a, b) => a.drug.localeCompare(b.drug)),
    factors: stats.filter((s) => s.verdict === 'PRIMARY' || s.verdict === 'STACKING' || s.verdict === 'FALSE_SUSPECT'),
    testsPassed: tests.filter((c) => c.status === 'passed').map((c) => c.item_name),
    testsFailed: tests.filter((c) => c.status === 'failed').map((c) => c.item_name),
  };
}
