// Traffic on real streets. The districts built from map data give their roads as polylines; joined at
// shared corners they make a network of one-way lanes. Vehicles keep to the right, stay in a lane, follow
// one-way streets the right way, queue behind each other, give way at junctions and turn from one road
// into the next, instead of shuttling up and down a single stretch of road.
import type { StreetRoad } from './streets';

export type P2 = [number, number];

/** A line to drive along, with the distance travelled at each point. */
export interface Lane {
  pts: P2[];
  at: number[];
  len: number;
}

/** One direction of travel along a stretch of road between two junctions. */
export interface DriveEdge {
  id: number;
  from: number;
  to: number;
  cls: string;
  w: number;
  oneway: boolean;
  /** Lanes from the middle of the road outwards: the last one runs beside the right-hand kerb. */
  lanes: Lane[];
  /** Which way the road points where it starts and where it ends. */
  d0: P2;
  d1: P2;
  /** The same stretch in the opposite direction, or -1 on a one-way street. */
  rev: number;
  /** How far before its end (and after its start) a vehicle swings into its turn. */
  trim: number;
}

export interface DriveNode {
  x: number;
  z: number;
  out: number[];
  in: number[];
  /** Three or more roads meet here: vehicles take turns. */
  junction: boolean;
  /** On the rim of the map: vehicles arrive and leave here. */
  rim: boolean;
}

export interface DriveNet {
  nodes: DriveNode[];
  edges: DriveEdge[];
  /** Edges that lead in from the rim of the map. */
  sources: number[];
  /** Total length of all edges. */
  total: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const norm = (x: number, z: number): P2 => {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
};

export function lane(pts: P2[]): Lane {
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, at, len: at[at.length - 1] };
}

/** A polyline moved sideways by d (positive: to the right of travel, in this x-east, z-south world). */
export function offsetLine(pts: P2[], d: number): P2[] {
  return pts.map((p, i) => {
    const d0 = i > 0 ? norm(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : null;
    const d1 = i < pts.length - 1 ? norm(pts[i + 1][0] - p[0], pts[i + 1][1] - p[1]) : null;
    const m = d0 && d1 ? norm(d0[0] + d1[0], d0[1] + d1[1]) : (d0 ?? d1)!;
    const cos = d0 && d1 ? Math.max(0.4, m[0] * d1[0] + m[1] * d1[1]) : 1;
    return [p[0] - (m[1] * d) / cos, p[1] + (m[0] * d) / cos];
  });
}

/** Where on a lane, and which way it points, at distance s. `hint` remembers the last segment to save searching. */
export function along(l: Lane, s: number, hint: { i: number }): { x: number; z: number; dx: number; dz: number } {
  let i = Math.min(hint.i, l.pts.length - 2);
  if (l.at[i] > s) i = 0;
  while (i < l.pts.length - 2 && l.at[i + 1] < s) i++;
  hint.i = i;
  const [a, b] = [l.pts[i], l.pts[i + 1]];
  const seg = l.at[i + 1] - l.at[i] || 1;
  const t = Math.max(0, Math.min(1, (s - l.at[i]) / seg));
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / seg, dz: (b[1] - a[1]) / seg };
}

/** How many lanes a direction of travel gets. */
function laneCount(w: number, oneway: boolean): number {
  if (oneway) return w >= 11 ? 3 : w >= 6.5 ? 2 : 1;
  return w >= 12 ? 2 : 1;
}

/** Sideways positions of the lanes, measured to the right of the road's centre line. */
export function laneOffsets(w: number, oneway: boolean): number[] {
  const n = laneCount(w, oneway);
  if (oneway) {
    const lw = (w - 1) / n;
    return Array.from({ length: n }, (_, k) => -(w - 1) / 2 + lw * (k + 0.5));
  }
  const half = w / 2 - 0.4;
  const lw = half / n;
  return Array.from({ length: n }, (_, k) => 0.2 + lw * (k + 0.5));
}

