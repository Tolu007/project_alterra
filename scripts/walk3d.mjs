// Plays the opening of a life in the 3D world and saves screenshots.
// Usage: node scripts/walk3d.mjs <baseUrl> <outDir> [desktop|mobile] [stateName] [lgaNick]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [base = 'http://localhost:5174/', out = 'shots', kind = 'desktop', state = 'Lagos', lga = 'Oshodi'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const viewport = kind === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const tag = `${kind}-${lga.replace(/[^a-z]/gi, '')}`;
const shot = (name) => page.screenshot({ path: `${out}/${tag}-${name}.png` });
const closeMenu = async () => {
  const close = page.locator('.action-menu .x-btn');
  if (await close.count()) await close.click();
};
/** Opens Places and taps a chip, then waits for the arrival menu. */
const goVia = async (chip) => {
  await closeMenu();
  await page.locator('.hud-br').getByRole('button', { name: /places/i }).click();
  await chip(page.locator('.places-pop')).click();
  await page.waitForSelector('.action-menu', { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(700);
};

await page.goto(base, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: /start a new life/i }).click();
await page.getByLabel('Your name').fill('Bisola Adeyemi');
await page.getByRole('button', { name: state, exact: true }).click();
await page.locator('.option', { hasText: lga }).first().click();
await page.getByRole('button', { name: /begin life/i }).click();
await page.waitForTimeout(4000);
await shot('01-start');

// Walk to your own business on its plot and work a shift.
await goVia((p) => p.locator('.chip-own').first());
await shot('02-own-plot');
const work = page.locator('.am-item:not([disabled])', { hasText: /Work at your|Manage/ }).first();
if (await work.count()) {
  await work.click();
  await page.waitForTimeout(700);
  await shot('03-working');
  await page.waitForTimeout(1600);
}

// Hire someone: they earn for you every night from now on.
const hireBtn = page.locator('.am-item:not([disabled])', { hasText: /Hire a worker/ }).first();
if (await hireBtn.count()) {
  await shot('03b-hire-offer');
  await hireBtn.click();
  await page.waitForTimeout(1800);
}

// The bus stop: danfos to the rest of the state.
await goVia((p) => p.getByRole('button', { name: 'Bus stop', exact: true }));
await shot('04-bus-stop');

// A free plot: what you could build.
await goVia((p) => p.locator('.chip-lot'));
await shot('05-free-plot');

// Pull the camera back to see the neighbourhood.
await closeMenu();
await page.mouse.move(viewport.width / 2, viewport.height / 2);
for (let i = 0; i < 12; i++) {
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(60);
}
await page.waitForTimeout(1200);
await shot('06-town');

// Market by keke.
await page.locator('.hud-br').getByRole('button', { name: /places/i }).click();
await page.locator('.ride-toggle button').nth(1).click();
await page.locator('.places-pop').getByRole('button', { name: 'Market', exact: true }).click();
await page.waitForTimeout(1500);
await shot('07-keke');
await page.waitForSelector('.action-menu', { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(500);
await shot('08-market');

// Sleep to see night and the next morning.
await closeMenu();
await page.locator('.hud-br').getByRole('button', { name: /home/i }).click();
await page.waitForSelector('.action-menu', { timeout: 40000 }).catch(() => {});
const sleep = page.locator('.am-item', { hasText: 'Go to bed' });
if (await sleep.count()) {
  await sleep.click();
  await page.waitForTimeout(900);
  await shot('09-night');
  await page.waitForTimeout(2200);
  await shot('10-morning');
}

// The event centre and what's on.
await goVia((p) => p.getByRole('button', { name: 'Event centre', exact: true }));
await shot('11-event-centre');
await closeMenu();
await page.locator('.hud-br').getByRole('button', { name: /phone/i }).click();
await page.locator('.phone').getByRole('button', { name: /naija news/i }).click();
await page.waitForTimeout(400);
await shot('12-whats-on');
await page.getByRole('button', { name: /close phone/i }).click();

// Let time run fast for a while, then play out the week on routine to see the paper.
await page.getByRole('radio', { name: 'Fastest' }).click();
await page.waitForTimeout(6000);
await shot('13-time-passes');
await page.locator('.hud-br').getByRole('button', { name: /places/i }).click();
await page.getByRole('button', { name: /routine for the rest of the week/i }).click();
await page.waitForTimeout(2500);
await shot('14-weekly-paper');

console.log(errors.length ? 'PAGE ERRORS:\n' + errors.slice(0, 8).join('\n---\n') : 'no page errors');
await browser.close();
