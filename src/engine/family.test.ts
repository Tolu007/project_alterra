import { describe, expect, it } from 'vitest';
import { testGame } from './autoplay';
import { FURNISHINGS, court, datingOf, familyWeek, furnishingPrice, kidsOf, owns, spouseOf, weddingCost } from './family';
import { actionsAt } from './life';
import { doAction, goTo } from './sim';

describe('a life beyond work', () => {
  it('you furnish your home, and it lifts your mood every week', () => {
    let g = goTo(testGame(), 'home', null);
    g.player.money = 2_000_000;
    const bed = FURNISHINGS.find((f) => f.id === 'bed')!;
    const price = furnishingPrice(g, bed);
    expect(actionsAt(g, 'home').some((a) => a.id === 'buy:bed' && a.cost === price)).toBe(true);
    const r = doAction(g, 'buy:bed');
    expect(r.ok).toBe(true);
    g = r.game;
    expect(owns(g, 'bed')).toBe(true);
    expect(g.player.money).toBe(2_000_000 - price);
    expect(actionsAt(g, 'home').some((a) => a.id === 'buy:bed')).toBe(false);
    g.player.happiness = 50;
    g.player.health = 50;
    familyWeek(g);
    expect(g.player.happiness).toBeGreaterThan(50);
    expect(g.player.health).toBeGreaterThan(50);
  });

  it('you court someone you get on with, marry, and share a household', () => {
    const g = testGame();
    const who = g.people.find((x) => x.id !== g.me && x.role === 'neighbour' && x.age >= 21)!;
    who.relation = 20;
    expect(court(g, who.id, 'ask').ok).toBe(false);
    who.relation = 60;
    expect(court(g, who.id, 'propose').ok).toBe(false);
    expect(court(g, who.id, 'ask').ok).toBe(true);
    expect(datingOf(g)?.id).toBe(who.id);
    who.relation = 90;
    g.player.money = 1000;
    expect(court(g, who.id, 'propose').ok).toBe(false);
    g.player.money = weddingCost(g) + 5000;
    expect(court(g, who.id, 'propose').ok).toBe(true);
    expect(spouseOf(g)?.id).toBe(who.id);
    expect(g.player.money).toBe(5000);
    expect(who.role).toBe('family');
    // Married people cannot court anyone else.
    const other = g.people.find((x) => x.id !== g.me && x.id !== who.id && x.role === 'neighbour' && x.age >= 21)!;
    other.relation = 90;
    expect(court(g, other.id, 'ask').ok).toBe(false);
    const before = g.player.money;
    familyWeek(g);
    expect(g.player.week.some((l) => /contribution/.test(l.label))).toBe(true);
    expect(g.player.money).toBeGreaterThan(before);
  });

  it('children come in time and cost money; birthdays come every 48 weeks', () => {
    const g = testGame();
    const who = g.people.find((x) => x.id !== g.me && x.role === 'neighbour' && x.age >= 21)!;
    who.relation = 95;
    court(g, who.id, 'ask');
    g.player.money = weddingCost(g);
    court(g, who.id, 'propose');
    const age = g.people[g.me].age;
    let news: string[] = [];
    for (let w = 1; w <= 200 && kidsOf(g) === 0; w++) {
      g.week = w;
      g.player.week = [];
      news = news.concat(familyWeek(g));
    }
    expect(kidsOf(g)).toBe(1);
    expect(news.some((n) => /baby/i.test(n))).toBe(true);
    g.week = 96;
    familyWeek(g);
    expect(g.people[g.me].age).toBeGreaterThan(age);
    g.player.week = [];
    familyWeek(g);
    expect(g.player.week.some((l) => /Child/.test(l.label) && l.amount < 0)).toBe(true);
  });
});
