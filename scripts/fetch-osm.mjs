// Downloads OpenStreetMap data for the city builder, into data/osm/ (not committed: run this to refresh).
// Usage: node scripts/fetch-osm.mjs <name> <overpass query file or inline query>
// Tries several public Overpass servers in turn, waits and retries when they are busy, and skips files
// that are already there (delete one to fetch it again). Map data © OpenStreetMap contributors (ODbL).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export async function overpass(name, query, { force = false } = {}) {
  mkdirSync('data/osm', { recursive: true });
  const file = `data/osm/${name}.json`;
  if (!force && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  let last = '';
  for (let round = 0; round < 3; round++) {
    for (const url of SERVERS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'NaijaHustleMapBuilder/0.1 (game map prep)' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(300_000),
        });
        const text = await res.text();
        if (!res.ok || !text.startsWith('{')) {
          last = `${url}: ${res.status} ${text.slice(0, 120).replace(/\s+/g, ' ')}`;
          continue;
        }
        const json = JSON.parse(text);
        if (json.remark && /timed out|out of memory/i.test(json.remark)) {
          last = `${url}: ${json.remark}`;
          continue;
        }
        writeFileSync(file, text);
        console.log(`${name}: ${json.elements.length} elements from ${new URL(url).host}`);
        return json;
      } catch (e) {
        last = `${url}: ${e.message}`;
      }
    }
    await new Promise((r) => setTimeout(r, 15_000 * (round + 1)));
  }
  throw new Error(`Could not fetch ${name}. Last error: ${last}`);
}

if (process.argv[1]?.endsWith('fetch-osm.mjs') && process.argv[2]) {
  const q = process.argv[3];
  await overpass(process.argv[2], existsSync(q) ? readFileSync(q, 'utf8') : q, { force: process.argv.includes('--force') });
}
