// Seeds a save with businesses at every stage on the plots of one LGA, then photographs the street.
// Usage: node scripts/stages.mjs <baseUrl> <outDir> [lgaId] [desktop|mobile]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [base = 'http://localhost:5174/', out = 'shots', lga = 'OSH', kind = 'desktop'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const viewport = kind === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (name) => page.screenshot({ path: `${out}/stages-${lga}-${name}.png` });

await page.goto(base, { waitUntil: 'networkidle' });
// Build the save in the page, with the game's own modules served by Vite.
const made = await page.evaluate(async (lga) => {
  const setup = await import('/src/engine/setup.ts');
  const biz = await import('/src/engine/business.ts');
  const map = await import('/src/engine/map.ts');
  const g = setup.newGame({ name: 'Bisola Adeyemi', gender: 'f', looks: { skin: 2, hair: 1, outfit: 3, accent: 2, glasses: false }, home: lga, start: { kind: 'business', type: 'buka' } }, 7);
  g.player.money = 900_000_000;
  for (const k of Object.keys(g.player.skills)) g.player.skills[k] = 5;
  const h = map.hood(lga);
  const street = ['stall', 'pos', 'supermarket', 'pharmacy', 'restaurant', 'fleet', 'estate', 'school', 'solar', 'logistics', 'clearing', 'wholesale', 'bakery', 'water', 'blocks', 'salon'];
  const levels = [2, 3, 2, 4, 5, 3, 4, 3, 3, 4, 3, 5, 4, 2, 3, 4];
  let i = 0;
  for (const id of h.lots) {
    if (biz.businessOn(g, lga, id)) continue;
    const farm = h.plots[id].kind === 'farm';
    const type = farm ? (i % 2 ? 'ricemill' : 'farm') : street[i % street.length];
    const b = biz.openBusiness(g, type, lga, false, id);
    b.level = farm ? 4 : levels[i % levels.length];
    i++;
  }
  g.businesses[0].level = 1;
  localStorage.setItem('naija-hustle:save:v2', JSON.stringify(g));
  return g.businesses.map((b) => `${b.name} L${b.level} @${b.plot}`);
}, lga);
console.log(made.join('\n'));
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: /continue/i }).click();
await page.waitForTimeout(4000);
await shot('01-home');

const zoom = async (n) => {
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  for (let i = 0; i < Math.abs(n); i++) {
    await page.mouse.wheel(0, n > 0 ? 300 : -300);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(1200);
};
await zoom(6);
await shot('02-wide');

// Visit a few businesses through the Places list.
const chips = page.locator('.places-pop .chip-own');
await page.locator('.hud-br').getByRole('button', { name: /places/i }).click();
const count = await chips.count();
await page.locator('.hud-br').getByRole('button', { name: /places/i }).click();
for (const n of [1, 3, 4, 5, 6, 11, 12]) {
  if (n >= count) continue;
  const close = page.locator('.action-menu .x-btn');
  if (await close.count()) await close.click();
  await page.locator('.hud-br').getByRole('button', { name: /places/i }).click();
  const name = (await chips.nth(n).textContent())?.replace(/[^a-z]/gi, '') ?? String(n);
  await chips.nth(n).click();
  await page.waitForSelector('.action-menu', { timeout: 60000 }).catch(() => {});
  await page.locator('.action-menu .x-btn').click().catch(() => {});
  await page.waitForTimeout(900);
  await shot(`03-${n}-${name}`);
}

console.log(errors.length ? 'PAGE ERRORS:\n' + errors.slice(0, 8).join('\n---\n') : 'no page errors');
await browser.close();
