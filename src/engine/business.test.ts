import { describe, expect, it } from 'vitest';
import { START } from './setup';
import { testGame } from './autoplay';
import { demandFor, freeLots, hire, openBusiness, playerBusinesses, settleBusinesses, settleDay, staffCap, weeklyPnL } from './business';
import { hood } from './map';
import type { Game } from './types';
import { doAction, goTo } from './sim';

const street = (g: Game, lga: string) => freeLots(g, lga).find((id) => hood(lga).plots[id].kind === 'street')!;

describe('equal starts', () => {
  it('everyone begins with the same cash and skills; a stall costs its capital', () => {
    const job = testGame(1, 'OSH', { kind: 'job', trade: 'factory' });
    const stall = testGame(1, 'OSH', { kind: 'business', type: 'stall' });
    const keke = testGame(1, 'OSH', { kind: 'business', type: 'keke' });
    expect(job.player.skills).toEqual(START.skills);
    expect(stall.player.skills).toEqual(START.skills);
    expect(job.player.money).toBe(START.money);
    expect(stall.player.money).toBe(START.money - 150_000);
    expect(keke.player.money).toBe(START.money);
    expect(keke.businesses[0].financeWeeks).toBe(40);
    expect(playerBusinesses(job)).toHaveLength(0);
  });
});

describe('businesses', () => {
  it('staff add takings at a starter business', () => {
    const g = testGame(2, 'OSH');
    const b = g.businesses[0];
    const alone = weeklyPnL(g, b).revenue;
    hire(g, b);
    expect(weeklyPnL(g, b).revenue).toBeGreaterThan(alone);
    expect(g.people[b.staff[0]].employer).toBe(b.id);
  });

  it('a higher minimum wage raises the wage bill of a formal business, not of a street stall', () => {
    const g = testGame(3, 'IKJ');
    for (const k of Object.keys(g.player.skills) as (keyof typeof g.player.skills)[]) g.player.skills[k] = 5;
    const stall = g.businesses[0];
    hire(g, stall);
    const stallWages = weeklyPnL(g, stall).wages;
    const b = openBusiness(g, 'supermarket', 'IKJ', false, street(g, 'IKJ'));
    hire(g, b);
    const before = weeklyPnL(g, b).wages;
    g.fed.policy.minWage = 150_000;
    expect(weeklyPnL(g, b).wages).toBeGreaterThan(before * 2);
    expect(weeklyPnL(g, stall).wages).toBeCloseTo(stallWages, 0);
  });

  it('owning the wholesaler makes your supermarket cheaper to stock and the wholesaler busier', () => {
    const g = testGame(4, 'IKJ');
    g.player.skills.biz = 3;
    const shop = openBusiness(g, 'supermarket', 'IKJ', false, street(g, 'IKJ'));
    hire(g, shop);
    const plainInputs = weeklyPnL(g, shop).inputs;
    const wholesale = openBusiness(g, 'wholesale', 'OSH', false, street(g, 'OSH'));
    const plainDemand = demandFor(g, wholesale);
    const shop2 = openBusiness(g, 'buka', 'OSH', false, street(g, 'OSH'));
    expect(weeklyPnL(g, shop).inputs).toBeLessThan(plainInputs);
    expect(demandFor(g, wholesale)).toBeGreaterThan(plainDemand * 0.99);
    expect(shop2.id).toBeGreaterThan(wholesale.id);
  });

  it('solar installers get busier when the grid gets worse', () => {
    const g = testGame(5, 'LMA');
    g.player.skills.tech = 3;
    const solar = openBusiness(g, 'solar', 'LMA', false, street(g, 'LMA'));
    const good = demandFor(g, solar);
    g.prices.LA.grid = 3;
    expect(demandFor(g, solar)).toBeGreaterThan(good);
  });

  it('closing the week records what the nights paid and grows influence with staff', () => {
    const g = testGame(6, 'OSH');
    const b = g.businesses[0];
    for (let i = 0; i < 2; i++) hire(g, b);
    const influence = g.player.influence.OSH;
    let paid = 0;
    for (let d = 0; d < 6; d++) paid += settleDay(g).reduce((s, l) => s + l.amount, 0);
    const lines = settleBusinesses(g);
    expect(lines.length).toBe(1);
    expect(lines[0].amount).toBeCloseTo(paid, 0);
    expect(b.lastProfit).toBeCloseTo(paid, 0);
    expect(b.week.profit).toBe(0);
    expect(g.player.influence.OSH).toBeGreaterThan(influence);
  });

  it('staff earn for you every night even if you never go to work', () => {
    const g = testGame(8, 'OSH', { kind: 'business', type: 'stall' });
    hire(g, g.businesses[0]);
    const before = g.player.money;
    // Sleep through the first night only: the stall's takings land overnight.
    const night = doAction(goTo(g, 'home'), 'sleep');
    expect(night.text).toMatch(/Your businesses made/);
    expect(night.game.player.money).toBeGreaterThan(before);
    // A whole week asleep still leaves the stall in profit after the worker's pay.
    let w = g;
    for (let i = 0; i < 6; i++) w = doAction(goTo(w, 'home'), 'sleep').game;
    const b = w.businesses[0];
    expect(b.lastProfit).toBeGreaterThan(0);
    expect(b.last.find((l) => l.label.startsWith('Staff wages'))!.amount).toBeLessThan(0);
  });

  it('every kind of worker covers their own wage, and a fully staffed shop covers its running costs, with the boss away', () => {
    for (const [type, lga] of [['buka', 'OSH'], ['pos', 'OSH'], ['workshop', 'OSH'], ['stall', 'OSH'], ['farm', 'KUR']] as const) {
      const g = testGame(9, lga, { kind: 'business', type });
      const b = g.businesses[0];
      const alone = weeklyPnL(g, b, 0).profit;
      hire(g, b);
      expect(weeklyPnL(g, b, 0).profit - alone, type).toBeGreaterThan(0);
    }
    for (const type of ['supermarket', 'restaurant', 'wholesale', 'pharmacy'] as const) {
      const g = testGame(9, 'IKJ');
      for (const k of Object.keys(g.player.skills) as (keyof typeof g.player.skills)[]) g.player.skills[k] = 5;
      const b = openBusiness(g, type, 'IKJ', false, street(g, 'IKJ'));
      const empty = weeklyPnL(g, b, 0);
      // An empty shop still pays rent, power and upkeep.
      expect(empty.profit, type).toBeLessThan(0);
      expect(empty.premises + empty.power + empty.upkeep).toBeGreaterThan(0);
      while (b.staff.length < staffCap(b)) hire(g, b);
      expect(weeklyPnL(g, b, 0).profit, type).toBeGreaterThan(0);
    }
  });

  it('can lease a free plot, open a business on it and hire into it', () => {
    const g0 = testGame(7, 'OSH', { kind: 'job', trade: 'factory' });
    let g = goTo(g0, 'lot', street(g0, 'OSH'));
    expect(doAction(goTo(g0, 'market'), 'open:buka').ok).toBe(false);
    const r = doAction(g, 'open:buka');
    expect(r.ok).toBe(true);
    g = r.game;
    expect(playerBusinesses(g).find((b) => b.type === 'buka')?.plot).toBe(g.lot);
    expect(doAction(g, 'open:stall').ok).toBe(false);
    const id = playerBusinesses(g).find((b) => b.type === 'buka')!.id;
    const h = doAction(g, `hire:${id}`);
    expect(h.ok).toBe(true);
    expect(h.game.businesses.find((b) => b.id === id)!.staff).toHaveLength(1);
  });
});
