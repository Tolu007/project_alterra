import { BIZ, WAGES, bizType, type BizType, type BizTypeId } from '../data/businesses';
import { tradeById, type Skill } from '../data/trades';
import { LGAS, lgaById, stateById, type StateId, type TradeId } from '../data/world';
import { clamp, localDemand, okadaBanned, services, startIncome, tradeIncome } from './economy';
import { hood } from './map';
import { makePerson } from './people';
import { humanOf, isHuman } from './seats';
import type { HasRng } from './rng';
import { DAYS_PER_WEEK, type Business, type Game, type LedgerLine, type PnLTotals } from './types';

const P = (g: Game) => g.macro.priceLevel;

export const staffCap = (b: Business) => b.level * bizType(b.type).staffPerLevel;
/**
 * A week's pay for one worker. Bigger (formal) businesses follow the minimum wage. Small starter businesses pay what
 * the street pays: about half of what someone in that trade earns locally, so a Kano mama put is not held to Lagos wages.
 */
export function wageWeekly(g: Game, b: Business): number {
  const t = bizType(b.type);
  if (t.kind === 'starter' && t.trade) return 0.5 * tradeIncome(g, b.lga, t.trade).income * WAGES[b.wage].mult;
  return (g.fed.policy.minWage / 4) * WAGES[b.wage].mult;
}
export const openCost = (g: Game, type: BizTypeId) => Math.round(bizType(type).capital * Math.pow(P(g), 0.8));
export const growCost = (g: Game, b: Business) => Math.round(openCost(g, b.type) * b.level * 0.9);

const SHOP_STAGES = ['a zinc shack', 'a container shop', 'a block shop', 'a two-storey building', 'a big branded building', 'a flagship complex'];
const FARM_STAGES = ['a small plot', 'a farm with a store', 'a farm with a silo', 'a mechanised farm', 'an agro estate', 'an agro-processing complex'];

/** What a business looks like on its plot, 0..5. Starters begin as a shack; bigger businesses begin in a container shop. */
export const stageOf = (type: BizTypeId, level: number) => Math.min(5, level - 1 + (bizType(type).kind === 'starter' ? 0 : 1));
export const stageName = (type: BizTypeId, level: number) => (needsFarmland(type) ? FARM_STAGES : SHOP_STAGES)[stageOf(type, level)];

/** Okadas and kekes are vehicles: they work from the motor park and need no plot. */
export const isMobile = (type: BizTypeId) => type === 'okada' || type === 'keke';

/** Farms and rice mills need farmland; everything else needs a street plot. */
export const needsFarmland = (type: BizTypeId) => type === 'farm' || type === 'ricemill';

export const businessOn = (g: Game, lga: string, plot: number) => g.businesses.find((b) => b.lga === lga && b.plot === plot);

/** Plots in an LGA nobody is using yet. */
export const freeLots = (g: Game, lga: string) => hood(lga).lots.filter((id) => !businessOn(g, lga, id));

/** Why the player cannot open this business on this plot, or null. */
export function openBlocked(g: Game, type: BizTypeId, lga: string, plot: number): string | null {
  const t = bizType(type);
  const l = lgaById(lga);
  const p = hood(lga).plots[plot];
  if (!isMobile(type)) {
    if (!p || !hood(lga).lots.includes(plot)) return 'This plot is not for lease.';
    if (businessOn(g, lga, plot)) return 'Somebody is already using this plot.';
    if (needsFarmland(type) !== (p.kind === 'farm')) return needsFarmland(type) ? 'Needs farmland on the edge of town.' : 'This is farmland. Build on a street plot.';
  }
  if (t.where && !t.where(l)) return `There is no room for a ${t.name.toLowerCase()} in ${l.nick}.`;
  for (const [k, v] of Object.entries(t.needs ?? {})) {
    if (g.player.skills[k as Skill] < (v as number)) return `Needs ${k === 'edu' ? 'education' : k === 'biz' ? 'business' : k === 'tech' ? 'technical' : 'people'} skill ${v}.`;
  }
  return null;
}

