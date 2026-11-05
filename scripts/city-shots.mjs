// Screenshots of a real-map district: arrival, a walk to the market, the bus stop's trips.
// Usage: node scripts/city-shots.mjs <baseUrl> <outDir> <lgaNick> [desktop|mobile]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [base = 'http://localhost:5174/', out = 'shots', lga = 'Oshodi', kind = 'desktop'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const viewport = kind === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const tag = `${kind}-${lga.replace(/[^a-z]/gi, '')}`;
const shot = (name) => page.screenshot({ path: `${out}/${tag}-${name}.png` });
const t0 = Date.now();
const log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);

await page.goto(base, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: /start a new life/i }).click();
await page.getByLabel('Your name').fill('Bisola Adeyemi');
await page.getByRole('button', { name: 'Lagos', exact: true }).click();
await page.locator('.option', { hasText: lga }).first().click();
await page.getByRole('button', { name: /begin life/i }).click();
await page.waitForSelector('.map-loading', { state: 'detached', timeout: 60000 }).catch(() => log('map-loading never went away'));
await page.waitForTimeout(5000);
log('arrived');
await shot('01-arrive');

const go = async (name) => {
  const close = page.locator('.action-menu .x-btn');
  if (await close.count()) await close.click();
  await page.locator('.hud-br').getByRole('button', { name: /places/i }).click();
  await page.locator('.places-pop .chip', { hasText: name }).first().click();
  await page.waitForSelector('.action-menu', { timeout: 90000 }).catch(() => log(`never reached ${name}`));
  await page.waitForTimeout(1200);
};
if (!process.argv.includes('quick')) {
  await go(/^Market/);
  log('at the market');
  await shot('02-market');
}
await go(/^Bus stop/);
log('at the bus stop');
await shot('03-busstop');

// The phone's travel app: Lagos, then Nigeria with Kano picked.
const close = page.locator('.action-menu .x-btn');
if (await close.count()) await close.click();
await page.locator('.hud-br').getByRole('button', { name: /phone/i }).click();
await page.locator('.app-icon', { hasText: 'Travel' }).click();
await page.waitForSelector('svg.travel-map', { timeout: 20000 }).catch(() => log('no travel map'));
await page.locator('svg.travel-map g.mm-hit').filter({ hasText: /Yaba|Ikeja/ }).first().locator('circle').first().click({ force: true });
await page.waitForTimeout(600);
await shot('04-travel-lagos');
await page.getByRole('tab', { name: 'Nigeria' }).click();
await page.locator('svg.travel-map g.mm-hit').filter({ hasText: 'Kano' }).first().locator('circle').first().click({ force: true });
await page.waitForTimeout(600);
await shot('05-travel-nigeria');
await page.getByRole('button', { name: 'Close phone' }).click();

// Take a danfo from the bus stop and watch the route.
await go(/^Bus stop/);
await page.locator('.am-item:not([disabled])', { hasText: /^Danfo to/ }).first().click();
await page.waitForTimeout(2500);
await shot('06-trip');
await page.waitForTimeout(6000);
const ok = page.locator('.trip-card button');
if (await ok.count()) await ok.click();
await page.waitForSelector('.map-loading', { state: 'detached', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(5000);
log('arrived in the next district');
await shot('07-next-district');
const shut = page.locator('.action-menu .x-btn');
if (await shut.count()) await shut.click();
const grow = page.locator('.minimap-grow');
if (await grow.count()) {
  await grow.click();
  await page.waitForTimeout(800);
  await shot('08-district-map');
}
console.log(errors.length ? `ERRORS:\n${errors.slice(0, 8).join('\n')}` : 'no errors');
await browser.close();
