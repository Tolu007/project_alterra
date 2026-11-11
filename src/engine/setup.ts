import { BIZ, bizType, type BizTypeId } from '../data/businesses';
import { namePool } from '../data/people';
import { FED_START, type LeaderStyle, type Level, type LgaPolicy, type PartyId, type StatePolicy } from '../data/politics';
import { TRADES, tradeById, type Skill } from '../data/trades';
import { LGAS, STATES, lgaById, lgasOf, type StateId, type TradeId } from '../data/world';
import { startIncome, updateCohorts, updatePrices, updateSatisfaction } from './economy';
import { TEMPLATES, weeklyGovernment } from './government';
import { emptyPnL, isMobile, needsFarmland, openBusiness, openCost } from './business';
import { hood } from './map';
import { seedTown } from './npc';
import { bind } from './seats';
import { scheduleCulture } from './culture';
import { makePerson } from './people';
import { between, pick, rand, weightedPick } from './rng';
import { DAY_START, PLAYER, type Cohort, type Game, type Gov, type GovLedger, type Housing, type Looks, type Person, type Player, type StatePrices } from './types';

/** The lot nearest home that suits the business. */
function startPlot(lga: string, type: BizTypeId, taken: number[] = []): number {
  const h = hood(lga);
  const home = h.plots[h.place.home ?? 0];
  const ok = h.lots.filter((id) => (h.plots[id].kind === 'farm') === needsFarmland(type) && !taken.includes(id));
  ok.sort((a, b) => Math.hypot(h.plots[a].x - home.x, h.plots[a].z - home.z) - Math.hypot(h.plots[b].x - home.x, h.plots[b].z - home.z));
  return ok[0] ?? h.lots[0];
}

/** The town layout plots refer to. 2: the Lagos districts rebuilt from real map data. */
export const MAP_VERSION = 2;

/**
 * Keeps businesses on plots that exist. Worlds made before the towns were last redrawn move every
 * business in a mapped district to the nearest free plot of the right kind, and send anyone standing
 * on a plot home. Works on a world with or without a bound seat, so the server can run it on what it loads.
 */
export function migrateMap(g: Game): Game {
  const stale = (g.mapVersion ?? 1) < MAP_VERSION;
  const redrawn = (lga: string) => !!hood(lga).real;
  // Every business in a mapped district must stand alone on a plot for lease of the right kind. Old
  // worlds move them all; after that, only ones a rebuilt map has left on a plot that is gone.
  const seen = new Set<string>();
  const moving = g.businesses.filter((b) => {
    if (b.plot < 0 || !redrawn(b.lga)) return false;
    const h = hood(b.lga);
    const key = `${b.lga}:${b.plot}`;
    const bad = stale || !h.lots.includes(b.plot) || (h.plots[b.plot].kind === 'farm') !== needsFarmland(b.type) || seen.has(key);
    seen.add(key);
    return bad;
  });
  for (const b of moving) b.plot = -2;
  for (const b of moving) {
    const taken = g.businesses.filter((x) => x.lga === b.lga && x.plot >= 0).map((x) => x.plot);
    b.plot = startPlot(b.lga, b.type, taken);
  }
  // Anyone standing on a plot a rebuilt map no longer has goes home (a town that has just been given its real streets).
  const gone = (lga: string, lot: number | null) => lot === null || !hood(lga).lots.includes(lot);
  for (const seat of g.seats ?? []) {
    if (seat.place === 'lot' && gone(seat.player.at, seat.lot)) {
      seat.place = 'home';
      seat.lot = null;
    }
  }
  if (g.me >= 0 && g.player && g.place === 'lot' && gone(g.player.at, g.lot)) {
    g.place = 'home';
    g.lot = null;
  }
  if (!stale) return g;
  for (const seat of g.seats ?? []) {
    if (seat.place === 'lot' && redrawn(seat.player.at)) {
      seat.place = 'home';
      seat.lot = null;
    }
  }
  if (g.me >= 0 && g.player && g.place === 'lot' && redrawn(g.player.at)) {
    g.place = 'home';
    g.lot = null;
  }
  g.mapVersion = MAP_VERSION;
  return g;
}

