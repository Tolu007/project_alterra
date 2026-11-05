// Fetches the OpenStreetMap data for every Lagos district and for Lagos as a whole into data/osm/.
import { DISTRICTS, LAGOS_BOX, districtQuery } from './city-districts.mjs';
import { overpass } from './fetch-osm.mjs';

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
for (const [id, d] of Object.entries(DISTRICTS)) {
  if (only.length && !only.includes(id)) continue;
  const [s, w, n, e] = d.box;
  const pad = 0.004;
  await overpass(`district-${id}`, districtQuery([s - pad, w - pad, n + pad, e + pad]));
}
if (!only.length || only.includes('lagos')) {
  const [s, w, n, e] = LAGOS_BOX;
  await overpass(
    'lagos-overview',
    `[out:json][timeout:300];(way["highway"~"^(motorway|trunk|primary|motorway_link|trunk_link)$"](${s},${w},${n},${e});way["natural"~"^(water|coastline)$"](${s},${w},${n},${e});relation["natural"="water"](${s},${w},${n},${e}););out geom;`,
  );
}