export function openBusiness(g: Game, type: BizTypeId, lga: string, financed: boolean, plot: number, owner = g.me, name?: string): Business {
  const t = bizType(type);
  const first = g.people[owner]?.name.trim().split(/\s+/)[0] || 'Your';
  const b: Business = {
    id: (g.businesses.reduce((m, x) => Math.max(m, x.id), -1) ?? -1) + 1,
    type,
    name: name ?? `${first}'s ${t.name.split(' (')[0]}`,
    lga,
    plot,
    owner,
    level: 1,
    staff: [],
    wage: 'fair',
    opened: g.week,
    financeWeeks: financed ? 40 : 0,
    ownerDays: 0,
    bossDay: -1,
    week: emptyPnL(),
    lastProfit: 0,
    history: [],
    last: [],
  };
  g.businesses.push(b);
  return b;
}

// ───────────── demand ─────────────

/** Real spending of the client trades across a state, 1 at the start. */
function clientActivity(g: Game, state: StateId, clients: TradeId[]): number {
  let now = 0;
  let base = 0;
  for (const l of LGAS) {
    if (l.state !== state) continue;
    for (const t of clients) {
      const c = g.cohorts[l.id][t];
      if (!c) continue;
      now += (c.income * c.employed * c.workers) / g.prices[state].cpi;
      base += startIncome(l.id, t) * (tradeById(t).kind === 'salary' ? 0.92 : 1) * c.workers;
    }
  }
  return base > 0 ? clamp(now / base, 0.3, 2.5) : 1;
}

/** The same owner's businesses in the state that buy from a supplier of this type. */
function ownCustomers(g: Game, supplier: BizType, state: StateId, owner: number): Business[] {
  return g.businesses.filter((x) => x.owner === owner && supplier.feeds.includes(x.type) && lgaById(x.lga).state === state);
}

/** The owner also owns a supplier that feeds this business in the same state. */
function integrated(g: Game, b: Business): boolean {
  const st = lgaById(b.lga).state;
  return g.businesses.some((x) => x.owner === b.owner && x.id !== b.id && bizType(x.type).feeds.includes(b.type) && lgaById(x.lga).state === st);
}

export function demandFor(g: Game, b: Business): number {
  const t = bizType(b.type);
  const l = lgaById(b.lga);
  const sv = services(g, b.lga);
  const pr = g.prices[l.state];
  let d: number;
  if (t.kind === 'supplier') d = clientActivity(g, l.state, t.clients) * (1 + 0.12 * Math.min(4, ownCustomers(g, t, l.state, b.owner).length));
  else d = localDemand(g, b.lga) * (0.6 + 0.8 * l.wealth);
  switch (b.type) {
    case 'school':
      d *= 1 + (50 - sv.schools) / 80;
      break;
    case 'pharmacy':
      d *= 1 + (50 - sv.health) / 80;
      break;
    case 'solar':
      d *= Math.max(0.4, 1 + (10 - pr.grid) / 10);
      break;
    case 'clearing':
      d *= Math.pow(g.ref.fx / g.macro.fxParallel, 0.7);
      break;
    case 'ricemill':
      d *= (g.fed.policy.riceBan ? 1.45 : 1) * Math.sqrt(pr.food / stateById(l.state).foodAdj);
      break;
    case 'blocks': {
      const roads = g.states[l.state].ledger.spent.roads ?? 5;
      d *= 0.7 + 0.3 * Math.min(3, roads / 5);
      break;
    }
    case 'fleet':
      d *= (g.fares[b.lga] / stateById(l.state).fare) * (okadaBanned(g, b.lga) ? 1.06 : 1);
      break;
  }
  return clamp(d, 0.2, 3);
}

/** How much dearer this business's inputs are than its takings since the start. */
function inputPressure(g: Game, b: Business): number {
  const t = bizType(b.type);
  const l = lgaById(b.lga);
  const pr = g.prices[l.state];
  const rest = Math.max(0, 1 - t.fx - t.fuel - t.power - t.food);
  const idx =
    t.fx * (g.macro.fxParallel / g.ref.fx) +
    t.fuel * (pr.petrol / g.ref.petrol[l.state]) +
    t.power * (pr.energy / g.ref.energy[l.state]) +
    t.food * (pr.food / stateById(l.state).foodAdj) +
    rest * P(g);
  return idx / Math.pow(P(g), 0.9);
}

