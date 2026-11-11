import { describe, expect, it } from 'vitest';
import { testGame } from './autoplay';
import { actionsAt } from './life';
import { doAction, goTo } from './sim';

describe('being broke away from home', () => {
  it('never strands you: you can trek home, and work your way back', () => {
    // Home is Ikeja; you are at the Oshodi bus stop with a debt and no fare.
    let g = testGame();
    g.player.at = 'OSH';
    g.player.money = -23_000;
    g.minute = 9 * 60;
    g = goTo(g, 'busstop', null);
    const trips = actionsAt(g, 'busstop');
    const danfo = trips.find((a) => a.id === 'travel:IKJ')!;
    expect(danfo.blocked).toBeTruthy();
    const trek = trips.find((a) => a.id === 'travel:IKJ:trek')!;
    expect(trek).toBeTruthy();
    expect(trek.blocked ?? null).toBeNull();
    expect(trek.cost ?? 0).toBe(0);
    const r = doAction(g, 'travel:IKJ:trek');
    expect(r.ok).toBe(true);
    expect(r.game.player.at).toBe('IKJ');
    expect(r.game.player.money).toBe(-23_000);
    expect(r.game.player.energy).toBeLessThan(g.player.energy);

    // Odd jobs at the market are open to someone with nothing.
    const m = goTo(g, 'market', null);
    const odd = actionsAt(m, 'market').find((a) => a.id === 'oddjobs')!;
    expect(odd.blocked ?? null).toBeNull();
    const w = doAction(m, 'oddjobs');
    expect(w.ok).toBe(true);
    expect(w.game.player.money).toBeGreaterThan(-23_000);
  });

  it('with money for the fare, nobody is offered the trek', () => {
    let g = testGame();
    g.player.at = 'OSH';
    g.player.money = 50_000;
    g = goTo(g, 'busstop', null);
    expect(actionsAt(g, 'busstop').some((a) => a.id.endsWith(':trek'))).toBe(false);
  });
});
