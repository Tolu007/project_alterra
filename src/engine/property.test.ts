import { describe, expect, it } from 'vitest';
import { testGame } from './autoplay';
import { actionsAt, netWorth } from './life';
import { freeLots } from './business';
import { hood } from './map';
import { builders, fillerKinds, holdings, propertyWeek, standing } from './property';
import { doAction, goTo } from './sim';
import { validPlace } from './world';

function rich(home = 'IKJ') {
  const g = testGame();
  void home;
  g.player.money = 5e9;
  g.minute = 10 * 60;
  return g;
}
const did = (g: ReturnType<typeof rich>, id: string) => {
  const r = doAction(g, id);
  expect(r.ok, id).toBe(true);
  r.game.minute = 10 * 60;
  return r.game;
};
const at = (g: ReturnType<typeof rich>, lot: number) => goTo(g, 'lot', lot);
const ids = (g: ReturnType<typeof rich>) => actionsAt(g, 'lot').map((a) => a.id);

describe('land and buildings', () => {
  it('any ordinary building can be bought, pulled down and rebuilt by a construction company', () => {
    let g = rich();
    const h = hood('IKJ');
    const house = h.fillers.find((id) => fillerKinds('IKJ').get(id) === 'house')!;
    expect(validPlace(g, 'lot', house)).toBe(true);
    g = at(g, house);
    expect(ids(g)).toEqual(['prop:buy']);
    const before = g.player.money;
    const price = standing(g, 'IKJ', house)!.value;
    g = did(g, 'prop:buy');
    expect(before - g.player.money).toBeGreaterThan(price);
    expect(standing(g, 'IKJ', house)!.owner).toBe(g.me);
    expect(holdings(g, g.me)).toHaveLength(1);
    expect(ids(g)).toContain('prop:demolish');
    g = did(g, 'prop:demolish');
    expect(standing(g, 'IKJ', house)!.on).toBe('empty');
    expect(ids(g)).toContain('prop:build:duplex');
    // The cheap builder is cheaper and slower than the big name.
    const cost = (gg: typeof g) => actionsAt(gg, 'lot').find((a) => a.id === 'prop:build:duplex')!.cost!;
    const mid = cost(g);
    g = did(g, 'prop:firm:2');
    expect(cost(g)).toBeLessThan(mid);
    g = did(g, 'prop:build:duplex');
    const s = standing(g, 'IKJ', house)!;
    expect(s.on).toBe('site');
    expect(s.rent).toBe(0);
    g.week = s.deed!.site!.done;
    const done = standing(g, 'IKJ', house)!;
    expect(done.on).toBe('duplex');
    expect(done.rent).toBeGreaterThan(0);
    const money = g.player.money;
    expect(propertyWeek(g).join(' ')).toMatch(/finished/);
    expect(g.player.money).toBe(money + done.rent);
    expect(netWorth(g)).toBeGreaterThan(g.player.money);
  });

  it('an empty plot can be bought and built on, and then takes no business', () => {
    let g = rich();
    const lot = freeLots(g, 'IKJ').find((id) => hood('IKJ').plots[id].kind === 'street')!;
    g = at(g, lot);
    expect(ids(g)).toContain('prop:buy');
    g = did(g, 'prop:buy');
    g = did(g, 'prop:build:bungalow');
    expect(freeLots(g, 'IKJ')).not.toContain(lot);
    expect(ids(g).some((id) => id.startsWith('open:'))).toBe(false);
  });

  it('a construction company can be bought: it pays a profit and builds for its owner at cost', () => {
    let g = rich();
    const lot = freeLots(g, 'IKJ').find((id) => hood('IKJ').plots[id].kind === 'street')!;
    g = at(g, lot);
    g = did(g, 'prop:buy');
    const cost = (gg: typeof g) => actionsAt(gg, 'lot').find((a) => a.id === 'prop:build:bungalow')!.cost!;
    const before = cost(g);
    g = did(g, 'firm:buy:1');
    expect(builders(g)[1].owner).toBe(g.me);
    expect(cost(g)).toBeLessThan(before);
    const money = g.player.money;
    propertyWeek(g);
    expect(g.player.money).toBeGreaterThan(money);
  });

  it('public places are not for sale, and places in use cannot be pulled down', () => {
    let g = rich();
    g = goTo(g, 'market', null);
    expect(actionsAt(g, 'market').some((a) => a.id.startsWith('prop:'))).toBe(false);
    g = goTo(g, 'bank', null);
    expect(actionsAt(g, 'bank').some((a) => a.id === 'prop:buy')).toBe(true);
    g = did(g, 'prop:buy');
    expect(actionsAt(g, 'bank').some((a) => a.id === 'prop:demolish')).toBe(false);
  });
});
