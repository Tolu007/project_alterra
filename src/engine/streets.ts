// Walking on real streets. The districts built from map data (see scripts/build-city.mjs) give their roads
// as polylines; joined at shared corners they make a network to find paths on. People keep to the
// pavement on one side of the road and cross where they have to.

export type Pt = [number, number];

/** A road as the city builder writes it: class, width, flags and a flat list of x, z pairs. */
export interface StreetRoad {
  c: string;
  w: number;
  b?: 1;
  /** One-way, in the order of its points. */
  o?: 1;
  /** Not for walking: expressways, ramps and streets cut off from the rest. */
  x?: 1;
  n?: string;
  p: number[];
}

interface Edge {
  a: number;
  b: number;
  /** Half the road's width. */
  hw: number;
  len: number;
  /** One-way for vehicles, from a to b. */
  ow?: boolean;
}

interface Net {
  xs: number[];
  zs: number[];
  edges: Edge[];
  /** Edges leaving each node. */
  out: number[][];
  cells: Map<string, number[]>;
}

const CELL = 24;
const nets = new Map<string, Net>();

/** How far from the kerb people walk. */
const KERB = 1.1;

/**
 * Builds a district's walking network from its roads and its crossings (x0, z0, x1, z1 for each: places to
 * get over a median, a railway or onto the next street without walking round to a junction).
 */
export function registerStreets(lga: string, roads: StreetRoad[], cross: number[] = []) {
  if (nets.has(lga)) return;
  const xs: number[] = [];
  const zs: number[] = [];
  const ids = new Map<string, number>();
  const node = (x: number, z: number) => {
    const k = `${x},${z}`;
    let i = ids.get(k);
    if (i === undefined) {
      i = xs.length;
      ids.set(k, i);
      xs.push(x);
      zs.push(z);
    }
    return i;
  };
  const edges: Edge[] = [];
  for (const r of roads) {
    if (r.x) continue;
    for (let i = 2; i < r.p.length; i += 2) {
      const a = node(r.p[i - 2], r.p[i - 1]);
      const b = node(r.p[i], r.p[i + 1]);
      if (a !== b) edges.push({ a, b, hw: r.w / 2, len: Math.hypot(xs[a] - xs[b], zs[a] - zs[b]), ...(r.o ? { ow: true } : {}) });
    }
  }
  for (let i = 0; i + 3 < cross.length; i += 4) {
    const a = ids.get(`${cross[i]},${cross[i + 1]}`);
    const b = ids.get(`${cross[i + 2]},${cross[i + 3]}`);
    // A little dearer than its length: people use a crossing when it saves a real walk.
    if (a !== undefined && b !== undefined) edges.push({ a, b, hw: 0, len: Math.hypot(xs[a] - xs[b], zs[a] - zs[b]) * 1.3 });
  }
  const out: number[][] = xs.map(() => []);
  const cells = new Map<string, number[]>();
  edges.forEach((e, i) => {
    out[e.a].push(i);
    out[e.b].push(i);
    // Crossings are for finding a way, not for standing on: they stay out of the lookup grid.
    if (e.hw === 0) return;
    const x0 = Math.floor(Math.min(xs[e.a], xs[e.b]) / CELL);
    const x1 = Math.floor(Math.max(xs[e.a], xs[e.b]) / CELL);
    const z0 = Math.floor(Math.min(zs[e.a], zs[e.b]) / CELL);
    const z1 = Math.floor(Math.max(zs[e.a], zs[e.b]) / CELL);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const k = `${x},${z}`;
        const list = cells.get(k);
        if (list) list.push(i);
        else cells.set(k, [i]);
      }
  });
  nets.set(lga, { xs, zs, edges, out, cells });
}

export const hasStreets = (lga: string) => nets.has(lga);

interface Snap {
  edge: number;
  /** 0 at the edge's a end, 1 at its b end. */
  t: number;
  pt: Pt;
  d: number;
  /** Which side of the edge (seen from a to b) the point is on: 1 left, -1 right. */
  side: 1 | -1;
}

