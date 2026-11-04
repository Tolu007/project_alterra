// Screenshots the budget session (player made governor via the dev hook) and a results night.
// Needs the dev server: node scripts/govern.mjs <baseUrl> <outDir>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [base = 'http://localhost:5174/', out = 'shots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
const shot = (name, full = false) => page.screenshot({ path: `${out}/gov-${name}.png`, fullPage: full });

async function newLife() {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /start a new life/i }).click();
  await page.getByLabel('Your name').fill('Bisola Adeyemi');
  await page.getByRole('button', { name: /begin life/i }).click();
  await page.waitForFunction(() => '__nh' in window);
}

/** Clicks through whatever modal is up until the predicate says stop. */
async function clickThrough(stopWhen, max = 25) {
  for (let i = 0; i < max; i++) {
    if (await stopWhen()) return true;
    const overlay = page.locator('.overlay');
    if (await overlay.count()) {
      const choice = overlay.locator('.choice:not([disabled])').first();
      if (await choice.count()) {
        await choice.click();
        await page.waitForTimeout(150);
      }
      const next = overlay.getByRole('button', { name: /new week|continue|take the oath/i }).first();
      if (await next.count()) await next.click();
    } else {
      await page.getByRole('button', { name: /routine rest of week/i }).click();
    }
    await page.waitForTimeout(250);
  }
  return false;
}

await newLife();
await page.evaluate(() => window.__nh.office('LA'));
await page.waitForLoadState('networkidle');
await page.getByRole('button', { name: /continue/i }).click();
await clickThrough(async () => (await page.getByText('How will you spend the people’s money?').count()) > 0);
await page.waitForTimeout(300);
await shot('01-budget', true);
await page.getByRole('button', { name: /sign the budget/i }).click();
await page.waitForTimeout(300);
await shot('02-after');

// Results night for the Lagos governorship (week 30).
await newLife();
await page.evaluate(() => window.__nh.skip(29));
await page.waitForLoadState('networkidle');
await page.getByRole('button', { name: /continue/i }).click();
const found = await clickThrough(async () => (await page.getByText(/Governorship election/).count()) > 0, 40);
await page.waitForTimeout(300);
await shot('03-election', true);
console.log(found ? 'election shown' : 'no election modal found');
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.slice(0, 8).join('\n---\n') : 'no page errors');
await browser.close();