/** Saves from before businesses had plots: give each one the nearest free plot. */
export function upgradeSave(g: Game): Game {
  // Saves from before seats: the one player becomes the world's only seat.
  if (!g.seats) {
    const top = g as unknown as Record<string, unknown>;
    const flags = (top.flags as Record<string, number>) ?? {};
    const world: Record<string, number> = {};
    for (const k of Object.keys(flags)) if (k === 'petrolAvg' || k === 'noLaElection' || k.startsWith('strike:') || k.startsWith('rig:')) {
      world[k] = flags[k];
      delete flags[k];
    }
    g.wflags = world;
    g.shared = null;
    g.humans = [PLAYER];
    g.seats = [
      {
        id: PLAYER,
        account: 'local',
        player: g.player,
        place: g.place,
        lot: g.lot ?? null,
        talked: g.talked ?? [],
        phase: g.phase,
        report: g.report,
        eventQueue: g.eventQueue,
        currentEvent: g.currentEvent,
        outcome: g.outcome,
        seenEvents: g.seenEvents,
        showElection: g.showElection,
        ending: g.ending,
        flags,
        busyUntil: 0,
        asleep: false,
        seenMs: 0,
      },
    ];
    g.me = -1;
    bind(g, PLAYER);
  }
  if (g.lot === undefined) g.lot = null;
  const old = g as Game & { block?: number };
  if (g.minute === undefined) g.minute = [7, 12, 17, 21][old.block ?? 0] * 60;
  delete old.block;
  g.culture ??= [];
  g.rngs ??= { npc: { rng: (g.seed * 2654435761) | 0 }, culture: { rng: (g.seed * 2246822519 + 7) | 0 } };
  g.player.pension ??= 0;
  for (const x of g.people) {
    x.money ??= 0;
    x.losses ??= 0;
  }
  for (const b of g.businesses) {
    b.bossDay ??= -1;
    b.week = Object.assign(emptyPnL(), b.week ?? {});
    if (typeof b.plot === 'number') continue;
    const taken = g.businesses.filter((x) => x.lga === b.lga && typeof x.plot === 'number').map((x) => x.plot);
    b.plot = isMobile(b.type) ? -1 : startPlot(b.lga, b.type, taken);
  }
  return migrateMap(g);
}

/** Everybody begins level: the same cash, skills and a rented room. */
export const START = { money: 250_000, skills: { edu: 2, tech: 1, biz: 1, people: 1 } as Record<Skill, number>, housing: 'room' as Housing, rentWeeks: 24 };

export type StartPath = { kind: 'job'; trade: TradeId } | { kind: 'business'; type: BizTypeId };

export interface NewLife {
  name: string;
  gender: 'm' | 'f';
  looks: Looks;
  home: string;
  start: StartPath;
}

/** Jobs and starter businesses open to a new arrival in an LGA. */
export function startOptions(home: string): { jobs: TradeId[]; businesses: BizTypeId[] } {
  const l = lgaById(home);
  const jobs = TRADES.filter((t) => t.kind === 'salary' && (l.mix[t.id] ?? 0) > 0 && Object.entries(t.needs ?? {}).every(([k, v]) => START.skills[k as Skill] >= (v as number))).map((t) => t.id);
  const businesses = BIZ.filter((b) => b.kind === 'starter' && (!b.where || b.where(l)) && Object.entries(b.needs ?? {}).every(([k, v]) => START.skills[k as Skill] >= (v as number))).map((b) => b.id);
  return { jobs, businesses };
}

const STYLE_WEIGHTS: [LeaderStyle, number][] = [
  ['reformer', 0.18],
  ['populist', 0.24],
  ['looter', 0.22],
  ['indifferent', 0.24],
  ['tyrant', 0.12],
];
const randomStyle = (g: { rng: number }) => weightedPick(g, STYLE_WEIGHTS, ([, w]) => w)![0];

function makeGov<P>(id: string, level: Level, name: string, leader: Person, party: PartyId, style: LeaderStyle, policy: P, treasury: number, debt: number): Gov<P> {
  const ledger: GovLedger = { revenue: 0, wages: 0, wagesPaid: 0, debtService: 0, borrowed: 0, spent: {}, looted: 0, subsidy: 0 };
  leader.office = id;
  leader.party = party;
  leader.style = style;
  return { id, level, name, leader: leader.id, party, style, treasury, debt, arrears: 0, budget: { ...TEMPLATES[level][style] }, payRate: 1, policy, approval: 50, termStart: -20, terms: 1, ledger, loot: 0 };
}

