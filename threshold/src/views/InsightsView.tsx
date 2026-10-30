import type { View } from '../logic/derive';
import { MIN_DAYS, VERDICT_ADVICE, VERDICT_LABEL, dayDots } from '../logic/insights';
import { fromIso, itemLabel, shortDate } from '../logic/time';
import { data, useStore } from '../store';
import { Card } from '../ui';

const warning = (a: string | null, b: string | null) => {
  if (!a || !b) return null;
  const m = Math.round((fromIso(b) - fromIso(a)) / 60_000);
  if (m < 1) return null;
  return m >= 60 ? `${Math.floor(m / 60)} h warning` : `${m} min warning`;
};

export function InsightsView({ v, onReport }: { v: View; onReport: () => void }) {
  const d = useStore(data);
  const { stats, loggedDays, ready } = v.analysis;
  const dots = dayDots(d, v.today);
  const factors = stats.filter((s) => s.total > 0);
  const episodes = [...d.episodes]
    .filter((e) => e.status !== 'prodrome')
    .sort((a, b) => fromIso(b.headache_onset_at ?? b.prodrome_detected_at) - fromIso(a.headache_onset_at ?? a.prodrome_detected_at))
    .slice(0, 10);
  const tests = [...d.challenges].sort((a, b) => fromIso(b.started_at) - fromIso(a.started_at)).slice(0, 10);
  const attackDays = dots.filter((x) => x.state === 'attack').length;

  return (
    <div className="view">
      <Card title={ready ? 'Last 30 days' : `Day ${loggedDays} of ${MIN_DAYS}`}>
        <div className="dots" role="img" aria-label={`${dots.length - dots.filter((x) => x.state === 'none').length} days logged, ${attackDays} attack days`}>
          {dots.map((x) => <i key={x.date} className={`dot is-${x.state}`} />)}
        </div>
        <div className="legend" aria-hidden="true">
          <span><i className="dot is-logged" />Logged</span>
          <span><i className="dot is-attack" />Attack</span>
        </div>
      </Card>

      <Card title="Triggers">
        {factors.length ? (
          <ul className="factors">
            {factors.map((s) => (
              <li key={`${s.kind}-${s.key}`} className={`v-${s.verdict.toLowerCase()}`}>
                <div className="factor-top">
                  <b>{s.label}</b>
                  {s.verdict === 'NEED_DATA'
                    ? <span className="count" aria-label={`logged ${s.total} times`}>{s.total}</span>
                    : <span className="verdict">{VERDICT_LABEL[s.verdict]}</span>}
                </div>
                {s.verdict !== 'NEED_DATA' && <small className="advice">{VERDICT_ADVICE[s.verdict]}</small>}
              </li>
            ))}
          </ul>
        ) : <p className="muted">Nothing logged yet.</p>}
      </Card>

      {episodes.length > 0 && (
        <Card title="Attacks">
          <ul className="history">
            {episodes.map((e) => {
              const w = warning(e.prodrome_detected_at, e.headache_onset_at);
              return (
                <li key={e.episode_id}>
                  <span>{shortDate(fromIso(e.headache_onset_at ?? e.prodrome_detected_at))}</span>
                  <span>{e.status === 'averted' ? 'Stopped early' : `Pain ${e.peak_pain_score}`}{w ? ` · ${w}` : ''}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {tests.length > 0 && (
        <Card title="Food tests">
          <ul className="history">
            {tests.map((c) => (
              <li key={c.challenge_id}><span>{shortDate(fromIso(c.started_at))}</span><span>{itemLabel(c.item_name)} · {c.status}</span></li>
            ))}
          </ul>
        </Card>
      )}

      <button type="button" className="wide" onClick={onReport}>Doctor report</button>
    </div>
  );
}
