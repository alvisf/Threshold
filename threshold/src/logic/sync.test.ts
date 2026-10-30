import { describe, expect, it } from 'vitest';
import { PROFILE_ID, parseRow, pickProfile, planPull, profileJson, rowId, toFields, type QueueEntry, type Row } from './syncPlan';
import type { UserProfile } from './model';

const day = (date: string, extra: object = {}) => ({ log_id: date, date, sleep_hours: 6, ...extra });
const row = (coll: Row['kind'], key: string, rec: object | null, updatedAt: number): Row => ({
  id: rowId(coll, key), kind: coll, json: rec ? JSON.stringify(rec) : '', updatedAt, deleted: rec === null,
});

describe('parseRow', () => {
  it('reads an Airtable record and treats a missing checkbox as false', () => {
    expect(parseRow({ id: 'daily:2026-10-29', kind: 'daily', json: '{}', updatedAt: 5 })).toEqual({
      id: 'daily:2026-10-29', kind: 'daily', json: '{}', updatedAt: 5, deleted: false,
    });
    expect(parseRow({ id: 'events:e1', kind: 'events', updatedAt: 7, deleted: true })?.deleted).toBe(true);
    expect(parseRow({ id: 'events:e1', kind: 'events', updatedAt: 7 })?.json).toBe('');
  });

  it('rejects rows it cannot trust', () => {
    expect(parseRow({ kind: 'daily', updatedAt: 1 })).toBeNull();
    expect(parseRow({ id: 'daily:x', kind: 'daily' })).toBeNull();
    expect(parseRow({ id: 'daily:x', kind: 'daily', updatedAt: 'soon' })).toBeNull();
    expect(parseRow({ id: 'cats:x', kind: 'cats', updatedAt: 1 })).toBeNull();
    expect(parseRow({ id: 'events:x', kind: 'daily', updatedAt: 1 })).toBeNull();
    expect(parseRow({ id: 'profile:other', kind: 'profile', updatedAt: 1 })).toBeNull();
    expect(parseRow({ id: PROFILE_ID, kind: 'profile', updatedAt: 1 })?.id).toBe(PROFILE_ID);
  });

  it('round-trips through toFields', () => {
    const e: QueueEntry = { coll: 'daily', json: '{"a":1}', at: 9 };
    expect(toFields('daily:d', e)).toEqual({ id: 'daily:d', kind: 'daily', json: '{"a":1}', updatedAt: 9, deleted: false });
    expect(toFields('daily:d', { coll: 'daily', json: null, at: 9 })).toEqual({ id: 'daily:d', kind: 'daily', json: '', updatedAt: 9, deleted: true });
  });
});

