import { describe, expect, it } from 'vitest';
import { LGAS } from '../data/world';
import { playWeeks, testGame } from './autoplay';
import { freeLots, hire, openBusiness, weeklyPnL } from './business';
import { actionsAt, hasPerk } from './life';
import { hood } from './map';
import { advanceClock, doAction, goTo } from './sim';
import { PLAYER, type Game } from './types';

const street = (g: Game, lga: string) => freeLots(g, lga).find((id) => hood(lga).plots[id].kind === 'street')!;

describe('a town with its own lives', () => {
  it('starts with other people’s businesses open, staffed and named, and plots left for you', () => {
    const g = testGame(21, 'OSH');
    for (const l of LGAS) {
      const theirs = g.businesses.filter((b) => b.lga === l.id && b.owner !== PLAYER);
      expect(theirs.length, l.id).toBeGreaterThanOrEqual(1);
      expect(freeLots(g, l.id).filter((id) => hood(l.id).plots[id].kind === 'street').length, l.id).toBeGreaterThanOrEqual(4);
    }
    const staffed = g.businesses.filter((b) => b.owner !== PLAYER && b.staff.length > 0);
    expect(staffed.length).toBeGreaterThan(10);
    expect(g.businesses.find((b) => b.owner !== PLAYER)!.name).not.toMatch(/^Ada/);
  });

  it('over a few months, people open, grow and close businesses, and the paper reports it', () => {
    const g0 = testGame(22, 'IKJ');
    const before = new Set(g0.businesses.map((b) => b.id));
    const g = playWeeks(g0, 16);
    const opened = g.businesses.filter((b) => !before.has(b.id) && b.owner !== PLAYER);
    expect(opened.length).toBeGreaterThan(3);
    expect(g.news.some((n) => n.kind === 'business' && /opens/.test(n.text))).toBe(true);
    // Their owners' cash moves with trade.
    const owners = g.businesses.filter((b) => b.owner !== PLAYER).map((b) => g.people[b.owner]);
    expect(owners.some((o) => o.money !== g0.people[o.id]?.money)).toBe(true);
  }, 120_000);

  it('a rival of the same kind on your streets takes some of your custom', () => {
    const g = testGame(23, 'IKJ', { kind: 'business', type: 'buka' });
    g.businesses = g.businesses.filter((b) => b.owner === PLAYER || b.type !== 'buka');
    const mine = g.businesses[0];
    hire(g, mine);
    const alone = weeklyPnL(g, mine, 0).revenue;
    const rival = openBusiness(g, 'buka', 'IKJ', false, street(g, 'IKJ'), g.people.find((x) => x.role === 'neighbour' && x.lga === 'IKJ')!.id, 'Mama Funmi Kitchen');
    rival.level = 3;
    expect(weeklyPnL(g, mine, 0).revenue).toBeLessThan(alone * 0.95);
  });

  it('you can buy a neighbour out: they get paid and the staff stay on', () => {
    const g = testGame(24, 'OSH', { kind: 'job', trade: 'factory' });
    const theirs = g.businesses.find((b) => b.owner !== PLAYER && b.lga === 'OSH')!;
    g.player.money = 500_000_000;
    const owner = g.people[theirs.owner];
    const at = goTo(g, 'lot', theirs.plot);
    const offer = actionsAt(at, 'lot').find((a) => a.id === `offer:${theirs.id}`)!;
    expect(offer.blocked).toBeNull();
    const bought = doAction(at, offer.id);
    expect(bought.ok).toBe(true);
    const mine = bought.game.businesses.find((b) => b.id === theirs.id)!;
    expect(mine.owner).toBe(PLAYER);
    expect(mine.staff).toEqual(theirs.staff);
    expect(bought.game.people[owner.id].money).toBeGreaterThan(owner.money);
  });
});

describe('a job comes with perks; a business does not', () => {
  it('a factory job has HMO, so the clinic is free; a business owner pays', () => {
    const worker = advanceClock(testGame(31, 'IKJ', { kind: 'job', trade: 'factory' }), 4 * 60).game;
    const owner = advanceClock(testGame(31, 'IKJ', { kind: 'business', type: 'stall' }), 4 * 60).game;
    const clinic = (g: Game) => actionsAt(goTo(g, 'clinic'), 'clinic').find((a) => a.id === 'clinic')!;
    expect(hasPerk(worker, 'hmo')).toBe(true);
    expect(clinic(worker).cost).toBe(0);
    expect(hasPerk(owner, 'hmo')).toBe(false);
    expect(clinic(owner).cost).toBeGreaterThan(0);
  });

  it('a teacher’s HMO lapses when the state owes salaries', () => {
    const g = testGame(32, 'IKJ', { kind: 'job', trade: 'factory' });
    g.player.trade = 'teacher';
    expect(hasPerk(g, 'hmo')).toBe(true);
    g.states.LA.arrears = 2;
    expect(hasPerk(g, 'hmo')).toBe(false);
  });

  it('salaried work builds a pension; running a stall does not', () => {
    const job = playWeeks(testGame(33, 'IKJ', { kind: 'job', trade: 'factory' }), 5);
    const stall = playWeeks(testGame(33, 'IKJ', { kind: 'business', type: 'stall' }), 5);
    expect(job.player.pension).toBeGreaterThan(0);
    expect(stall.player.pension).toBe(0);
  }, 60_000);
});

describe('things to do and a paper to read', () => {
  it('schedules events, lets you go, and prints the results', () => {
    let g = testGame(41, 'IKJ');
    for (let i = 0; i < 6 && !g.culture.some((e) => e.week === g.week); i++) g = playWeeks(g, 1);
    const e = g.culture.find((x) => x.week === g.week && x.lga !== '*') ?? g.culture.find((x) => x.week === g.week)!;
    expect(e).toBeDefined();
    // Jump to the event and go.
    g = structuredClone(g);
    g.player.at = e.lga === '*' ? g.player.at : e.lga;
    g.day = e.day;
    g.minute = e.start;
    g.player.money = 1_000_000;
    const mood = g.player.happiness;
    const r = doAction(goTo(g, e.place), `attend:${e.id}`);
    expect(r.ok).toBe(true);
    expect(r.game.player.happiness).toBeGreaterThan(mood);
    expect(r.game.culture.find((x) => x.id === e.id)!.attended).toBe(true);
  });

  it('the weekly front page leads with the biggest stories', () => {
    const g = playWeeks(testGame(42, 'OSH'), 3, () => {});
    const last = g.news.filter((n) => n.week === g.week - 1);
    expect(last.length).toBeGreaterThan(0);
    const reports: number[][] = [];
    playWeeks(testGame(42, 'OSH'), 3, (w) => {
      if (w.report) reports.push(w.report.headlines.map((h) => h.weight ?? 1));
    });
    for (const ws of reports) for (let i = 1; i < ws.length; i++) expect(ws[i]).toBeLessThanOrEqual(ws[i - 1]);
  }, 60_000);
});

