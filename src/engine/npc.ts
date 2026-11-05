import { BIZ, bizType, type BizType, type BizTypeId } from '../data/businesses';
import { TRADES, tradeById } from '../data/trades';
import { LGAS, lgaById, type TradeId } from '../data/world';
import { competition, fire, freeLots, growCost, hire, isMobile, needsFarmland, openBusiness, openCost, stageOf, staffCap, wageWeekly } from './business';
import { clamp, tradeIncome } from './economy';
import { hood } from './map';
import { makePerson } from './people';
import { between, chance, pick, rand, weightedPick } from './rng';
import { isHuman } from './seats';
import type { Business, Game, News, Person } from './types';

// The rest of the town has lives too. Neighbours save, open shops on empty plots, hire each other,
// build up or go bust, and look for work. Their businesses compete with yours for the same customers.

/** The town's own dice. */
const R = (g: Game) => g.rngs.npc;

/** Plots kept free so you can always expand. */
const KEEP_FREE = 4;
/** Named people per LGA: past this, businesses hire from who is already there or not at all. */
const MAX_PEOPLE = 36;

/** Someone local is free to take a job, or there is room for a new face in town. */
function canHire(g: Game, lga: string): boolean {
  const here = g.people.filter((x) => x.lga === lga);
  if (here.length < MAX_PEOPLE) return true;
  const owners = new Set(g.businesses.map((b) => b.owner));
  return here.some((x) => x.role === 'neighbour' && x.employer === null && !owners.has(x.id) && (x.trade === 'unemployed' || x.ambition < 0.4));
}

/** No LGA gets more than this many businesses run by other people. */
const MAX_NPC_BIZ = 6;

const SHOP_NOUN: Record<BizTypeId, string> = {
  stall: 'Provisions',
  pos: 'POS & Transfers',
  buka: 'Kitchen',
  workshop: 'Fashion House',
  farm: 'Farms',
  okada: 'Okada',
  keke: 'Keke',
  supermarket: 'Supermarket',
  restaurant: 'Lounge',
  pharmacy: 'Pharmacy',
  salon: 'Salon',
  school: 'Academy',
  fleet: 'Motors',
  estate: 'Homes',
  wholesale: 'Foodstuff Depot',
  bakery: 'Bakery',
  water: 'Table Water',
  logistics: 'Haulage',
  blocks: 'Blocks Industry',
  solar: 'Solar',
  clearing: 'Clearing Agency',
  ricemill: 'Rice Mill',
};
const WORDS = {
  LA: ['Divine Favour', 'God’s Time', 'Mercy', 'Success', 'Unity', 'Royal', 'Golden', 'De Choice', 'Blessed', 'Ultimate', 'Grace', 'Pacesetter', 'Eko', 'Kingdom'],
  KN: ['Alheri', 'Barka', 'Nasara', 'Albarka', 'Bismillah', 'Jama’a', 'Hikima', 'Sabon Gari', 'Unity', 'Golden'],
  RI: ['Garden City', 'Rivers Pride', 'Treasure Base', 'Bonny Light', 'Mile One', 'Divine Favour', 'Mercy', 'Royal', 'Kingdom'],
};

/** A shop name the way Nigerian shops are named: after the owner, or after a blessing. */
export function shopName(g: Game, owner: Person, type: BizTypeId): string {
  const noun = SHOP_NOUN[type];
  const first = owner.name.replace(/^(Hon\.|Chief|Dr\.|Alh\.|Barr\.|Engr\.|Sen\.)\s+/, '').split(' ')[0];
  if (chance(R(g), 0.4)) return `${type === 'buka' ? 'Mama ' : ''}${first}${type === 'buka' ? '' : '’s'} ${noun}`.replace('Mama Mama', 'Mama');
  return `${pick(R(g), WORDS[lgaById(owner.lga).state])} ${noun}`;
}

/** Adds the town's own people and their money at the start, and opens a few businesses so the streets are not empty. */
export function seedTown(g: Game) {
  for (const l of LGAS) {
    for (let i = 0; i < 6; i++) {
      const trade = weightedPick(R(g), Object.entries(l.mix) as [TradeId, number][], ([, w]) => w)![0];
      makePerson(g, l.id, 'neighbour', trade, {}, R(g));
    }
  }
  for (const x of g.people) {
    if (isHuman(g, x.id)) continue;
    const rich = x.role === 'politician' || x.role === 'godfather';
    x.money = rich ? between(R(g), 50e6, 400e6) : Math.round(between(R(g), 80_000, 700_000) * (0.6 + 2.5 * x.ambition * x.ambition) * (0.6 + lgaById(x.lga).wealth));
  }
  for (const l of LGAS) {
    const n = 2 + Math.floor(rand(R(g)) * 2);
    for (let i = 0; i < n; i++) tryOpen(g, l.id, true);
  }
}

