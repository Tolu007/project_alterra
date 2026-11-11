import { describe, expect, it } from 'vitest';
import { bind, seatOf } from './seats';
import { answerOffer, endorse, leaderboard, makeOffer, repayDebt, sendChat, sendMoney, settleSocial, socialOf, socialView } from './social';
import { avatarLooks } from './testLooks';
import type { Game } from './types';
import { createSharedWorld, joinWorld } from './world';

const T0 = Date.UTC(2026, 10, 5, 8);
const ada = { name: 'Ada Eze', gender: 'f' as const, looks: avatarLooks, home: 'IKJ', start: { kind: 'business' as const, type: 'stall' as const } };
const tunde = { name: 'Tunde Bello', gender: 'm' as const, looks: avatarLooks, home: 'OSH', start: { kind: 'job' as const, trade: 'factory' as const } };
const kemi = { name: 'Kemi Ojo', gender: 'f' as const, looks: avatarLooks, home: 'IKJ', start: { kind: 'business' as const, type: 'pos' as const } };

function world(): { g: Game; a: number; b: number; c: number } {
  const g = createSharedWorld(5, T0, 12);
  return { g, a: joinWorld(g, ada, 'acct-a', T0), b: joinWorld(g, tunde, 'acct-b', T0), c: joinWorld(g, kemi, 'acct-c', T0) };
}
const money = (g: Game, id: number) => (g.me === id ? g.player : seatOf(g, id)!.player).money;

describe('players with each other', () => {
  it('street talk reaches the people on that street; private messages reach one person', () => {
    const { g, a, b, c } = world();
    bind(g, a);
    expect(sendChat(g, '  Who get change?  ', null, T0).ok).toBe(true);
    expect(sendChat(g, 'Tunde, how far?', b, T0).ok).toBe(true);
    expect(sendChat(g, '   ', null, T0).ok).toBe(false);
    // Kemi is in Ikeja with Ada; Tunde is in Oshodi.
    expect(socialView(g, c).chat.map((m) => m.text)).toEqual(['Who get change?']);
    expect(socialView(g, b).chat.map((m) => m.text)).toEqual(['Tunde, how far?']);
    expect(socialView(g, a).chat).toHaveLength(2);
    for (let i = 0; i < 8; i++) sendChat(g, `spam ${i}`, null, T0 + 100);
    expect(socialOf(g).chat.filter((m) => m.from === a).length).toBeLessThanOrEqual(5);
  });

  it('money moves between players, and only what you have', () => {
    const { g, a, b } = world();
    bind(g, a);
    const [ma, mb] = [money(g, a), money(g, b)];
    expect(sendMoney(g, b, 20_000, T0).ok).toBe(true);
    expect(money(g, a)).toBe(ma - 20_000);
    expect(money(g, b)).toBe(mb + 20_000);
    expect(sendMoney(g, b, ma * 10, T0).ok).toBe(false);
    expect(sendMoney(g, a, 500, T0).ok).toBe(false);
    expect(sendMoney(g, 3, 500, T0).ok).toBe(false);
    expect(sendMoney(g, b, -5, T0).ok).toBe(false);
    expect(socialView(g, b).chat.some((m) => /sent you/.test(m.text))).toBe(true);
  });

  it('a business is bought with an offer the owner accepts', () => {
    const { g, a, b } = world();
    const stall = g.businesses.find((x) => x.owner === a)!;
    bind(g, b);
    expect(makeOffer(g, a, { type: 'buy', business: stall.id, amount: 60_000 }, T0).ok).toBe(true);
    const [ma, mb] = [money(g, a), money(g, b)];
    // Only the owner can accept.
    expect(answerOffer(g, socialOf(g).offers[0].id, true, T0).ok).toBe(false);
    bind(g, a);
    expect(answerOffer(g, socialOf(g).offers[0].id, true, T0).ok).toBe(true);
    expect(stall.owner).toBe(b);
    expect(money(g, a)).toBe(ma + 60_000);
    expect(money(g, b)).toBe(mb - 60_000);
    expect(socialOf(g).offers).toHaveLength(0);
  });

  it('one player employs another and pays them every week', () => {
    const { g, a, b } = world();
    const stall = g.businesses.find((x) => x.owner === a)!;
    bind(g, a);
    expect(makeOffer(g, b, { type: 'job', business: stall.id, amount: 15_000 }, T0).ok).toBe(true);
    bind(g, b);
    expect(answerOffer(g, socialOf(g).offers[0].id, true, T0).ok).toBe(true);
    expect(stall.staff).toContain(b);
    const [ma, mb] = [money(g, a), money(g, b)];
    settleSocial(g, T0);
    expect(money(g, b)).toBe(mb + 15_000);
    expect(money(g, a)).toBe(ma - 15_000);
    // A boss who cannot pay loses the worker.
    seatOf(g, a)!.player.money = 10;
    settleSocial(g, T0);
    expect(stall.staff).not.toContain(b);
    expect(socialOf(g).jobs).toHaveLength(0);
  });

  it('a loan is repaid when it falls due, or early', () => {
    const { g, a, b } = world();
    bind(g, a);
    expect(makeOffer(g, b, { type: 'loan', amount: 50_000, repay: 60_000, weeks: 2 }, T0).ok).toBe(true);
    expect(makeOffer(g, b, { type: 'loan', amount: 50_000, repay: 900_000, weeks: 2 }, T0).ok).toBe(false);
    bind(g, b);
    const before = money(g, b);
    answerOffer(g, socialOf(g).offers[0].id, true, T0);
    expect(money(g, b)).toBe(before + 50_000);
    expect(repayDebt(g, a, 10_000, T0).ok).toBe(true);
    settleSocial(g, T0);
    expect(socialOf(g).debts[0].owed).toBe(50_000);
    g.week += 2;
    settleSocial(g, T0);
    expect(socialOf(g).debts).toHaveLength(0);
    expect(money(g, b)).toBe(before - 10_000);
  });

  it('an endorsement lifts a campaign, once', () => {
    const { g, a, b } = world();
    seatOf(g, b)!.player.campaign = { office: 'LA', stage: 'aspirant', spent: 0, push: {} };
    bind(g, a);
    expect(endorse(g, b, T0).ok).toBe(true);
    expect(seatOf(g, b)!.player.campaign!.push.IKJ).toBeGreaterThan(0);
    expect(endorse(g, b, T0).ok).toBe(false);
    expect(socialView(g, b).chat.some((m) => /endorses Tunde Bello/.test(m.text))).toBe(true);
  });

  it('ranks everyone by what they are worth and leaves the bound player bound', () => {
    const { g, a, b } = world();
    bind(g, a);
    seatOf(g, b)!.player.money = 90_000_000;
    const rows = leaderboard(g);
    expect(rows[0].id).toBe(b);
    expect(rows).toHaveLength(3);
    expect(g.me).toBe(a);
  });
});
