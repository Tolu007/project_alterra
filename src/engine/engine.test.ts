import { describe, expect, it } from 'vitest';
import { LGAS, STATES } from '../data/world';
import { playWeeks, testGame } from './autoplay';
import { tradeIncome } from './economy';
import { EVENTS } from './events';
import { actionsAt, placesIn } from './life';
import { advanceClock, doAction, eventChoices, goTo } from './sim';
import type { Game } from './types';

const atWork = (g: Game) => goTo(g, 'lot', g.businesses[0].plot);

const sane = (g: Game) => {
  const m = g.macro;
  for (const v of [m.fxParallel, m.fxOfficial, m.priceLevel, m.inflation, m.reserves, m.oilOutput, g.player.money]) expect(Number.isFinite(v)).toBe(true);
  expect(m.fxParallel).toBeGreaterThan(300);
  expect(m.fxParallel).toBeLessThan(50_000);
  expect(m.inflation).toBeGreaterThan(-0.3);
  expect(m.inflation).toBeLessThan(4);
  for (const s of STATES) {
    const pr = g.prices[s.id];
    for (const v of [pr.petrol, pr.food, pr.rice, pr.energy, pr.grid, pr.cpi]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
    for (const v of Object.values(g.stateInfra[s.id])) expect(v).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(g.states[s.id].treasury)).toBe(true);
  }
  for (const l of LGAS) {
    expect(g.fares[l.id]).toBeGreaterThan(0);
    for (const c of Object.values(g.cohorts[l.id])) {
      expect(Number.isFinite(c.income)).toBe(true);
      for (const v of Object.values(c.sat)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  }
};

describe('a new life', () => {
  it('starts with 2026-ish prices', () => {
    const g = testGame();
    sane(g);
    expect(g.prices.LA.petrol).toBeGreaterThan(850);
    expect(g.prices.LA.petrol).toBeLessThan(1050);
    expect(g.prices.LA.rice).toBeGreaterThan(70_000);
    expect(g.prices.LA.rice).toBeLessThan(100_000);
    expect(g.fares.IKJ).toBeGreaterThan(550);
    expect(g.fares.IKJ).toBeLessThan(900);
    expect(g.prices.LA.grid).toBeGreaterThan(6);
    expect(g.prices.LA.grid).toBeLessThan(11);
    expect(g.macro.inflation).toBeCloseTo(0.18, 2);
  });

  it('pays a trader a believable weekly income', () => {
    const g = testGame();
    const w = tradeIncome(g, 'IKJ', 'trader').income;
    expect(w).toBeGreaterThan(30_000);
    expect(w).toBeLessThan(120_000);
  });

  it('has every place offer at least one thing to do', () => {
    const g = testGame();
    for (const place of placesIn('IKJ')) expect(actionsAt(goTo(g, place), place).length).toBeGreaterThan(0);
  });
});

describe('days and weeks', () => {
  it('a shift at your stall earns money and takes four hours; six days make a week', () => {
    let g = atWork(testGame());
    const money = g.player.money;
    const r = doAction(g, 'bw:0');
    expect(r.ok).toBe(true);
    expect(r.game.player.money).toBeGreaterThan(money - 3_000);
    expect(r.game.player.energy).toBeLessThan(g.player.energy);
    expect(r.game.player.hunger).toBeLessThan(g.player.hunger);
    expect(r.game.minute).toBe(g.minute + 240);
    g = doAction(goTo(r.game, 'home'), 'sleep').game;
    expect(g.day).toBe(1);
    expect(g.minute).toBe(6 * 60);
    for (let i = 0; i < 5; i++) g = doAction(goTo(g, 'home'), 'sleep').game;
    expect(g.phase).toBe('week');
    expect(g.report?.lines.length).toBeGreaterThan(0);
  });

  it('keeps opening hours while the clock runs, and past 2am you pass out', () => {
    let g = testGame();
    expect(actionsAt(goTo(g, 'bank'), 'bank').every((a) => a.blocked)).toBe(true);
    g = advanceClock(g, 22 * 60 - g.minute).game;
    expect(g.minute).toBe(22 * 60);
    expect(g.player.hunger).toBeLessThan(testGame().player.hunger);
    expect(actionsAt(goTo(g, 'market'), 'market').every((a) => a.blocked)).toBe(true);
    expect(actionsAt(goTo(g, 'joint'), 'joint').some((a) => !a.blocked)).toBe(true);
    const late = advanceClock(g, 5 * 60);
    expect(late.text).toMatch(/passed out/);
    expect(late.game.day).toBe(1);
    expect(late.game.minute).toBe(9 * 60);
  });

  it('an early night gives more energy back than a late one', () => {
    const tired = (m: number) => {
      const g = advanceClock(testGame(), m - 6 * 60).game;
      g.player.energy = 20;
      return doAction(goTo(g, 'home'), 'sleep').game;
    };
    const early = tired(21 * 60);
    const late = tired(25 * 60);
    expect(early.player.energy).toBeGreaterThan(late.player.energy + 20);
    expect(late.minute).toBe(7 * 60);
  });

  it('a shift stops when the place closes', () => {
    const g = advanceClock(atWork(testGame()), 19 * 60 - 6 * 60).game;
    const shift = actionsAt(g, 'lot').find((a) => a.id === 'bw:0')!;
    expect(shift.minutes).toBe(120);
  });

  it('never mutates the game it was given', () => {
    const g = atWork(testGame());
    const before = JSON.stringify(g);
    doAction(g, 'bw:0');
    expect(JSON.stringify(g)).toBe(before);
  });

  it('replays identically from the same seed', () => {
    const a = playWeeks(testGame(3), 12);
    const b = playWeeks(testGame(3), 12);
    expect(a.macro.fxParallel).toBe(b.macro.fxParallel);
    expect(a.player.money).toBe(b.player.money);
  }, 60_000);
});

describe('events', () => {
  it('every event has a free choice and building choices has no side effects', () => {
    const g = playWeeks(testGame(11), 2);
    for (const def of EVENTS) {
      const probe: Game = { ...structuredClone(g), phase: 'event', currentEvent: { id: def.id, person: g.people.length - 1, amount: 50_000, trade: 'office' } };
      probe.player.money = 0;
      probe.player.office = 'IKJ';
      const before = JSON.stringify(probe);
      const choices = eventChoices(probe);
      expect(JSON.stringify(probe)).toBe(before);
      expect(choices.length).toBeGreaterThanOrEqual(2);
      expect(choices.some((c) => !c.blocked)).toBe(true);
    }
  });
});

describe('a year of routine', () => {
  it('stays sane and holds elections at every level', () => {
    const g = playWeeks(testGame(5), 48);
    sane(g);
    const offices = new Set(g.elections.map((e) => e.office));
    expect(offices.has('FED')).toBe(true);
    expect(offices.has('LA')).toBe(true);
    expect(offices.has('IKJ')).toBe(true);
    expect(g.series.length).toBeGreaterThan(40);
  }, 120_000);
});
