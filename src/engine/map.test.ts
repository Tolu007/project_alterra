import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LGAS } from '../data/world';
import { testGame } from './autoplay';
import { freeLots, stageName } from './business';
import { actionsAt, placesIn } from './life';
import { doorOf, hood, onStreet, onStreetIn, route, type Plot } from './map';
import { MAP_VERSION, migrateMap } from './setup';
import { doAction, goTo, payRide, rideFare } from './sim';
import { pathLength, registerStreets } from './streets';

// The real districts need their streets for walking; the game loads them with the 3D scene.
for (const l of LGAS) {
  if (!hood(l.id).real) continue;
  const r = JSON.parse(readFileSync(new URL(`../data/city/render/${l.id}.json`, import.meta.url), 'utf8'));
  registerStreets(l.id, r.roads, r.cross);
}

/** Corners of a plot on the ground: w runs along the model's x, d along its z, turned by rot. */
const corners = (p: Plot): [number, number][] => {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  return [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ].map(([i, j]) => [p.x + (c * i * p.w) / 2 + (s * j * p.d) / 2, p.z - (s * i * p.w) / 2 + (c * j * p.d) / 2]);
};

/** Is a point inside a plot, more than `inset` from its edges? */
function inPlot(q: Plot, p: [number, number], inset: number): boolean {
  const c = Math.cos(q.rot);
  const s = Math.sin(q.rot);
  const dx = p[0] - q.x;
  const dz = p[1] - q.z;
  return Math.abs(dx * c - dz * s) < q.w / 2 - inset && Math.abs(dx * s + dz * c) < q.d / 2 - inset;
}

/** Do two plots share ground? (Separating axis test, with a hair of slack for touching edges.) */
function overlap(a: Plot, b: Plot): boolean {
  if (Math.hypot(a.x - b.x, a.z - b.z) > (Math.hypot(a.w, a.d) + Math.hypot(b.w, b.d)) / 2) return false;
  const ca = corners(a);
  const cb = corners(b);
  for (const poly of [ca, cb]) {
    for (let i = 0; i < 4; i++) {
      const [px, pz] = poly[i];
      const [qx, qz] = poly[(i + 1) % 4];
      const n = [qz - pz, px - qx];
      const pa = ca.map(([x, z]) => x * n[0] + z * n[1]);
      const pb = cb.map(([x, z]) => x * n[0] + z * n[1]);
      const len = Math.hypot(n[0], n[1]);
      if (Math.max(...pa) - Math.min(...pb) < 0.01 * len || Math.max(...pb) - Math.min(...pa) < 0.01 * len) return false;
    }
  }
  return true;
}

describe('neighbourhood map', () => {
  it('gives every place a plot, every door a pavement, and no two plots the same ground', () => {
    for (const l of LGAS) {
      const h = hood(l.id);
      for (const place of placesIn(l.id)) {
        if (place === 'busstop') continue;
        expect(h.place[place], `${l.id} ${place}`).toBeDefined();
        expect(onStreetIn(l.id, doorOf(l.id, place, null)), `${l.id} ${place} door`).toBe(true);
      }
      expect(onStreetIn(l.id, doorOf(l.id, 'busstop', null)), `${l.id} bus stop`).toBe(true);
      for (let i = 0; i < h.plots.length; i++) {
        for (let j = i + 1; j < h.plots.length; j++) expect(overlap(h.plots[i], h.plots[j]), `${l.id} plots ${i} and ${j}`).toBe(false);
      }
      const used = new Set(Object.values(h.place));
      expect(h.lots.some((id) => used.has(id))).toBe(false);
      expect(h.lots.length).toBeGreaterThanOrEqual(10);
    }
  });

  it('in the grid towns, routes along the streets, never through the middle of a block', () => {
    const h = hood('KMC');
    const from = doorOf('KMC', 'home', null);
    const to = doorOf('KMC', 'lot', h.lots[h.lots.length - 1]);
    const path = route('KMC', from, to);
    expect(path[0]).toEqual(from);
    expect(path[path.length - 1]).toEqual(to);
    // Every leg runs along one axis, and every turn is on a pavement.
    for (let i = 1; i < path.length - 1; i++) expect(onStreet(path[i])).toBe(true);
  });

  it('Lagos districts are real places: Computer Village, the Marina ferry, Ikorodu garage', () => {
    expect(hood('IKJ').real?.name).toBe('Ikeja');
    const name = (lga: string, place: 'market' | 'jetty' | 'park' | 'airport') => hood(lga).plots[hood(lga).place[place]!].real;
    expect(name('IKJ', 'market')).toBe('Computer Village');
    expect(name('IKJ', 'airport')).toMatch(/Murtala Muhammed|MMA/);
    expect(name('LIS', 'jetty')).toMatch(/Marina/);
    expect(name('IKD', 'park')).toMatch(/Ikorodu/);
    // Kano and Port Harcourt keep their small grid towns for now.
    expect(hood('KMC').real).toBeUndefined();
  });

  it('in the real districts you can walk from home to every place and plot on the pavements', { timeout: 30_000 }, () => {
    for (const l of LGAS.filter((x) => hood(x.id).real)) {
      const h = hood(l.id);
      const from = doorOf(l.id, 'home', null);
      const targets = [...placesIn(l.id).map((p) => doorOf(l.id, p, null)), ...h.lots.map((id) => doorOf(l.id, 'lot', id))];
      for (const to of targets) {
        const path = route(l.id, from, to);
        expect(path[0]).toEqual(from);
        expect(path[path.length - 1]).toEqual(to);
        const far = Math.hypot(to[0] - from[0], to[1] - from[1]);
        if (far > 40) expect(path.length, `${l.id} to ${to}`).toBeGreaterThan(3);
        expect(pathLength(path)).toBeGreaterThanOrEqual(far - 0.01);
        // Not absurdly roundabout: real streets wind and railways and expressways cut across, but not six times over.
        expect(pathLength(path), `${l.id} detour to ${to}`).toBeLessThan(far * 6 + 150);
        // Out of the door, along the streets (and over the odd crossing), and never through a building.
        if (path.length > 2) expect(onStreetIn(l.id, path[1]), `${l.id} first step`).toBe(true);
        for (let i = 1; i < path.length - 2; i++) {
          const [a, b] = [path[i], path[i + 1]];
          const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
          for (let k = 0; k <= n; k++) {
            const p: [number, number] = [a[0] + ((b[0] - a[0]) * k) / Math.max(1, n), a[1] + ((b[1] - a[1]) * k) / Math.max(1, n)];
            const inside = h.plots.find((q) => Math.hypot(q.x - p[0], q.z - p[1]) < q.w && inPlot(q, p, 0.6));
            expect(inside, `${l.id} walks through plot ${inside?.id} at ${p}`).toBeUndefined();
          }
        }
      }
    }
  });
});

