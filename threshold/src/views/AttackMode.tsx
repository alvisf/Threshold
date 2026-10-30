import { useEffect, useRef, useState } from 'react';
import { openEpisode, saveAttack } from '../logic/episodes';
import { inLetdown } from '../logic/letdown';
import { PAIN_SIDES, type PainSide } from '../logic/model';
import { Icon } from '../icons';
import { data, flash, profile, upsert, useStore } from '../store';

/** Panic mode: no typing, giant targets, a few taps and Save. */
export function AttackMode({ onClose }: { onClose: () => void }) {
  const p = useStore(profile);
  const d = useStore(data);
  const open = openEpisode(d.episodes);
  const active = open?.status === 'active' ? open : null;
  const [sides, setSides] = useState<PainSide[]>(active?.pain_location ?? []);
  const [pain, setPain] = useState(active ? active.peak_pain_score : 5);
  const [meds, setMeds] = useState<string[]>([]);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const toggleSide = (s: PainSide) => setSides((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));
  const toggleMed = (m: string) => setMeds((x) => (x.includes(m) ? x.filter((y) => y !== m) : [...x, m]));

  const save = () => {
    const now = Date.now();
    upsert('episodes', [saveAttack(d.episodes, now, { sides, pain, meds, masked: inLetdown(d.blocks, now) })]);
    flash(active ? 'Attack updated' : 'Attack saved. Rest now.');
    onClose();
  };

  return (
    <div className="attack" role="dialog" aria-modal="true" aria-label="Attack mode">
      <div className="attack-head">
        <h2>{active ? 'Update attack' : 'Attack'}</h2>
        <button type="button" className="attack-x" aria-label="Close attack mode" onClick={onClose}><Icon name="close" size={30} /></button>
      </div>

      <p className="attack-q">Where is the pain?</p>
      <div className="attack-grid">
        {PAIN_SIDES.map((s, i) => (
          <button key={s.id} ref={i === 0 ? first : undefined} type="button" aria-pressed={sides.includes(s.id)}
            className={`attack-btn ${sides.includes(s.id) ? 'on' : ''}`} onClick={() => toggleSide(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      <p className="attack-q"><span>How bad?</span><b>{pain} / 10</b></p>
      <input className="attack-range" type="range" min={0} max={10} step={1} value={pain} aria-label="Pain from 0 to 10"
        onChange={(e) => setPain(Number(e.target.value))} />

      <p className="attack-q">Medicine taken</p>
      {p.medications.length ? (
        <div className="attack-meds">
          {p.medications.map((m) => (
            <button key={m} type="button" aria-pressed={meds.includes(m)} className={`attack-btn small ${meds.includes(m) ? 'on' : ''}`} onClick={() => toggleMed(m)}>
              {m}
            </button>
          ))}
        </div>
      ) : (
        <p className="attack-note">Add medicines in Settings.</p>
      )}

      <button type="button" className="attack-save" onClick={save}>Save</button>
    </div>
  );
}