function snap(net: Net, p: Pt): Snap | null {
  let best: Snap | null = null;
  const cx = Math.floor(p[0] / CELL);
  const cz = Math.floor(p[1] / CELL);
  // Look in widening rings of cells until something is found (and one ring more, in case it is closer).
  for (let r = 0, found = -1; r < 40 && (found < 0 || r <= found + 1); r++) {
    for (let x = cx - r; x <= cx + r; x++) {
      for (let z = cz - r; z <= cz + r; z++) {
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
        for (const i of net.cells.get(`${x},${z}`) ?? []) {
          const e = net.edges[i];
          const ax = net.xs[e.a];
          const az = net.zs[e.a];
          const dx = net.xs[e.b] - ax;
          const dz = net.zs[e.b] - az;
          const l2 = dx * dx + dz * dz || 1e-9;
          const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / l2));
          const q: Pt = [ax + dx * t, az + dz * t];
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (!best || d < best.d) best = { edge: i, t, pt: q, d, side: dx * (p[1] - az) - dz * (p[0] - ax) >= 0 ? 1 : -1 };
        }
      }
    }
    if (best && found < 0) found = r;
  }
  return best;
}

/** The normal of a direction in the x–z plane. With x east and z south it points to the right of travel. */
const left = (dx: number, dz: number): Pt => {
  const l = Math.hypot(dx, dz) || 1;
  return [-dz / l, dx / l];
};

/** The nearest point on a pavement, on the side of the road the point is on. */
export function streetPoint(lga: string, p: Pt): Pt {
  const net = nets.get(lga);
  if (!net) return p;
  const s = snap(net, p);
  if (!s) return p;
  const e = net.edges[s.edge];
  if (s.d <= e.hw + KERB + 1.5) return p;
  const n = left(net.xs[e.b] - net.xs[e.a], net.zs[e.b] - net.zs[e.a]);
  const o = s.side * (e.hw + KERB);
  return [s.pt[0] + n[0] * o, s.pt[1] + n[1] * o];
}

/** Is this point on a road or its pavement? */
export function onStreetNet(lga: string, p: Pt, slack = 2.8): boolean {
  const net = nets.get(lga);
  if (!net) return false;
  const s = snap(net, p);
  return !!s && s.d <= net.edges[s.edge].hw + slack;
}

