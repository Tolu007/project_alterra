// Builds the Lagos districts from OpenStreetMap data (data/osm/, fetched by fetch-city.mjs):
//   src/data/city/lagos.json         what the rules need: plots, places, lots, travel between districts
//   src/data/city/render/<LGA>.json  what the 3D world draws: roads, water, rail, blocks, rooftops, landmarks
//   src/data/city/overview.json      the Lagos travel map: water, main roads, routes between districts
// Real roads, rail, water and landmarks keep their true positions (shrunk by each district's scale);
// the buildings along and between the roads are generated. Map data © OpenStreetMap contributors (ODbL).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BRT_LINES, DISTRICTS, FERRY_JETTIES, LAGOS_BOX, RAIL_LINES, REAL_PLACES } from './city-districts.mjs';

const OUT = 'src/data/city';
mkdirSync(`${OUT}/render`, { recursive: true });
const r1 = (v) => Math.round(v * 10) / 10;
const flat = (pts) => pts.flatMap(([x, z]) => [r1(x), r1(z)]);

// ───────────── geometry ─────────────

function seeded(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    h ^= h >>> 15;
    return ((h >>> 0) % 100000) / 100000;
  };
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

/** Douglas–Peucker that never drops a vertex flagged in `keep`. */
function simplify(pts, keep, tol) {
  if (pts.length < 3) return pts.map((_, i) => i);
  const out = new Set([0, pts.length - 1]);
  keep.forEach((k, i) => k && out.add(i));
  const anchors = [...out].sort((a, b) => a - b);
  const rec = (i, j) => {
    let best = -1;
    let bi = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(pts[k], pts[i], pts[j]);
      if (d > best) {
        best = d;
        bi = k;
      }
    }
    if (best > tol) {
      out.add(bi);
      rec(i, bi);
      rec(bi, j);
    }
  };
  for (let a = 0; a < anchors.length - 1; a++) rec(anchors[a], anchors[a + 1]);
  return [...out].sort((a, b) => a - b);
}

/** Splits a polyline into the pieces inside a rectangle (vertices outside are dropped, crossings added). */
function clipLine(pts, [x0, z0, x1, z1]) {
  const inside = ([x, z]) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  const pieces = [];
  let cur = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (inside(p)) {
      if (!cur.length && i > 0) cur.push(edge(pts[i - 1], p));
      cur.push(p);
    } else {
      if (cur.length) {
        cur.push(edge(p, cur[cur.length - 1]));
        pieces.push(cur);
        cur = [];
      } else if (i > 0) {
        // Both ends outside: the segment may still cross the box.
        const seg = liang(pts[i - 1], p, x0, z0, x1, z1);
        if (seg) pieces.push(seg);
      }
    }
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces.filter((s) => s.length > 1);
  function edge(out, inn) {
    const s = liang(inn, out, x0, z0, x1, z1);
    return s ? s[1] : inn;
  }
}

function liang(a, b, x0, z0, x1, z1) {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  for (const [p, q] of [
    [-dx, a[0] - x0],
    [dx, x1 - a[0]],
    [-dz, a[1] - z0],
    [dz, z1 - a[1]],
  ]) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  if (t0 > t1) return null;
  return [
    [a[0] + t0 * dx, a[1] + t0 * dz],
    [a[0] + t1 * dx, a[1] + t1 * dz],
  ];
}

/** Sutherland–Hodgman against an axis-aligned box. */
function clipPoly(poly, [x0, z0, x1, z1]) {
  let out = poly;
  const edges = [
    (p) => p[0] >= x0,
    (p) => p[0] <= x1,
    (p) => p[1] >= z0,
    (p) => p[1] <= z1,
  ];
  const cross = [
    (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])],
    (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((b[0] - a[0]) * (z0 - a[1])) / (b[1] - a[1]), z0],
    (a, b) => [a[0] + ((b[0] - a[0]) * (z1 - a[1])) / (b[1] - a[1]), z1],
  ];
  for (let e = 0; e < 4; e++) {
    const inn = edges[e];
    const next = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      if (inn(b)) {
        if (!inn(a)) next.push(cross[e](a, b));
        next.push(b);
      } else if (inn(a)) next.push(cross[e](a, b));
    }
    out = next;
    if (!out.length) break;
  }
  return out;
}

function inPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

const area = (poly) => poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0) / 2;

/**
 * Joins open OSM ways into chains by shared end nodes. Coastline ways all run the same way (land on the
 * left) and are joined end to start; the rings of a water area may be drawn either way round (`flip`).
 */