/** Roads vehicles use: everything but the back streets. */
export const drivable = (r: StreetRoad) => r.c !== 'local';

/** Builds the lanes of a district from its roads. */
export function buildDriveNet(roads: StreetRoad[], bounds?: Bounds): DriveNet {
  const use = roads.filter(drivable);
  const count = new Map<string, number>();
  const key = (x: number, z: number) => `${x},${z}`;
  for (const r of use) {
    for (let i = 0; i < r.p.length; i += 2) {
      const k = key(r.p[i], r.p[i + 1]);
      const end = i === 0 || i === r.p.length - 2;
      count.set(k, (count.get(k) ?? 0) + (end ? 2 : 1));
    }
  }
  const nodes: DriveNode[] = [];
  const ids = new Map<string, number>();
  const node = (x: number, z: number) => {
    const k = key(x, z);
    let i = ids.get(k);
    if (i === undefined) {
      i = nodes.length;
      ids.set(k, i);
      const rim = !!bounds && (x <= bounds.minX + 4 || x >= bounds.maxX - 4 || z <= bounds.minZ + 4 || z >= bounds.maxZ - 4);
      nodes.push({ x, z, out: [], in: [], junction: false, rim });
    }
    return i;
  };
  const edges: DriveEdge[] = [];
  let total = 0;
  const add = (pts: P2[], r: StreetRoad, oneway: boolean): number => {
    const lanes = laneOffsets(r.w, oneway).map((d) => lane(offsetLine(pts, d)));
    const n = pts.length;
    const len = lane(pts).len;
    const e: DriveEdge = {
      id: edges.length,
      from: node(pts[0][0], pts[0][1]),
      to: node(pts[n - 1][0], pts[n - 1][1]),
      cls: r.c,
      w: r.w,
      oneway,
      lanes,
      d0: norm(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]),
      d1: norm(pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1]),
      rev: -1,
      trim: Math.min(3.5, Math.min(...lanes.map((l) => l.len)) * 0.3),
    };
    edges.push(e);
    nodes[e.from].out.push(e.id);
    nodes[e.to].in.push(e.id);
    total += len;
    return e.id;
  };
  for (const r of use) {
    let piece: P2[] = [];
    for (let i = 0; i < r.p.length; i += 2) {
      const p: P2 = [r.p[i], r.p[i + 1]];
      const last = piece[piece.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) continue;
      piece.push(p);
      const end = i === r.p.length - 2;
      if (piece.length > 1 && (end || (count.get(key(p[0], p[1])) ?? 0) >= 2)) {
        if (lane(piece).len > 0.5) {
          const a = add(piece, r, !!r.o);
          if (!r.o) {
            const b = add([...piece].reverse(), r, false);
            edges[a].rev = b;
            edges[b].rev = a;
          }
        }
        piece = [p];
      }
    }
  }
  for (const n of nodes) {
    const around = new Set<number>();
    for (const e of n.out) around.add(edges[e].to);
    for (const e of n.in) around.add(edges[e].from);
    n.junction = around.size >= 3;
  }
  // Vehicles come in where a road starts at the rim of the map, or where nothing leads into it.
  const sources = edges.filter((e) => nodes[e.from].in.every((i) => i === e.rev) && (nodes[e.from].rim || !bounds)).map((e) => e.id);
  return { nodes, edges, sources, total };
}

// ───────────── vehicles ─────────────

export interface Car {
  id: number;
  edge: number;
  lane: number;
  /** Distance along the lane. */
  s: number;
  v: number;
  vmax: number;
  len: number;
  /** Buses of this kind pull in at the bus stop. */
  bus: boolean;
  /** The edge it will take at the end of this one (-1: the road ends). */
  next: number;
  nextLane: number;
  /** The curve it is following through a junction. */
  turn: { p0: P2; c: P2; p1: P2; len: number; t: number; node: number; vmax: number } | null;
  /** Seconds left waiting at the bus stop, and whether it has stopped on this pass. */
  dwell: number;
  stopped: boolean;
  /** How far it has pulled in to the kerb, 0 to 1. */
  pull: number;
  /** Seconds it has been stuck at a junction. */
  stuck: number;
  /** Off the road for now (fewer vehicles at night). */
  parked: boolean;
  x: number;
  z: number;
  dx: number;
  dz: number;
  hint: { i: number };
}