/** A small binary heap of [cost, node]. */
class Heap {
  private a: [number, number][] = [];
  get size() {
    return this.a.length;
  }
  push(v: [number, number]) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** How far to the right of a road's centre line a keke or an okada rides. */
const rideLane = (e: Edge) => (e.ow ? e.hw * 0.45 : e.hw * 0.5 + 0.1);

/**
 * A path from one point to another along the streets. On foot: out to the pavement, along the roads
 * (keeping to one side), and over to the destination. With `drive`, as a keke or an okada goes: out into the
 * right-hand lane, along the roads the right way down one-way streets, and in to the kerb at the end.
 * Without the district's streets, a straight line.
 */
export function streetRoute(lga: string, from: Pt, to: Pt, drive = false): Pt[] {
  const net = nets.get(lga);
  if (!net) return [from, to];
  const sa = snap(net, from);
  const sb = snap(net, to);
  if (!sa || !sb) return [from, to];
  return trace(net, sa, sb, from, to, drive, drive) ?? trace(net, sa, sb, from, to, drive, false) ?? [from, to];
}

/** The path itself. `oneWay` keeps to the direction of one-way streets; null if there is no way through. */
function trace(net: Net, sa: Snap, sb: Snap, from: Pt, to: Pt, drive: boolean, oneWay: boolean): Pt[] | null {
  const { xs, zs, edges } = net;
  const ea = edges[sa.edge];
  const eb = edges[sb.edge];
  const offset = (e: Edge) => (drive ? rideLane(e) : e.hw + KERB);

  // Centre-line points and how far from the centre line to keep on the road leading to each.
  let centre: Pt[];
  let widths: number[];
  if (sa.edge === sb.edge && !(oneWay && ea.ow && sb.t < sa.t)) {
    centre = [sa.pt, sb.pt];
    widths = [offset(ea)];
  } else {
    const goal = new Map<number, number>(
      oneWay && eb.ow
        ? [[eb.a, eb.len * sb.t]]
        : [
            [eb.a, eb.len * sb.t],
            [eb.b, eb.len * (1 - sb.t)],
          ],
    );
    const cost = new Map<number, number>();
    const prev = new Map<number, number>();
    const heap = new Heap();
    const h = (i: number) => Math.hypot(xs[i] - sb.pt[0], zs[i] - sb.pt[1]);
    const starts: [number, number][] =
      oneWay && ea.ow
        ? [[ea.b, ea.len * (1 - sa.t)]]
        : [
            [ea.a, ea.len * sa.t],
            [ea.b, ea.len * (1 - sa.t)],
          ];
    for (const [n, c] of starts) {
      cost.set(n, c);
      prev.set(n, -1);
      heap.push([c + h(n), n]);
    }
    let end = -1;
    let bestEnd = Infinity;
    const done = new Set<number>();
    while (heap.size) {
      const [f, n] = heap.pop();
      if (f >= bestEnd) break;
      if (done.has(n)) continue;
      done.add(n);
      const c = cost.get(n)!;
      const g = goal.get(n);
      if (g !== undefined && c + g < bestEnd) {
        bestEnd = c + g;
        end = n;
      }
      for (const ei of net.out[n]) {
        const e = edges[ei];
        if (oneWay && e.ow && e.b === n) continue;
        // Vehicles cannot use the footpaths over a median or a railway.
        if (drive && e.hw === 0) continue;
        const m = e.a === n ? e.b : e.a;
        const nc = c + e.len;
        if (nc < (cost.get(m) ?? Infinity)) {
          cost.set(m, nc);
          prev.set(m, n);
          heap.push([nc + h(m), m]);
        }
      }
    }
    if (end < 0) return null;
    const nodes: number[] = [];
    for (let n = end; n >= 0; n = prev.get(n)!) nodes.push(n);
    nodes.reverse();
    centre = [sa.pt, ...nodes.map((n): Pt => [xs[n], zs[n]]), sb.pt];
    widths = [offset(ea)];
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1];
      const b = nodes[i];
      const e = net.out[a].map((k) => edges[k]).find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
      widths.push(e ? offset(e) : offset(ea));
    }
    widths.push(offset(eb));
  }

  // Drop zero-length steps, keeping widths in line with the segments that remain.
  const pts: Pt[] = [centre[0]];
  const hws: number[] = [];
  for (let i = 1; i < centre.length; i++) {
    const p = centre[i];
    const q = pts[pts.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05) continue;
    pts.push(p);
    hws.push(widths[i - 1]);
  }
  if (pts.length < 2) return tidy([from, to]);

  // Walk on the pavement on the side you start from; ride in the right-hand lane.
  const d0: Pt = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]];
  const n0 = left(d0[0], d0[1]);
  const side = drive || n0[0] * (from[0] - pts[0][0]) + n0[1] * (from[1] - pts[0][1]) >= 0 ? 1 : -1;
  const offs = hws.map((hw) => side * hw);
  const path: Pt[] = [from];
  const norms = pts.slice(1).map((p, i) => left(p[0] - pts[i][0], p[1] - pts[i][1]));
  path.push([pts[0][0] + norms[0][0] * offs[0], pts[0][1] + norms[0][1] * offs[0]]);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const n1 = norms[i - 1];
    const n2 = norms[i];
    const a: Pt = [p[0] + n1[0] * offs[i - 1], p[1] + n1[1] * offs[i - 1]];
    const b: Pt = [p[0] + n2[0] * offs[i], p[1] + n2[1] * offs[i]];
    // Where the two offset lines meet (a mitre), unless they are nearly parallel or meet far away.
    const d1: Pt = [-n1[1], n1[0]];
    const d2: Pt = [-n2[1], n2[0]];
    const cr = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(cr) > 0.08) {
      const t = ((b[0] - a[0]) * d2[1] - (b[1] - a[1]) * d2[0]) / cr;
      const m: Pt = [a[0] + d1[0] * t, a[1] + d1[1] * t];
      if (Math.hypot(m[0] - p[0], m[1] - p[1]) < 3 * Math.max(Math.abs(offs[i - 1]), Math.abs(offs[i]))) {
        path.push(m);
        continue;
      }
    }
    path.push(a, b);
  }
  const last = pts.length - 1;
  const nl = norms[last - 1];
  path.push([pts[last][0] + nl[0] * offs[last - 1], pts[last][1] + nl[1] * offs[last - 1]]);
  path.push(to);
  return tidy(path);
}

/** Drops steps too short to see, always keeping where the path starts and ends. */
function tidy(path: Pt[]): Pt[] {
  const out: Pt[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const p = path[i];
    const q = out[out.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p);
    else if (i === path.length - 1 && out.length > 1) out[out.length - 1] = p;
  }
  return out;
}

/** Total length of a path. */
export const pathLength = (path: Pt[]) => path.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0);