/** People who might open a business: ordinary residents with ambition and savings, not already busy with one. */
function entrepreneurs(g: Game, lga: string): Person[] {
  const owners = new Map<number, number>();
  for (const b of g.businesses) owners.set(b.owner, (owners.get(b.owner) ?? 0) + 1);
  // Owners who have done well can open a second, bigger business.
  const big = Math.min(...BIZ.filter((t) => t.kind !== 'starter').map((t) => openCost(g, t.id)));
  return g.people.filter(
    (x) => !isHuman(g, x.id) && x.lga === lga && ['neighbour', 'friend', 'market-leader'].includes(x.role) && x.ambition >= 0.5 && x.employer === null && !x.office && (!owners.has(x.id) || (owners.get(x.id)! < 2 && x.money > big * 1.5)),
  );
}

/** An entrepreneur in this LGA picks a business they can afford and a free plot, and opens it. */
function tryOpen(g: Game, lga: string, seeding = false): Business | null {
  const npcCount = g.businesses.filter((b) => b.lga === lga && !isHuman(g, b.owner)).length;
  if (npcCount >= MAX_NPC_BIZ) return null;
  const free = freeLots(g, lga);
  const street = free.filter((id) => hood(lga).plots[id].kind === 'street');
  const farm = free.filter((id) => hood(lga).plots[id].kind === 'farm');
  const who = weightedPick(R(g), entrepreneurs(g, lga), (x) => x.ambition * Math.sqrt(x.money));
  if (!who) return null;
  const l = lgaById(lga);
  const second = g.businesses.some((b) => b.owner === who.id);
  const options = BIZ.filter((t) => !isMobile(t.id) && (!second || t.kind !== 'starter') && (!t.where || t.where(l)) && openCost(g, t.id) <= who.money * 0.85).filter((t) => (needsFarmland(t.id) ? farm.length > 0 : street.length > KEEP_FREE));
  // Prefer what the street does not already have; bigger businesses if they can afford them.
  const t = weightedPick(R(g), options, (x: BizType) => rivalsGap(g, lga, x.id) * (x.kind === 'starter' ? 1 : 1.6) * (0.5 + rand(R(g))));
  if (!t) return null;
  const plots = needsFarmland(t.id) ? farm : street;
  const plot = plots[Math.floor(rand(R(g)) * plots.length)];
  const b = openBusiness(g, t.id, lga, false, plot, who.id, shopName(g, who, t.id));
  who.money -= openCost(g, t.id);
  if (!second) who.trade = t.ownerTrade;
  if (seeding) {
    b.level = 1 + Math.floor(rand(R(g)) * (t.kind === 'starter' ? 3 : 2));
    b.opened = -Math.round(between(R(g), 10, 120));
    for (let i = 0; i < Math.min(staffCap(b), 1 + Math.floor(rand(R(g)) * staffCap(b))); i++) if (canHire(g, lga)) hire(g, b, undefined, R(g));
  }
  return b;
}

/** 1 when nobody here runs this kind of business yet, less the more there already are. */
function rivalsGap(g: Game, lga: string, type: BizTypeId): number {
  const n = g.businesses.filter((b) => b.lga === lga && b.type === type).length;
  return 1 / (1 + 1.5 * n);
}

const tag = (b: Business) => `${b.name}, ${lgaById(b.lga).nick}`;

/**
 * A week in everybody else's life: savings, openings, hiring, growth, failure and the job market.
 * Returns the stories worth printing.
 */