export interface BusStopAt {
  edge: number;
  lane: number;
  s: number;
  /** Which way to pull in: 1 to the right of travel, -1 to the left. */
  side: 1 | -1;
}

export interface Traffic {
  net: DriveNet;
  cars: Car[];
  stop: BusStopAt | null;
  rnd: () => number;
  /** For each junction: the edge whose vehicles hold it, whether they are going straight on, and how many are in it. */
  lockEdge: Int32Array;
  lockStraight: Uint8Array;
  lockCount: Uint8Array;
  /** Is a bus standing at the stop? */
  stopBusy: boolean;
}

const CLASS_WEIGHT: Record<string, number> = { major: 6, minor: 2.5, link: 2.5 };

/** The lane and the place on it nearest the bus shelter, if a road runs past it. */
export function findBusStop(net: DriveNet, shelter: P2): BusStopAt | null {
  let best: (BusStopAt & { d: number }) | null = null;
  for (const e of net.edges) {
    e.lanes.forEach((l, li) => {
      for (let i = 0; i < l.pts.length - 1; i++) {
        const [a, b] = [l.pts[i], l.pts[i + 1]];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const l2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((shelter[0] - a[0]) * dx + (shelter[1] - a[1]) * dz) / l2));
        // Right of travel is (-dz, dx): is the shelter on that side? Buses stop with their doors to the kerb where they can.
        const right = -dz * (shelter[0] - a[0]) + dx * (shelter[1] - a[1]) >= 0;
        const d = Math.hypot(shelter[0] - (a[0] + dx * t), shelter[1] - (a[1] + dz * t)) + (right ? 0 : 7);
        if (d < 18 && (!best || d < best.d)) {
          best = { edge: e.id, lane: li, s: l.at[i] + Math.sqrt(l2) * t, side: right ? 1 : -1, d };
        }
      }
    });
  }
  if (!best) return null;
  const { d: _d, ...stop } = best as BusStopAt & { d: number };
  const l = net.edges[stop.edge].lanes[stop.lane];
  // Not at the very end of the stretch, where vehicles are turning.
  const trim = net.edges[stop.edge].trim;
  if (l.len < 12) return null;
  stop.s = Math.max(trim + 2, Math.min(l.len - trim - 2, stop.s));
  return stop;
}

/** Picks the road to take at the end of this one: mostly straight on, mostly along the bigger road. */
function pickNext(t: Traffic, e: DriveEdge): number {
  const outs = t.net.nodes[e.to].out;
  let sum = 0;
  const opts: [number, number][] = [];
  for (const id of outs) {
    if (id === e.rev) continue;
    const o = t.net.edges[id];
    const cos = e.d1[0] * o.d0[0] + e.d1[1] * o.d0[1];
    if (cos < -0.6) continue;
    const c = Math.max(0, cos);
    const w = (CLASS_WEIGHT[o.cls] ?? 1) * (0.2 + 3 * c * c * c);
    opts.push([id, w]);
    sum += w;
  }
  if (!opts.length) {
    // A dead end inside the map: turn round. At the rim the vehicle leaves.
    return e.rev >= 0 && !t.net.nodes[e.to].rim ? e.rev : -1;
  }
  let r = t.rnd() * sum;
  for (const [id, w] of opts) {
    r -= w;
    if (r <= 0) return id;
  }
  return opts[opts.length - 1][0];
}

