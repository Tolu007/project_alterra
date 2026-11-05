import { describe, expect, it } from 'vitest';
import { testGame } from './autoplay';
import { actionsAt, rideHailActions } from './life';
import { hood } from './map';
import { doAction, goTo } from './sim';
import { rushFactor, tripsFrom } from './travel';
import type { Game } from './types';

/** A rich traveller at a place at a given time of day. */
const at = (home: string, place: Parameters<typeof goTo>[1], minute: number): Game => {
  const g = goTo(testGame(21, home), place);
  g.minute = minute;
  g.player.money = 2_000_000;
  g.player.energy = 100;
  return g;
};
const ids = (g: Game) => actionsAt(g, g.place).map((a) => a.id);

describe('getting around Lagos', () => {
  it('danfos follow the real roads, and rush hour makes them crawl', () => {
    const trip = (minute: number) => tripsFrom(at('IKD', 'busstop', minute)).find((t) => t.id === 'travel:LIS')!;
    const peak = trip(8 * 60);
    const calm = trip(11 * 60);
    expect(calm.via).toContain('Third Mainland Bridge');
    expect(calm.km).toBeGreaterThan(25);
    expect(peak.minutes).toBeGreaterThan(calm.minutes * 1.6);
    expect(rushFactor(3 * 60)).toBe(1);
  });

  it('the BRT runs only along its corridors, and the Red Line train only between its stations', () => {
    const osh = ids(at('OSH', 'busstop', 11 * 60));
    expect(osh).toContain('travel:IKJ:brt');
    expect(osh).toContain('travel:LMA:rail');
    expect(osh).not.toContain('travel:LIS:brt');
    expect(ids(at('IKD', 'busstop', 11 * 60))).toContain('travel:LIS:brt');
  });

  it('ferries leave from the jetty and land at the jetty across the lagoon', () => {
    const g = at('IKD', 'jetty', 9 * 60);
    expect(ids(g)).toContain('travel:LIS:ferry');
    expect(ids(goTo(g, 'busstop'))).not.toContain('travel:LIS:ferry');
    const r = doAction(g, 'travel:LIS:ferry');
    expect(r.ok, r.text).toBe(true);
    expect(r.game.player.at).toBe('LIS');
    expect(r.game.place).toBe('jetty');
    // No ferries at night.
    expect(actionsAt(at('IKD', 'jetty', 21 * 60), 'jetty').find((a) => a.id === 'travel:LIS:ferry')?.blocked).toBeTruthy();
  });

  it('a ride-hailing car is booked from anywhere and costs more than the danfo', () => {
    const g = at('OSH', 'home', 11 * 60);
    const car = rideHailActions(g).find((a) => a.id === 'travel:ETI:taxi')!;
    const danfo = tripsFrom(g).find((t) => t.id === 'travel:ETI')!;
    expect(car.cost).toBeGreaterThan(danfo.cost * 3);
    const r = doAction(g, 'travel:ETI:taxi');
    expect(r.ok, r.text).toBe(true);
    expect(r.game.player.at).toBe('ETI');
    expect(r.game.player.money).toBe(g.player.money - (car.cost ?? 0));
  });
});

describe('getting to Kano and Port Harcourt', () => {
  it('the motor park sells morning buses to the other states', () => {
    const g = at('OSH', 'park', 7 * 60);
    const bus = actionsAt(g, 'park').find((a) => a.id === 'travel:KMC')!;
    expect(bus.label).toBe('Bus to Kano');
    expect(bus.minutes).toBeGreaterThanOrEqual(14 * 60);
    expect(actionsAt(at('OSH', 'park', 12 * 60), 'park').find((a) => a.id === 'travel:KMC')!.blocked).toMatch(/before/);
    const r = doAction(g, 'travel:KMC');
    expect(r.ok, r.text).toBe(true);
    expect(r.game.player.at).toBe('KMC');
    expect(r.game.place).toBe('park');
  });

  it('flights leave from Murtala Muhammed in Ikeja and land at Mallam Aminu Kano', () => {
    const g = at('IKJ', 'airport', 10 * 60);
    expect(hood('IKJ').place.airport).toBeDefined();
    const fly = actionsAt(g, 'airport').find((a) => a.id === 'travel:FAG:flight')!;
    const bus = tripsFrom(g).find((t) => t.id === 'travel:KMC')!;
    expect(fly.minutes).toBeLessThan(bus.minutes / 3);
    expect(fly.cost).toBeGreaterThan(bus.cost * 2);
    const r = doAction(g, 'travel:FAG:flight');
    expect(r.ok, r.text).toBe(true);
    expect(r.game.player.at).toBe('FAG');
    expect(r.game.place).toBe('airport');
    expect(hood('FAG').place.airport).toBeDefined();
    // And on to Port Harcourt.
    const ph = actionsAt({ ...r.game, minute: 12 * 60 }, 'airport').map((a) => a.id);
    expect(ph).toContain('travel:OBI:flight');
    // No airport, no flights: Oshodi people get to Ikeja first.
    expect(tripsFrom(at('OSH', 'busstop', 10 * 60)).some((t) => t.mode === 'flight')).toBe(false);
    expect(actionsAt(at('IKJ', 'airport', 21 * 60), 'airport').find((a) => a.id === 'travel:FAG:flight')!.blocked).toMatch(/Flights/);
  });

  it('Ikorodu keeps its fish ponds on farmland', () => {
    const h = hood('IKD');
    expect(h.plots[h.place.farm!].kind).toBe('farm');
    expect(h.lots.some((id) => h.plots[id].kind === 'farm')).toBe(true);
  });
});
