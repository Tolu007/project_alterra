import { describe, expect, it } from 'vitest';
import { LGAS } from '../data/world';
import { testGame } from './autoplay';
import { freeLots, stageName } from './business';
import { actionsAt, placesIn } from './life';
import { doorOf, hood, onStreet, route } from './map';
import { doAction, goTo, payRide, rideFare } from './sim';

/** World-space footprint of a plot: side plots are turned a quarter, so their frontage runs north–south. */
const rect = (p: { x: number; z: number; w: number; d: number; face: string }) => {
  const across = p.face === 'n' || p.face === 's';
  const hx = (across ? p.w : p.d) / 2;
  const hz = (across ? p.d : p.w) / 2;
  return { x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz };
};

describe('neighbourhood map', () => {
  it('gives every place a plot, every door a pavement, and no two plots the same ground', () => {
    for (const l of LGAS) {
      const h = hood(l.id);
      for (const place of placesIn(l.id)) {
        if (place === 'busstop') continue;
        expect(h.place[place], `${l.id} ${place}`).toBeDefined();
        expect(onStreet(doorOf(l.id, place, null)), `${l.id} ${place} door`).toBe(true);
      }
      expect(onStreet(doorOf(l.id, 'busstop', null))).toBe(true);
      const rects = h.plots.map(rect);
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.01 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0.01;
          expect(overlap, `${l.id} plots ${i} and ${j}`).toBe(false);
        }
      }
      const used = new Set(Object.values(h.place));
      expect(h.lots.some((id) => used.has(id))).toBe(false);
      expect(h.lots.length).toBeGreaterThanOrEqual(10);
    }
  });

  it('routes along the streets, never through the middle of a block', () => {
    const h = hood('IKJ');
    const from = doorOf('IKJ', 'home', null);
    const to = doorOf('IKJ', 'lot', h.lots[h.lots.length - 1]);
    const path = route('IKJ', from, to);
    expect(path[0]).toEqual(from);
    expect(path[path.length - 1]).toEqual(to);
    // Every leg runs along one axis, and every turn is on a pavement.
    for (let i = 1; i < path.length - 1; i++) expect(onStreet(path[i])).toBe(true);
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