function plan(t: Traffic, c: Car) {
  const e = t.net.edges[c.edge];
  c.next = pickNext(t, e);
  if (c.next < 0) return;
  const n = t.net.edges[c.next];
  const stop = t.stop;
  if (c.bus && stop && stop.edge === c.next && !c.stopped) c.nextLane = stop.lane;
  // Keep to the same side of the road: count lanes from the kerb.
  else c.nextLane = Math.max(0, n.lanes.length - 1 - (e.lanes.length - 1 - c.lane));
}

function place(t: Traffic, c: Car, edge: number, s: number, laneIdx?: number) {
  const e = t.net.edges[edge];
  c.edge = edge;
  c.lane = laneIdx ?? Math.floor(t.rnd() * e.lanes.length);
  c.s = Math.min(s, e.lanes[c.lane].len);
  c.turn = null;
  c.dwell = 0;
  c.stopped = false;
  c.pull = 0;
  c.stuck = 0;
  c.hint.i = 0;
  c.v = c.vmax * 0.6;
  plan(t, c);
  const q = along(e.lanes[c.lane], c.s, c.hint);
  c.x = q.x;
  c.z = q.z;
  c.dx = q.dx;
  c.dz = q.dz;
}

/** Is there room for a vehicle at this place on this lane? */
function roomAt(t: Traffic, me: Car, edge: number, laneIdx: number, s: number): boolean {
  for (const o of t.cars) {
    if (o === me || o.parked || o.turn || o.edge !== edge || o.lane !== laneIdx) continue;
    if (Math.abs(o.s - s) < (o.len + me.len) / 2 + 3) return false;
  }
  return true;
}

/** Vehicles are kept on the streets within this distance of you, and come in no nearer than NEAR. */
const FAR = 300;
const NEAR = 165;

/** Puts a vehicle on a road some way from a point: between `near` and `far` of it. False if there is no room. */
function enterAround(t: Traffic, c: Car, at: P2, near: number, far: number): boolean {
  const { net } = t;
  const opts: [number, number][] = [];
  let sum = 0;
  for (const e of net.edges) {
    const l = e.lanes[0];
    const m = l.pts[l.pts.length >> 1];
    const d = Math.hypot(m[0] - at[0], m[1] - at[1]);
    if (d > far + l.len / 2 || d < near - l.len / 2) continue;
    const w = l.len * (CLASS_WEIGHT[e.cls] ?? 1);
    opts.push([e.id, w]);
    sum += w;
  }
  if (!opts.length) return false;
  for (let tries = 0; tries < 14; tries++) {
    let r = t.rnd() * sum;
    let id = opts[opts.length - 1][0];
    for (const [i, w] of opts) {
      r -= w;
      if (r <= 0) {
        id = i;
        break;
      }
    }
    const e = net.edges[id];
    const li = Math.floor(t.rnd() * e.lanes.length);
    const l = e.lanes[li];
    const s = e.trim + t.rnd() * Math.max(0, l.len - 2 * e.trim);
    const q = along(l, s, { i: 0 });
    const d = Math.hypot(q.x - at[0], q.z - at[1]);
    if (d < near || d > far || !roomAt(t, c, id, li, s)) continue;
    place(t, c, id, s, li);
    return true;
  }
  return false;
}

/** Brings a vehicle in out of sight: on a street some way from you, or else at the rim of the map. */
function enter(t: Traffic, c: Car, avoid?: P2) {
  const { net } = t;
  if (avoid && enterAround(t, c, avoid, NEAR, FAR - 20)) return;
  const from = net.sources.length ? net.sources : net.edges.map((e) => e.id);
  for (let tries = 0; tries < 12; tries++) {
    const id = from[Math.floor(t.rnd() * from.length)];
    const e = net.edges[id];
    const n = net.nodes[e.from];
    if (avoid && tries < 8 && Math.abs(n.x - avoid[0]) + Math.abs(n.z - avoid[1]) < 110) continue;
    const li = Math.floor(t.rnd() * e.lanes.length);
    const s = Math.min(e.lanes[li].len * 0.5, 1 + t.rnd() * 6);
    if (!roomAt(t, c, id, li, s) && tries < 11) continue;
    place(t, c, id, s, li);
    return;
  }
}