const START_INFRA: Record<StateId, { roads: number; power: number; security: number; schools: number; health: number }> = {
  LA: { roads: 50, power: 25, security: 50, schools: 45, health: 48 },
  KN: { roads: 38, power: 12, security: 42, schools: 32, health: 33 },
  RI: { roads: 45, power: 18, security: 35, schools: 38, health: 40 },
};
const STATE_START: Record<StateId, { party: PartyId; policy: StatePolicy; treasury: number; debt: number }> = {
  LA: { party: 'JRP', treasury: 80, debt: 1200, policy: { tax: 0.03, okada: 'partial', payMinWage: true, rentControl: false, freeSchool: false, withholdLga: false, borrow: 3 } },
  KN: { party: 'SPM', treasury: 30, debt: 200, policy: { tax: 0.02, okada: 'full', payMinWage: true, rentControl: false, freeSchool: true, withholdLga: false, borrow: 1 } },
  RI: { party: 'GUC', treasury: 120, debt: 300, policy: { tax: 0.03, okada: 'partial', payMinWage: true, rentControl: false, freeSchool: false, withholdLga: false, borrow: 2 } },
};

/** Party strength by state, a starting point for every election. */
export const PARTY_BASE: Record<StateId | 'REST', Record<PartyId, number>> = {
  LA: { JRP: 0.6, SPM: 0.1, GUC: 0.2, PFP: 0.28 },
  KN: { JRP: 0.25, SPM: 0.65, GUC: 0.05, PFP: 0.15 },
  RI: { JRP: 0.3, SPM: 0.05, GUC: 0.6, PFP: 0.15 },
  REST: { JRP: 0.35, SPM: 0.32, GUC: 0.25, PFP: 0.12 },
};

export function newGame(life: NewLife, seed: number): Game {
  const g = createWorld(seed, null, life);
  const id = addSeat(g, life, 'local', PLAYER);
  bind(g, id);
  finishWorld(g);
  return g;
}

/** A shared world with nobody in it yet: people join with addSeat. Its clock runs at `rate` game minutes per real minute. */
export function newSharedWorld(seed: number, nowMs: number, rate: number): Game {
  const g = createWorld(seed, { realMs: nowMs, rate });
  finishWorld(g);
  return g;
}

