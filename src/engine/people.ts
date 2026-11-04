import { namePool, TITLES, type Role } from '../data/people';
import { lgaById, type TradeId } from '../data/world';
import { between, chance, pick, rand, type HasRng } from './rng';
import type { Game, Looks, Person } from './types';

export function randomLooks(g: { rng: number }): Looks {
  return { skin: Math.floor(rand(g) * 5), hair: Math.floor(rand(g) * 5), outfit: Math.floor(rand(g) * 8), accent: Math.floor(rand(g) * 8), glasses: chance(g, 0.15) };
}

/** Adds a named person to the world and returns them. */
export function makePerson(g: Game, lga: string, role: Role, trade: TradeId, opts: Partial<Person> = {}, r: HasRng = g): Person {
  const l = lgaById(lga);
  const pool = namePool(l.state, rand(r));
  const gender = opts.gender ?? (chance(r, 0.5) ? 'm' : 'f');
  const first = pick(r, gender === 'm' ? pool.m : pool.f);
  const last = pick(r, pool.last);
  const p: Person = {
    id: g.people.length,
    name: role === 'politician' || role === 'godfather' ? `${pick(r, TITLES)} ${first} ${last}` : `${first} ${last}`,
    gender,
    age: Math.round(between(r, 22, 60)),
    lga,
    trade,
    role,
    relation: Math.round(between(r, -10, 25)),
    party: null,
    style: null,
    ambition: rand(r),
    looks: randomLooks(r),
    bio: '',
    office: null,
    employer: null,
    money: 0,
    losses: 0,
    ...opts,
  };
  g.people.push(p);
  return p;
}