export interface CarSpec {
  len: number;
  vmax: number;
  bus?: boolean;
}

/** Puts vehicles on the roads, spread out by road length and importance: all over the map, or on the streets around a point. */
export function makeTraffic(net: DriveNet, specs: CarSpec[], rnd: () => number, stop: BusStopAt | null = null, around?: P2): Traffic {
  const t: Traffic = {
    net,
    cars: [],
    stop,
    rnd,
    lockEdge: new Int32Array(net.nodes.length).fill(-1),
    lockStraight: new Uint8Array(net.nodes.length),
    lockCount: new Uint8Array(net.nodes.length),
    stopBusy: false,
  };
  if (!net.edges.length) return t;
  const weights = net.edges.map((e) => e.lanes[0].len * (CLASS_WEIGHT[e.cls] ?? 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  specs.forEach((sp, id) => {
    const c: Car = { id, edge: 0, lane: 0, s: 0, v: 0, vmax: sp.vmax, len: sp.len, bus: !!sp.bus, next: -1, nextLane: 0, turn: null, dwell: 0, stopped: false, pull: 0, stuck: 0, parked: false, x: 0, z: 0, dx: 1, dz: 0, hint: { i: 0 } };
    t.cars.push(c);
    if (around && enterAround(t, c, around, 0, FAR - 20)) return;
    for (let tries = 0; tries < 10; tries++) {
      let r = rnd() * sum;
      let edge = 0;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          edge = i;
          break;
        }
      }
      const e = net.edges[edge];
      const li = Math.floor(rnd() * e.lanes.length);
      const s = e.trim + rnd() * Math.max(0, e.lanes[li].len - 2 * e.trim);
      if (!roomAt(t, c, edge, li, s) && tries < 9) continue;
      place(t, c, edge, s, li);
      break;
    }
  });
  return t;
}

const bez = (p0: P2, c: P2, p1: P2, u: number): { x: number; z: number; dx: number; dz: number } => {
  const a = 1 - u;
  const x = a * a * p0[0] + 2 * a * u * c[0] + u * u * p1[0];
  const z = a * a * p0[1] + 2 * a * u * c[1] + u * u * p1[1];
  const [dx, dz] = norm(2 * a * (c[0] - p0[0]) + 2 * u * (p1[0] - c[0]), 2 * a * (c[1] - p0[1]) + 2 * u * (p1[1] - c[1]));
  return { x, z, dx, dz };
};

/** How fast a vehicle may go with this much clear road ahead. */
const safeSpeed = (gap: number) => Math.sqrt(2 * 7 * Math.max(0, gap - 1.4));

/**
 * Moves every vehicle on by dt seconds. `active` is how many of them are on the road at this hour; `player`
 * is someone on foot whom drivers stop for.
 */
