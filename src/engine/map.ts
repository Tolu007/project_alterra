import city from '../data/city/lagos.json';
import type { PlaceId } from '../data/trades';
import { lgaById } from '../data/world';
import { placesIn } from './life';
import { onStreetNet, streetPoint, streetRoute } from './streets';

// Where things are in each LGA. Lagos districts are built from real map data (scripts/build-city.mjs):
// their real streets, with plots along them and the real market, motor park, jetty or airport where
// they really are. Elsewhere, a small neighbourhood: a main road running east–west with side streets
// in a grid, blocks of plots facing the roads, and farmland north of town where the LGA farms.
// Pure data, shared by the rules (which plots exist) and the 3D world (where things are).

/** Distance between parallel roads. */
export const PITCH = 44;
export const MAIN_HALF = 6;
export const SIDE_HALF = 3.5;
export const PAVEMENT = 3;

/** Vertical (north–south) road x positions and horizontal (east–west) road z positions. The main road is at z = 0. */
export const COLS = [0, PITCH, 2 * PITCH, 3 * PITCH];
export const ROWS = [-2 * PITCH, -PITCH, 0, PITCH];
export const MAIN_Z = 0;
export const halfWidth = (z: number) => (z === MAIN_Z ? MAIN_HALF : SIDE_HALF);

export type Facing = 'n' | 's' | 'e' | 'w';

export interface Plot {
  id: number;
  x: number;
  z: number;
  w: number;
  d: number;
  /** Which way the front door faces. */
  face: Facing;
  /** Y rotation so a model built facing +z faces the road. Models use w along their x and d along their z. */
  rot: number;
  door: [number, number];
  onMain: boolean;
  kind: 'street' | 'farm';
  /** Small side plots are always filler houses. */
  small?: boolean;
  /** The real place this plot stands for, in districts built from map data. */
  real?: string;
  /** A famous building that is not a game place: its name and what kind of building it is. */
  landmark?: { n: string; k: string };
}

/** A district built from real map data. */
export interface RealHood {
  name: string;
  /** Map metres per game unit. */
  scale: number;
  /** The real bus stop's name and the road it is on. */
  stopName: string;
  street: string | null;
  /** Width of the bus stop's road, kerb to kerb including pavements, and its centre beside the stop. */
  span: number;
  road: [number, number];
  landmarks: number[];
}

export interface Hood {
  plots: Plot[];
  /** Which plot each place occupies. */
  place: Partial<Record<PlaceId, number>>;
  /** Plots open for businesses. */
  lots: number[];
  fillers: number[];
  busStop: [number, number];
  /** Y rotation of the bus shelter. Its open side (local -z) faces the road. */
  busRot: number;
  /** Where you stand to catch a bus. */
  busDoor: [number, number];
  bridgeX: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  farmland: boolean;
  real?: RealHood;
}

const ROT: Record<Facing, number> = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };

function seeded(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    h ^= h >>> 15;
    return ((h >>> 0) % 10000) / 10000;
  };
}

/** Places that want to be seen from the main road. */
const MAIN_ROAD: PlaceId[] = ['market', 'park', 'venue', 'bank', 'office', 'govhouse', 'joint', 'techhub', 'clinic', 'secretariat'];
const OUTSKIRTS: PlaceId[] = ['oilsite', 'factory'];

const memo = new Map<string, Hood>();

interface CityDistrict {
  name: string;
  m: number;
  bounds: Hood['bounds'];
  plots: Plot[];
  place: Record<string, number>;
  lots: number[];
  fillers: number[];
  landmarks: number[];
  busStop: { x: number; z: number; rot: number; door: [number, number]; road: [number, number]; name: string; street: string | null; span: number } | null;
}
const CITY = (city as unknown as { districts: Record<string, CityDistrict> }).districts;

/** Is this LGA built from real map data? */
export const isRealDistrict = (lga: string) => !!CITY[lga];