function joinChains(ways, flip = false) {
  const chains = ways.map((w) => ({ nodes: w.nodes.slice(), geom: w.geometry.slice() }));
  const rev = (c) => {
    c.nodes.reverse();
    c.geom.reverse();
  };
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < chains.length; i++) {
      const a = chains[i];
      if (a.nodes[0] === a.nodes[a.nodes.length - 1] && a.nodes.length > 2) continue;
      for (let j = 0; j < chains.length; j++) {
        if (i === j) continue;
        const b = chains[j];
        const aEnd = a.nodes[a.nodes.length - 1];
        if (flip && aEnd === b.nodes[b.nodes.length - 1] && aEnd !== b.nodes[0]) rev(b);
        else if (flip && a.nodes[0] === b.nodes[0] && aEnd !== b.nodes[0]) rev(a);
        else if (flip && a.nodes[0] === b.nodes[b.nodes.length - 1] && aEnd !== b.nodes[0]) {
          rev(a);
          rev(b);
        }
        if (a.nodes[a.nodes.length - 1] === b.nodes[0]) {
          a.nodes.push(...b.nodes.slice(1));
          a.geom.push(...b.geom.slice(1));
          chains.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return chains;
}

/** Oriented rectangles and their overlap (separating axis test). */
function corners(r) {
  const c = Math.cos(r.rot);
  const s = Math.sin(r.rot);
  // Local +x is (cos, -sin) and local +z is (sin, cos) under a y-rotation of `rot`.
  const ax = [c, -s];
  const az = [s, c];
  const hw = r.w / 2;
  const hd = r.d / 2;
  return [
    [r.x + ax[0] * hw + az[0] * hd, r.z + ax[1] * hw + az[1] * hd],
    [r.x - ax[0] * hw + az[0] * hd, r.z - ax[1] * hw + az[1] * hd],
    [r.x - ax[0] * hw - az[0] * hd, r.z - ax[1] * hw - az[1] * hd],
    [r.x + ax[0] * hw - az[0] * hd, r.z + ax[1] * hw - az[1] * hd],
  ];
}

function overlap(a, b) {
  const ca = corners(a);
  const cb = corners(b);
  for (const poly of [ca, cb]) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % 4];
      const n = [q[1] - p[1], p[0] - q[0]];
      const pa = ca.map((v) => v[0] * n[0] + v[1] * n[1]);
      const pb = cb.map((v) => v[0] * n[0] + v[1] * n[1]);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

/** A grid of buckets for fast "what is near here" questions. */
class Grid {
  constructor(cell) {
    this.cell = cell;
    this.map = new Map();
  }
  key(x, z) {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }
  add(item, x0, z0, x1, z1) {
    for (let x = Math.floor(x0 / this.cell); x <= Math.floor(x1 / this.cell); x++)
      for (let z = Math.floor(z0 / this.cell); z <= Math.floor(z1 / this.cell); z++) {
        const k = `${x},${z}`;
        if (!this.map.has(k)) this.map.set(k, []);
        this.map.get(k).push(item);
      }
  }
  near(x0, z0, x1, z1) {
    const out = new Set();
    for (let x = Math.floor(x0 / this.cell); x <= Math.floor(x1 / this.cell); x++)
      for (let z = Math.floor(z0 / this.cell); z <= Math.floor(z1 / this.cell); z++) for (const it of this.map.get(`${x},${z}`) ?? []) out.add(it);
    return out;
  }
}

// ───────────── one district ─────────────

const CLASS = {
  motorway: ['major', 13],
  trunk: ['major', 12],
  primary: ['major', 10],
  secondary: ['major', 8.5],
  tertiary: ['minor', 7],
  unclassified: ['local', 5.5],
  residential: ['local', 5],
  living_street: ['local', 4.5],
  motorway_link: ['link', 7],
  trunk_link: ['link', 7],
  primary_link: ['link', 6.5],
  secondary_link: ['link', 6],
  tertiary_link: ['link', 5.5],
};
const PAV = 2.5;

const PLACE_SIZE = {
  market: [30, 20], park: [30, 22], airport: [50, 30], govhouse: [26, 20], venue: [26, 18], jetty: [18, 12], palace: [22, 16],
  school: [24, 16], clinic: [20, 14], factory: [30, 22], secretariat: [22, 16], office: [16, 12], techhub: [16, 12], bank: [16, 12],
  joint: [16, 12], skills: [16, 12], party: [16, 12], workshop: [18, 12], home: [16, 12], oilsite: [30, 22], farm: [34, 28],
};
/** Places that like to be seen from a main road. */
const ON_MAIN = new Set(['bank', 'office', 'joint', 'techhub', 'clinic', 'secretariat', 'venue', 'party', 'market', 'park']);
const ALL_PLACES = ['home', 'market', 'park', 'workshop', 'school', 'secretariat', 'office', 'techhub', 'factory', 'skills', 'joint', 'venue', 'party', 'clinic', 'bank', 'govhouse', 'palace', 'jetty', 'airport', 'farm', 'oilsite'];

/** What kind of landmark an OSM feature is, for its model and for picking. */
function landmarkKind(t) {
  const n = (t.name || '').toLowerCase();
  // Stops, supermarkets and names nobody capitalised are not landmarks.
  if (t.highway === 'bus_stop' || t.public_transport === 'stop_position' || /supermarket|pharmacy/.test(n) || !/^[A-Z0-9"'][^/]{3,}$/.test(t.name || '')) return 'building';
  if (t.amenity === 'marketplace' || /\bmarket\b/.test(n)) return 'market';
  if (t.amenity === 'bus_station' || /terminal|motor park|garage|bus stop|interchange/.test(n)) return 'terminal';
  if (t.amenity === 'ferry_terminal' || /jetty|ferry/.test(n)) return 'jetty';
  if (t.public_transport === 'station' || t.railway === 'station') return 'station';
  if (t.aeroway) return t.aeroway === 'terminal' || t.aeroway === 'aerodrome' ? 'airport' : 'building';
  if (t.amenity === 'university' || t.amenity === 'college') return 'campus';
  if (t.amenity === 'school') return 'school';
  if (t.amenity === 'hospital') return 'hospital';
  if (t.amenity === 'place_of_worship') return /mosque|masjid/.test(n) || t.religion === 'muslim' ? 'mosque' : 'church';
  if (t.shop === 'mall') return 'mall';
  if (t.tourism === 'museum') return 'museum';
  if (t.leisure === 'stadium') return 'stadium';
  if (t.leisure === 'park' || /square/.test(n)) return 'square';
  if (t.office === 'government' || t.building === 'government' || t.amenity === 'townhall' || t.amenity === 'courthouse' || /secretariat|local govt|government/.test(n)) return 'government';
  if (/palace/.test(n)) return 'palace';
  if (t.landuse === 'industrial' || t.landuse === 'port') return 'industrial';
  if (/toll/.test(n)) return 'toll';
  return 'building';
}
const DECOR_PRIORITY = { market: 9, terminal: 8, mosque: 7, church: 7, campus: 8, mall: 7, museum: 7, square: 7, palace: 7, station: 6, hospital: 5, government: 5, stadium: 8, jetty: 5, toll: 8, airport: 9, school: 3, industrial: 2, building: 1 };
/** At most this many famous buildings of one kind per district, so twelve clinics do not crowd out the rest. */
const DECOR_CAP = { airport: 1, hospital: 1, government: 2, mosque: 2, church: 2, market: 3, terminal: 2, station: 2, jetty: 2 };
const GENERIC_NAME = /^(market|mosque|church|school|hospital|clinic|terminal|park|station|bus stop|motor park)$/i;
const DECOR_SIZE = { market: [26, 18], terminal: [26, 18], mosque: [20, 18], church: [18, 20], campus: [30, 22], mall: [30, 22], museum: [20, 16], square: [26, 20], palace: [22, 16], station: [24, 10], hospital: [22, 16], government: [22, 16], stadium: [34, 28], jetty: [16, 10], toll: [20, 10], airport: [50, 30], school: [20, 14], industrial: [28, 20], building: [16, 12] };

function buildDistrict(id, d) {
  const raw = JSON.parse(readFileSync(`data/osm/district-${id}.json`, 'utf8'));
  const [s, w, n, e] = d.box;
  const lat0 = (s + n) / 2;
  const lon0 = (w + e) / 2;
  const kx = (Math.cos((lat0 * Math.PI) / 180) * 111320) / d.m;
  const kz = 110574 / d.m;
  const P = (lat, lon) => [(lon - lon0) * kx, -(lat - lat0) * kz];
  const hx = ((e - w) / 2) * kx;
  const hz = ((n - s) / 2) * kz;
  const box = [-hx, -hz, hx, hz];
  const rnd = seeded(`city:${id}`);
  const els = raw.elements;

  // Roads: junction nodes survive simplification so the network stays connected.
  const ways = els.filter((x) => x.type === 'way' && x.tags?.highway && CLASS[x.tags.highway] && x.geometry);
  const uses = new Map();
  for (const wy of ways) wy.nodes.forEach((nd, i) => uses.set(nd, (uses.get(nd) ?? 0) + (i === 0 || i === wy.nodes.length - 1 ? 2 : 1)));
  const roads = [];
  for (const wy of ways) {
    const [cls, width] = CLASS[wy.tags.highway];
    // One-way streets (each side of a dual carriageway, ramps, roundabouts) are stored in their direction of travel.
    const back = wy.tags.oneway === '-1' || wy.tags.oneway === 'reverse';
    const oneway = back || wy.tags.oneway === 'yes' || wy.tags.oneway === '1' || wy.tags.oneway === 'true' || ((wy.tags.highway === 'motorway' || wy.tags.junction === 'roundabout' || wy.tags.junction === 'circular') && wy.tags.oneway !== 'no');
    const pts = wy.geometry.map((g) => P(g.lat, g.lon));
    const keep = wy.nodes.map((nd) => (uses.get(nd) ?? 0) >= 2);
    if (back) {
      pts.reverse();
      keep.reverse();
    }
    const idx = simplify(pts, keep, 0.8);
    const simple = idx.map((i) => pts[i]);
    for (const piece of clipLine(simple, box)) {
      const len = piece.slice(1).reduce((a, p, i) => a + dist(p, piece[i]), 0);
      if (len < 3) continue;
      // Drop the little dead ends that make the map noisy.
      if (cls === 'local' && len < 18 && !wy.tags.name) continue;
      roads.push({ c: cls, w: width, b: wy.tags.bridge && wy.tags.bridge !== 'no' ? 1 : 0, o: oneway ? 1 : 0, n: wy.tags.name || undefined, hw: wy.tags.highway, p: piece.map(([x, z]) => [r1(x), r1(z)]) });
    }
  }
  // People walk on every road except expressways and their ramps. Keep only the streets joined to the
  // biggest walkable network, so every plot can be reached on foot from every other.
  const walkRoad = (rd) => rd.hw !== 'motorway' && rd.c !== 'link';
  const parent = new Map();
  const find = (k) => {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  };
  const vkey = ([x, z]) => `${x},${z}`;
  for (const rd of roads.filter(walkRoad)) {
    for (const p of rd.p) if (!parent.has(vkey(p))) parent.set(vkey(p), vkey(p));
    for (let i = 1; i < rd.p.length; i++) parent.set(find(vkey(rd.p[i])), find(vkey(rd.p[0])));
  }
  const compLen = new Map();
  for (const rd of roads.filter(walkRoad)) {
    const c = find(vkey(rd.p[0]));
    compLen.set(c, (compLen.get(c) ?? 0) + rd.p.slice(1).reduce((a, p, i) => a + dist(p, rd.p[i]), 0));
  }
  const mainComp = [...compLen].sort((a, b) => b[1] - a[1])[0]?.[0];
  const connected = (rd) => walkRoad(rd) && find(vkey(rd.p[0])) === mainComp;
  const segs = new Grid(24);
  for (const rd of roads) {
    for (let i = 0; i < rd.p.length - 1; i++) {
      const a = rd.p[i];
      const b = rd.p[i + 1];
      segs.add({ a, b, hw: rd.w / 2, rd }, Math.min(a[0], b[0]) - 10, Math.min(a[1], b[1]) - 10, Math.max(a[0], b[0]) + 10, Math.max(a[1], b[1]) + 10);
    }
  }
  /** How far a point is from the edge of the nearest road (negative: on the road). */
  const roadClear = (p, r = 20) => {
    let best = Infinity;
    for (const sg of segs.near(p[0] - r, p[1] - r, p[0] + r, p[1] + r)) best = Math.min(best, segDist(p, sg.a, sg.b) - sg.hw);
    return best;
  };

  // Water: lakes and creeks as polygons, and the sea and lagoon rebuilt from the coastline.
  const water = [];
  const islands = [];
  const polyOf = (geom) => geom.map((g) => P(g.lat, g.lon));
  for (const x of els) {
    if (x.type === 'way' && x.geometry && (x.tags?.natural === 'water' || x.tags?.waterway === 'riverbank' || x.tags?.landuse === 'basin' || x.tags?.landuse === 'reservoir') && x.nodes[0] === x.nodes[x.nodes.length - 1]) {
      const c = clipPoly(polyOf(x.geometry), box);
      if (c.length > 2 && Math.abs(area(c)) > 40) water.push(c);
    }
    if (x.type === 'relation' && x.tags?.natural === 'water' && x.members) {
      for (const role of ['outer', 'inner']) {
        const ring = x.members.filter((m) => m.type === 'way' && (m.role === 'inner') === (role === 'inner') && m.geometry).map((m) => ({ nodes: m.geometry.map((g) => `${g.lat},${g.lon}`), geometry: m.geometry }));
        for (const ch of joinChains(ring, true)) {
          if (ch.nodes[0] !== ch.nodes[ch.nodes.length - 1]) continue;
          const c = clipPoly(polyOf(ch.geom), box);
          if (c.length > 2 && Math.abs(area(c)) > 40) (role === 'outer' ? water : islands).push(c);
        }
      }
    }
  }
  const coast = els.filter((x) => x.type === 'way' && x.tags?.natural === 'coastline' && x.geometry);
  if (coast.length) water.push(...seaFromCoast(joinChains(coast).map((c) => polyOf(c.geom)), box, islands));
  const wet = (p) => water.some((poly) => inPoly(p, poly)) && !islands.some((poly) => inPoly(p, poly));

  // Rail, ground areas, runways.
  const rail = [];
  for (const x of els.filter((y) => y.type === 'way' && y.tags?.railway && y.geometry)) for (const piece of clipLine(polyOf(x.geometry), box)) rail.push(piece);
  const areas = [];
  const blocked = [];
  for (const x of els) {
    if (x.type !== 'way' || !x.geometry || x.nodes[0] !== x.nodes[x.nodes.length - 1]) continue;
    const k = x.tags?.landuse ?? x.tags?.leisure ?? x.tags?.aeroway;
    if (!k || ['water', 'basin', 'reservoir'].includes(k)) continue;
    const c = clipPoly(polyOf(x.geometry), box);
    if (c.length < 3 || Math.abs(area(c)) < 60) continue;
    areas.push({ k, p: c });
    if (['cemetery', 'military', 'park', 'stadium', 'golf_course', 'runway', 'apron', 'railway'].includes(k)) blocked.push(c);
  }
  const runways = els.filter((x) => x.type === 'way' && x.tags?.aeroway === 'runway' && x.geometry).flatMap((x) => clipLine(polyOf(x.geometry), box));
  const railGrid = new Grid(24);
  for (const ln of rail) for (let i = 1; i < ln.length; i++) railGrid.add({ a: ln[i - 1], b: ln[i] }, Math.min(ln[i - 1][0], ln[i][0]) - 6, Math.min(ln[i - 1][1], ln[i][1]) - 6, Math.max(ln[i - 1][0], ln[i][0]) + 6, Math.max(ln[i - 1][1], ln[i][1]) + 6);
  const nearRail = (p) => [...railGrid.near(p[0] - 6, p[1] - 6, p[0] + 6, p[1] + 6)].some((s) => segDist(p, s.a, s.b) < 3.5);
  const offLimits = (p) => nearRail(p) || blocked.some((poly) => inPoly(p, poly)) || runways.some((rw) => rw.slice(1).some((q, i) => segDist(p, rw[i], q) < 20));

  // Points of interest, from the district download and the city-wide landmark list.
  const pois = [];
  const seenPoi = new Set();
  for (const x of [...els, ...LANDMARKS]) {
    const t = x.tags;
    if (!t?.name || t.highway === 'residential' || (t.highway && t.highway !== 'bus_stop')) continue;
    const lat = x.lat ?? x.center?.lat ?? (x.bounds ? (x.bounds.minlat + x.bounds.maxlat) / 2 : null);
    const lon = x.lon ?? x.center?.lon ?? (x.bounds ? (x.bounds.minlon + x.bounds.maxlon) / 2 : null);
    if (lat === null || lon === null) continue;
    const p = P(lat, lon);
    if (p[0] < -hx || p[0] > hx || p[1] < -hz || p[1] > hz) continue;
    const k = `${t.name}@${Math.round(p[0] / 20)},${Math.round(p[1] / 20)}`;
    if (seenPoi.has(k)) continue;
    seenPoi.add(k);
    pois.push({ name: t.name, t, p, kind: landmarkKind(t) });
  }

  // ── plots ──
  const plots = [];
  const plotGrid = new Grid(30);
  const fits = (r) => {
    const cs = corners(r);
    for (const c of [...cs, [r.x, r.z]]) {
      if (c[0] < -hx + 3 || c[0] > hx - 3 || c[1] < -hz + 3 || c[1] > hz - 3) return false;
      if (wet(c) || offLimits(c)) return false;
    }
    // All round the edge, keep a pavement's width from every road (people walk 1.1 beyond the kerb).
    for (let i = 0; i < 4; i++) {
      const p = cs[i];
      const q = cs[(i + 1) % 4];
      const n = Math.max(1, Math.ceil(dist(p, q) / 3));
      for (let k = 0; k < n; k++) if (roadClear([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n], 30) < 1.8) return false;
    }
    const m = Math.max(r.w, r.d);
    // A hair of gap between neighbours, so rounding the output never makes them touch.
    const grown = { ...r, w: r.w + 0.5, d: r.d + 0.5 };
    for (const o of plotGrid.near(r.x - m, r.z - m, r.x + m, r.z + m)) if (overlap(grown, o)) return false;
    return true;
  };
  const addPlot = (r) => {
    r.id = plots.length;
    plots.push(r);
    const m = Math.max(r.w, r.d) / 2 + 1;
    plotGrid.add(r, r.x - m, r.z - m, r.x + m, r.z + m);
    return r;
  };
  const toward = (fx, fz) => Math.atan2(fx, fz);
  const faceOf = (rot) => {
    // Nearest of the four, for code that still thinks in compass directions.
    const a = ((rot % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return ['s', 'e', 'n', 'w'][Math.round(a / (Math.PI / 2)) % 4];
  };
  /** A plot of this size beside a road at arc position t, on one side. */
  const besideRoad = (rd, t, side, wd, dp) => {
    let acc = 0;
    for (let i = 0; i < rd.p.length - 1; i++) {
      const a = rd.p[i];
      const b = rd.p[i + 1];
      const L = dist(a, b);
      if (acc + L >= t) {
        const k = (t - acc) / L;
        const px = a[0] + (b[0] - a[0]) * k;
        const pz = a[1] + (b[1] - a[1]) * k;
        const tx = (b[0] - a[0]) / L;
        const tz = (b[1] - a[1]) / L;
        const nx = -tz * side;
        const nz = tx * side;
        const off = rd.w / 2 + PAV + dp / 2;
        const r = { x: px + nx * off, z: pz + nz * off, w: wd, d: dp, rot: toward(-nx, -nz) };
        r.door = [r1(px + nx * (rd.w / 2 + 1.2)), r1(pz + nz * (rd.w / 2 + 1.2))];
        r.road = rd;
        return r;
      }
      acc += L;
    }
    return null;
  };
  const roadLen = (rd) => rd.p.slice(1).reduce((a, p, i) => a + dist(p, rd.p[i]), 0);
  const plotRoads = roads.filter((rd) => !rd.b && connected(rd));
  /** Nearest frontage spot to a point, trying both sides and nearby positions until one fits. */
  const plotNear = (pt, wd, dp, prefer = () => true) => {
    const cands = [];
    for (const rd of plotRoads) {
      if (!prefer(rd)) continue;
      let acc = 0;
      for (let i = 0; i < rd.p.length - 1; i++) {
        const a = rd.p[i];
        const b = rd.p[i + 1];
        const L = dist(a, b);
        const dd = segDist(pt, a, b);
        if (dd < 160) {
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dz) / (L * L || 1)));
          cands.push({ rd, t: acc + t * L, dd, side: Math.sign(dx * (pt[1] - a[1]) - dz * (pt[0] - a[0])) || 1 });
        }
        acc += L;
      }
    }
    cands.sort((x, y) => x.dd - y.dd);
    for (const c of cands.slice(0, 12)) {
      const L = roadLen(c.rd);
      for (const shift of [0, 8, -8, 16, -16, 26, -26, 38, -38]) {
        for (const side of [c.side, -c.side]) {
          const t = c.t + shift;
          if (t < wd / 2 + 2 || t > L - wd / 2 - 2) continue;
          const r = besideRoad(c.rd, t, side, wd, dp);
          if (r && fits(r)) return r;
        }
      }
    }
    return null;
  };

  const place = {};
  const landmarks = [];
  const used = new Set();
  /** The first feature matching a pattern, with its name (or the label after `=>`). */
  const pick = (patterns) => {
    for (const entry of patterns) {
      const [pat, rename] = entry.split('=>');
      const re = new RegExp(pat, 'i');
      const hit = pois.find((x) => !used.has(x) && re.test(x.name));
      if (hit) return { ...hit, poi: hit, name: rename ?? hit.name };
    }
    return null;
  };
  // The bus stop: a shelter on the pavement of a main road beside its real stop, kept clear of buildings.
  const stopHit = pick(REAL_PLACES[id]?.busstop ?? []);
  const stopAt = stopHit?.p ?? [0, 0];
  const stopRoad = plotRoads.filter((rd) => rd.c === 'major').sort((a, b) => nearestOnRoad(stopAt, a).dd - nearestOnRoad(stopAt, b).dd)[0];
  let busStop = null;
  if (stopRoad) {
    const q0 = nearestOnRoad(stopAt, stopRoad);
    const side0 = Math.sign(q0.tx * (stopAt[1] - q0.p[1]) - q0.tz * (stopAt[0] - q0.p[0])) || 1;
    const off = stopRoad.w / 2 + 1.6;
    // Slide along the road and try both sides until the shelter is off the tracks and off other roads.
    let q = q0;
    let side = side0;
    search: for (const shift of [0, 8, -8, 16, -16, 26, -26, 40, -40]) {
      for (const s of [side0, -side0]) {
        const at = [q0.p[0] + q0.tx * shift, q0.p[1] + q0.tz * shift];
        const qq = nearestOnRoad(at, stopRoad);
        const spot = [qq.p[0] - qq.tz * s * off, qq.p[1] + qq.tx * s * off];
        const ends = [-3, 3].map((k) => [spot[0] + qq.tx * k, spot[1] + qq.tz * k]);
        if ([spot, ...ends].some((p) => offLimits(p) || wet(p) || roadClear(p, 20) < -0.4)) continue;
        q = qq;
        side = s;
        break search;
      }
    }
    const nx = -q.tz * side;
    const nz = q.tx * side;
    // The shelter's back is local +z; its open side (local -z) faces the road, as in the grid towns.
    busStop = {
      x: r1(q.p[0] + nx * off),
      z: r1(q.p[1] + nz * off),
      rot: r1(Math.atan2(nx, nz) * 1000) / 1000,
      door: [r1(q.p[0] + nx * (stopRoad.w / 2 + 0.3)), r1(q.p[1] + nz * (stopRoad.w / 2 + 0.3))],
      road: [r1(q.p[0]), r1(q.p[1])],
      name: stopHit?.name ?? stopRoad.n ?? d.name,
      street: stopRoad.n ?? null,
      span: stopRoad.w + 2 * PAV,
    };
    const keepClear = { x: busStop.x + nx * 2, z: busStop.z + nz * 2, w: 26, d: 7, rot: Math.atan2(-nx, -nz) };
    plotGrid.add(keepClear, keepClear.x - 14, keepClear.z - 14, keepClear.x + 14, keepClear.z + 14);
  }

  // Places with a real address first.
  for (const [pl, patterns] of Object.entries(REAL_PLACES[id] ?? {})) {
    if (pl === 'busstop') continue;
    const [wd, dp] = PLACE_SIZE[pl];
    const hit = pick(patterns);
    const poi = hit?.poi;
    let target = hit?.p;
    let label = hit?.name;
    // Street names (Broad Street, Herbert Macaulay Way…) stand for whole districts of a kind.
    if (!poi) {
      for (const [pat, rename] of patterns.map((x) => x.split('=>'))) {
        const rd = roads.find((x) => x.n && new RegExp(pat, 'i').test(x.n));
        if (rd) {
          target = rd.p[Math.floor(rd.p.length / 2)];
          label = rename ?? rd.n;
          break;
        }
      }
    }
    if (!target) continue;
    // Old markets sit in tight streets: shrink the plot until it fits beside the real place.
    let r = null;
    for (const k of [1, 0.8, 0.65]) if (!r) r = plotNear(target, Math.round(wd * k), Math.round(dp * k));
    if (!r) continue;
    if (poi) used.add(poi);
    r.kind = pl === 'farm' ? 'farm' : 'street';
    r.real = label;
    place[pl] = addPlot(r).id;
  }
  // Famous buildings that are not game places: their own plot, model and label.
  const decor = pois
    .filter((x) => !used.has(x) && DECOR_PRIORITY[x.kind] >= 5 && !GENERIC_NAME.test(x.name.trim()))
    .sort((a, b) => DECOR_PRIORITY[b.kind] - DECOR_PRIORITY[a.kind] || a.name.length - b.name.length);
  const realNames = Object.values(place).map((pid) => plots[pid].real).filter(Boolean);
  for (const poi of decor) {
    if (landmarks.length >= 14) break;
    if (landmarks.filter((l) => l.k === poi.kind).length >= (DECOR_CAP[poi.kind] ?? 3)) continue;
    if (landmarks.some((l) => dist([l.x, l.z], poi.p) < 40 || l.n === poi.name || poi.name.startsWith(l.n) || l.n.startsWith(poi.name))) continue;
    if (realNames.some((n) => n.startsWith(poi.name) || poi.name.startsWith(n))) continue;
    if (Object.values(place).some((pid) => dist([plots[pid].x, plots[pid].z], poi.p) < 30)) continue;
    const [wd, dp] = DECOR_SIZE[poi.kind] ?? [16, 12];
    const r = plotNear(poi.p, wd, dp);
    if (!r) continue;
    r.kind = 'street';
    r.landmark = { n: poi.name, k: poi.kind };
    addPlot(r);
    landmarks.push({ n: poi.name, k: poi.kind, x: r1(r.x), z: r1(r.z), rot: r1(r.rot * 100) / 100, w: wd, d: dp, id: r.id });
    used.add(poi);
  }

  // Farmland where the district farms, claimed before the streets fill up: Ikorodu's fish ponds sit by the
  // lagoon near the jetty and out on the edges of town.
  const farmLots = [];
  if (id === 'IKD') {
    const jetty = place.jetty !== undefined ? plots[place.jetty] : null;
    const spots = [...(jetty ? [[jetty.x + 60, jetty.z - 40], [jetty.x + 30, jetty.z - 90]] : []), [-hx * 0.7, hz * 0.55], [hx * 0.6, hz * 0.6], [-hx * 0.75, -hz * 0.6], [hx * 0.7, -hz * 0.55]];
    for (const spot of spots) {
      if (farmLots.length + (place.farm === undefined ? 0 : 1) >= 4) break;
      let r = null;
      for (const [w, d] of [[34, 28], [28, 22], [24, 18]]) if (!r) r = plotNear(spot, w, d, (rd) => rd.c !== 'major');
      if (!r) continue;
      r.kind = 'farm';
      addPlot(r);
      if (place.farm === undefined) place.farm = r.id;
      else farmLots.push(r.id);
    }
  }

  // Frontage: plots along every street, both sides.
  const frontage = [];
  for (const rd of plotRoads) {
    const L = roadLen(rd);
    const major = rd.c === 'major' || rd.c === 'minor';
    for (const side of [-1, 1]) {
      let t = 6 + rnd() * 4;
      while (t < L - 6) {
        const wd = major ? 13 + rnd() * 5 : 9 + rnd() * 4;
        const dp = major ? 10 + rnd() * 3 : 8 + rnd() * 3;
        const r = besideRoad(rd, t + wd / 2, side, wd, dp);
        if (r && fits(r)) {
          r.kind = 'street';
          r.onMain = rd.c === 'major';
          frontage.push(addPlot(r));
          t += wd + 1.5;
        } else t += 4;
      }
    }
  }
  // Generic places and plots for lease near the middle of town, on frontage plots.
  const core = [stopRoad ? busStop.x : 0, stopRoad ? busStop.z : 0];
  const byCore = frontage.slice().sort((a, b) => dist([a.x, a.z], core) - dist([b.x, b.z], core));
  const taken = new Set();
  const claim = (want) => {
    const r = byCore.find((x) => !taken.has(x.id) && want(x) && [...taken].every((tid) => dist([plots[tid].x, plots[tid].z], [x.x, x.z]) > 24));
    if (r) taken.add(r.id);
    return r ?? null;
  };
  for (const pl of ALL_PLACES) {
    if (place[pl] !== undefined || ['farm', 'oilsite', 'airport', 'jetty', 'govhouse', 'palace'].includes(pl)) continue;
    // Home faces the camera (which looks north), so it is not hidden behind its own roof when you arrive.
    const facing = pl === 'home' ? (x) => Math.cos(x.rot) > 0.6 : () => true;
    const r = claim((x) => facing(x) && (ON_MAIN.has(pl) ? x.onMain : !x.onMain) && x.w >= 11) ?? claim((x) => (ON_MAIN.has(pl) ? x.onMain : !x.onMain) && x.w >= 11) ?? claim((x) => x.w >= 10);
    if (r) place[pl] = r.id;
  }
  const lots = [];
  for (let i = 0; i < 14; i++) {
    // The nearest plots for lease face the camera too, so a new business is seen from the street.
    const r = claim((x) => (i < 6 ? x.onMain : !x.onMain) && x.w >= 11 && (i % 3 === 2 || Math.cos(x.rot) > 0.5)) ?? claim((x) => (i < 6 ? x.onMain : !x.onMain) && x.w >= 11) ?? claim((x) => x.w >= 10);
    if (r) lots.push(r.id);
  }
  lots.push(...farmLots);
  // Ordinary buildings for the rules (houses people come out of): the frontage nearest the middle.
  const fillers = byCore.filter((x) => !taken.has(x.id)).slice(0, 60).map((x) => x.id);
  const engineIds = new Set([...Object.values(place), ...lots, ...fillers, ...landmarks.map((l) => l.id)]);

  // Everything else along the streets is drawn as plain buildings; the land behind them gets rooftops.
  const blocks = [];
  for (const r of frontage) {
    if (engineIds.has(r.id)) continue;
    blocks.push(r1(r.x), r1(r.z), r1(r.w), r1(r.d), r1(r.rot * 100) / 100, r1(r.onMain ? 4 + rnd() * 7 : 3 + rnd() * 3.5), Math.floor(rnd() * 8));
  }
  const roofs = [];
  const step = 10.5;
  for (let x = -hx + 6; x < hx - 6; x += step) {
    for (let z = -hz + 6; z < hz - 6; z += step) {
      if (rnd() < 0.18) continue;
      const p = [x + (rnd() - 0.5) * 4, z + (rnd() - 0.5) * 4];
      if (roadClear(p, 24) < 5 || wet(p) || offLimits(p)) continue;
      if ([...plotGrid.near(p[0] - 14, p[1] - 14, p[0] + 14, p[1] + 14)].some((o) => inPoly(p, corners({ ...o, w: o.w + 6, d: o.d + 6 })))) continue;
      // Rooftops line up with the nearest street.
      let best = null;
      for (const sg of segs.near(p[0] - 24, p[1] - 24, p[0] + 24, p[1] + 24)) {
        const dd = segDist(p, sg.a, sg.b);
        if (!best || dd < best.dd) best = { dd, sg };
      }
      const rot = best ? Math.atan2(best.sg.b[0] - best.sg.a[0], best.sg.b[1] - best.sg.a[1]) : 0;
      roofs.push(r1(p[0]), r1(p[1]), r1(6 + rnd() * 3), r1(2.6 + rnd() * (rnd() < 0.15 ? 6 : 2.5)), r1(rot * 100) / 100, Math.floor(rnd() * 8));
    }
  }

  // Crossings: where people get over a main road's median, a railway beside it, or across to the next
  // street without walking to a junction (footbridges, gaps in the fence). Main roads get a point every
  // 20 units; each links to the nearest walkable street point across the way if nothing stands between.
  const densify = (pts, step) => {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const n = Math.max(1, Math.ceil(dist(a, b) / step));
      for (let k = 1; k <= n; k++) out.push(k === n ? b : [r1(a[0] + ((b[0] - a[0]) * k) / n), r1(a[1] + ((b[1] - a[1]) * k) / n)]);
    }
    return out;
  };
  const wideRoad = (rd) => connected(rd) && rd.w >= 8.5 && !rd.b;
  for (const rd of roads) if (wideRoad(rd)) rd.p = densify(rd.p, 20);
  const adj = new Map();
  const vgrid = new Grid(24);
  const wideV = new Map();
  for (const rd of roads) {
    if (!connected(rd)) continue;
    rd.p.forEach((p, i) => {
      const k = vkey(p);
      if (!adj.has(k)) {
        adj.set(k, new Set());
        vgrid.add({ k, p }, p[0], p[1], p[0], p[1]);
      }
      if (wideRoad(rd)) wideV.set(k, p);
      if (i) {
        adj.get(k).add(vkey(rd.p[i - 1]));
        adj.get(vkey(rd.p[i - 1])).add(k);
      }
    });
  }
  const roofGrid = new Grid(24);
  for (let i = 0; i < roofs.length; i += 6) {
    const r = { x: roofs[i], z: roofs[i + 1], w: roofs[i + 2], d: roofs[i + 2] * 0.85, rot: roofs[i + 4] };
    roofGrid.add(r, r.x - 6, r.z - 6, r.x + 6, r.z + 6);
  }
  const hitsRect = (a, b, r) => {
    const c = Math.cos(r.rot);
    const s = Math.sin(r.rot);
    const loc = (p) => [(p[0] - r.x) * c - (p[1] - r.z) * s, (p[0] - r.x) * s + (p[1] - r.z) * c];
    return !!liang(loc(a), loc(b), -r.w / 2, -r.d / 2, r.w / 2, r.d / 2);
  };
  const crossesSeg = (a, b, c, e) => {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) !== o(a, b, e) && o(c, e, a) !== o(c, e, b);
  };
  const clearWay = (a, b) => {
    const [x0, z0, x1, z1] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    for (const o of plotGrid.near(x0 - 16, z0 - 16, x1 + 16, z1 + 16)) if (hitsRect(a, b, o)) return false;
    for (const o of roofGrid.near(x0, z0, x1, z1)) if (hitsRect(a, b, o)) return false;
    for (const sg of segs.near(x0, z0, x1, z1)) if (!connected(sg.rd) && crossesSeg(a, b, sg.a, sg.b)) return false;
    for (let t = 0.1; t < 1; t += 0.1) if (wet([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) return false;
    return true;
  };
  const cross = [];
  const crossed = new Set();
  for (const [k, p] of wideV) {
    const near = new Set([k]);
    let ring = [k];
    for (let hop = 0; hop < 4; hop++) {
      const next = [];
      for (const n of ring) for (const m of adj.get(n)) if (!near.has(m)) near.add(m), next.push(m);
      ring = next;
    }
    const options = [...vgrid.near(p[0] - 34, p[1] - 34, p[0] + 34, p[1] + 34)]
      .filter((o) => !near.has(o.k))
      .map((o) => ({ ...o, d: dist(p, o.p) }))
      .filter((o) => o.d < 34)
      .sort((a, b) => a.d - b.d);
    for (const o of options.slice(0, 6)) {
      const id = k < o.k ? `${k}|${o.k}` : `${o.k}|${k}`;
      if (crossed.has(id)) break;
      if (!clearWay(p, o.p)) continue;
      crossed.add(id);
      cross.push(p[0], p[1], o.p[0], o.p[1]);
      break;
    }
  }

  // Street name labels: one or two per named main road.
  const labels = [];
  const seen = new Set();
  for (const rd of roads.filter((x) => x.n && (x.c === 'major' || x.c === 'minor')).sort((a, b) => roadLen(b) - roadLen(a))) {
    if (seen.has(rd.n) || roadLen(rd) < 60) continue;
    seen.add(rd.n);
    const mid = rd.p[Math.floor(rd.p.length / 2)];
    const nxt = rd.p[Math.min(rd.p.length - 1, Math.floor(rd.p.length / 2) + 1)];
    const prv = rd.p[Math.max(0, Math.floor(rd.p.length / 2) - 1)];
    labels.push({ n: rd.n, x: mid[0], z: mid[1], a: r1(Math.atan2(nxt[1] - prv[1], nxt[0] - prv[0]) * 100) / 100 });
  }

  // ── output ──
  const enginePlots = [];
  const remap = new Map();
  for (const r of plots) {
    if (!engineIds.has(r.id)) continue;
    remap.set(r.id, enginePlots.length);
    enginePlots.push({
      id: enginePlots.length,
      x: r1(r.x),
      z: r1(r.z),
      w: r1(r.w),
      d: r1(r.d),
      face: faceOf(r.rot),
      rot: r1(r.rot * 1000) / 1000,
      door: r.door,
      onMain: !!r.onMain,
      kind: r.kind ?? 'street',
      ...(r.real ? { real: r.real } : {}),
      ...(r.landmark ? { landmark: r.landmark } : {}),
    });
  }
  const mapIds = (ids) => ids.map((x) => remap.get(x));
  const engine = {
    name: d.name,
    m: d.m,
    center: [r1(lat0 * 1e5) / 1e5, r1(lon0 * 1e5) / 1e5],
    bounds: { minX: r1(-hx), maxX: r1(hx), minZ: r1(-hz), maxZ: r1(hz) },
    plots: enginePlots,
    place: Object.fromEntries(Object.entries(place).map(([k, v]) => [k, remap.get(v)])),
    lots: mapIds(lots),
    fillers: mapIds(fillers),
    landmarks: landmarks.map((l) => remap.get(l.id)),
    busStop,
  };
  const render = {
    // c: class, w: width, b: bridge, o: one-way (in the order of its points), x: not for walking (expressways, ramps, streets cut off from the rest).
    roads: roads.map((rd) => ({ c: rd.c, w: rd.w, ...(rd.b ? { b: 1 } : {}), ...(rd.o ? { o: 1 } : {}), ...(connected(rd) ? {} : { x: 1 }), ...(rd.n ? { n: rd.n } : {}), p: flat(rd.p) })),
    // Pedestrian crossings between streets that do not meet: x0, z0, x1, z1 for each.
    cross,
    water: water.map(flat),
    islands: islands.map(flat),
    rail: rail.map(flat),
    areas: areas.filter((a) => ['industrial', 'port', 'commercial', 'retail', 'cemetery', 'park', 'stadium', 'golf_course', 'military', 'apron', 'railway'].includes(a.k)).map((a) => ({ k: a.k, p: flat(a.p) })),
    runways: runways.map(flat),
    blocks,
    roofs,
    labels,
  };
  return { engine, render, stats: { roads: roads.length, water: water.length, plots: enginePlots.length, frontage: frontage.length, blocks: blocks.length / 7, roofs: roofs.length / 6, places: Object.keys(place), landmarks: landmarks.map((l) => l.n), busStop: busStop?.name } };
}

function nearestOnRoad(p, rd) {
  let best = { dd: Infinity };
  for (let i = 0; i < rd.p.length - 1; i++) {
    const a = rd.p[i];
    const b = rd.p[i + 1];
    const L = dist(a, b) || 1e-9;
    const tx = (b[0] - a[0]) / L;
    const tz = (b[1] - a[1]) / L;
    const t = Math.max(0, Math.min(L, (p[0] - a[0]) * tx + (p[1] - a[1]) * tz));
    const q = [a[0] + tx * t, a[1] + tz * t];
    const dd = dist(p, q);
    if (dd < best.dd) best = { dd, p: q, tx, tz };
  }
  return best;
}

/**
 * Water from coastline inside a box. OSM coastline keeps land on the left, so walking the box edge
 * clockwise (in screen space, z down) from where a coastline leaves it closes the water on its right.
 */
function seaFromCoast(chains, box, islands) {
  const [x0, z0, x1, z1] = box;
  const pieces = [];
  for (const ch of chains) {
    const closed = dist(ch[0], ch[ch.length - 1]) < 0.01;
    if (closed && ch.every(([x, z]) => x > x0 && x < x1 && z > z0 && z < z1)) {
      islands.push(ch);
      continue;
    }
    for (const pc of clipLine(ch, box)) pieces.push(pc);
  }
  if (!pieces.length) return [];
  // Position along the box edge, going round clockwise on screen: top (z0) left→right, right side down, bottom right→left, left side up.
  const W = x1 - x0;
  const H = z1 - z0;
  const perim = ([x, z]) => {
    const e = 0.05;
    if (Math.abs(z - z0) < e) return x - x0;
    if (Math.abs(x - x1) < e) return W + (z - z0);
    if (Math.abs(z - z1) < e) return W + H + (x1 - x);
    return 2 * W + H + (z1 - z);
  };
  const cornerAt = [
    [W, [x1, z0]],
    [W + H, [x1, z1]],
    [2 * W + H, [x0, z1]],
    [2 * (W + H), [x0, z0]],
  ];
  const polys = [];
  const left = new Set(pieces.map((_, i) => i));
  while (left.size) {
    const first = [...left][0];
    let poly = [];
    let cur = first;
    for (let guard = 0; guard < 50; guard++) {
      left.delete(cur);
      const pc = pieces[cur];
      poly.push(...pc);
      // In screen space (z down) the right-hand side of travel is the clockwise side of the box.
      const out = perim(pc[pc.length - 1]);
      let bestI = -1;
      let bestD = Infinity;
      for (let i = 0; i < pieces.length; i++) {
        const din = (perim(pieces[i][0]) - out + 2 * (W + H)) % (2 * (W + H));
        if (din < bestD) {
          bestD = din;
          bestI = i;
        }
      }
      // Walk the corners between here and the next entry.
      for (const [pos, pt] of [...cornerAt, ...cornerAt.map(([p, q]) => [p + 2 * (W + H), q])]) {
        if (pos > out && pos < out + bestD) poly.push(pt);
      }
      if (bestI === first || !left.has(bestI)) break;
      cur = bestI;
    }
    if (poly.length > 2 && Math.abs(area(poly)) > 100) polys.push(poly);
  }
  return polys;
}

// ───────────── Lagos as a whole: the travel map and the routes between districts ─────────────

function buildOverview(districtHubs) {
  const raw = JSON.parse(readFileSync('data/osm/lagos-overview.json', 'utf8'));
  const [s, w, n, e] = LAGOS_BOX;
  const lat0 = (s + n) / 2;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111.32;
  const kz = 110.574;
  // Overview coordinates are kilometres east and south of the box's north-west corner.
  const P = (lat, lon) => [(lon - w) * kx, (n - lat) * kz];
  const box = [0, 0, (e - w) * kx, (n - s) * kz];
  const ways = raw.elements.filter((x) => x.type === 'way' && x.tags?.highway && x.geometry);
  const roads = [];
  const graph = new Map();
  const key = (g) => `${g.lat.toFixed(6)},${g.lon.toFixed(6)}`;
  const nodeAt = new Map();
  for (const wy of ways) {
    const pts = wy.geometry.map((g) => P(g.lat, g.lon));
    for (let i = 0; i < wy.geometry.length; i++) nodeAt.set(key(wy.geometry[i]), pts[i]);
    for (let i = 0; i < wy.geometry.length - 1; i++) {
      const a = key(wy.geometry[i]);
      const b = key(wy.geometry[i + 1]);
      const L = dist(pts[i], pts[i + 1]);
      if (!graph.has(a)) graph.set(a, []);
      if (!graph.has(b)) graph.set(b, []);
      graph.get(a).push({ to: b, L, name: wy.tags.name });
      if (wy.tags.oneway !== 'yes' || true) graph.get(b).push({ to: a, L, name: wy.tags.name });
    }
    const keep = pts.map(() => false);
    const simple = simplify(pts, keep, 0.06).map((i) => pts[i]);
    roads.push({ c: wy.tags.highway.replace('_link', ''), n: wy.tags.name, p: simple });
  }
  const water = [];
  const islands = [];
  for (const x of raw.elements) {
    if (x.type === 'way' && x.tags?.natural === 'water' && x.geometry && x.nodes[0] === x.nodes[x.nodes.length - 1]) {
      const poly = x.geometry.map((g) => P(g.lat, g.lon));
      if (Math.abs(area(poly)) > 0.05) water.push(simplify(poly, poly.map(() => false), 0.05).map((i) => poly[i]));
    }
    if (x.type === 'relation' && x.tags?.natural === 'water' && x.members) {
      for (const role of ['outer', 'inner']) {
        const ring = x.members.filter((m) => m.type === 'way' && (m.role === 'inner') === (role === 'inner') && m.geometry).map((m) => ({ nodes: m.geometry.map(key), geometry: m.geometry }));
        for (const ch of joinChains(ring, true)) {
          if (ch.nodes[0] !== ch.nodes[ch.nodes.length - 1]) continue;
          const poly = ch.geom.map((g) => P(g.lat, g.lon));
          const c = clipPoly(poly, box);
          if (c.length > 2 && Math.abs(area(c)) > 0.05) (role === 'outer' ? water : islands).push(simplify(c, c.map(() => false), 0.05).map((i) => c[i]));
        }
      }
    }
  }
  const coast = raw.elements.filter((x) => x.type === 'way' && x.tags?.natural === 'coastline' && x.geometry).map((x) => ({ nodes: x.nodes, geometry: x.geometry }));
  const sea = seaFromCoast(joinChains(coast).map((c) => c.geom.map((g) => P(g.lat, g.lon))), box, islands);
  for (const poly of sea) water.push(simplify(poly, poly.map(() => false), 0.04).map((i) => poly[i]));

  // Each district's hub on the road network.
  const hubs = {};
  for (const [id, h] of Object.entries(districtHubs)) {
    const p = P(h[0], h[1]);
    let best = null;
    for (const [k, q] of nodeAt) {
      const dd = dist(p, q);
      if (!best || dd < best.dd) best = { k, dd, q };
    }
    hubs[id] = { p, node: best.k };
  }
  // Shortest roads between every pair (Dijkstra; Lagos's main-road network is small).
  const routes = {};
  const ids = Object.keys(hubs).filter((k) => !k.includes(':'));
  for (const a of ids) {
    const D = new Map([[hubs[a].node, 0]]);
    const prev = new Map();
    const open = [[0, hubs[a].node]];
    const done = new Set();
    while (open.length) {
      open.sort((x, y) => x[0] - y[0]);
      const [dd, k] = open.shift();
      if (done.has(k)) continue;
      done.add(k);
      for (const ed of graph.get(k) ?? []) {
        const nd = dd + ed.L;
        if (nd < (D.get(ed.to) ?? Infinity)) {
          D.set(ed.to, nd);
          prev.set(ed.to, { k, name: ed.name, L: ed.L });
          open.push([nd, ed.to]);
        }
      }
      if (open.length > 4000) open.splice(2000);
    }
    for (const b of ids) {
      if (a >= b) continue;
      const path = [];
      const names = new Map();
      let k = hubs[b].node;
      if (!prev.has(k)) continue;
      while (k && k !== hubs[a].node) {
        path.push(nodeAt.get(k));
        const pr = prev.get(k);
        if (!pr) break;
        if (pr.name) names.set(pr.name, (names.get(pr.name) ?? 0) + pr.L);
        k = pr.k;
      }
      path.push(nodeAt.get(hubs[a].node));
      path.reverse();
      const km = D.get(hubs[b].node);
      const via = [...names].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([nm]) => nm);
      const simple = simplify(path, path.map(() => false), 0.08).map((i) => path[i]);
      routes[`${a}-${b}`] = { km: Math.round(km * 10) / 10, via, p: simple.flatMap(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]) };
    }
  }
  // Ferries cross the lagoon in near-straight lines.
  const ferries = {};
  for (const a of FERRY_JETTIES) {
    for (const b of FERRY_JETTIES) {
      if (a >= b || !districtHubs[`${a}:jetty`] || !districtHubs[`${b}:jetty`]) continue;
      const pa = P(...districtHubs[`${a}:jetty`]);
      const pb = P(...districtHubs[`${b}:jetty`]);
      ferries[`${a}-${b}`] = { km: Math.round(dist(pa, pb) * 1.15 * 10) / 10, p: [pa, pb].flat().map((v) => Math.round(v * 100) / 100) };
    }
  }
  return {
    size: [Math.round(box[2] * 100) / 100, Math.round(box[3] * 100) / 100],
    water: water.map((poly) => poly.flatMap(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100])),
    land: islands.map((poly) => poly.flatMap(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100])),
    roads: roads.map((r) => ({ c: r.c, ...(r.n ? { n: r.n } : {}), p: r.p.flatMap(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]) })),
    hubs: Object.fromEntries(Object.entries(hubs).filter(([id]) => !id.includes(':')).map(([id, h]) => [id, h.p.map((v) => Math.round(v * 100) / 100)])),
    routes,
    ferries,
  };
}

