import { describe, expect, it } from 'vitest';
import { actionsAt } from './life';
import { absNow, bind, packGame, seatOf, unbind, unpackGame } from './seats';
import { holdElectionForTest } from './testHooks';
import { createSharedWorld, joinWorld, tickWorld } from './world';
import { applyAction, peek } from './sim';
import { avatarLooks } from './testLooks';
import type { Game } from './types';

const T0 = Date.UTC(2026, 10, 5, 8);
const MIN = 60_000;
const ada = { name: 'Ada Eze', gender: 'f' as const, looks: avatarLooks, home: 'IKJ', start: { kind: 'business' as const, type: 'stall' as const } };
const tunde = { name: 'Tunde Bello', gender: 'm' as const, looks: avatarLooks, home: 'OSH', start: { kind: 'job' as const, trade: 'factory' as const } };

/** A shared world with two players, both online at T0. */
function world(): { g: Game; a: number; b: number } {
  const g = createSharedWorld(5, T0, 12);
  const a = joinWorld(g, ada, 'acct-a', T0);
  const b = joinWorld(g, tunde, 'acct-b', T0);
  return { g, a, b };
}
const online = (g: Game, id: number, ms: number) => (seatOf(g, id)!.seenMs = ms);

describe('a shared world', () => {
  it('runs on a real-time clock that nobody controls', () => {
    const { g } = world();
    const start = absNow(g);
    tickWorld(g, T0 + 10 * MIN);
    expect(absNow(g) - start).toBe(120);
    // Asking again at the same moment does nothing.
    tickWorld(g, T0 + 10 * MIN);
    expect(absNow(g) - start).toBe(120);
  });

  it('gives each player their own character, place and money', () => {
    const { g, a, b } = world();
    bind(g, a);
    const adaMoney = g.player.money;
    expect(g.player.home).toBe('IKJ');
    bind(g, b);
    expect(g.player.home).toBe('OSH');
    expect(g.player.money).not.toBe(adaMoney);
    expect(g.humans).toEqual([a, b]);
    expect(g.businesses.find((x) => x.owner === a)?.type).toBe('stall');
    expect(g.businesses.some((x) => x.owner === b)).toBe(false);
  });

  it('an action makes you busy until it is done, instead of skipping time for everyone', () => {
    const { g, a, b } = world();
    bind(g, a);
    const biz = g.businesses.find((x) => x.owner === a)!;
    g.place = 'lot';
    g.lot = biz.plot;
    const before = absNow(g);
    const money = g.player.money;
    applyAction(g, `bw:${biz.id}`);
    expect(absNow(g)).toBe(before);
    expect(g.busyUntil).toBe(before + 240);
    expect(g.player.money).toBeGreaterThan(money);
    expect(actionsAt(peek(g, 'lot', biz.plot), 'lot').every((x) => x.blocked?.startsWith('Busy'))).toBe(true);
    // The other player is free.
    bind(g, b);
    expect(actionsAt(peek(g, 'home'), 'home').some((x) => !x.blocked)).toBe(true);
    // Twenty real minutes later the shift is over.
    online(g, a, T0 + 20 * MIN);
    online(g, b, T0 + 20 * MIN);
    tickWorld(g, T0 + 20 * MIN);
    bind(g, a);
    expect(g.busyUntil).toBeLessThanOrEqual(absNow(g));
  });

  it('players who are away live on autopilot: they work, eat, sleep and get paid', () => {
    const { g, a, b } = world();
    unbind(g);
    // Nobody visits for two game days (four real hours).
    tickWorld(g, T0 + 4 * 60 * MIN);
    bind(g, a);
    expect(g.day).toBeGreaterThanOrEqual(1);
    expect(g.player.week.some((l) => l.label === 'Work')).toBe(true);
    expect(g.player.hunger).toBeGreaterThan(10);
    bind(g, b);
    expect(g.player.worked).toBeGreaterThan(0);
  });

  it('after Saturday everyone gets their own paper, and the world goes straight on', () => {
    const { g, a, b } = world();
    unbind(g);
    // Six game days at 12× is 12 real hours; somebody looks in every hour.
    for (let h = 1; h <= 13; h++) tickWorld(g, T0 + h * 60 * MIN);
    expect(g.week).toBe(1);
    for (const id of [a, b]) {
      const s = seatOf(g, id)!;
      // They were away, so autopilot filed it; the paper is still there to read.
      expect(s.player.paper?.week).toBe(0);
      expect(s.player.paper?.headlines.length).toBeGreaterThan(0);
      expect(s.phase).toBe('day');
    }
  });

  it('packs and unpacks without mixing players up', () => {
    const { g, a, b } = world();
    bind(g, a);
    g.player.money = 123;
    const json = packGame(g);
    const back = unpackGame(json, b);
    expect(back.player.home).toBe('OSH');
    bind(back, a);
    expect(back.player.money).toBe(123);
  });

  it('two players can run for office against each other', () => {
    const { g, a, b } = world();
    unbind(g);
    for (const [id, party] of [[a, 'JRP'], [b, 'SPM']] as const) {
      const p = seatOf(g, id)!.player;
      p.party = party;
      p.campaign = { office: 'LA', stage: 'nominee', spent: 0, push: {} };
      p.standing = 80;
      for (const k of Object.keys(p.influence)) p.influence[k] = 60;
    }
    const rec = holdElectionForTest(g, 'LA');
    expect(rec.humans?.sort()).toEqual([a, b].sort());
    expect([a, b]).toContain(rec.winner);
    const winner = seatOf(g, rec.winner)!.player;
    expect(winner.office).toBe('LA');
    expect(seatOf(g, a)!.player.campaign).toBeNull();
    expect(seatOf(g, b)!.player.campaign).toBeNull();
  });
});