/** A district from the real-map data. Places the LGA does not have become ordinary buildings. */
function realHood(lga: string, c: CityDistrict): Hood {
  const l = lgaById(lga);
  const want: PlaceId[] = placesIn(lga).filter((p) => p !== 'busstop' && p !== 'lot');
  const place: Partial<Record<PlaceId, number>> = {};
  const spare = [...c.fillers];
  for (const [p, id] of Object.entries(c.place) as [PlaceId, number][]) {
    if (want.includes(p)) place[p] = id;
    else spare.push(id);
  }
  // A place the data has no plot for borrows the filler nearest the bus stop.
  for (const p of want) if (place[p] === undefined && spare.length) place[p] = spare.shift()!;
  const stop = c.busStop ?? { x: 0, z: 0, rot: 0, door: [0, -1.4] as [number, number], road: [0, -4] as [number, number], name: l.nick, street: null, span: 15 };
  return {
    plots: c.plots,
    place,
    lots: c.lots,
    fillers: spare.filter((id) => c.plots[id].kind === 'street'),
    busStop: [stop.x, stop.z],
    busRot: stop.rot,
    busDoor: stop.door,
    bridgeX: Number.NaN,
    bounds: c.bounds,
    farmland: !!l.farm || (l.mix.farmer ?? 0) > 0.05,
    real: { name: c.name, scale: c.m, stopName: stop.name, street: stop.street, span: stop.span, road: stop.road, landmarks: c.landmarks },
  };
}

