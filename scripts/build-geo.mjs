// Builds src/data/geo.ts: the Nigeria outline (all 37 units) and a close-up of each playable
// state, with every playable LGA projected from its real coordinates.
// Source: geoBoundaries gbOpen NGA ADM1 (GRID3), CC BY 4.0.
import { readFileSync, writeFileSync } from 'node:fs';
import { geoArea, geoMercator, geoPath } from 'd3-geo';

const raw = JSON.parse(readFileSync('data/raw/nga-adm1-simplified.geojson', 'utf8'));
for (const f of raw.features) {
  if (geoArea(f) > 2 * Math.PI) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) ring.reverse();
  }
}
const idOf = (f) => f.properties.shapeISO.replace('NG-', '');

// Approximate LGA headquarters / centres (lat, lon). Kept in sync with src/data/world.ts.
const LGAS = {
  LA: { IKJ: [6.6018, 3.3515], LIS: [6.4549, 3.3947], LMA: [6.5095, 3.3711], ETI: [6.4474, 3.481], OSH: [6.5355, 3.3087], APP: [6.4489, 3.359], IKD: [6.6194, 3.5105] },
  KN: { KMC: [11.9964, 8.5167], FAG: [12.0063, 8.5326], NAS: [11.98, 8.55], DAL: [12.017, 8.498], KUR: [11.771, 8.43] },
  RI: { PHC: [4.7774, 7.0134], OBI: [4.85, 6.99], ELE: [4.79, 7.12], BON: [4.45, 7.17], OKR: [4.74, 7.08] },
};

function simplify(points, eps) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Closed rings start and end on the same point; split at the farthest vertex first.
function simplifyRing(points, eps) {
  const [sx, sy] = points[0];
  let far = 0;
  let farD = -1;
  points.forEach(([x, y], i) => {
    const d = Math.hypot(x - sx, y - sy);
    if (d > farD) {
      farD = d;
      far = i;
    }
  });
  return simplify(points.slice(0, far + 1), eps).concat(simplify(points.slice(far), eps).slice(1));
}

const r1 = (n) => Math.round(n * 10) / 10;

function toPath(feature, projection, eps) {
  const polys = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  return polys
    .flatMap((poly) =>
      poly.map((ring) => {
        const pts = simplifyRing(ring.map((c) => projection(c)), eps);
        return pts.length < 3 ? '' : 'M' + pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join('L') + 'Z';
      }),
    )
    .join('');
}

// Nudges labels apart so clustered city LGAs stay readable; each keeps a leader line to its true spot.
function relax(points, minDist, box) {
  const out = points.map((p) => ({ ...p, lx: p.x, ly: p.y }));
  for (let iter = 0; iter < 400; iter++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        let dx = b.lx - a.lx;
        let dy = b.ly - a.ly;
        let d = Math.hypot(dx, dy);
        if (d < minDist) {
          if (d < 0.01) {
            dx = Math.cos(i + j);
            dy = Math.sin(i + j);
            d = 1;
          }
          const push = (minDist - d) / 2;
          a.lx -= (dx / d) * push;
          a.ly -= (dy / d) * push;
          b.lx += (dx / d) * push;
          b.ly += (dy / d) * push;
          moved = true;
        }
      }
    }
    for (const p of out) {
      p.lx = Math.min(box[0] - 60, Math.max(60, p.lx));
      p.ly = Math.min(box[1] - 30, Math.max(30, p.ly));
    }
    if (!moved) break;
  }
  return out;
}

// Nigeria overview.
const NW = 1000;
const NH = 820;
const national = geoMercator().fitExtent([[12, 12], [NW - 12, NH - 12]], raw);
const nationalShapes = Object.fromEntries(
  raw.features.map((f) => {
    const [cx, cy] = geoPath(national).centroid(f);
    return [idOf(f), { d: toPath(f, national, 1.1), cx: r1(cx), cy: r1(cy) }];
  }),
);

// Cities on the long-distance routes, and the three airports, for the travel map.
const CITIES = {
  Lagos: [6.5244, 3.3792], Ibadan: [7.3775, 3.947], Ilorin: [8.4966, 4.5426], Jebba: [9.1333, 4.8333], Mokwa: [9.2949, 5.0541],
  Kaduna: [10.5105, 7.4165], Zaria: [11.0855, 7.7199], Kano: [12.0022, 8.592], Abuja: [9.0765, 7.3986], Makurdi: [7.7322, 8.5391],
  Enugu: [6.4584, 7.5464], Aba: [5.1066, 7.3667], Ore: [6.7456, 4.8737], 'Benin City': [6.335, 5.6037], Onitsha: [6.1413, 6.8029],
  Owerri: [5.4836, 7.0333], 'Port Harcourt': [4.8156, 7.0498],
  'airport:LA': [6.5774, 3.3212], 'airport:KN': [12.0476, 8.5246], 'airport:RI': [5.0155, 6.9496],
};
const cityPoints = Object.fromEntries(Object.entries(CITIES).map(([k, [lat, lon]]) => [k, national([lon, lat]).map(r1)]));

// Close-ups.
const SW = 800;
const SH = 560;
const states = {};
for (const [sid, lgas] of Object.entries(LGAS)) {
  const f = raw.features.find((x) => idOf(x) === sid);
  const proj = geoMercator().fitExtent([[40, 30], [SW - 40, SH - 30]], f);
  const pts = Object.entries(lgas).map(([id, [lat, lon]]) => {
    const [x, y] = proj([lon, lat]);
    return { id, x, y };
  });
  const relaxed = relax(pts, 92, [SW, SH]);
  states[sid] = {
    d: toPath(f, proj, 0.6),
    lgas: Object.fromEntries(relaxed.map((p) => [p.id, { x: r1(p.x), y: r1(p.y), lx: r1(p.lx), ly: r1(p.ly) }])),
  };
}

const out = `// GENERATED by scripts/build-geo.mjs — do not edit by hand.
// Boundaries: geoBoundaries gbOpen NGA ADM1 (GRID3), CC BY 4.0.
export const NIGERIA_W = ${NW};
export const NIGERIA_H = ${NH};
export const STATE_W = ${SW};
export const STATE_H = ${SH};

/** Cities on the long-distance routes and the three airports ("airport:LA"…), on the overview map. */
export const NIGERIA_CITIES: Record<string, [number, number]> = ${JSON.stringify(cityPoints)};

/** Every state and the FCT, for the overview map. */
export const NIGERIA: Record<string, { d: string; cx: number; cy: number }> = ${JSON.stringify(nationalShapes)};

/** Playable states: outline plus each LGA's true point (x, y) and label point (lx, ly). */
export const STATE_GEO: Record<string, { d: string; lgas: Record<string, { x: number; y: number; lx: number; ly: number }> }> = ${JSON.stringify(states, null, 1)};
`;
writeFileSync('src/data/geo.ts', out);
console.log(`wrote src/data/geo.ts (${(out.length / 1024).toFixed(1)} KB)`);