// ───────────── money ─────────────

/** One shift of the owner's own work at a starter business, ₦. */
export function starterShift(g: Game, b: Business): number {
  const t = bizType(b.type);
  if (t.kind !== 'starter' || !t.trade) return 0;
  let weekly = tradeIncome(g, b.lga, t.trade).income * competition(g, b);
  const owner = humanOf(g, b.owner) ?? g.player;
  if (g.demolition[b.lga] > 0 && (g.flags.relocated ?? 0) > 0 && tradeById(t.trade).markets > 0.2) weekly = (weekly / 0.4) * 0.8;
  const skill = 0.75 + 0.1 * owner.skills[tradeById(t.trade).skill];
  return (weekly / 5) * skill * (1 + 0.15 * (b.level - 1));
}

export type PnL = PnLTotals;

export const emptyPnL = (): PnL => ({ revenue: 0, inputs: 0, wages: 0, premises: 0, power: 0, upkeep: 0, levies: 0, finance: 0, profit: 0 });

/** Shop rent as a share of a year's flat rent in the LGA, by building stage: a shack is cheap, a flagship is not. */
const RENT_BY_STAGE = [0.12, 0.25, 0.4, 0.7, 1, 1.5];
/** Weekly NEPA bill plus generator diesel at start prices, by building stage. */
const POWER_BY_STAGE = [800, 2_000, 4_500, 9_000, 16_000, 26_000];

/**
 * The share of local trade a business keeps when others of the same kind compete for it (1 when alone).
 * Suppliers compete across the state; everyone else on their own streets. Bigger rivals bite harder.
 */
export function competition(g: Game, b: Business): number {
  const t = bizType(b.type);
  const st = lgaById(b.lga).state;
  const rivals = g.businesses.filter((x) => x.id !== b.id && x.type === b.type && (t.kind === 'supplier' ? lgaById(x.lga).state === st : x.lga === b.lga));
  const weight = rivals.reduce((s, x) => s + Math.min(2, 0.5 + 0.25 * x.level), 0);
  const bite = t.kind === 'starter' ? 0.15 : t.kind === 'supplier' ? 0.2 : 0.3;
  return 1 / (1 + bite * weight);
}

/** Of a starter's takings, the share that goes back into stock, fuel and materials. */
function starterStock(t: BizType): number {
  const tr = tradeById(t.trade!);
  return clamp(tr.fuel + tr.power + tr.fx + tr.food, 0.15, 0.6);
}

/** Running a place costs money whether or not anyone works there: rent for the plot, power, repairs and security. */
function fixedCosts(g: Game, b: Business): Pick<PnL, 'premises' | 'power' | 'upkeep'> {
  const t = bizType(b.type);
  const upkeep = 0.0015 * openCost(g, b.type) * (1 + 0.8 * (b.level - 1));
  if (isMobile(b.type)) return { premises: 0, power: 0, upkeep };
  const stage = stageOf(b.type, b.level);
  const pr = g.prices[lgaById(b.lga).state];
  const st = lgaById(b.lga).state;
  // The worse the grid, the more diesel.
  const diesel = 1 + Math.max(0, 12 - pr.grid) / 12;
  return {
    premises: (g.rent[b.lga] / 48) * RENT_BY_STAGE[stage],
    power: POWER_BY_STAGE[stage] * (pr.energy / g.ref.energy[st]) * (1 + 2 * t.power) * diesel * (needsFarmland(b.type) ? 0.5 : 1),
    upkeep,
  };
}

/** Each worker produces this many "units" of a bigger business's trade; the boss adds a little on top. */
const STAFF_OUTPUT = 1.3;
const BOSS_OUTPUT = 0.5;
/** Staff work harder when the boss is around. */
const BOSS_LIFT = 0.15;

/**
 * A week of trading at a given boss presence (0..1: the share of days you came in; defaults to this week's so far).
 * Staff earn for you whether or not you come in. Starters' owner takings are paid per shift, so here they only count staff.
 */
