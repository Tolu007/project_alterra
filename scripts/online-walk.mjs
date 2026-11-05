// Two players in the shared world, in two separate browsers, plus the admin stats page. Saves screenshots.
// Usage: node scripts/online-walk.mjs <baseUrl> <outDir> [admin email]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [base = 'http://localhost:5199/', out = 'shots', adminEmail = 'boss@example.com'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const run = Date.now().toString(36);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];

async function player(name, email, home, kind) {
  const ctx = await browser.newContext({ viewport: kind === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.stack || e}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  await page.goto(base, { waitUntil: 'networkidle' });
  return { page, name, email, home };
}
const shot = (p, n) => p.page.screenshot({ path: `${out}/online-${n}.png` });

async function signUpAndJoin(p, nick, start) {
  const { page } = p;
  await page.getByRole('button', { name: /play online/i }).click();
  await page.getByLabel('Name').fill(p.name);
  await page.getByLabel('Email').fill(p.email);
  await page.getByLabel('Password').fill('jollof-rice-9');
  await page.locator('form').getByRole('button', { name: /create account/i }).click();
  await page.waitForSelector('text=Who are you?', { timeout: 15000 });
  await page.getByRole('button', { name: 'Lagos', exact: true }).click();
  await page.locator('.option', { hasText: nick }).first().click();
  await page.locator('.option', { hasText: start }).first().click();
  await page.getByRole('button', { name: /move into the shared world/i }).click();
  await page.waitForSelector('.live-chip', { timeout: 90000 });
  await page.waitForTimeout(4000);
}

const a = await player('Ada Eze', `ada-${run}@example.com`, 'OSH', 'desktop');
await a.page.screenshot({ path: `${out}/online-00-title.png` });
await signUpAndJoin(a, 'Oshodi', 'Mama put');
await shot(a, '01-ada-joined');

const b = await player('Tunde Bello', `tunde-${run}@example.com`, 'OSH', 'mobile');
await signUpAndJoin(b, 'Oshodi', 'Market stall');
await shot(b, '02-tunde-joined-mobile');

// Ada sees Tunde in town after the next update.
await a.page.waitForTimeout(6000);
await shot(a, '03-ada-sees-tunde');

// Ada works her shift: she is busy, and the clock does not jump.
await a.page.locator('.hud-br').getByRole('button', { name: /places/i }).click();
await a.page.locator('.places-pop .chip-own').first().click();
await a.page.waitForSelector('.action-menu', { timeout: 40000 });
await a.page.waitForTimeout(500);
await shot(a, '04-ada-menu');
const work = a.page.locator('.am-item:not([disabled])', { hasText: /Work at your/ }).first();
if (await work.count()) {
  await work.click();
  await a.page.waitForTimeout(2500);
  await shot(a, '05-ada-busy');
}

// The admin sees both online.
const admin = await player('Site Admin', adminEmail, 'OSH', 'desktop');
await admin.page.getByRole('button', { name: /play online/i }).click();
await admin.page.getByRole('tab', { name: /log in/i }).click();
await admin.page.getByLabel('Email').fill(adminEmail);
await admin.page.getByLabel('Password').fill('admin-pass-1');
await admin.page.locator('form').getByRole('button', { name: /log in/i }).click();
await admin.page.waitForTimeout(2500);
await admin.page.goto(base + '#stats', { waitUntil: 'networkidle' });
await admin.page.reload({ waitUntil: 'networkidle' });
await admin.page.waitForSelector('.stats-tiles', { timeout: 15000 }).catch(() => {});
await admin.page.waitForTimeout(800);
await admin.page.screenshot({ path: `${out}/online-06-stats.png`, fullPage: true });

console.log(errors.length ? 'PAGE ERRORS:\n' + errors.slice(0, 10).join('\n---\n') : 'no page errors');
await browser.close();