describe('plots, bus stops and rides', () => {
  it('a starting business stands on a free plot near home, and the plot is taken', () => {
    const g = testGame(11, 'OSH', { kind: 'business', type: 'buka' });
    const b = g.businesses[0];
    expect(hood('OSH').lots).toContain(b.plot);
    expect(freeLots(g, 'OSH')).not.toContain(b.plot);
    const at = actionsAt(goTo(g, 'lot', b.plot), 'lot');
    expect(at.some((a) => a.id === `bw:${b.id}`)).toBe(true);
    expect(at.find((a) => a.id.startsWith('grow:'))?.label).toContain(stageName(b.type, 2));
  });

  it('okadas and kekes are bought at the motor park and need no plot', () => {
    const g0 = testGame(12, 'OSH', { kind: 'job', trade: 'factory' });
    const r = doAction(goTo(g0, 'park'), 'open:keke');
    expect(r.ok).toBe(true);
    const keke = r.game.businesses.find((b) => b.type === 'keke')!;
    expect(keke.plot).toBe(-1);
    expect(freeLots(r.game, 'OSH')).toEqual(freeLots(g0, 'OSH'));
  });

  it('danfos to the rest of the state leave from the bus stop; buses to other states from the park', () => {
    const g = testGame(13, 'IKJ');
    const stop = actionsAt(goTo(g, 'busstop'), 'busstop').map((a) => a.id);
    const park = actionsAt(goTo(g, 'park'), 'park').map((a) => a.id);
    expect(stop).toContain('travel:OSH');
    expect(stop.some((id) => id === 'travel:KMC')).toBe(false);
    expect(park.some((id) => id === 'travel:KMC')).toBe(true);
    const moved = doAction(goTo(g, 'busstop'), 'travel:OSH');
    expect(moved.ok).toBe(true);
    expect(moved.game.player.at).toBe('OSH');
    expect(moved.game.place).toBe('busstop');
  });

  it('a keke ride costs the fare and no time', () => {
    const g = testGame(14, 'OSH');
    const { fare } = rideFare(g);
    const r = payRide(g);
    expect(r.ok).toBe(true);
    expect(r.game.player.money).toBe(g.player.money - fare);
    expect(r.game.minute).toBe(g.minute);
    expect(fare).toBeGreaterThan(0);
  });
});

describe('worlds from before the real map', () => {
  it('moves Lagos businesses onto plots that exist in the new layout', () => {
    const g = testGame(15, 'OSH', { kind: 'business', type: 'buka' });
    const b = g.businesses[0];
    g.mapVersion = undefined;
    b.plot = 37;
    g.place = 'lot';
    g.lot = 37;
    const m = migrateMap(g);
    expect(m.mapVersion).toBe(MAP_VERSION);
    expect(hood('OSH').lots).toContain(b.plot);
    expect(hood('OSH').plots[b.plot].kind).toBe('street');
    expect(m.place).toBe('home');
    // Every business in the redrawn towns stands on its own plot.
    const lagos = m.businesses.filter((x) => x.plot >= 0 && hood(x.lga).real);
    expect(new Set(lagos.map((x) => `${x.lga}:${x.plot}`)).size).toBe(lagos.length);
    for (const x of lagos) expect(hood(x.lga).lots).toContain(x.plot);
  });
});
