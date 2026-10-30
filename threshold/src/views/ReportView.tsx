import { useEffect, useMemo } from 'react';
import type { View } from '../logic/derive';
import { VERDICT_LABEL } from '../logic/insights';
import { buildReport } from '../logic/report';
import { itemLabel } from '../logic/time';
import { data, useStore } from '../store';

export function ReportView({ v, now, onClose }: { v: View; now: number; onClose: () => void }) {
  const d = useStore(data);
  const r = useMemo(() => buildReport(d, v.analysis.stats, now), [d, v.analysis.stats, now]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="report" role="dialog" aria-modal="true" aria-label="Neurologist report">
      <div className="report-bar no-print">
        <button type="button" onClick={onClose}>Close</button>
        <button type="button" className="primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <article className="sheet">
        <h1>Migraine summary</h1>
        <p>{r.from} to {r.to} · from the Threshold app, patient-logged</p>

        <table className="kv">
          <tbody>
            <tr><th>Headache days</th><td>{r.headacheDays}</td></tr>
            <tr><th>Attacks</th><td>{r.attacks}</td></tr>
            <tr><th>Average peak pain</th><td>{r.avgPeak ?? '-'} / 10</td></tr>
            <tr><th>Attacks with prodrome warning</th><td>{r.warnedByProdrome} of {r.attacks}</td></tr>
            <tr><th>Prodromes stopped before pain</th><td>{r.averted}</td></tr>
            <tr><th>Let-down attacks (after stress or excitement)</th><td>{r.letdownAttacks}</td></tr>
          </tbody>
        </table>

        <h2>Medicine results</h2>
        {r.meds.length ? (
          <table>
            <thead><tr><th>Medicine</th><th>In prodrome: stopped it</th><th>In headache: helped</th></tr></thead>
            <tbody>
              {r.meds.map((m) => (
                <tr key={m.drug}>
                  <td>{m.drug}</td>
                  <td>{m.prodromeStopped} of {m.prodromeDoses}</td>
                  <td>{m.headacheHelped} of {m.headacheDoses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p>No medicines logged.</p>}

        <h2>Trigger findings</h2>
        {r.factors.length ? (
          <table>
            <thead><tr><th>Factor</th><th>Finding</th><th>Before attack</th><th>P trigger</th></tr></thead>
            <tbody>
              {r.factors.map((f) => (
                <tr key={`${f.kind}-${f.key}`}>
                  <td>{f.label}</td><td>{VERDICT_LABEL[f.verdict]}</td><td>{f.attack} of {f.total}</td><td>{Math.round(f.p * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p>{v.analysis.ready ? 'No confirmed triggers.' : `Not enough data yet (${v.analysis.loggedDays} of 30 days).`}</p>}

        <h2>Calm-day food tests</h2>
        <p>
          Passed: {r.testsPassed.length ? r.testsPassed.map(itemLabel).join(', ') : 'none'}.
          Failed: {r.testsFailed.length ? r.testsFailed.map(itemLabel).join(', ') : 'none'}.
        </p>
        <p className="fine">P trigger = (attacks within 24 h after the factor, minus prodrome cravings) / times logged. Not a diagnosis.</p>
      </article>
    </div>
  );
}
