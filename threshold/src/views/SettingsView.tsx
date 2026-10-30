import { useRef, useState } from 'react';
import { makeBackup, parseBackup } from '../logic/backup';
import type { UserProfile } from '../logic/model';
import { itemLabel, toSlug } from '../logic/time';
import { roundCoord } from '../logic/weather';
import { Icon } from '../icons';
import { askPermission, canNotify } from '../notify';
import { setSyncEnabled, syncConfig, syncNow, useSyncStatus } from '../sync';
import { DEFAULT_PROFILE, data, flash, meta, profile, refreshPressure, replaceData, useStore, wipeAll } from '../store';
import { Card, Switch } from '../ui';

const setP = (patch: Partial<UserProfile>) => profile.set((x) => ({ ...x, ...patch }));

function ListEditor({ items, onChange, placeholder, slug, label }: {
  items: string[]; onChange: (next: string[]) => void; placeholder: string; slug?: boolean; label: string;
}) {
  const [text, setText] = useState('');
  const add = () => {
    const v = slug ? toSlug(text) : text.trim().slice(0, 60);
    if (!v || items.includes(v)) { setText(''); return; }
    onChange([...items, v]);
    setText('');
  };
  return (
    <div className="list-editor">
      <ul>
        {items.map((it) => (
          <li key={it}>
            <span>{slug ? itemLabel(it) : it}</span>
            <button type="button" className="icon-btn" aria-label={`Remove ${slug ? itemLabel(it) : it}`} onClick={() => onChange(items.filter((x) => x !== it))}>
              <Icon name="close" size={20} />
            </button>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={text} placeholder={placeholder} aria-label={label} maxLength={60} onChange={(e) => setText(e.target.value)} />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}

export function exportBackup() {
  const b = makeBackup(profile.get(), data.get(), Date.now());
  const url = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `threshold-backup-${b.exported_at.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  meta.set((m) => ({ ...m, lastExport: Date.now() }));
}

function SyncCard() {
  const c = useStore(syncConfig);
  const st = useSyncStatus();
  const set = (patch: Partial<typeof c>) => syncConfig.set((x) => ({ ...x, ...patch }));
  const toggle = (on: boolean) => {
    if (on && (!c.token || !c.baseId)) { flash('Add a token and a base ID first.'); return; }
    setSyncEnabled(on);
  };
  const waiting = st.pending ? ` · ${st.pending} waiting` : '';
  const status = st.state === 'off' ? 'Off'
    : st.state === 'syncing' ? 'Syncing…'
    : st.state === 'error' ? `Error: ${st.error}${waiting}`
    : `${st.at ? `Synced ${new Date(st.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'On'}${waiting}`;
  return (
    <Card title="Airtable sync">
      <input className="other" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false}
        value={c.token} placeholder="Token (pat…)" aria-label="Airtable token" onChange={(e) => set({ token: e.target.value.trim() })} />
      <input className="other" autoComplete="off" autoCapitalize="off" spellCheck={false}
        value={c.baseId} placeholder="Base ID (app…)" aria-label="Airtable base ID" onChange={(e) => set({ baseId: e.target.value.trim() })} />
      <Switch label="Sync" checked={c.enabled} onChange={toggle} />
      <div className="row">
        <span className={st.state === 'error' ? 'note' : 'muted'} role="status">{status}</span>
        <button type="button" disabled={!c.enabled || st.state === 'syncing'} onClick={() => { void syncNow(); }}>Sync now</button>
      </div>
    </Card>
  );
}

export function SettingsView() {
  const p = useStore(profile);
  const sync = useStore(syncConfig);
  const file = useRef<HTMLInputElement>(null);
  const [locating, setLocating] = useState(false);

  /** On asks for a rough location once. Off forgets it. */
  const pressure = (on: boolean) => {
    if (!on) { setP({ pressure_enabled: false, location: null }); return; }
    if (!navigator.geolocation) { flash('Location is not available here.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setP({ location: { lat: roundCoord(pos.coords.latitude), lon: roundCoord(pos.coords.longitude) }, pressure_enabled: true });
        setLocating(false);
        refreshPressure(true);
      },
      () => { setLocating(false); flash('Location denied.'); },
      { maximumAge: 6 * 3600_000, timeout: 15_000 },
    );
  };

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = parseBackup(await f.text());
      if (!window.confirm('Replace all data on this phone with this backup?')) return;
      await replaceData(r.data);
      if (r.profile) profile.set({ ...DEFAULT_PROFILE, ...r.profile });
      flash(r.skipped ? `Imported. Skipped ${r.skipped} bad records.` : 'Backup imported.');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  const wipe = async () => {
    if (!window.confirm(sync.enabled ? 'Delete every log and setting on this phone and in Airtable? This cannot be undone.' : 'Delete every log, episode and setting on this phone? This cannot be undone.')) return;
    await wipeAll();
    profile.set({ ...DEFAULT_PROFILE });
    flash('All data deleted.');
  };

  const notifications = async (on: boolean) => {
    if (on && canNotify()) await askPermission();
    setP({ notifications_enabled: on });
  };

  return (
    <div className="view">
      <Card title="Foods to watch">
        <ListEditor items={p.suspect_items} slug placeholder="Add a food" label="Add a food to watch" onChange={(x) => setP({ suspect_items: x })} />
      </Card>

      <Card title="Medicines">
        <ListEditor items={p.medications} placeholder="Name and dose" label="Add a medicine" onChange={(x) => setP({ medications: x })} />
      </Card>

      <Card title="Rescue steps">
        <ListEditor items={p.rescue_plan} placeholder="Add a step" label="Add a rescue step" onChange={(x) => setP({ rescue_plan: x })} />
      </Card>

      <Card>
        <label className="row"><span>Usual wake time</span>
          <input type="time" value={p.baseline_wake_time} onChange={(e) => e.target.value && setP({ baseline_wake_time: e.target.value })} />
        </label>
        <Switch label="Cycle tracking" checked={p.menstrual_tracking_enabled} onChange={(x) => setP({ menstrual_tracking_enabled: x })} />
        <Switch label="Auto pressure" hint={locating ? 'Finding you…' : 'Uses a rough location'} checked={p.pressure_enabled} onChange={pressure} />
        <Switch label="Quiet alerts" hint="At 75% or more" checked={p.notifications_enabled} onChange={notifications} />
        {canNotify() && Notification.permission === 'denied' && <p className="note">Alerts are blocked in phone settings.</p>}
      </Card>

      <SyncCard />

      <Card title="Data">
        <div className="actions three">
          <button type="button" onClick={exportBackup}>Export</button>
          <button type="button" onClick={() => file.current?.click()}>Import</button>
          <button type="button" className="danger" onClick={wipe}>Delete all</button>
        </div>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
      </Card>

      <p className="fine">Not medical advice. {sync.enabled ? 'Data stays on this phone and in your Airtable base.' : 'Data stays on this phone.'}</p>
    </div>
  );
}