export function hood(lga: string): Hood {
  const hit = memo.get(lga);
  if (hit) return hit;
  if (CITY[lga]) {
    const h = realHood(lga, CITY[lga]);
    memo.set(lga, h);
    return h;
  }
  const l = lgaById(lga);
  const rnd = seeded(`hood:${lga}`);
  const plots: Plot[] = [];
  const add = (p: Omit<Plot, 'id' | 'rot'>) => {
    plots.push({ ...p, id: plots.length, rot: ROT[p.face] });
    return plots.length - 1;
  };

  // Blocks sit between consecutive roads. Each block gets two plots on its north and south
  // faces (facing the roads) and one small side plot on its east and west faces.
  for (let r = 0; r < ROWS.length - 1; r++) {
    const top = ROWS[r];
    const bottom = ROWS[r + 1];
    for (let c = 0; c < COLS.length - 1; c++) {
      const left = COLS[c] + SIDE_HALF + PAVEMENT;
      const right = COLS[c + 1] - SIDE_HALF - PAVEMENT;
      const innerTop = top + halfWidth(top) + PAVEMENT;
      const innerBottom = bottom - halfWidth(bottom) - PAVEMENT;
      const w = (right - left) / 2 - 1;
      const d = 10;
      for (const k of [0, 1]) {
        const x = left + w / 2 + 0.5 + k * (w + 1);
        add({ x, z: innerBottom - d / 2, w, d, face: 's', door: [x, innerBottom + 1.2], onMain: bottom === MAIN_Z, kind: 'street' });
        add({ x, z: innerTop + d / 2, w, d, face: 'n', door: [x, innerTop - 1.2], onMain: top === MAIN_Z, kind: 'street' });
      }
      // Side plots fit in the gap between the back-to-back rows. w is frontage and d is depth, so here w runs north–south.
      const midZ = (innerTop + innerBottom) / 2;
      const gap = innerBottom - innerTop - 2 * d - 1;
      add({ x: left + 4.7, z: midZ, w: gap, d: 9, face: 'w', door: [left - 1.2, midZ], onMain: false, kind: 'street', small: true });
      add({ x: right - 4.7, z: midZ, w: gap, d: 9, face: 'e', door: [right + 1.2, midZ], onMain: false, kind: 'street', small: true });
    }
  }

  // Farmland beyond the northern road, for LGAs that farm.
  const farmland = !!l.farm || (l.mix.farmer ?? 0) > 0.05;
  if (farmland) {
    const z = ROWS[0] - SIDE_HALF - PAVEMENT - 14;
    for (let i = 0; i < COLS.length - 1; i++) {
      const x = COLS[i] + PITCH / 2;
      add({ x, z, w: 30, d: 26, face: 's', door: [x, ROWS[0] - SIDE_HALF - PAVEMENT + 1.2], onMain: false, kind: 'farm' });
    }
  }

  // Plots on the north side of a road face south, towards the default camera, so home and the
  // plots you can build on get those first. Important places go on the main road, factories and oil on the edges.
  const places = placesIn(lga).filter((p) => p !== 'busstop' && p !== 'lot');
  const free = new Set(plots.filter((p) => !p.small && p.kind === 'street').map((p) => p.id));
  const take = (want: (p: Plot) => boolean): number | null => {
    const options = plots.filter((p) => free.has(p.id) && want(p));
    if (!options.length) return null;
    const p = options[Math.floor(rnd() * options.length)];
    free.delete(p.id);
    return p.id;
  };
  const facing = (want: (p: Plot) => boolean) => take((p) => want(p) && p.face === 's') ?? take(want);
  const placeAt: Partial<Record<PlaceId, number>> = {};
  const homeX = COLS[1] + PITCH / 2;
  const home = facing((p) => !p.onMain && Math.abs(p.x - homeX) < PITCH);
  if (home !== null) placeAt.home = home;

  const lots: number[] = [];
  for (let i = 0; i < 4; i++) {
    const id = facing((p) => p.onMain);
    if (id !== null) lots.push(id);
  }
  for (let i = 0; i < 7; i++) {
    const id = facing((p) => !p.onMain);
    if (id !== null) lots.push(id);
  }

  for (const pl of places) {
    if (pl === 'home') continue;
    let id: number | null;
    if (pl === 'farm') id = plots.find((p) => p.kind === 'farm')?.id ?? null;
    else if (MAIN_ROAD.includes(pl)) id = take((p) => p.onMain) ?? take(() => true);
    else if (OUTSKIRTS.includes(pl)) id = take((p) => (p.x < COLS[1] || p.x > COLS[2]) && !p.onMain) ?? take(() => true);
    else id = take((p) => !p.onMain) ?? take(() => true);
    if (id !== null) placeAt[pl] = id;
  }

  for (const p of plots) if (p.kind === 'farm' && p.id !== placeAt.farm) lots.push(p.id);
  const fillers = plots.filter((p) => (free.has(p.id) || p.small) && p.kind === 'street').map((p) => p.id);

  const out: Hood = {
    plots,
    place: placeAt,
    lots,
    fillers,
    busStop: [COLS[1] + PITCH / 2 + 6, MAIN_HALF + PAVEMENT - 0.8],
    busRot: 0,
    busDoor: [COLS[1] + PITCH / 2 + 6, MAIN_HALF + PAVEMENT - 2.2],
    bridgeX: COLS[1] + PITCH / 2 - 8,
    bounds: { minX: COLS[0] - 30, maxX: COLS[3] + 30, minZ: ROWS[0] - (farmland ? 60 : 30), maxZ: ROWS[3] + 30 },
    farmland,
  };
  memo.set(lga, out);
  return out;
}

/** Where you stand to use a place or a plot. */
export function doorOf(lga: string, place: PlaceId, lot: number | null): [number, number] {
  const h = hood(lga);
  if (place === 'lot' && lot !== null) return h.plots[lot].door;
  if (place === 'busstop') return h.busDoor;
  const id = h.place[place];
  return id !== undefined ? h.plots[id].door : h.plots[h.place.home ?? 0].door;
}

// ───────────── walking routes ─────────────

export type Pt = [number, number];

/** People walk on the south pavement of east–west roads and the east pavement of north–south roads. */
const walkZ = (z: number) => z + halfWidth(z) + 1.4;
const walkX = (x: number) => x + SIDE_HALF + 1.4;
const WALK_ZS = ROWS.map(walkZ);
const WALK_XS = COLS.map(walkX);