function createWorld(seed: number, shared: Game['shared'], first?: NewLife): Game {
  const g = { rng: seed | 0, people: [] as Person[] } as unknown as Game;
  Object.assign(g, {
    version: 2,
    mapVersion: MAP_VERSION,
    seed,
    rngs: { npc: { rng: (seed * 2654435761) | 0 }, culture: { rng: (seed * 2246822519 + 7) | 0 } },
    seats: [],
    me: -1,
    humans: [],
    wflags: {},
    shared,
    busyUntil: 0,
    asleep: false,
    week: 0,
    day: 0,
    minute: DAY_START,
    culture: [],
    lot: null,
    talked: [],
    phase: 'day',
    macro: {
      fxOfficial: 1500,
      fxParallel: 1500,
      peg: 1500,
      reserves: 38,
      oilPrice: 72,
      oilOutput: 1.6,
      priceLevel: 1,
      confidence: 0.55,
      inflation: 0.18,
      subsidyBill: 0,
      // Seeded so year-on-year inflation reads 18% from the first week.
      priceHistory: Array.from({ length: 49 }, (_, i) => 1 / Math.pow(1.18, (48 - i) / 48)),
    },
    prices: {} as Record<StateId, StatePrices>,
    ref: { petrol: {}, fx: 1500, energy: {}, food: {}, fare: {}, demand: {}, farm: 1 },
    wageIndex: 1,
    fares: {},
    rent: Object.fromEntries(LGAS.map((l) => [l.id, l.rent])),
    fedInfra: { power: 35, roads: 35, security: 40, schools: 35, health: 35 },
    stateInfra: Object.fromEntries(STATES.map((s) => [s.id, { ...START_INFRA[s.id] }])),
    lgaInfra: {},
    cohorts: {},
    restMood: 45,
    demolition: Object.fromEntries(LGAS.map((l) => [l.id, 0])),
    news: [],
    series: [],
    eventQueue: [],
    currentEvent: null,
    outcome: null,
    seenEvents: {},
    elections: [],
    businesses: [],
    showElection: null,
    flags: {},
    report: null,
    ending: null,
    place: 'home',
  });
  for (const s of STATES) g.prices[s.id] = { petrol: 0, diesel: 0, food: 1, rice: 0, energy: 0, grid: 8, cpi: 1, scarcity: false };

  if (first) g.people.push(playerPerson(first, PLAYER));

  for (const l of LGAS) {
    g.lgaInfra[l.id] = {
      roads: 22 + 40 * l.wealth + between(g, -5, 5),
      sanitation: 20 + 45 * l.wealth + between(g, -5, 5),
      markets: 30 + 30 * l.wealth + between(g, -5, 5),
      health: 22 + 35 * l.wealth + between(g, -5, 5),
    };
    const total = Object.values(l.mix).reduce((a, b) => a + (b ?? 0), 0);
    const cohorts = {} as Record<TradeId, Cohort>;
    for (const [t, share] of Object.entries(l.mix) as [TradeId, number][]) {
      const inc = startIncome(l.id, t);
      cohorts[t] = { workers: (l.voters * share) / total, income: inc, base: inc, employed: tradeById(t).kind === 'salary' ? 0.92 : 1, happiness: 50, sat: { federal: 48, state: 52, lga: 50 }, relief: 0 };
    }
    if (!cohorts.unemployed) cohorts.unemployed = { workers: l.voters * 0.03, income: 8_000, base: 8_000, employed: 0, happiness: 40, sat: { federal: 42, state: 46, lga: 46 }, relief: 0 };
    g.cohorts[l.id] = cohorts;
    const cs = Object.values(cohorts);
    g.ref.demand[l.id] = cs.reduce((a, c) => a + c.income * c.employed * c.workers, 0) / cs.reduce((a, c) => a + c.workers, 0);
  }

  // Leaders.
  const fedParty = pick(g, ['JRP', 'SPM', 'GUC'] as PartyId[]);
  const presHome = pick(g, LGAS).id;
  const president = makePerson(g, presHome, 'politician', 'business', { age: 64 });
  g.fed = makeGov('FED', 'federal', 'Federal Government', president, fedParty, randomStyle(g), { ...FED_START }, 400, 150_000);
  g.states = {} as Game['states'];
  for (const st of STATES) {
    const start = STATE_START[st.id];
    const gov = makePerson(g, st.capitalLga, 'politician', 'business', { age: Math.round(between(g, 48, 66)) });
    g.states[st.id] = makeGov(st.id, 'state', `${st.name} State`, gov, start.party, randomStyle(g), { ...start.policy }, start.treasury, start.debt);
  }
  g.lgas = {};
  for (const l of LGAS) {
    const chair = makePerson(g, l.id, 'politician', 'business');
    const policy: LgaPolicy = { levy: 0.03, park: 'touts', sanitationDay: false };
    // Councils are almost always won by the governor's party.
    g.lgas[l.id] = makeGov(l.id, 'lga', `${l.name} LGA`, chair, g.states[l.state].party, randomStyle(g), policy, 0.4, 0);
  }

  // Town faces: every LGA has some ordinary people; every state has its power players.
  for (const l of LGAS) {
    for (let i = 0; i < 5; i++) {
      const trade = weightedPick(g, Object.entries(l.mix) as [TradeId, number][], ([, w]) => w)![0];
      makePerson(g, l.id, 'neighbour', trade);
    }
  }
  for (const st of STATES) {
    const lgas = lgasOf(st.id);
    makePerson(g, st.capitalLga, 'godfather', 'business', { party: g.states[st.id].party, age: 70, ambition: 0.9 });
    makePerson(g, pick(g, lgas).id, 'journalist', 'office');
    makePerson(g, pick(g, lgas).id, 'union-chairman', st.id === 'KN' ? 'keke' : 'danfo');
    makePerson(g, pick(g, lgas).id, 'market-leader', 'trader', { gender: 'f' });
    makePerson(g, pick(g, lgas).id, 'area-boss', 'unemployed', { gender: 'm' });
    // A bench of ambitious politicians for future elections.
    for (const party of ['JRP', 'SPM', 'GUC', 'PFP'] as PartyId[]) {
      for (let i = 0; i < 2; i++) makePerson(g, pick(g, lgas).id, 'politician', 'business', { party, ambition: 0.6 + 0.4 * rand(g), style: randomStyle(g) });
    }
  }

  return g;
}

