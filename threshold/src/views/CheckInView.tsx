import type { View } from '../logic/derive';
import type { Caffeine, CyclePhase, DailyBucketLog, Hydration, Stress } from '../logic/model';
import { checkIn, checkInDefaults, profile, useStore } from '../store';
import { Choice, Modal } from '../ui';

const WATER: { id: Hydration; label: string }[] = [{ id: 'low', label: 'Low' }, { id: 'ok', label: 'OK' }, { id: 'good', label: 'Good' }];
const MEALS: { id: 'ok' | 'skipped'; label: string }[] = [{ id: 'ok', label: 'On time' }, { id: 'skipped', label: 'Skipped or late' }];
const CAFFEINE: { id: Caffeine; label: string }[] = [{ id: 'less', label: 'Less' }, { id: 'usual', label: 'Usual' }, { id: 'more', label: 'More' }];
const MOOD: { id: Stress; label: string }[] = [{ id: 'calm', label: 'Calm' }, { id: 'stressed', label: 'Stressed' }, { id: 'excited', label: 'Excited' }];
const CYCLE: { id: CyclePhase; label: string }[] = [
  { id: 'pre_period', label: 'Pre-period' }, { id: 'period', label: 'Period' }, { id: 'ovulation', label: 'Ovulation' }, { id: 'other', label: 'Other' },
];

/** Prefilled from yesterday, so a same-as-usual day is one tap on Done. Every tap saves. */
export function CheckInSheet({ v, onClose }: { v: View; onClose: () => void }) {
  const p = useStore(profile);
  const shown: Partial<DailyBucketLog> = { ...checkInDefaults(), ...(v.log?.checked_in ? v.log : {}) };
  const set = (patch: Partial<DailyBucketLog>) => checkIn(patch);
  const sleep = shown.sleep_hours ?? 7.5;
  const hpa = v.log?.barometric_delta_hpa;

  return (
    <Modal title="Check in" onClose={onClose}
      aside={<span className={`mini lv-${v.level}`} aria-label={`Bucket ${v.bucket.score}%`}>{v.bucket.score}%</span>}>
      <fieldset className="field">
        <legend>Sleep <b>{sleep} h</b></legend>
        <input type="range" className="range" min={3} max={12} step={0.5} value={sleep} aria-label="Hours of sleep"
          onChange={(e) => set({ sleep_hours: Number(e.target.value) })} />
      </fieldset>

      <label className="row field-row">
        <b>Woke up</b>
        <input type="time" value={shown.wake_time ?? p.baseline_wake_time} aria-label="Wake time"
          onChange={(e) => e.target.value && set({ wake_time: e.target.value })} />
      </label>

      <Choice label="Water" options={WATER} value={shown.hydration_level ?? null} onChange={(x) => set({ hydration_level: x })} />
      <Choice label="Meals" options={MEALS} value={shown.skipped_meal_flag ? 'skipped' : 'ok'} onChange={(x) => set({ skipped_meal_flag: x === 'skipped' })} />
      <Choice label="Caffeine" options={CAFFEINE} value={shown.caffeine_variance ?? null} onChange={(x) => set({ caffeine_variance: x })} />
      <Choice label="Mood" options={MOOD} value={shown.stress_state ?? null} onChange={(x) => set({ stress_state: x })} />
      {p.menstrual_tracking_enabled && (
        <Choice label="Cycle" options={CYCLE} value={shown.cycle_phase ?? null} onChange={(x) => set({ cycle_phase: x })} />
      )}
      {p.pressure_enabled && hpa != null && (
        <p className="row field-row"><b>Pressure</b><span>{hpa > 0 ? '+' : ''}{hpa.toFixed(1)} hPa</span></p>
      )}

      <button type="button" className="primary wide" onClick={() => { checkIn({}); onClose(); }}>Done</button>
    </Modal>
  );
}