export function weeklyPnL(g: Game, b: Business, presence = Math.min(1, b.ownerDays / DAYS_PER_WEEK), boost = 1): PnL {
  const t = bizType(b.type);
  const l = lgaById(b.lga);
  const out: PnL = { ...emptyPnL(), ...fixedCosts(g, b) };
  const output = WAGES[b.wage].output;
  const crowd = competition(g, b) * boost;
  out.wages = b.staff.length * wageWeekly(g, b);
  out.finance = b.financeWeeks > 0 ? (t.financed ?? 0) * Math.pow(P(g), 0.6) : 0;

  if (t.kind === 'starter') {
    // A worker does the trade's full day's work; you keep what is left after their wage and the stock they sell.
    const net = b.staff.length * output * (t.staffYield ?? 1) * (1 + BOSS_LIFT * presence) * tradeIncome(g, b.lga, t.trade!).income * (1 + 0.15 * (b.level - 1)) * crowd;
    out.revenue = net / (1 - starterStock(t));
    out.inputs = out.revenue - net;
  } else if (b.type === 'estate') {
    const units = 4 * b.level;
    const occupancy = clamp(0.65 + 0.35 * (localDemand(g, b.lga) - 0.7), 0.4, 1);
    out.revenue = (g.rent[b.lga] * units * occupancy) / 48;
    out.inputs = out.revenue * t.inputs * inputPressure(g, b);
  } else {
    const sv = services(g, b.lga);
    const capacity = b.staff.length * output * STAFF_OUTPUT * (1 + BOSS_LIFT * presence) + BOSS_OUTPUT * presence;
    const eff =
      (1 + 0.12 * (b.level - 1)) *
      (t.power > 0.2 ? 1 + (0.12 * (sv.grid - 8)) / 8 : 1) *
      (t.fuel > 0.4 ? 1 + (0.2 * (sv.roads - 50)) / 50 : 1) *
      (1 + (0.1 * (sv.security - 50)) / 50);
    out.revenue = t.unit * Math.pow(P(g), 0.9) * demandFor(g, b) * capacity * eff * crowd;
    out.inputs = out.revenue * t.inputs * inputPressure(g, b) * (integrated(g, b) ? 0.85 : 1);
    const levy = t.place === 'market' ? g.lgas[b.lga].policy.levy : 0.01;
    out.levies = out.revenue * (levy + g.states[l.state].policy.tax);
  }
  out.profit = out.revenue - out.inputs - out.wages - out.premises - out.power - out.upkeep - out.levies - out.finance;
  return out;
}

/** Busy days: a premiere or a big match brings crowds to the bukas, bars, salons and transport of that LGA. */
const CROWD_TRADES: BizTypeId[] = ['buka', 'restaurant', 'stall', 'pos', 'salon', 'fleet', 'keke', 'okada'];
export function dayBoost(g: Game, b: Business): number {
  if (!CROWD_TRADES.includes(b.type)) return 1;
  const on = g.culture.filter((e) => e.week === g.week && e.day === g.day && (e.lga === b.lga || e.lga === '*'));
  return 1 + on.reduce((s, e) => s + (e.lga === '*' ? 0.25 : 0.6) * e.hype, 0);
}

/** Business owners other than you are always about their shop. */
const NPC_PRESENCE = 0.8;

/**
 * One night's trading for every business in the world: a sixth of a week at today's boss presence.
 * Computer-run owners are paid straight into their pockets. Returns what each player's businesses made today,
 * with the owner's person id; the caller pays it out.
 */
export function settleDay(g: Game): (LedgerLine & { owner: number })[] {
  const lines: (LedgerLine & { owner: number })[] = [];
  const today = g.week * 7 + g.day;
  for (const b of g.businesses) {
    const human = isHuman(g, b.owner);
    const day = weeklyPnL(g, b, human ? (b.bossDay === today ? 1 : 0) : NPC_PRESENCE, dayBoost(g, b));
    for (const k of Object.keys(day) as (keyof PnL)[]) b.week[k] += day[k] / DAYS_PER_WEEK;
    const profit = day.profit / DAYS_PER_WEEK;
    if (!human) g.people[b.owner].money += profit;
    else if (Math.abs(profit) >= 1) lines.push({ owner: b.owner, label: b.name, amount: profit });
  }
  return lines;
}