describe('planPull', () => {
  it('takes a new row and remembers its time', () => {
    const p = planPull([row('daily', '2026-10-29', day('2026-10-29'), 100)], {}, {});
    expect(p.puts.daily).toEqual([day('2026-10-29')]);
    expect(p.stamps).toEqual({ 'daily:2026-10-29': 100 });
  });

  it('keeps the local copy when it is as new or newer', () => {
    const r = row('daily', 'd', day('d'), 100);
    expect(planPull([r], { 'daily:d': 100 }, {}).puts.daily).toBeUndefined();
    expect(planPull([r], { 'daily:d': 250 }, {}).puts.daily).toBeUndefined();
    expect(planPull([r], { 'daily:d': 99 }, {}).puts.daily).toHaveLength(1);
  });

  it('keeps a change that is still waiting to be sent when it is newer', () => {
    const r = row('daily', 'd', day('d'), 100);
    const waiting = (at: number): Record<string, QueueEntry> => ({ 'daily:d': { coll: 'daily', json: '{}', at } });
    expect(planPull([r], {}, waiting(100)).puts.daily).toBeUndefined();
    expect(planPull([r], {}, waiting(300)).puts.daily).toBeUndefined();
    expect(planPull([r], {}, waiting(50)).puts.daily).toHaveLength(1);
  });

  it('turns a deleted row into a local delete, and keeps its time', () => {
    const p = planPull([row('events', 'e1', null, 200)], { 'events:e1': 100 }, {});
    expect(p.dels.events).toEqual(['e1']);
    expect(p.stamps['events:e1']).toBe(200);
    expect(planPull([row('events', 'e1', null, 50)], { 'events:e1': 100 }, {}).dels.events).toBeUndefined();
  });

  it('lets the newest row win when an id appears twice', () => {
    const rows = [row('daily', 'd', day('d', { sleep_hours: 9 }), 300), row('daily', 'd', day('d', { sleep_hours: 4 }), 200)];
    expect(planPull(rows, {}, {}).puts.daily).toEqual([day('d', { sleep_hours: 9 })]);
    const del = [row('daily', 'd', day('d'), 100), row('daily', 'd', null, 200)];
    const p = planPull(del, {}, {});
    expect(p.puts.daily).toEqual([]);
    expect(p.dels.daily).toEqual(['d']);
  });

  it('skips bad json, a wrong key, and counts them', () => {
    const bad: Row[] = [
      { id: 'daily:a', kind: 'daily', json: '{oops', updatedAt: 1, deleted: false },
      row('daily', 'b', day('not-b'), 1),
      { id: 'daily:c', kind: 'daily', json: '[1,2]', updatedAt: 1, deleted: false },
      row('daily', 'ok', day('ok'), 1),
    ];
    const p = planPull(bad, {}, {});
    expect(p.skipped).toBe(3);
    expect(p.puts.daily).toEqual([day('ok')]);
    expect(Object.keys(p.stamps)).toEqual(['daily:ok']);
  });

  it('applies several collections at once', () => {
    const p = planPull([
      row('events', 'e1', { event_id: 'e1', item_name: 'citrus' }, 10),
      row('episodes', 'p1', { episode_id: 'p1', status: 'active' }, 20),
    ], {}, {});
    expect(p.puts.events).toHaveLength(1);
    expect(p.puts.episodes).toHaveLength(1);
  });
});

describe('profile sync', () => {
  const base: UserProfile = {
    user_id: 'u', baseline_wake_time: '07:00', baseline_caffeine_mg: 150, menstrual_tracking_enabled: false,
    suspect_items: ['chocolate'], medications: ['Sumatriptan 50mg'], rescue_plan: ['Drink water'],
    pressure_enabled: true, location: { lat: 1, lon: 2 }, notifications_enabled: true,
  };

  it('sends only the settings that belong to the person', () => {
    const j = JSON.parse(profileJson(base));
    expect(Object.keys(j).sort()).toEqual(['baseline_wake_time', 'medications', 'menstrual_tracking_enabled', 'rescue_plan', 'suspect_items']);
    expect(profileJson({ ...base, location: { lat: 9, lon: 9 }, notifications_enabled: false })).toBe(profileJson(base));
  });

  it('takes a good profile row', () => {
    const p = planPull([{ id: PROFILE_ID, kind: 'profile', json: profileJson({ ...base, suspect_items: ['kiwi'] }), updatedAt: 5, deleted: false }], {}, {});
    expect(p.profile?.suspect_items).toEqual(['kiwi']);
    expect(p.stamps[PROFILE_ID]).toBe(5);
  });

  it('ignores fields that look wrong and keeps the rest', () => {
    expect(pickProfile({ baseline_wake_time: '25:99', suspect_items: 'chocolate', medications: ['A'], extra: 1 })).toEqual({ medications: ['A'] });
    expect(pickProfile({ suspect_items: ['', 'x'] })).toBeNull();
    expect(pickProfile({ rescue_plan: ['x'.repeat(81)] })).toBeNull();
    expect(pickProfile([])).toBeNull();
    expect(pickProfile(null)).toBeNull();
  });

  it('skips a broken profile row without stamping it', () => {
    const p = planPull([{ id: PROFILE_ID, kind: 'profile', json: 'nope', updatedAt: 5, deleted: false }], {}, {});
    expect(p.profile).toBeNull();
    expect(p.skipped).toBe(1);
    expect(p.stamps).toEqual({});
  });
});