/** How far the east–west roads and the north–south roads run. */
export const ROAD_X: [number, number] = [COLS[0] - 26, COLS[COLS.length - 1] + 26];
export const ROAD_Z: [number, number] = [ROWS[0] - SIDE_HALF - PAVEMENT, ROWS[ROWS.length - 1] + 22];

/** Is this point on a road or a pavement? */
export function onStreet([x, z]: Pt): boolean {
  if (x >= ROAD_X[0] && x <= ROAD_X[1] && ROWS.some((r) => Math.abs(z - r) <= halfWidth(r) + PAVEMENT)) return true;
  return z >= ROAD_Z[0] && z <= ROAD_Z[1] && COLS.some((c) => Math.abs(x - c) <= SIDE_HALF + PAVEMENT);
}

/** The nearest point you can walk to. */
export function walkable(lga: string, p: Pt): Pt {
  if (hood(lga).real) return streetPoint(lga, p);
  return onStreet(p) ? p : snap(p, hood(lga)).pt;
}

/** Is this point on a road or pavement in this LGA? Real districts need their streets loaded (registerStreets). */
export function onStreetIn(lga: string, p: Pt): boolean {
  return hood(lga).real ? onStreetNet(lga, p) : onStreet(p);
}

function snap(p: Pt, _h: Hood): { pt: Pt; axis: 'h' | 'v' } {
  let best: { pt: Pt; axis: 'h' | 'v'; d: number } = { pt: p, axis: 'h', d: Infinity };
  const minZ = ROAD_Z[0];
  const maxZ = ROAD_Z[1];
  for (const z of WALK_ZS) {
    const x = Math.min(ROAD_X[1], Math.max(ROAD_X[0], p[0]));
    const d = Math.hypot(p[0] - x, p[1] - z);
    if (d < best.d) best = { pt: [x, z], axis: 'h', d };
  }
  for (const x of WALK_XS) {
    const z = Math.min(maxZ, Math.max(minZ, p[1]));
    const d = Math.hypot(p[0] - x, p[1] - z);
    if (d < best.d) best = { pt: [x, z], axis: 'v', d };
  }
  return best;
}

const len = (pts: Pt[]) => pts.slice(1).reduce((s, p, i) => s + Math.abs(p[0] - pts[i][0]) + Math.abs(p[1] - pts[i][1]), 0);

/** A path that follows the street grid from one point to another. */
export function route(lga: string, from: Pt, to: Pt): Pt[] {
  const h = hood(lga);
  if (h.real) return streetRoute(lga, from, to);
  const a = snap(from, h);
  const b = snap(to, h);
  const sameLine = (a.axis === 'h' && b.axis === 'h' && a.pt[1] === b.pt[1]) || (a.axis === 'v' && b.axis === 'v' && a.pt[0] === b.pt[0]);
  let best: Pt[] = [from, a.pt, b.pt, to];
  if (!sameLine) {
    const corners = (s: { pt: Pt; axis: 'h' | 'v' }): Pt[] => (s.axis === 'h' ? WALK_XS.map((x) => [x, s.pt[1]] as Pt) : WALK_ZS.map((z) => [s.pt[0], z] as Pt));
    let bestLen = Infinity;
    for (const ia of corners(a)) {
      for (const ib of corners(b)) {
        // From ia go along its east–west line, then up the north–south line through ib.
        const turn: Pt = [ib[0], ia[1]];
        const path: Pt[] = [from, a.pt, ia, turn, ib, b.pt, to];
        const l = len(path);
        if (l < bestLen) {
          bestLen = l;
          best = path;
        }
      }
    }
  }
  return best.filter((p, i) => i === 0 || Math.hypot(p[0] - best[i - 1][0], p[1] - best[i - 1][1]) > 0.05);
}
