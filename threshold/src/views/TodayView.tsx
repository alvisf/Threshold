import { useState } from 'react';
import type { FactorKey } from '../logic/bucket';
import { startChallenge } from '../logic/calm';
import { makeEvent } from '../logic/craving';
import type { View } from '../logic/derive';
import { avertEpisode, endEpisode } from '../logic/episodes';
import { DECOMPRESSION, endBlock, startBlock, toggleStep } from '../logic/letdown';
import { DAY, clockTime, duration, fromIso, itemLabel } from '../logic/time';
import { Icon, type IconName } from '../icons';
import { flash, upsert } from '../store';
import { Card, Chip } from '../ui';
import { BucketGauge } from './Bucket';
import { RescueSteps } from './Sheets';

const FACTOR_ICON: Record<FactorKey, IconName> = {
  sleep: 'sleep', wake: 'wake', pressure: 'pressure', meal: 'meal', water: 'water', caffeine: 'caffeine',
  stress: 'bolt', letdown: 'wave', cycle: 'cycle', foods: 'food', primary: 'food',
};

interface Props {
  v: View;
  now: number;
  onAttack: () => void;
  onFood: () => void;
  onCheckIn: () => void;
}

function Tile({ icon, label, on, done, onClick }: { icon: IconName; label: string; on?: boolean; done?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`tile ${on ? 'on' : ''} ${done ? 'done' : ''}`} onClick={onClick}>
      <Icon name={icon} size={28} />
      <span>{label}</span>
    </button>
  );
}

export function TodayView({ v, now, onAttack, onFood, onCheckIn }: Props) {
  const [asking, setAsking] = useState(false);
  const ep = v.episode;
  const checked = !!v.log?.checked_in;

  const finish = (helped: boolean | null) => {
    if (!ep) return;
    upsert('episodes', [endEpisode(ep, Date.now(), helped)]);
    setAsking(false);
    flash('Episode closed');
  };
  const over = () => {
    if (!ep) return;
    if (ep.medications_taken.some((m) => m.taken_during_phase === 'HEADACHE' && m.headache_aborted === null)) setAsking(true);
    else finish(null);
  };

  const rush = () => {
    const t = Date.now();
    if (v.running) {
      upsert('blocks', [endBlock(v.running, t)]);
      flash('Rush over. Wind down slowly.');
    } else {
      upsert('blocks', [startBlock('excitement', 2, t)]);
      flash('Rush started. Tap End rush when it ends.');
    }
  };

  const startTest = () => {
    const item = v.testSuggestion;
    if (!item) return;
    const t = Date.now();
    upsert('challenges', [startChallenge(item, t)]);
    upsert('events', [makeEvent({ item, suddenUrge: false, signs: [], context: 'challenge', now: t })]);
    flash(`Testing ${itemLabel(item)}`);
  };

  return (
    <div className="view">
      {ep?.status === 'active' && (
        <Card tone="alert" title={`Attack since ${clockTime(fromIso(ep.headache_onset_at))} · pain ${ep.peak_pain_score}`}>
          {asking ? (
            <>
              <p className="q">Did the medicine help?</p>
              <div className="pair">
                <Chip className="big" onClick={() => finish(true)}>Yes</Chip>
                <Chip className="big" onClick={() => finish(false)}>No</Chip>
                <Chip className="big" onClick={() => finish(null)}>Not sure</Chip>
              </div>
            </>
          ) : (
            <button type="button" className="primary wide" onClick={over}>It's over</button>
          )}
        </Card>
      )}

      {ep?.status === 'prodrome' && (
        <Card tone="amber" title="A migraine may be starting">
          <RescueSteps episodeId={ep.episode_id} />
          <div className="pair">
            <button type="button" className="primary" onClick={onAttack}>Pain started</button>
            <button type="button" onClick={() => { upsert('episodes', [avertEpisode(ep, Date.now())]); flash('Marked as passed'); }}>It passed</button>
          </div>
        </Card>
      )}

      <section className="hero">
        <BucketGauge score={v.bucket.score} level={v.level} />
        {v.bucket.contributions.length > 0 && (
          <ul className="drivers">
            {v.bucket.contributions.map((c) => (
              <li key={c.key} aria-label={`${c.label}, ${c.detail}, plus ${c.points}`}>
                <Icon name={FACTOR_ICON[c.key]} size={22} />
                <b>+{c.points}</b>
                <span>{c.word}</span>
              </li>
            ))}
          </ul>
        )}
        {v.tip && <p className="tip" role="alert">{v.tip}</p>}
      </section>

      <div className="tiles">
        <Tile icon="check" label={checked ? 'Checked in' : 'Check in'} on={!checked} done={checked} onClick={onCheckIn} />
        <Tile icon="food" label="Food" onClick={onFood} />
        <Tile icon={v.running ? 'stop' : 'bolt'} label={v.running ? 'End rush' : 'Rush'} on={!!v.running} onClick={rush} />
      </div>
      <button type="button" className="attack-big" onClick={onAttack} aria-label="Open attack mode">
        <Icon name="head" size={28} />
        <span>Attack</span>
      </button>

      {v.letdown && (
        <Card tone="amber" title={`Wind down · ${duration(fromIso(v.letdown.letdown_window_ends_at) - now)} left`}>
          <ul className="checklist">
            {DECOMPRESSION.map((s) => (
              <li key={s.id}>
                <Chip on={v.letdown!.decompression_done.includes(s.id)} onClick={() => upsert('blocks', [toggleStep(v.letdown!, s.id)])}>{s.label}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {v.challenge && (
        <Card tone="sage" title={`Testing ${itemLabel(v.challenge.item_name)} · ${duration(fromIso(v.challenge.started_at) + DAY - now)} left`}>
          <button type="button" className="link" onClick={() => upsert('challenges', [{ ...v.challenge!, status: 'cancelled', resolved_at: new Date().toISOString() }])}>Cancel test</button>
        </Card>
      )}

      {v.calmEligible && v.testSuggestion && (
        <Card tone="sage" title="Calm day">
          <p>Test {itemLabel(v.testSuggestion)} today? Eat a normal amount.</p>
          <button type="button" className="primary wide" onClick={startTest}>Start test</button>
        </Card>
      )}
    </div>
  );
}
