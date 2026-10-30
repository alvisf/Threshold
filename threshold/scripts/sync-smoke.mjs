// Two phones, one fake Airtable. Usage: node sync-smoke.mjs <url> <outDir>
// The fake follows Airtable's rules the app relies on: bearer token, CORS preflight, 404 for a missing table,
// table creation through the meta API, 10 records per write, upsert by the id field, paged reads.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/alvisf/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

const [url, out] = process.argv.slice(2);
const BASE = 'appTESTBASE12345', TOKEN = 'patGOOD.token';

const air = { table: null, rows: new Map(), creates: 0, gets: 0, pagedGets: 0, patches: 0, maxBatch: 0, pageCap: 1 };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' };
const json = (status, body) => ({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function airtable(route) {
  const req = route.request();
  const u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.headers().authorization !== `Bearer ${TOKEN}`) return route.fulfill(json(401, { error: { type: 'AUTHENTICATION_REQUIRED', message: 'Authentication required' } }));
  const meta = u.pathname.match(/^\/v0\/meta\/bases\/([^/]+)\/tables$/);
  if (meta) {
    if (meta[1] !== BASE) return route.fulfill(json(404, { error: { type: 'NOT_FOUND' } }));
    const b = JSON.parse(req.postData());
    air.creates++;
    air.table = { name: b.name, fields: b.fields.map((f) => f.name) };
    return route.fulfill(json(200, { id: 'tblX', name: b.name }));
  }
  const m = u.pathname.match(/^\/v0\/([^/]+)\/([^/]+)$/);
  if (!m || m[1] !== BASE || !air.table || decodeURIComponent(m[2]) !== air.table.name) {
    return route.fulfill(json(404, { error: { type: 'TABLE_NOT_FOUND', message: 'Could not find table' } }));
  }
  if (req.method() === 'GET') {
    air.gets++;
    if (u.searchParams.get('offset')) air.pagedGets++;
    const all = [...air.rows.values()];
    const from = Number(u.searchParams.get('offset') || 0);
    const size = Math.min(Number(u.searchParams.get('pageSize') || 100), air.pageCap);
    const page = all.slice(from, from + size).map((fields, i) => ({ id: `rec${from + i}`, fields }));
    return route.fulfill(json(200, { records: page, ...(from + size < all.length ? { offset: String(from + size) } : {}) }));
  }
  if (req.method() === 'PATCH') {
    air.patches++;
    const b = JSON.parse(req.postData());
    air.maxBatch = Math.max(air.maxBatch, b.records.length);
    if (b.records.length > 10) return route.fulfill(json(422, { error: { type: 'INVALID_REQUEST_BODY', message: 'Too many records' } }));
    if (!b.performUpsert?.fieldsToMergeOn?.includes('id')) return route.fulfill(json(422, { error: { type: 'INVALID_REQUEST_BODY' } }));
    for (const r of b.records) {
      const bad = Object.keys(r.fields).find((k) => !air.table.fields.includes(k));
      if (bad) return route.fulfill(json(422, { error: { type: 'UNKNOWN_FIELD_NAME', message: `Unknown field name: "${bad}"` } }));
    }
    for (const r of b.records) {
      const f = { ...r.fields };
      if (!f.deleted) delete f.deleted; // Airtable leaves an unchecked box out
      air.rows.set(f.id, f);
    }
    return route.fulfill(json(200, { records: b.records.map((r, i) => ({ id: `rec${i}`, fields: r.fields })) }));
  }
  return route.fulfill(json(405, { error: { type: 'METHOD_NOT_ALLOWED' } }));
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/home/alvisf/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
});
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
const errors = [];