// ───────────── run ─────────────

const LANDMARKS = existsSync('data/osm/landmarks.json') ? JSON.parse(readFileSync('data/osm/landmarks.json', 'utf8')).elements : [];
const engineOut = { version: 1, districts: {} };
const hubs = {};
for (const [id, d] of Object.entries(DISTRICTS)) {
  if (!existsSync(`data/osm/district-${id}.json`)) {
    console.log(`${id}: no data yet (run node scripts/fetch-city.mjs)`);
    continue;
  }
  const { engine, render, stats } = buildDistrict(id, d);
  engineOut.districts[id] = engine;
  writeFileSync(`${OUT}/render/${id}.json`, JSON.stringify(render));
  // Where each district's transport hub is, in real coordinates, for the travel map.
  const [s, w, n, e] = d.box;
  const lat0 = (s + n) / 2;
  const lon0 = (w + e) / 2;
  const unproject = ([x, z]) => [lat0 - (z * d.m) / 110574, lon0 + (x * d.m) / (Math.cos((lat0 * Math.PI) / 180) * 111320)];
  // Danfos, BRT buses and taxis leave from the bus stop.
  hubs[id] = unproject(engine.busStop ? [engine.busStop.x, engine.busStop.z] : [0, 0]);
  if (engine.place.jetty !== undefined) hubs[`${id}:jetty`] = unproject([engine.plots[engine.place.jetty].x, engine.plots[engine.place.jetty].z]);
  console.log(`${id}: ${stats.roads} roads, ${stats.water} water, ${stats.plots} rule plots (${stats.frontage} along streets, ${stats.blocks} drawn blocks), ${stats.roofs} rooftops`);
  console.log(`   places: ${stats.places.join(', ')}`);
  console.log(`   landmarks: ${stats.landmarks.join(' · ')}`);
  console.log(`   bus stop: ${stats.busStop}`);
}
if (existsSync('data/osm/lagos-overview.json')) {
  const ov = buildOverview(hubs);
  writeFileSync(`${OUT}/overview.json`, JSON.stringify(ov));
  engineOut.travel = {
    road: Object.fromEntries(Object.entries(ov.routes).map(([k, r]) => [k, { km: r.km, via: r.via }])),
    ferry: Object.fromEntries(Object.entries(ov.ferries).map(([k, r]) => [k, { km: r.km }])),
    brt: BRT_LINES,
    rail: RAIL_LINES,
  };
  console.log(`overview: ${ov.roads.length} roads, ${ov.water.length} water, ${Object.keys(ov.routes).length} routes`);
  for (const [k, r] of Object.entries(ov.routes)) console.log(`   ${k}: ${r.km} km via ${r.via.join(', ')}`);
}
writeFileSync(`${OUT}/lagos.json`, JSON.stringify(engineOut));
console.log(`wrote ${OUT}/lagos.json (${Math.round(JSON.stringify(engineOut).length / 1024)} KB)`);
