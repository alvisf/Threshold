import { useCallback, useEffect, useMemo, useState } from 'react';
import { App as F7App, Link, Page, Toolbar, View as F7View } from 'framework7-react';
import { Icon, type IconName } from './icons';
import { shouldAlert } from './logic/bucket';
import { derive } from './logic/derive';
import { DAY } from './logic/time';
import { notifyBucket } from './notify';
import { data, housekeeping, load, meta, patchToday, profile, ready, refreshPressure, toast, useStore } from './store';
import { useNow } from './ui';
import { AttackMode } from './views/AttackMode';
import { CheckInSheet } from './views/CheckInView';
import { InsightsView } from './views/InsightsView';
import { ReportView } from './views/ReportView';
import { SettingsView, exportBackup } from './views/SettingsView';
import { FoodSheet } from './views/Sheets';
import { TodayView } from './views/TodayView';

type Tab = 'today' | 'insights' | 'settings';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Today', icon: 'bucket' },
  { id: 'insights', label: 'Insights', icon: 'chart' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
];

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function Banners() {
  const m = useStore(meta);
  const out = [];
  if (isIOS && !isStandalone() && !m.installDismissed) {
    out.push(
      <div className="banner" key="install">
        <span>Add to Home Screen to keep your data.</span>
        <button type="button" onClick={() => meta.set((x) => ({ ...x, installDismissed: true }))}>OK</button>
      </div>,
    );
  }
  if (Date.now() - Math.max(m.firstUse, m.lastExport, m.exportSnooze) > 30 * DAY) {
    out.push(
      <div className="banner" key="export">
        <span>Back up your logs.</span>
        <button type="button" onClick={exportBackup}>Export</button>
        <button type="button" onClick={() => meta.set((x) => ({ ...x, exportSnooze: Date.now() }))}>Later</button>
      </div>,
    );
  }
  return <>{out}</>;
}

function Toast() {
  const t = useStore(toast);
  if (!t) return null;
  return <div className="toast" role="status" onClick={() => toast.set(null)}>{t}</div>;
}

export default function App() {
  const d = useStore(data);
  const p = useStore(profile);
  const isReady = useStore(ready);
  const tick = useNow(30_000);
  const [tab, setTab] = useState<Tab>('today');
  const [attack, setAttack] = useState(false);
  const [report, setReport] = useState(false);
  const [sheet, setSheet] = useState<'checkin' | 'food' | null>(null);

  // Date.now(), not the tick, so a record saved a second ago is already inside every window.
  const v = useMemo(() => derive(d, p, Date.now()), [d, p, tick]);
  const now = v.now;

  useEffect(() => {
    if (!localStorage.getItem('threshold.profile')) profile.set((x) => x);
    load().then(() => refreshPressure());
    const id = setInterval(() => { housekeeping(); refreshPressure(); }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Keep today's score on the log, so tomorrow can check for two calm days in a row.
  useEffect(() => {
    if (isReady && v.log && v.log.calculated_bucket_score !== v.bucket.score) patchToday({ calculated_bucket_score: v.bucket.score });
  }, [isReady, v.log, v.bucket.score]);

  useEffect(() => {
    if (!isReady || !v.alert) return;
    const last = meta.get().lastAlert;
    if (!shouldAlert(v.bucket.score, v.today, last)) return;
    meta.set((m) => ({ ...m, lastAlert: { date: v.today, score: v.bucket.score } }));
    if (p.notifications_enabled) notifyBucket(v.alert);
  }, [isReady, v.alert, v.bucket.score, v.today, p.notifications_enabled]);

  const closeAttack = useCallback(() => setAttack(false), []);
  const closeReport = useCallback(() => setReport(false), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  useEffect(() => { document.querySelector('.view-main .page-content')?.scrollTo(0, 0); }, [tab]);

  return (
    <F7App theme="ios" darkMode colors={{ primary: '#D4A373' }} className="app">
      <F7View main className="safe-areas">
        <Page>
          <Toolbar tabbar icons bottom>
            {TABS.map((t) => (
              <Link key={t.id} tabLink tabLinkActive={tab === t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
                <i className="icon"><Icon name={t.icon} size={26} /></i>
                <span className="tabbar-label">{t.label}</span>
              </Link>
            ))}
          </Toolbar>
          <main>
            <Banners />
            {!isReady ? <p className="muted">Loading…</p> : (
              <>
                {tab === 'today' && (
                  <TodayView v={v} now={now} onAttack={() => setAttack(true)} onFood={() => setSheet('food')} onCheckIn={() => setSheet('checkin')} />
                )}
                {tab === 'insights' && <InsightsView v={v} onReport={() => setReport(true)} />}
                {tab === 'settings' && <SettingsView />}
              </>
            )}
          </main>
        </Page>
      </F7View>
      {sheet === 'food' && <FoodSheet onClose={closeSheet} />}
      {sheet === 'checkin' && <CheckInSheet v={v} onClose={closeSheet} />}
      {attack && <AttackMode onClose={closeAttack} />}
      {report && <ReportView v={v} now={now} onClose={closeReport} />}
      <Toast />
    </F7App>
  );
}
