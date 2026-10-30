import { useState } from 'react';
import { RESULT, isProdrome, makeEvent } from '../logic/craving';
import { addProdromeDose, prodromeEpisode } from '../logic/episodes';
import { SIGNS, type FoodAndCravingEvent, type ProdromeSign } from '../logic/model';
import { itemLabel, toSlug } from '../logic/time';
import { data, flash, profile, upsert, useStore } from '../store';
import { Chip, Modal } from '../ui';

export function RescueSteps({ episodeId }: { episodeId: string | null }) {
  const p = useStore(profile);
  const d = useStore(data);
  const [done, setDone] = useState<string[]>([]);
  const ep = d.episodes.find((e) => e.episode_id === episodeId);
  const taken = ep?.medications_taken.filter((m) => m.taken_during_phase === 'PRODROME').map((m) => m.drug_name) ?? [];
  const take = (m: string) => {
    if (!ep || taken.includes(m)) return;
    upsert('episodes', [addProdromeDose(ep, m, Date.now())]);
    flash(`${m} logged`);
  };
  return (
    <div className="rescue">
      <ul className="checklist">
        {p.rescue_plan.map((s) => (
          <li key={s}>
            <Chip on={done.includes(s)} onClick={() => setDone((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}>{s}</Chip>
          </li>
        ))}
      </ul>
      {ep?.status === 'prodrome' && p.medications.length > 0 && (
        <>
          <h4>Took a medicine?</h4>
          <div className="chips">
            {p.medications.map((m) => <Chip key={m} on={taken.includes(m)} onClick={() => take(m)}>{m}</Chip>)}
          </div>
        </>
      )}
    </div>
  );
}

/** One entry for cravings and meals. The urge and the signs decide what it means. */
export function FoodSheet({ onClose }: { onClose: () => void }) {
  const p = useStore(profile);
  const [item, setItem] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [urge, setUrge] = useState<boolean | null>(null);
  const [signs, setSigns] = useState<ProdromeSign[]>([]);
  const [saved, setSaved] = useState<FoodAndCravingEvent | null>(null);
  const [episodeId, setEpisodeId] = useState<string | null>(null);

  const name = item ?? toSlug(custom);
  const canSave = !!name && urge !== null;

  const save = () => {
    if (!name || urge === null) return;
    const now = Date.now();
    const ev = makeEvent({ item: name, suddenUrge: urge, signs, now });
    upsert('events', [ev]);
    if (!p.suspect_items.includes(name)) profile.set((x) => ({ ...x, suspect_items: [...x.suspect_items, name] }));
    if (isProdrome(ev.classification)) {
      const ep = prodromeEpisode(data.get().episodes, now);
      upsert('episodes', [ep]);
      setEpisodeId(ep.episode_id);
    }
    setSaved(ev);
  };

  if (saved) {
    const r = RESULT[saved.classification];
    const prodrome = isProdrome(saved.classification);
    return (
      <Modal title={itemLabel(saved.item_name)} onClose={onClose}>
        <div className={`result ${prodrome ? 'amber' : 'sage'}`} role="status">
          <h3>{r.title}</h3>
          <p>{r.text}</p>
        </div>
        {prodrome && <RescueSteps episodeId={episodeId} />}
        <button type="button" className="primary wide" onClick={onClose}>Done</button>
      </Modal>
    );
  }

  return (
    <Modal title="Food" onClose={onClose}>
      <div className="chips">
        {p.suspect_items.map((s) => (
          <Chip key={s} on={item === s} onClick={() => { setItem(s); setCustom(''); }}>{itemLabel(s)}</Chip>
        ))}
      </div>
      <input
        className="other" placeholder="Something else" aria-label="Something else" value={custom} maxLength={40}
        onChange={(e) => { setCustom(e.target.value); setItem(null); }}
      />
      <div className="pair">
        <Chip className="big" on={urge === true} onClick={() => setUrge(true)}>Sudden urge</Chip>
        <Chip className="big" on={urge === false} onClick={() => setUrge(false)}>Normal meal</Chip>
      </div>
      <p className="q">Any of these?</p>
      <div className="chips">
        {SIGNS.map((s) => (
          <Chip key={s.id} on={signs.includes(s.id)} onClick={() => setSigns((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id]))}>
            {s.label}
          </Chip>
        ))}
      </div>
      <button type="button" className="primary wide" disabled={!canSave} onClick={save}>Save</button>
    </Modal>
  );
}