function playerPerson(life: NewLife, id: number): Person {
  const startTrade: TradeId = life.start.kind === 'job' ? life.start.trade : bizType(life.start.type).ownerTrade;
  return {
    id,
    name: life.name,
    gender: life.gender,
    age: 24,
    lga: life.home,
    trade: startTrade,
    role: 'friend',
    money: 0,
    losses: 0,
    relation: 100,
    party: null,
    style: null,
    ambition: 1,
    looks: life.looks,
    bio: '',
    office: null,
    employer: null,
  };
}

/**
 * Adds a player to a world: their character, family and a friend, and their start (a job or a business).
 * Returns their person id. In a fresh single-player world the character already exists as person 0.
 */
export function addSeat(g: Game, life: NewLife, account: string, id = g.people.length): number {
  if (!g.people[id]) g.people.push(playerPerson(life, id));
  const home = lgaById(life.home);
  const startTrade: TradeId = life.start.kind === 'job' ? life.start.trade : bizType(life.start.type).ownerTrade;
  // Your people.
  const famPool = namePool(home.state, rand(g));
  const surname = life.name.trim().split(/\s+/).slice(-1)[0] || pick(g, famPool.last);
  makePerson(g, life.home, 'family', 'trader', { name: `Mama ${surname}`, gender: 'f', age: 54, relation: 70, kin: id });
  makePerson(g, life.home, 'family', 'unemployed', { name: `${pick(g, famPool.m)} ${surname}`, gender: 'm', age: 19, relation: 55, bio: 'Your younger brother. Smart, broke, always on his phone.', kin: id });
  makePerson(g, life.home, 'friend', startTrade, { relation: 45, kin: id });

  const player: Player = {
    pension: 0,
    home: life.home,
    at: life.home,
    trade: startTrade,
    hired: false,
    hireWeeks: 0,
    scale: 1,
    money: START.money,
    usd: 0,
    loan: 0,
    health: 85,
    energy: 80,
    happiness: 55,
    hunger: 70,
    social: 60,
    skills: { ...START.skills },
    influence: Object.fromEntries(LGAS.map((l) => [l.id, l.id === life.home ? 8 : 0])),
    party: null,
    standing: 0,
    housing: START.housing,
    rentDue: START.rentWeeks,
    worked: 0,
    queries: 0,
    hasGenerator: false,
    assets: [],
    office: null,
    campaign: null,
    scandal: 0,
    loot: 0,
    week: [],
    lastWeek: [],
    goals: [],
    sick: 0,
  };
  g.seats.push({
    id,
    account,
    player,
    place: 'home',
    lot: null,
    talked: [],
    phase: 'day',
    report: null,
    eventQueue: [],
    currentEvent: null,
    outcome: null,
    seenEvents: {},
    showElection: null,
    ending: null,
    flags: {},
    busyUntil: 0,
    asleep: false,
    seenMs: 0,
  });
  g.humans.push(id);
  if (life.start.kind === 'business') {
    const t = bizType(life.start.type);
    const financed = !!t.financed;
    const taken = g.businesses.filter((b) => b.lga === life.home).map((b) => b.plot);
    const free = isMobile(t.id) || hood(life.home).lots.some((p) => !taken.includes(p) && (hood(life.home).plots[p].kind === 'farm') === needsFarmland(t.id));
    if (free) {
      const plot = isMobile(t.id) ? -1 : startPlot(life.home, t.id, taken);
      openBusiness(g, t.id, life.home, financed, plot, id);
      if (!financed) player.money -= openCost(g, t.id);
    } else {
      // Every plot in town is taken: start looking for work instead, with your money intact.
      player.trade = 'unemployed';
      g.people[id].trade = 'unemployed';
    }
  }
  return id;
}

/** Prices, moods and governments settle, the town opens its shops, and this week's events are planned. */
function finishWorld(g: Game) {
  updatePrices(g, true);
  updateCohorts(g);
  // Re-base each cohort on its first real figures, so "better or worse than when you started" is fair.
  for (const l of LGAS) for (const c of Object.values(g.cohorts[l.id])) c.base = (c.income * Math.max(c.employed, 0.3)) / g.prices[l.state].cpi;
  for (let i = 0; i < 4; i++) updateSatisfaction(g);
  weeklyGovernment(g);
  // The rest of the town: neighbours with savings, a few shops already open, and this week's events.
  seedTown(g);
  scheduleCulture(g, 0);
}

