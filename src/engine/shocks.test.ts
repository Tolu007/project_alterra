import { describe, expect, it } from 'vitest';
import { playWeeks, testGame } from './autoplay';
import { activeShocks, startShock } from './shocks';

const snap = (g: ReturnType<typeof testGame>) => ({ oil: g.macro.oilPrice, petrol: g.prices.LA.petrol, fare: g.fares.OSH, food: g.prices.LA.food, cpi: g.prices.LA.cpi });

describe('news from the wider world', () => {
  it('a war in the Middle East lifts crude, then petrol, fares and food', () => {
    // With no subsidy, the pump price is free to follow the cost of landing fuel.
    const free = () => {
      const g = testGame();
      g.fed.style = 'indifferent';
      g.fed.policy.subsidy = false;
      return g;
    };
    const calm = playWeeks(free(), 6);
    const war = free();
    startShock(war, 'mideast-war', 12);
    const hit = playWeeks(war, 6);
    const a = snap(calm);
    const b = snap(hit);
    expect(b.oil).toBeGreaterThan(a.oil * 1.25);
    expect(b.petrol).toBeGreaterThan(a.petrol * 1.08);
    expect(b.fare).toBeGreaterThan(a.fare * 1.03);
    expect(b.food).toBeGreaterThan(a.food * 1.005);
    expect(b.cpi).toBeGreaterThan(a.cpi);
    expect(hit.news.some((n) => /Middle East|petrol/i.test(n.text))).toBe(true);
  }, 60_000);

  it('floods make food dearer, and it passes', () => {
    const calm = playWeeks(testGame(), 4);
    const wet = testGame();
    startShock(wet, 'floods', 3);
    const hit = playWeeks(wet, 2);
    expect(hit.prices.KN.food).toBeGreaterThan(playWeeks(testGame(), 2).prices.KN.food * 1.1);
    const after = playWeeks(hit, 2);
    expect(activeShocks(after).some((s) => s.shock.id === 'floods')).toBe(false);
    expect(after.prices.KN.food).toBeLessThan(calm.prices.KN.food * 1.06);
    expect(after.news.some((n) => /recede/i.test(n.text))).toBe(true);
  }, 60_000);

  it('with a subsidy the pump price holds in a war, and the federation pays for it', () => {
    const held = (war: boolean) => {
      const g = testGame();
      g.fed.style = 'indifferent';
      g.fed.policy.subsidy = true;
      if (war) startShock(g, 'mideast-war', 12);
      let bill = 0;
      playWeeks(g, 4, (w) => (bill = Math.max(bill, w.macro.subsidyBill, w.fed.ledger.subsidy)));
      return bill;
    };
    expect(held(true)).toBeGreaterThan(held(false) * 1.15);
  }, 60_000);

  it('things happen over the years, never more than two at once', () => {
    let seen = 0;
    let most = 0;
    playWeeks(testGame(), 60, (g) => {
      most = Math.max(most, activeShocks(g).length);
      if (activeShocks(g).length) seen++;
    });
    expect(most).toBeLessThanOrEqual(2);
    expect(seen).toBeGreaterThan(0);
  }, 120_000);
});
