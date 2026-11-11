import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { StreetRoad } from './streets';
import { buildDriveNet, drivable, findBusStop, makeTraffic, stepTraffic, type CarSpec } from './traffic';

const DISTRICTS = ['OSH', 'IKJ', 'LIS', 'LMA', 'ETI', 'APP', 'IKD'];
const city = JSON.parse(readFileSync('src/data/city/lagos.json', 'utf8')) as { districts: Record<string, { bounds: { minX: number; maxX: number; minZ: number; maxZ: number }; busStop: { x: number; z: number } | null }> };
const roadsOf = (id: string) => (JSON.parse(readFileSync(`src/data/city/render/${id}.json`, 'utf8')) as { roads: StreetRoad[] }).roads;

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Answers how far a point is from the nearest road vehicles use, less half that road's width (negative: on the tar). */
function roadFinder(roads: StreetRoad[]) {
  const CELL = 30;
  const cells = new Map<string, number[][]>();
  for (const r of roads) {
    for (let i = 2; i < r.p.length; i += 2) {
      const seg = [r.p[i - 2], r.p[i - 1], r.p[i], r.p[i + 1], r.w / 2];
      for (let x = Math.floor((Math.min(seg[0], seg[2]) - 12) / CELL); x <= Math.floor((Math.max(seg[0], seg[2]) + 12) / CELL); x++)
        for (let z = Math.floor((Math.min(seg[1], seg[3]) - 12) / CELL); z <= Math.floor((Math.max(seg[1], seg[3]) + 12) / CELL); z++) {
          const k = `${x},${z}`;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k)!.push(seg);
        }
    }
  }
  return (x: number, z: number) => {
    let best = Infinity;
    for (const [ax, az, bx, bz, hw] of cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)) - hw);
    }
    return best;
  };
}

describe('traffic on the real streets', () => {
  for (const id of DISTRICTS) {
    it(`${id}: vehicles keep to the road, the right way, and keep moving`, { timeout: 60_000 }, () => {
      const offRoad = roadFinder(roadsOf(id).filter(drivable));
      const net = buildDriveNet(roadsOf(id), city.districts[id].bounds);
      expect(net.edges.length).toBeGreaterThan(20);
      // One-way streets have no lane the other way, and every lane lies on its road.
      let lanesOff = -Infinity;
      for (const e of net.edges) {
        if (e.oneway) expect(e.rev).toBe(-1);
        for (const l of e.lanes) for (const p of l.pts) lanesOff = Math.max(lanesOff, offRoad(p[0], p[1]));
      }
      expect(lanesOff).toBeLessThan(0.6);
      const rnd = seeded(7);
      const N = 90;
      const specs: CarSpec[] = Array.from({ length: N }, (_, i) => ({ len: i % 5 === 0 ? 8.5 : 4, vmax: 8 + rnd() * 6, bus: i % 3 === 0 }));
      const stop = city.districts[id].busStop;
      const me: [number, number] = stop ? [stop.x, stop.z] : [0, 0];
      const t = makeTraffic(net, specs, rnd, stop ? findBusStop(net, [stop.x, stop.z]) : null, me);
      let worst = -Infinity;
      let moving = 0;
      let samples = 0;
      let dwelt = 0;
      const SECONDS = 300;
      for (let step = 0; step < 30 * SECONDS; step++) {
        stepTraffic(t, 1 / 30, N, me);
        if (step % 10) continue;
        for (const c of t.cars) {
          if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) throw new Error('a vehicle left the map');
          worst = Math.max(worst, offRoad(c.x, c.z));
          if (c.dwell > 0) dwelt++;
          if (step > 30 * (SECONDS - 60)) {
            samples++;
            if (c.v > 1) moving++;
          }
        }
      }
      if (process.env.TRAFFIC_LOG) console.log(id, { edges: net.edges.length, sources: net.sources.length, km: Math.round(net.total), stop: !!t.stop, lanesOff: +lanesOff.toFixed(2), worst: +worst.toFixed(2), moving: +(moving / samples).toFixed(2), dwelt });
      // Cutting a corner or pulling in at the bus stop may take a vehicle a little over the kerb, no more.
      expect(worst).toBeLessThan(3);
      // No gridlock: in the last minute most vehicles are moving most of the time.
      expect(moving / samples).toBeGreaterThan(0.6);
      if (t.stop) expect(dwelt).toBeGreaterThan(0);
    });
  }

  it('queues instead of overlapping in a lane', { timeout: 60_000 }, () => {
    const net = buildDriveNet(roadsOf('OSH'), city.districts.OSH.bounds);
    const rnd = seeded(3);
    const t = makeTraffic(net, Array.from({ length: 120 }, () => ({ len: 4, vmax: 7 + rnd() * 7 })), rnd, null, [60, -30]);
    let overlaps = 0;
    let checks = 0;
    for (let step = 0; step < 30 * 120; step++) {
      stepTraffic(t, 1 / 30, 120, [60, -30]);
      if (step % 15) continue;
      for (const a of t.cars) {
        for (const b of t.cars) {
          if (a.id >= b.id || a.turn || b.turn || a.edge !== b.edge || a.lane !== b.lane) continue;
          checks++;
          if (Math.abs(a.s - b.s) < 3.2) overlaps++;
        }
      }
    }
    expect(checks).toBeGreaterThan(100);
    expect(overlaps / checks).toBeLessThan(0.01);
  });
});
