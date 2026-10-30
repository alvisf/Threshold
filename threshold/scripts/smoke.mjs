// Phone smoke test for Threshold. Usage: node smoke.mjs <url> <outDir>
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/alvisf/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

const [url, out] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/home/alvisf/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
});
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const ctx = await browser.newContext({ ...phone, reducedMotion: 'reduce' });

// Auto pressure on, with Open-Meteo answering an 8.2 hPa drop over 24 h.
await ctx.addInitScript(() => {
  if (!localStorage.getItem('threshold.profile')) {
    localStorage.setItem('threshold.profile', JSON.stringify({ pressure_enabled: true, location: { lat: 47.61, lon: -122.33 } }));
  }
});
await ctx.route('https://api.open-meteo.com/**', (route) => {
  const nowHour = Math.floor(Date.now() / 3_600_000) * 3600;
  const time = Array.from({ length: 36 }, (_, i) => nowHour + (i - 30) * 3600);
  const pressure_msl = time.map((t) => (t <= nowHour - 24 * 3600 ? 1013.2 : 1005.0));
  route.fulfill({ contentType: 'application/json', body: JSON.stringify({ hourly: { time, pressure_msl } }) });
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const text = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
const sheet = page.locator('.sheet-modal');
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);

await page.goto(url, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Check in', exact: true }).waitFor();
await page.getByText('25%').waitFor();
check('auto pressure counts before check-in', (await text()).includes('25%'));
check('no top bar', (await page.locator('.navbar').count()) === 0);
check('three tabs', (await page.locator('.tabbar .tab-link').count()) === 3);
await shot('1-today');

// Check-in sheet: 5.5 h sleep, skipped meal. Pressure came in on its own.
await page.getByRole('button', { name: 'Check in', exact: true }).click();
await page.locator('.sheet-modal.modal-in').waitFor();
const sleep = page.getByLabel('Hours of sleep');
await sleep.focus();
for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
await sheet.locator('legend', { hasText: '5.5 h' }).waitFor();
await sheet.getByRole('button', { name: 'Skipped or late' }).click();
check('pressure shown in check-in', (await sheet.innerText()).includes('-8.2 hPa'));
await shot('2-checkin');
await sheet.getByRole('button', { name: 'Done' }).click();
await page.getByText('Eat a protein snack and rest now.').waitFor();
const t2 = await text();
check('spec example scores 80%', t2.includes('80%'));
check('short tip', t2.includes('Eat a protein snack and rest now.'));
check('three factor icons', (await page.locator('.drivers li').count()) === 3);
await shot('3-today-high');

// Food: chocolate + sudden urge + yawning -> prodrome craving.
await page.getByRole('button', { name: 'Food', exact: true }).click();
await sheet.getByRole('button', { name: 'Chocolate', exact: true }).click();
await sheet.getByRole('button', { name: 'Sudden urge' }).click();
await sheet.getByRole('button', { name: 'Yawning' }).click();
await shot('4-food');
await sheet.getByRole('button', { name: 'Save' }).click();
await page.getByText('Prodrome craving').waitFor();
check('prodrome craving text', (await sheet.innerText()).replace(/\s+/g, ' ').includes('Enjoy the snack guilt-free'));
await sheet.getByRole('button', { name: 'Done' }).click();
await page.getByText('A migraine may be starting').waitFor();
check('prodrome card', true);
await shot('5-today-prodrome');

// Attack mode: Left, pain 7, save.
await page.getByRole('button', { name: 'Open attack mode' }).click();
const dlg = page.getByRole('dialog', { name: 'Attack mode' });
await dlg.waitFor();
await dlg.getByRole('button', { name: 'Left', exact: true }).click();
await page.getByLabel('Pain from 0 to 10').focus();
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await shot('6-attack-mode');
await dlg.getByRole('button', { name: 'Save', exact: true }).click();
await page.getByText(/Attack since/).waitFor();
check('attack saved from prodrome', (await text()).includes('pain 7'));

// Rush: one tap to start, one to end, then the wind-down card.
await page.getByRole('button', { name: 'Rush', exact: true }).click();
await page.getByRole('button', { name: 'End rush', exact: true }).click();
await page.getByRole('heading', { name: /Wind down/ }).waitFor();
check('let-down window opens', true);
await shot('7-today-attack-winddown');

for (const [tab, name] of [['Insights', '8-insights'], ['Settings', '9-settings']]) {
  await page.getByRole('link', { name: tab }).click();
  await page.waitForTimeout(150);
  await shot(name);
}
await page.getByRole('link', { name: 'Insights' }).click();
check('30 day dots', (await page.locator('.dots .dot').count()) === 30);
check('attack dot today', (await page.locator('.dots .dot.is-attack').count()) === 1);
await page.getByRole('button', { name: 'Doctor report' }).click();
await page.getByText('Migraine summary').waitFor();
check('report opens', (await page.locator('.report').innerText()).includes('Attacks with prodrome warning'));
await shot('10-report');
await page.getByRole('button', { name: 'Close' }).click();
await page.getByRole('link', { name: 'Today' }).click();

// No pure black or pure white anywhere visible.
const bad = await page.evaluate(() => {
  const hits = new Set();
  const isPure = (c) => /^rgba?\((255, 255, 255|0, 0, 0)(, 1)?\)$/.test(c);
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    for (const p of ['color', 'backgroundColor']) if (isPure(s[p])) hits.add(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} ${p}=${s[p]}`);
    if (s.borderTopStyle !== 'none' && parseFloat(s.borderTopWidth) > 0 && isPure(s.borderTopColor)) hits.add(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} border=${s.borderTopColor}`);
  }
  return [...hits].slice(0, 20);
});
check('no pure black or white', bad.length === 0, bad.join(' | '));

// Reload keeps data (IndexedDB).
await page.reload({ waitUntil: 'networkidle' });
await page.getByText(/Attack since/).waitFor();
check('data survives reload', true);

// With motion allowed, the fill eases up to 25% instead of jumping.
const live = await browser.newContext(phone);
await live.addInitScript(() => {
  if (!localStorage.getItem('threshold.profile')) {
    localStorage.setItem('threshold.profile', JSON.stringify({ pressure_enabled: true, location: { lat: 47.61, lon: -122.33 } }));
  }
});
await live.route('https://api.open-meteo.com/**', (route) => {
  const nowHour = Math.floor(Date.now() / 3_600_000) * 3600;
  const time = Array.from({ length: 36 }, (_, i) => nowHour + (i - 30) * 3600);
  route.fulfill({ contentType: 'application/json', body: JSON.stringify({ hourly: { time, pressure_msl: time.map((t) => (t <= nowHour - 86400 ? 1013.2 : 1005.0)) } }) });
});
const p2 = await live.newPage();
await p2.goto(url, { waitUntil: 'domcontentloaded' });
const fillY = () => p2.locator('.g-fill').evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42);
await p2.getByText('25%').waitFor();
const early = await fillY();
await p2.waitForTimeout(1800);
const late = await fillY();
check('fill eases up', early > late + 5 && Math.abs(late - 94.5) < 1, `${early.toFixed(1)} -> ${late.toFixed(1)}`);
await live.close();

check('no console errors', errors.length === 0, errors.join(' | '));
console.log(results.join('\n'));
await browser.close();