async function phone(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await ctx.route('https://api.airtable.com/**', airtable);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(url, { waitUntil: 'networkidle' });
  return { page, ctx };
}
const until = async (fn, ms = 10_000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
const tab = (page, name) => page.getByRole('link', { name }).click();
const main = async (page) => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
const status = (page) => page.getByRole('status').filter({ hasText: /^(Off|On|Syncing|Synced|Error)/ }).first();

// ---- Phone A: has data before sync is ever turned on ----
const A = await phone('A');
await A.page.getByRole('button', { name: 'Check in', exact: true }).click();
await A.page.locator('.sheet-modal.modal-in').waitFor();
await A.page.getByLabel('Hours of sleep').focus();
for (let i = 0; i < 4; i++) await A.page.keyboard.press('ArrowLeft');
await A.page.locator('.sheet-modal legend', { hasText: '5.5 h' }).waitFor();
await A.page.locator('.sheet-modal').getByRole('button', { name: 'Skipped or late' }).click();
await A.page.locator('.sheet-modal').getByRole('button', { name: 'Done' }).click();
await A.page.getByText('55%').waitFor();
check('A: 55% before sync', true);

await tab(A.page, 'Settings');
check('A: sync starts off', (await status(A.page).innerText()).startsWith('Off'));
await A.page.getByRole('switch', { name: 'Sync' }).click();
check('A: needs a token first', (await A.page.locator('.toast').innerText()).includes('Add a token'));

// Wrong token shows the error and keeps the changes waiting.
await A.page.getByLabel('Airtable token').fill('patBAD');
await A.page.getByLabel('Airtable base ID').fill(BASE);
await A.page.getByRole('switch', { name: 'Sync' }).click();
await A.page.getByText(/Error: Authentication required/).waitFor();
check('A: wrong token shows the error', true);
check('A: changes wait, nothing lost', /\d+ waiting/.test(await status(A.page).innerText()), await status(A.page).innerText());

// Right token: the table is made by itself, then everything goes up.
await A.page.getByLabel('Airtable token').fill(TOKEN);
await A.page.getByRole('button', { name: 'Sync now' }).click();
await A.page.getByText(/^Synced/).waitFor();
const today = new Date(); const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
check('A: table created once', air.creates === 1 && air.table?.name === 'Threshold' && air.table.fields.join() === 'id,kind,json,updatedAt,deleted');
check('A: existing data went up', air.rows.has(`daily:${key}`) && air.rows.has('profile:me'), [...air.rows.keys()].join(' '));
const dailyRow = air.rows.get(`daily:${key}`);
check('A: row shape', dailyRow?.kind === 'daily' && JSON.parse(dailyRow.json).sleep_hours === 5.5 && typeof dailyRow.updatedAt === 'number' && dailyRow.deleted === undefined);
check('A: pending is zero', !/waiting/.test(await status(A.page).innerText()));
await A.page.screenshot({ path: `${out}/sync-1-settings.png` });

// A change on A goes up by itself.
await A.page.getByLabel('Add a food to watch').fill('Kiwi');
await A.page.getByLabel('Add a food to watch').press('Enter');
check('A: a setting change goes up by itself', await until(() => JSON.parse(air.rows.get('profile:me')?.json ?? '{}').suspect_items?.includes('kiwi')));

// ---- Phone B: new phone, turns sync on, gets everything ----
const B = await phone('B');
check('B: starts empty (0%)', (await main(B.page)).includes('0%'));
await tab(B.page, 'Settings');
await B.page.getByLabel('Airtable token').fill(TOKEN);
await B.page.getByLabel('Airtable base ID').fill(BASE);
await B.page.getByRole('switch', { name: 'Sync' }).click();
await B.page.getByText(/^Synced/).waitFor();
check('B: gets the foods list', (await main(B.page)).includes('Kiwi'));
check('B: did not overwrite A (still one table)', air.creates === 1);
check('B: read the rows in pages', air.pagedGets >= 1, String(air.pagedGets));
check('B: A rows kept their time', JSON.parse(air.rows.get(`daily:${key}`).json).sleep_hours === 5.5);
await tab(B.page, 'Today');
await B.page.getByText('55%').waitFor();
check('B: sees A check-in as 55%', true);
await B.page.screenshot({ path: `${out}/sync-2-phone-b.png` });

// B logs an attack, A picks it up.
await B.page.getByRole('button', { name: 'Open attack mode' }).click();
await B.page.getByRole('dialog', { name: 'Attack mode' }).getByRole('button', { name: 'Save', exact: true }).click();
await B.page.getByText(/Attack since/).waitFor();
check('B: attack goes up by itself', await until(() => [...air.rows.keys()].some((k) => k.startsWith('episodes:'))));
await tab(A.page, 'Settings');
await A.page.getByRole('button', { name: 'Sync now' }).click();
await tab(A.page, 'Today');
check('A: gets the attack from B', await A.page.getByText(/Attack since/).waitFor({ timeout: 8000 }).then(() => true, () => false));

// Delete all on A removes it everywhere.
await tab(A.page, 'Settings');
await A.page.getByRole('button', { name: 'Delete all' }).click();
check('A: rows marked deleted in Airtable', await until(() => ['daily:' + key, 'episodes:'].every((p) => [...air.rows].some(([k, v]) => k.startsWith(p) && v.deleted === true))));
await tab(B.page, 'Settings');
await B.page.getByRole('button', { name: 'Sync now' }).click();
await tab(B.page, 'Today');
check('B: everything gone after sync', await until(async () => { const t = await main(B.page); return !t.includes('Attack since') && t.includes('0%'); }));

// A broken row must not break a phone.
air.rows.set('daily:2020-01-01', { id: 'daily:2020-01-01', kind: 'daily', json: '{oops', updatedAt: 9_999_999_999_999 });
air.rows.set('mystery:1', { id: 'mystery:1', kind: 'mystery', json: '{}', updatedAt: 1 });
await tab(B.page, 'Settings');
await B.page.getByRole('button', { name: 'Sync now' }).click();
await B.page.getByText(/^Synced/).waitFor();
check('B: bad rows ignored', true);

// Turning sync off stops sending.
await A.page.getByRole('switch', { name: 'Sync' }).click();
check('A: off means off', (await status(A.page).innerText()).startsWith('Off'));
const before = air.patches;
await A.page.getByLabel('Add a food to watch').fill('Pear');
await A.page.getByLabel('Add a food to watch').press('Enter');
await A.page.waitForTimeout(2500);
check('A: nothing sent while off', air.patches === before);
check('batches stay at 10 or fewer', air.maxBatch <= 10, String(air.maxBatch));

check('no console errors', errors.length === 0, errors.join(' | '));
console.log(results.join('\n'));
await browser.close();