/** Closes the week's books for every business (the money was paid out night by night). Returns one net line per business. */
export function settleBusinesses(g: Game): LedgerLine[] {
  const lines: LedgerLine[] = [];
  for (const b of g.businesses) {
    const pnl = b.week;
    b.week = emptyPnL();
    b.lastProfit = pnl.profit;
    b.history.push(pnl.profit);
    if (b.history.length > 12) b.history.shift();
    b.last = [
      { label: 'Takings', amount: pnl.revenue },
      { label: 'Stock & inputs', amount: -pnl.inputs },
      { label: `Staff wages (${b.staff.length})`, amount: -pnl.wages },
      { label: isMobile(b.type) ? 'Plot rent' : needsFarmland(b.type) ? 'Land lease' : 'Shop rent', amount: -pnl.premises },
      { label: 'Power & generator', amount: -pnl.power },
      { label: isMobile(b.type) ? 'Servicing & repairs' : 'Repairs & security', amount: -pnl.upkeep },
      { label: 'Levies & taxes', amount: -pnl.levies },
      ...(pnl.finance ? [{ label: 'Owner’s remittance', amount: -pnl.finance }] : []),
    ].filter((x) => Math.abs(x.amount) >= 1);
    if (b.financeWeeks > 0) b.financeWeeks--;
    b.ownerDays = 0;
    const owner = humanOf(g, b.owner);
    if (!owner) continue;
    if (Math.abs(pnl.profit) >= 1) lines.push({ label: b.name, amount: pnl.profit });
    // Employers are respected: every job is a family that remembers you.
    owner.influence[b.lga] = clamp(owner.influence[b.lga] + Math.min(2, 0.05 * b.staff.length), 0, 100);
  }
  return lines;
}

export function businessValue(g: Game, b: Business): number {
  const base = openCost(g, b.type) * (1 + 0.8 * (b.level - 1)) * 0.6;
  const avg = b.history.length ? b.history.reduce((a, x) => a + x, 0) / b.history.length : 0;
  return Math.max(0, base + 6 * Math.max(0, avg) - (b.financeWeeks > 0 ? openCost(g, b.type) * (b.financeWeeks / 40) : 0));
}

// ───────────── staff ─────────────

/** Hires someone for the business: a named person if given, else the first available neighbour. */
export function hire(g: Game, b: Business, personId?: number, r: HasRng = g): number {
  const owners = new Set(g.businesses.map((y) => y.owner));
  const pool = g.people.filter((x) => x.lga === b.lga && x.role === 'neighbour' && x.employer === null && !owners.has(x.id) && (x.trade === 'unemployed' || x.ambition < 0.4) && x.id !== 0);
  const chosen = personId !== undefined ? g.people[personId] : undefined;
  const person = chosen ?? (pool.length ? pool[0] : makePerson(g, b.lga, 'neighbour', 'unemployed', {}, r));
  person.employer = b.id;
  person.trade = bizType(b.type).ownerTrade === 'business' ? 'office' : bizType(b.type).ownerTrade;
  person.relation = clamp(person.relation + 25, -100, 100);
  b.staff.push(person.id);
  return person.id;
}

export function fire(g: Game, b: Business): number | null {
  const id = b.staff.pop();
  if (id === undefined) return null;
  const p = g.people[id];
  p.employer = null;
  p.trade = 'unemployed';
  p.relation = clamp(p.relation - 30, -100, 100);
  const owner = humanOf(g, b.owner);
  if (owner) owner.influence[b.lga] = clamp(owner.influence[b.lga] - 1, 0, 100);
  return id;
}

export function sellBusiness(g: Game, b: Business): number {
  const value = businessValue(g, b);
  for (const id of b.staff) {
    g.people[id].employer = null;
    g.people[id].trade = 'unemployed';
  }
  g.businesses = g.businesses.filter((x) => x.id !== b.id);
  return value;
}

export const playerBusinesses = (g: Game) => g.businesses.filter((b) => b.owner === g.me);
export const bizTypesAt = (place: string) => BIZ.filter((t) => t.place === place);
