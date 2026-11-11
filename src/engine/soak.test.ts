// Policy → outcome checks and a long soak. `npm run soak` prints yearly tables.
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from './government';
import { playWeeks, testGame } from './autoplay';
import { tradeIncome } from './economy';
import type { Game } from './types';

/** Two copies of the same world, one with a policy changed, played forward the same number of weeks. */
function ab(setup: (g: Game, variant: 'A' | 'B') => void, weeks: number, seed = 21) {
  const base = playWeeks(testGame(seed), 2);
  const a = structuredClone(base);
  const b = structuredClone(base);
  setup(a, 'A');
  setup(b, 'B');
  return [playWeeks(a, weeks), playWeeks(b, weeks)] as const;
}

describe('policies move the economy the way they should', () => {
  it('a fuel subsidy lowers the pump price and costs the federation', () => {
    const [a, b] = ab((g, v) => {
      g.fed.style = 'indifferent';
      g.fed.policy.subsidy = v === 'A';
    }, 8);
    // The official pump price: in a week of fuel queues the black market charges more than that.
    expect(a.prices.LA.petrol / (a.prices.LA.scarcity ? 1.4 : 1)).toBeLessThan(b.prices.LA.petrol * 0.85);
    expect(a.fed.ledger.subsidy).toBeGreaterThan(100);
    expect(b.fed.ledger.subsidy).toBe(0);
  }, 180_000);

  it('a peg opens a black-market gap and burns reserves', () => {
    const [a, b] = ab((g, v) => {
      g.fed.style = 'indifferent';
      g.fed.policy.fx = v === 'A' ? 'peg' : 'float';
      g.macro.peg = Math.round(g.macro.fxParallel * 0.85);
    }, 24);
    expect(a.macro.fxParallel / a.macro.fxOfficial).toBeGreaterThan(1.1);
    expect(a.macro.reserves).toBeLessThan(b.macro.reserves);
  }, 180_000);

  it('printing money raises prices', () => {
    const [a, b] = ab((g, v) => {
      g.fed.style = 'indifferent';
      g.fed.policy.print = v === 'A' ? 800 : 0;
    }, 24);
    expect(a.macro.priceLevel).toBeGreaterThan(b.macro.priceLevel * 1.02);
  }, 180_000);

  it('an okada ban hurts riders and raises fares', () => {
    const [a, b] = ab((g, v) => {
      g.states.LA.style = 'indifferent';
      g.states.LA.policy.okada = v === 'A' ? 'full' : 'none';
    }, 4);
    expect(tradeIncome(a, 'OSH', 'okada').income).toBeLessThan(tradeIncome(b, 'OSH', 'okada').income * 0.6);
    expect(a.fares.IKJ).toBeGreaterThan(b.fares.IKJ);
  }, 180_000);

  it('higher market levies squeeze traders and fill council coffers', () => {
    const [a, b] = ab((g, v) => {
      g.lgas.IKJ.style = 'indifferent';
      g.lgas.IKJ.policy.levy = v === 'A' ? 0.08 : 0.02;
    }, 8);
    expect(tradeIncome(a, 'IKJ', 'trader').income).toBeLessThan(tradeIncome(b, 'IKJ', 'trader').income);
    expect(a.lgas.IKJ.ledger.revenue).toBeGreaterThan(b.lgas.IKJ.ledger.revenue);
  }, 180_000);

  it('a reformer governor builds roads; a looter leaves arrears', () => {
    const [a, b] = ab((g, v) => {
      const style = v === 'A' ? 'reformer' : 'looter';
      g.states.LA.style = style;
      g.states.LA.budget = { ...TEMPLATES.state[style] };
      // Keep the same governor for the whole comparison.
      g.states.LA.terms = 2;
      g.flags.noLaElection = 1;
    }, 26);
    expect(a.stateInfra.LA.roads).toBeGreaterThan(b.stateInfra.LA.roads + 4);
    expect(b.states.LA.arrears).toBeGreaterThan(a.states.LA.arrears);
  }, 180_000);
});

describe('soak', () => {
  it('three years in four different worlds stay sane', () => {
    for (const seed of [2, 9, 17, 33]) {
      const rows: Record<string, string | number>[] = [];
      const g = playWeeks(testGame(seed, seed % 2 ? 'KMC' : 'IKJ'), 144, (w) => {
        if (w.week % 48 === 0 && w.week > 0) {
          rows.push({
            year: 2026 + w.week / 48,
            president: w.fed.style,
            lagos: w.states.LA.style,
            kano: w.states.KN.style,
            fx: Math.round(w.macro.fxParallel),
            infl: `${(w.macro.inflation * 100).toFixed(0)}%`,
            petrolLA: Math.round(w.prices.LA.petrol),
            riceLA: Math.round(w.prices.LA.rice / 1000) + 'k',
            gridLA: w.prices.LA.grid.toFixed(1),
            roadsLA: Math.round(w.stateInfra.LA.roads),
            roadsKN: Math.round(w.stateInfra.KN.roads),
            fedApp: Math.round(w.fed.approval),
            reserves: w.macro.reserves.toFixed(0),
            debtTn: (w.fed.debt / 1000).toFixed(0),
            money: Math.round(w.player.money / 1000) + 'k',
            traderOSH: `${Math.round(((w.cohorts.OSH.trader.income / w.prices.LA.cpi / w.cohorts.OSH.trader.base) - 1) * 100)}%`,
            parties: `${w.fed.party}/${w.states.LA.party}/${w.states.KN.party}/${w.states.RI.party}`,
          });
        }
      });
      console.log(`seed ${seed}`);
      console.table(rows);
      expect(g.macro.fxParallel).toBeLessThan(50_000);
      expect(Number.isFinite(g.macro.priceLevel)).toBe(true);
      expect(g.elections.length).toBeGreaterThan(40);
    }
  }, 600_000);
});
