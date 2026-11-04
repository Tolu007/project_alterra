// Screenshot a URL or local file with the system Edge: node scripts/shot.mjs <url> <out.png> [width] [height]
import { chromium } from 'playwright-core';
const [url, out, w = '1000', h = '820'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.screenshot({ path: out, fullPage: false });
await browser.close();
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
console.log('saved', out);
