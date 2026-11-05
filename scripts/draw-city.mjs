// Draws a built district as an SVG (and a PNG next to it, through Edge) to check the city builder's work.
// Usage: node scripts/draw-city.mjs OSH [out-dir] [--zoom]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const id = process.argv[2] ?? 'OSH';
const outDir = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'data/osm/draw';
const zoom = process.argv.includes('--zoom');
mkdirSync(outDir, { recursive: true });
const eng = JSON.parse(readFileSync('src/data/city/lagos.json', 'utf8')).districts[id];
const ren = JSON.parse(readFileSync(`src/data/city/render/${id}.json`, 'utf8'));
const b = eng.bounds;
const pairs = (a) => a.reduce((o, v, i) => (i % 2 ? (o[o.length - 1].push(v), o) : (o.push([v]), o)), []);
const pts = (a) => pairs(a).map(([x, z]) => `${x},${z}`).join(' ');
const stop = eng.busStop;
const view = zoom ? [stop.x - 160, stop.z - 120, 320, 240] : [b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ];
const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.join(' ')}" width="${zoom ? 1600 : 1400}" height="${zoom ? 1200 : Math.round((1400 * view[3]) / view[2])}">`);
out.push(`<rect x="${b.minX}" y="${b.minZ}" width="${b.maxX - b.minX}" height="${b.maxZ - b.minZ}" fill="#e8dcc0"/>`);
const areaFill = { industrial: '#cfc6b8', port: '#c2c0bb', commercial: '#ecd3c8', retail: '#ecc9c0', cemetery: '#b9c9a8', park: '#a9cf8a', stadium: '#b4d39a', golf_course: '#a9cf8a', military: '#d9c2a8', apron: '#bdbdbd', railway: '#d3c8c0' };
for (const a of ren.areas) out.push(`<polygon points="${pts(a.p)}" fill="${areaFill[a.k] ?? '#ddd'}"/>`);
for (const w of ren.water) out.push(`<polygon points="${pts(w)}" fill="#7fb6d6"/>`);
for (const w of ren.islands) out.push(`<polygon points="${pts(w)}" fill="#e8dcc0"/>`);
for (const r of ren.runways) out.push(`<polyline points="${pts(r)}" stroke="#555" stroke-width="18" fill="none"/>`);
for (const r of ren.roads) out.push(`<polyline points="${pts(r.p)}" stroke="${r.c === 'major' ? '#3d3b38' : r.c === 'minor' ? '#5a5650' : r.c === 'link' ? '#7a5a3a' : '#8a857c'}" stroke-width="${r.w}" stroke-linecap="round" stroke-linejoin="round" fill="none" ${r.x ? 'stroke-dasharray="4 3"' : ''}/>`);
for (const r of ren.rail) out.push(`<polyline points="${pts(r)}" stroke="#6b2d5c" stroke-width="2" fill="none" stroke-dasharray="6 3"/>`);
const rect = (x, z, w, d, rot, fill, stroke = 'none', sw = 0) => `<rect x="${-w / 2}" y="${-d / 2}" width="${w}" height="${d}" transform="translate(${x} ${z}) rotate(${(-rot * 180) / Math.PI})" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
for (let i = 0; i < ren.roofs.length; i += 6) out.push(rect(ren.roofs[i], ren.roofs[i + 1], ren.roofs[i + 2], ren.roofs[i + 2] * 0.85, ren.roofs[i + 4], '#b07a5a'));
for (let i = 0; i < ren.blocks.length; i += 7) out.push(rect(ren.blocks[i], ren.blocks[i + 1], ren.blocks[i + 2], ren.blocks[i + 3], ren.blocks[i + 4], '#c9b79a', '#7a6a55', 0.4));
const placeOf = new Map(Object.entries(eng.place).map(([k, v]) => [v, k]));
for (const p of eng.plots) {
  const pl = placeOf.get(p.id);
  const lot = eng.lots.includes(p.id);
  const lm = p.landmark;
  const fill = pl ? (p.real ? '#d23c22' : '#f29a05') : lot ? '#f2e705' : lm ? '#7b3fa0' : '#9a8f7a';
  out.push(rect(p.x, p.z, p.w, p.d, p.rot, fill, '#1f1d1a', 0.6));
  out.push(`<circle cx="${p.door[0]}" cy="${p.door[1]}" r="1" fill="#000"/>`);
  if (pl || lm) out.push(`<text x="${p.x}" y="${p.z}" font-size="${zoom ? 4 : 9}" text-anchor="middle" fill="#000" stroke="#fff" stroke-width="${zoom ? 0.8 : 2}" paint-order="stroke">${(pl ? `${pl}${p.real ? `: ${p.real}` : ''}` : lm.n).replace(/&/g, '&amp;')}</text>`);
}
if (stop) {
  out.push(rect(stop.x, stop.z, 6, 2.4, stop.rot, '#2f63ad'));
  out.push(`<text x="${stop.x}" y="${stop.z - 5}" font-size="${zoom ? 5 : 11}" text-anchor="middle" fill="#2f63ad" stroke="#fff" stroke-width="2" paint-order="stroke">BUS STOP: ${stop.name}</text>`);
}
for (const l of ren.labels) out.push(`<text x="${l.x}" y="${l.z}" font-size="${zoom ? 4 : 8}" text-anchor="middle" fill="#fff" transform="rotate(${(l.a * 180) / Math.PI} ${l.x} ${l.z})">${l.n.replace(/&/g, '&amp;')}</text>`);
out.push('</svg>');
const file = `${outDir}/${id}${zoom ? '-zoom' : ''}.svg`;
writeFileSync(file, out.join('\n'));
try {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: zoom ? 1600 : 1400, height: zoom ? 1200 : Math.round((1400 * view[3]) / view[2]) } });
  await page.setContent(`<body style="margin:0">${out.join('\n')}</body>`);
  await page.screenshot({ path: file.replace('.svg', '.png') });
  await browser.close();
  console.log(`wrote ${file.replace('.svg', '.png')}`);
} catch (e) {
  console.log(`wrote ${file} (no PNG: ${e.message})`);
}