export function npcWeek(g: Game): News[] {
  const news: News[] = [];
  const say = (text: string, tone: News['tone'], weight: number, where?: string) => news.push({ week: g.week, text, tone, scope: 'world', where, kind: 'business', weight });

  // Savings from work.
  for (const x of g.people) {
    if (isHuman(g, x.id) || x.office || x.role === 'politician' || x.role === 'godfather') continue;
    const t = tradeById(x.trade);
    if (x.employer !== null) {
      const b = g.businesses.find((y) => y.id === x.employer);
      if (b) x.money += 0.12 * wageWeekly(g, b);
    } else if (t.kind !== 'none' && t.id !== 'business') x.money += 0.1 * tradeIncome(g, x.lga, x.trade).income;
  }

  // Each business run by someone else.
  for (const b of g.businesses.slice()) {
    if (isHuman(g, b.owner)) continue;
    const owner = g.people[b.owner];
    // New shops get a few weeks to find their customers.
    owner.losses = b.lastProfit < 0 && g.week - b.opened >= 6 ? owner.losses + 1 : 0;
    if (owner.losses >= 6 || owner.money < -openCost(g, b.type) * 0.3) {
      for (const s of b.staff) {
        g.people[s].employer = null;
        g.people[s].trade = 'unemployed';
      }
      g.businesses = g.businesses.filter((x) => x.id !== b.id);
      if (!g.businesses.some((x) => x.owner === owner.id)) owner.trade = 'unemployed';
      owner.losses = 0;
      say(`${tag(b)} shuts its doors after weeks of losses. ${b.staff.length ? `${b.staff.length} workers are out of a job.` : ''}`.trim(), 'bad', 3 + Math.min(3, b.level), b.lga);
      continue;
    }
    if (owner.losses >= 2 && b.staff.length > 0 && chance(R(g), 0.5)) fire(g, b);
    else if (b.staff.length < staffCap(b) && b.lastProfit > 0 && owner.money > 3 * wageWeekly(g, b) && chance(R(g), 0.6) && canHire(g, b.lga)) hire(g, b, undefined, R(g));
    const cost = growCost(g, b);
    if (b.level < 5 && b.staff.length >= staffCap(b) && owner.money > cost * 2 && b.lastProfit * 25 > cost && chance(R(g), 0.2)) {
      const before = stageOf(b.type, b.level);
      b.level++;
      owner.money -= cost;
      const stage = stageOf(b.type, b.level);
      if (stage >= 3 && stage > before) say(`${tag(b)} goes up to ${['', '', '', 'two storeys', 'a big branded building', 'a flagship complex'][stage]}. ${owner.name} is now one of the area’s big employers.`, 'good', 2 + stage, b.lga);
    }
  }

  // New businesses.
  for (const l of LGAS) {
    if (!chance(R(g), 0.15)) continue;
    const b = tryOpen(g, l.id);
    if (b) say(`${g.people[b.owner].name} opens ${b.name} in ${l.nick}.`, 'good', bizType(b.type).kind === 'starter' ? 1.5 : 3, l.id);
  }

  // The job market: the jobless look for work; when the economy turns, some lose it.
  for (const x of g.people) {
    if (isHuman(g, x.id) || x.role !== 'neighbour' || x.employer !== null) continue;
    const c = g.cohorts[x.lga];
    if (x.trade === 'unemployed') {
      const jobs = TRADES.filter((t) => t.kind === 'salary' && (lgaById(x.lga).mix[t.id] ?? 0) > 0);
      const t = pick(R(g), jobs);
      if (t && chance(R(g), 0.06 * (c[t.id]?.employed ?? 0.8))) x.trade = t.id;
    } else if (tradeById(x.trade).kind === 'salary' && chance(R(g), 0.04 * (1 - (c[x.trade]?.employed ?? 0.9)))) {
      x.trade = 'unemployed';
    }
  }
  return news;
}

/** Your offer to buy a business someone else runs: more if they do not know you. */
export function buyoutPrice(g: Game, b: Business): number {
  const owner = g.people[b.owner];
  const premium = owner.losses >= 2 ? 1 : owner.relation >= 30 ? 1.25 : 1.5;
  const base = openCost(g, b.type) * (1 + 0.8 * (b.level - 1)) * 0.6;
  return Math.round((base + 6 * Math.max(0, b.lastProfit)) * premium);
}

/** Takes over a business: the owner is paid and the staff stay on. */
export function buyout(g: Game, b: Business, price: number): string {
  const owner = g.people[b.owner];
  owner.money += price;
  owner.trade = 'unemployed';
  owner.relation = clamp(owner.relation + 10, -100, 100);
  b.owner = g.me;
  b.bossDay = -1;
  b.ownerDays = 0;
  return `${owner.name} shook your hand. ${b.name} is yours, staff and all.`;
}

/** Share of local custom you would win from rivals by opening another of these here. For the open-a-business hint. */
export function rivalsNote(g: Game, lga: string, type: BizTypeId): string | null {
  const rivals = g.businesses.filter((b) => b.lga === lga && b.type === type && b.owner !== g.me);
  if (!rivals.length) return null;
  const probe = { ...rivals[0], id: -1, owner: g.me, level: 1 } as Business;
  const keep = competition({ ...g, businesses: [...g.businesses, probe] } as Game, probe);
  return `${rivals.length} already on these streets (${rivals.map((r) => r.name).join(', ')}): you would get about ${Math.round(keep * 100)}% of a lone shop’s custom.`;
}