export function stepTraffic(t: Traffic, dt: number, active = t.cars.length, player?: P2) {
  const { net, cars } = t;
  if (!net.edges.length) return;
  // Who is on each stretch of road. Vehicles in a junction count as arriving on the road they turn into.
  const on = new Map<number, Car[]>();
  const put = (edge: number, c: Car) => {
    const l = on.get(edge);
    if (l) l.push(c);
    else on.set(edge, [c]);
  };
  cars.forEach((c, i) => {
    const want = i >= active;
    if (want && !c.parked && !c.turn && c.dwell <= 0) {
      // Leave the road only out of sight.
      if (!player || Math.abs(c.x - player[0]) + Math.abs(c.z - player[1]) > 170) c.parked = true;
    } else if (!want && c.parked) {
      c.parked = false;
      enter(t, c, player);
    }
    if (!c.parked) put(c.turn ? c.next : c.edge, c);
  });
  /** Where a vehicle counts as being on the road it is on or turning into. */
  const posOn = (c: Car) => (c.turn ? net.edges[c.next].trim - (c.turn.len - c.turn.t) : c.s);
  const laneOn = (c: Car) => (c.turn ? c.nextLane : c.lane);
  /** Clear road ahead of `me` at distance s along a lane of an edge. */
  const gapOn = (me: Car, edge: number, laneIdx: number, s: number): number => {
    let gap = Infinity;
    for (const o of on.get(edge) ?? []) {
      if (o === me || laneOn(o) !== laneIdx) continue;
      const d = posOn(o) - s;
      if (d > 0 || (d === 0 && o.id < me.id)) gap = Math.min(gap, d - (o.len + me.len) / 2);
    }
    return gap;
  };

  for (const c of cars) {
    if (c.parked) continue;
    // Left far behind: come back in on a street nearer you.
    if (player && !c.turn && c.dwell <= 0 && Math.hypot(c.x - player[0], c.z - player[1]) > FAR + 40) {
      enter(t, c, player);
      continue;
    }
    const e = net.edges[c.edge];
    if (c.turn) {
      const tr = c.turn;
      const n = net.edges[c.next];
      const gap = gapOn(c, c.next, c.nextLane, posOn(c));
      const target = Math.min(tr.vmax, safeSpeed(gap));
      c.v = Math.max(0, c.v + Math.max(-16 * dt, Math.min(5 * dt, target - c.v)));
      tr.t += c.v * dt;
      if (tr.t >= tr.len) {
        // Out of the junction and onto the next road.
        if (net.nodes[tr.node].junction && t.lockCount[tr.node] > 0 && --t.lockCount[tr.node] === 0) t.lockEdge[tr.node] = -1;
        c.edge = c.next;
        c.lane = c.nextLane;
        c.s = n.trim + (tr.t - tr.len);
        c.turn = null;
        c.hint.i = 0;
        c.stopped = false;
        plan(t, c);
      } else {
        const q = bez(tr.p0, tr.c, tr.p1, tr.t / tr.len);
        c.x = q.x;
        c.z = q.z;
        c.dx = q.dx;
        c.dz = q.dz;
        continue;
      }
    } else {
      const l = e.lanes[c.lane];
      const end = c.next >= 0 ? l.len - e.trim : l.len;
      const toEnd = end - c.s;
      let gap = gapOn(c, c.edge, c.lane, c.s);
      let limit = c.vmax;
      const nodeId = e.to;
      let held = false;
      if (c.next >= 0) {
        const n = net.edges[c.next];
        const cos = e.d1[0] * n.d0[0] + e.d1[1] * n.d0[1];
        const straight = cos > 0.9;
        // Slow down for the corner.
        if (!straight) {
          const vTurn = 3.2 + 4.5 * Math.max(0, cos);
          limit = Math.min(limit, Math.sqrt(vTurn * vTurn + 2 * 5 * Math.max(0, toEnd)));
        }
        // Vehicles already on the road ahead.
        gap = Math.min(gap, toEnd + gapOn(c, c.next, c.nextLane, n.trim - turnLength(e, c.lane, n, c.nextLane)));
        // Give way at a junction someone else is crossing.
        if (net.nodes[nodeId].junction && t.lockCount[nodeId] > 0 && t.lockEdge[nodeId] !== c.edge) {
          const through = straight && t.lockStraight[nodeId] === 1 && t.lockEdge[nodeId] === n.rev;
          if (!through && c.stuck < 7) {
            held = true;
            gap = Math.min(gap, toEnd + 1.4);
          }
        }
      }
      // The bus stop.
      const stop = t.stop;
      if (c.dwell > 0) {
        c.dwell -= dt;
        gap = 0;
        c.pull = Math.min(1, c.pull + dt * 1.5);
        if (c.dwell <= 0) t.stopBusy = false;
      } else {
        if (c.pull > 0) c.pull = Math.max(0, c.pull - dt * 0.8);
        if (c.bus && stop && !c.stopped && stop.edge === c.edge && stop.lane === c.lane && !t.stopBusy) {
          const ds = stop.s - c.s;
          if (ds > -0.5 && ds < 30) {
            gap = Math.min(gap, ds + 1);
            if (ds < 12) c.pull = Math.min(1, c.pull + dt * 1.2);
            if (ds < 1 && c.v < 1.5) {
              c.dwell = 4 + t.rnd() * 3;
              c.stopped = true;
              t.stopBusy = true;
            }
          }
        }
      }
      // Someone on foot in the road ahead.
      if (player) {
        const px = player[0] - c.x;
        const pz = player[1] - c.z;
        const ahead = px * c.dx + pz * c.dz;
        if (ahead > 0 && ahead < 9 + c.v && Math.abs(-px * c.dz + pz * c.dx) < 1.7) gap = Math.min(gap, ahead - c.len / 2 - 0.4);
      }
      const target = Math.min(limit, safeSpeed(gap));
      c.v = Math.max(0, c.v + Math.max(-16 * dt, Math.min(4.5 * dt, target - c.v)));
      c.s += c.v * dt;
      c.stuck = held && c.v < 0.3 ? c.stuck + dt : held ? c.stuck : 0;
      if (c.s >= end) {
        if (c.next < 0) {
          enter(t, c, player);
          continue;
        }
        if (held) {
          c.s = end;
          c.v = 0;
        } else {
          // Swing through the junction onto the next road.
          const n = net.edges[c.next];
          const nl = n.lanes[c.nextLane];
          const a = along(l, end, c.hint);
          const b = along(nl, n.trim, { i: 0 });
          const le = l.pts[l.pts.length - 1];
          const ns = nl.pts[0];
          const ctl: P2 = [(le[0] + ns[0]) / 2, (le[1] + ns[1]) / 2];
          const p0: P2 = [a.x, a.z];
          const p1: P2 = [b.x, b.z];
          const len = Math.max(0.5, (Math.hypot(ctl[0] - p0[0], ctl[1] - p0[1]) + Math.hypot(p1[0] - ctl[0], p1[1] - ctl[1]) + Math.hypot(p1[0] - p0[0], p1[1] - p0[1])) / 2);
          const cos = e.d1[0] * n.d0[0] + e.d1[1] * n.d0[1];
          c.turn = { p0, c: ctl, p1, len, t: c.s - end, node: nodeId, vmax: cos > 0.9 ? c.vmax : 3.2 + 4.5 * Math.max(0, cos) };
          if (net.nodes[nodeId].junction) {
            if (t.lockCount[nodeId] === 0) {
              t.lockEdge[nodeId] = c.edge;
              t.lockStraight[nodeId] = cos > 0.9 ? 1 : 0;
            }
            if (t.lockCount[nodeId] < 250) t.lockCount[nodeId]++;
          }
          c.stuck = 0;
          const q = bez(p0, ctl, p1, Math.min(1, c.turn.t / len));
          c.x = q.x;
          c.z = q.z;
          c.dx = q.dx;
          c.dz = q.dz;
          continue;
        }
      }
    }
    const cur = net.edges[c.edge];
    const q = along(cur.lanes[c.lane], c.s, c.hint);
    const side = t.stop && t.stop.edge === c.edge ? t.stop.side : 1;
    const pull = c.pull * c.pull * (3 - 2 * c.pull) * 1.5 * side;
    c.x = q.x - q.dz * pull;
    c.z = q.z + q.dx * pull;
    c.dx = q.dx;
    c.dz = q.dz;
  }
}

/** Roughly how long the curve through a junction is, from one lane to the next. */
function turnLength(e: DriveEdge, li: number, n: DriveEdge, ni: number): number {
  const a = e.lanes[li].pts[e.lanes[li].pts.length - 1];
  const b = n.lanes[ni].pts[0];
  return e.trim + n.trim + Math.hypot(a[0] - b[0], a[1] - b[1]);
}
