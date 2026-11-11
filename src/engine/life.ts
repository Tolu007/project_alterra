import { familyAct, homeExtras } from './family';
import { PARTIES, partyById, type Level, type PartyId } from '../data/politics';
import { PLACES, TRADES, tradeById, type PerkId, type PlaceId, type Skill } from '../data/trades';
import { lgaById, stateById, type TradeId } from '../data/world';
import { clockLabel, inCampaign, inPrimaries, isMonthEnd, isWorkday, weekOfYear } from './calendar';
import { clamp, localDemand, okadaBanned, tradeIncome } from './economy';
import { FORM_PRICE, formBlocked, jurisdictionLgas, officeFor } from './elections';
import { govById, levelOf } from './government';
import { BIZ, WAGES, bizType, type BizType, type BizTypeId } from '../data/businesses';
import { businessOn, businessValue, fire, growCost, hire, isMobile, needsFarmland, openBlocked, openBusiness, openCost, playerBusinesses, sellBusiness, settleDay, stageName, staffCap, starterShift, wageWeekly, weeklyPnL } from './business';
import { hood } from './map';
import { absNow, humanOf, isHuman } from './seats';
import { attend, eventsHere, isOn } from './culture';
import { buyout, buyoutPrice, rivalsNote } from './npc';
import { between, chance, pick } from './rng';
import { MODES, parseTrip, tripDetail, tripLabel, tripsFrom } from './travel';
import { WEEKS_PER_YEAR, type Business, type Game, type Housing, type Player } from './types';

export const HOUSING: Record<Housing, { name: string; rent: number; energy: number }> = {
  family: { name: 'Family house', rent: 0, energy: 0.4 },
  room: { name: 'Room (face-me-I-face-you)', rent: 0.35, energy: 0.45 },
  flat: { name: 'One-bedroom flat', rent: 1, energy: 1 },
  duplex: { name: 'Duplex', rent: 3.2, energy: 2.4 },
};

const SKILL_NAMES: Record<Skill, string> = { edu: 'Education', tech: 'Technical', biz: 'Business', people: 'People' };
const LEARN: Record<Skill, { label: string; cost: number }> = {
  edu: { label: 'Evening classes', cost: 20_000 },
  tech: { label: 'Vocational course', cost: 15_000 },
  biz: { label: 'Business course', cost: 12_000 },
  people: { label: 'Public speaking club', cost: 8_000 },
};
export const CAMPAIGN_COST: Record<Level, number> = { lga: 300_000, state: 4_000_000, federal: 25_000_000 };

export interface DayAction {
  id: string;
  label: string;
  detail: string;
  cost?: number;
  energy: number;
  /** How long it takes, in minutes. 'sleep' takes you to the morning. */
  minutes: number;
  blocked?: string | null;
  tone?: 'work' | 'money' | 'politics' | 'rest' | 'food';
}

/** An action before its time cost is settled. */
type Draft = Omit<DayAction, 'minutes'> & { minutes?: number };

/** Opening hours, as hours after midnight (past 24 is the small hours). */
export const HOURS: Record<PlaceId, [number, number]> = {
  home: [0, 26],
  busstop: [5, 23],
  lot: [6, 21],
  market: [6.5, 19.5],
  park: [5, 23],
  workshop: [7, 19],
  farm: [6, 18],
  school: [7.5, 15],
  secretariat: [8, 16],
  office: [7, 19],
  techhub: [8, 23],
  oilsite: [6, 20],
  factory: [6, 22],
  skills: [8, 20],
  joint: [11, 26],
  party: [9, 21],
  clinic: [0, 26],
  bank: [8, 16],
  govhouse: [8, 18],
  palace: [9, 17],
  venue: [10, 26],
  airport: [5, 22],
  jetty: [6, 20],
};

/** Minutes each action takes; anything not listed takes an hour. */
const DURATION: Record<string, number> = {
  work: 480, oddjobs: 360, cook: 45, eat: 40, nap: 90, family: 120, generator: 30, network: 150, football: 120, petition: 60, protest: 180,
  govern: 180, meet: 180, join: 30, leave: 15, delegates: 120, palace: 90, clinic: 90, 'usd:buy': 30, 'usd:sell': 30, land: 60, 'land:sell': 45,
  loan: 30, repay: 20, japa: 0, sleep: 0,
};
const PREFIX_DURATION: [string, number][] = [
  ['bw:', 240], ['learn:', 180], ['apply:', 90], ['campaign:tour', 600], ['campaign:', 180], ['travel:', 75], ['form:', 30], ['donate:', 15],
  ['move:', 120], ['open:', 90], ['grow:', 60], ['sell:', 60], ['hire:', 30], ['fire:', 30], ['wage:', 10], ['buy:', 45], ['attend:', 180], ['shop:', 45],
];
const durationOf = (id: string) => DURATION[id] ?? PREFIX_DURATION.find(([k]) => id.startsWith(k))?.[1] ?? 60;
/** Work that stops when the place closes. */
const isShift = (id: string) => id === 'work' || id === 'oddjobs' || id.startsWith('bw:') || id.startsWith('learn:');

export function isOpen(g: Game, place: PlaceId): boolean {
  const [a, b] = HOURS[place];
  // Open all hours (home, the clinic): never closed, even past 2am on your own clock.
  if (a === 0 && b >= 26) return true;
  const m = g.minute;
  return (m >= a * 60 && m < b * 60) || (b > 24 && m + 1440 < b * 60);
}

function closedNote(place: PlaceId): string {
  return `Closed. Opens at ${clockLabel(HOURS[place][0] * 60)}.`;
}

/** Does your job come with this perk right now? Government jobs lose their HMO when salaries are owed. */
export function hasPerk(g: Game, perk: PerkId): boolean {
  const t = tradeById(g.player.trade);
  if (t.kind !== 'salary' || !t.perks?.includes(perk)) return false;
  if (perk === 'hmo' && t.payer === 'state' && g.states[lgaById(g.player.home).state].arrears >= 1) return false;
  if (perk === 'hmo' && t.payer === 'lga' && g.lgas[g.player.home].arrears >= 1) return false;
  return true;
}

export const perksOf = (trade: TradeId): PerkId[] => tradeById(trade).perks ?? [];

/**
 * Lets time pass for the player: the clock moves, food and company wear off, tiredness builds.
 * Hunger and loneliness cost health and energy once they get bad.
 */
export function passTime(g: Game, minutes: number, activity: 'idle' | 'work' | 'rest' = 'idle', crowd = false) {
  g.minute += minutes;
  drift(g, minutes, activity, crowd);
}

/** What the hours do to the bound player's body and mood, without moving the clock. */
export function drift(g: Game, minutes: number, activity: 'idle' | 'work' | 'rest' = 'idle', crowd = false) {
  const p = g.player;
  const h = minutes / 60;
  p.hunger = clamp(p.hunger - h * (activity === 'work' ? 2.8 : 2.1), 0, 100);
  p.social = clamp(p.social - h + (crowd ? h * 0.8 : 0), 0, 100);
  if (activity !== 'rest') p.energy = clamp(p.energy - h * 1.2, 0, 100);
  if (p.hunger < 15) {
    p.health = clamp(p.health - 0.75 * h, 0, 100);
    p.energy = clamp(p.energy - 0.75 * h, 0, 100);
  }
  const needs = (p.hunger + p.social + p.energy + p.health) / 4;
  p.happiness = clamp(p.happiness + Math.min(1, 0.03 * h) * (needs - p.happiness), 0, 100);
}

const P = (g: Game) => g.macro.priceLevel;
const foodIdx = (g: Game) => g.prices[lgaById(g.player.at).state].food;
const naira = (n: number) =>
  Math.abs(n) >= 1e9
    ? `₦${(n / 1e9).toFixed(2)}bn`
    : Math.abs(n) >= 1e6
      ? `₦${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}m`
      : Math.abs(n) >= 10_000
        ? `₦${Math.round(n / 1000)}k`
        : Math.abs(n) >= 1_000
          ? `₦${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
          : `₦${Math.round(n)}`;
export { naira };

/** Books money in or out for a player, merged into this week's line of the same name. */
export function ledgerFor(p: Player, label: string, amount: number) {
  const line = p.week.find((l) => l.label === label);
  if (line) line.amount += amount;
  else p.week.push({ label, amount });
  p.money += amount;
}

const ledger = (g: Game, label: string, amount: number) => ledgerFor(g.player, label, amount);

/** Where the player's day job is, or their first business at home. */
export function mainWork(g: Game): { place: PlaceId; id: string; lot?: number } | null {
  const p = g.player;
  const t = tradeById(p.trade);
  if (t.kind === 'salary') return { place: t.place, id: 'work' };
  const b = playerBusinesses(g).find((x) => x.lga === p.home);
  if (!b) return null;
  return isMobile(b.type) ? { place: 'park', id: `bw:${b.id}` } : { place: 'lot', id: `bw:${b.id}`, lot: b.plot };
}

const tripCost = (g: Game) => Math.round(g.fares[g.player.at] * 2);

/** Places that exist in an LGA, in scene order. */
export function placesIn(lga: string): PlaceId[] {
  const l = lgaById(lga);
  const st = stateById(l.state);
  const out: PlaceId[] = ['home', 'busstop', 'market', 'park', 'workshop'];
  if (l.farm || (l.mix.farmer ?? 0) > 0.05) out.push('farm');
  out.push('school', 'secretariat');
  if ((l.mix.office ?? 0) + (l.mix.business ?? 0) > 0.08) out.push('office');
  if ((l.mix.tech ?? 0) > 0) out.push('techhub');
  if ((l.mix.oil ?? 0) >= 0.08) out.push('oilsite');
  if ((l.mix.factory ?? 0) >= 0.05) out.push('factory');
  out.push('skills', 'joint', 'venue', 'party', 'clinic', 'bank');
  if (st.capitalLga === lga) out.push('govhouse');
  if (l.palace) out.push('palace');
  if (l.jetty) out.push('jetty');
  if (l.airport) out.push('airport');
  return out;
}

function needsFor(g: Game, trade: TradeId): string | null {
  const t = tradeById(trade);
  for (const [k, v] of Object.entries(t.needs ?? {})) {
    if (g.player.skills[k as Skill] < (v as number)) return `Needs ${SKILL_NAMES[k as Skill].toLowerCase()} skill ${v} (you have ${g.player.skills[k as Skill].toFixed(1)}).`;
  }
  return null;
}

const atHome = (g: Game) => g.player.at === g.player.home;

/**
 * In the shared world actions are instant, so the ones that pay, teach or win people over can each be
 * done once a world day (per business, course or campaign stop). Eating, shopping, travel and running
 * your businesses are not limited.
 */
export const onceADay = (id: string) => ['work', 'oddjobs', 'network', 'family', 'football', 'petition', 'protest', 'palace', 'clinic', 'delegates'].includes(id) || /^(bw|learn|campaign|apply):/.test(id);

/** In a shared world: asleep (which only happens while you are away), or this was already done today. */
function sharedBlock(g: Game, id: string): string | null {
  if (!g.shared) return null;
  if (g.asleep && g.busyUntil > absNow(g)) return `Asleep until ${clockLabel(g.busyUntil)}.`;
  if (onceADay(id) && g.flags[`did:${id}`] === g.week * 7 + g.day) return 'Done for today. Come back tomorrow.';
  return null;
}

/** Everything the player can do at a place today. */
export function actionsAt(g: Game, place: PlaceId): DayAction[] {
  const p = g.player;
  const t = tradeById(p.trade);
  const here = lgaById(p.at);
  const out: Draft[] = [];
  const tired = p.energy < 12 ? 'Too tired. Rest first.' : null;
  const fare = tripCost(g);
  const away = !atHome(g);

  if (place === t.place && t.kind === 'salary') {
    const canWork = atHome(g) || p.trade === 'tech';
    out.push({
      id: 'work',
      label: `Go to work: ${t.name.toLowerCase()}`,
      detail: `${isWorkday(g.day) ? `Paid monthly. You have shown up ${p.worked} day${p.worked === 1 ? '' : 's'} this week.` : 'Saturday overtime. Earns nothing extra, but the boss notices.'}${hasPerk(g, 'lunch') ? ' Lunch in the canteen.' : ''}`,
      energy: -18,
      blocked: !canWork ? 'Your job is back home.' : tired,
      tone: 'work',
    });
  }
  if (place === 'lot') out.push(...lotActions(g, tired));
  for (const e of eventsHere(g, p.at)) {
    if (e.place !== place || e.day !== g.day) continue;
    const on = isOn(g, e);
    out.push({
      id: `attend:${e.id}`,
      label: `${e.kind === 'owambe' ? 'Join the party' : e.kind === 'football' ? 'Watch' : 'Attend'}: ${e.title}`,
      detail: `${e.star}. ${e.ticket ? naira(e.ticket) : 'Free entry'}${e.kind === 'owambe' ? ' for the gift and the spraying' : e.kind === 'football' ? ' at the viewing centre' : ' a ticket'}. ${clockLabel(e.start)}–${clockLabel(e.end)}.`,
      cost: e.ticket,
      energy: -8,
      minutes: Math.max(30, Math.min(180, e.end - g.minute)),
      blocked: e.attended ? 'You were there.' : on ? null : g.minute < e.start - 30 ? `Starts at ${clockLabel(e.start)}.` : 'It is over.',
      tone: 'rest',
    });
  }

  switch (place) {
    case 'busstop':
      out.push(...travelActions(g, 'busstop'));
      break;
    case 'jetty':
      out.push(...travelActions(g, 'jetty'));
      break;
    case 'airport':
      out.push(...travelActions(g, 'airport'));
      break;
    case 'home':
      // In the shared world you never go to bed: your character sleeps while you are away.
      if (!g.shared) out.push({ id: 'sleep', label: g.minute >= 24 * 60 ? 'Go to bed (it is late)' : 'Go to bed', detail: g.minute < 22 * 60 ? 'Sleep through to 6am. An early night means a full recharge.' : g.minute < 24 * 60 ? 'Up at 6am.' : 'Six hours of sleep; you will wake up late.', energy: 0, minutes: 0, tone: 'rest' });
      out.push({ id: 'cook', label: 'Cook and eat at home', detail: 'Rice and stew from the pot. Hunger +45.', cost: Math.round(1_500 * foodIdx(g)), energy: 0, tone: 'food' });
      if (!g.shared) out.push({ id: 'nap', label: 'Take a nap', detail: 'An hour and a half on the mat. Energy +20.', energy: 20, tone: 'rest' });
      out.push({ id: 'family', label: 'Time with family', detail: 'Social and mood up; your people feel remembered.', cost: Math.round(3_000 * P(g)), energy: 5, tone: 'rest' });
      // Someone to take out, and things for the house (see family.ts).
      out.push(...homeExtras(g));
      break;
    case 'market':
      out.push({ id: 'eat', label: 'Eat at a mama put', detail: 'Hot food and gist. Hunger +55, a little social.', cost: Math.round(2_800 * foodIdx(g)), energy: 0, tone: 'food' });
      out.push({ id: 'oddjobs', label: 'Odd jobs (load trucks, run errands)', detail: `${naira(6_000 * Math.pow(P(g), 0.7) * Math.pow(localDemand(g, p.at), 0.5))} for a hard day.`, energy: -25, blocked: tired, tone: 'work' });
      if (!p.hasGenerator) out.push({ id: 'generator', label: 'Buy a generator', detail: 'Light when NEPA takes it. Fuel not included.', cost: Math.round(280_000 * Math.pow(P(g), 0.8)), energy: 0, blocked: p.money < 280_000 * Math.pow(P(g), 0.8) ? 'Not enough money.' : null, tone: 'money' });
      if (p.campaign?.stage === 'nominee' && campaignHere(g)) out.push(campaignAction(g, 'campaign:market', 'Meet the market women', 'Iya Oloja’s blessing moves a whole market.', 0.5));
      break;
    case 'park':
      for (const kind of ['okada', 'keke'] as const) {
        const price = Math.round(tradeById(kind).capital * Math.pow(P(g), 0.8));
        out.push({ id: `buy:${kind}`, label: `Buy a ${kind} to hire out`, detail: `A rider remits weekly. ${kind === 'okada' && okadaBanned(g, p.at) ? 'Warning: okada is banned here.' : ''}`, cost: price, energy: -5, blocked: p.money < price ? 'Not enough money.' : null, tone: 'money' });
      }
      for (const b of playerBusinesses(g)) if (b.lga === p.at && isMobile(b.type)) out.push(...ownedActions(g, b, tired));
      for (const t of BIZ) if (isMobile(t.id)) out.push(...openOffer(g, t, -1));
      out.push(...travelActions(g, 'park'));
      if (p.campaign?.stage === 'nominee' && campaignHere(g)) {
        out.push(campaignAction(g, 'campaign:rally', 'Hold a rally', 'Canopies, music, branded rice and a crowd.', 1));
        out.push(campaignAction(g, 'campaign:union', 'Meet the transport union', 'The union can move drivers and passengers.', 0.4));
      }
      if (p.campaign?.stage === 'nominee' && levelOf(p.campaign.office) === 'federal' && inCampaign(g.week, 'federal')) {
        out.push(campaignAction(g, 'campaign:tour', 'Tour the other 34 states', 'Three days of flights and rallies far from home.', 1.6));
      }
      break;
    case 'workshop':
      out.push({ id: 'learn:tech', label: 'Apprenticeship', detail: 'Learn a trade with a master. Technical skill up, small stipend.', energy: -15, blocked: tired, tone: 'work' });
      break;
    case 'farm':
      break;
    case 'school':
    case 'secretariat':
    case 'office':
    case 'techhub':
    case 'oilsite':
    case 'factory': {
      const jobs = TRADES.filter((x) => x.place === place && x.kind === 'salary' && x.id !== p.trade && here.mix[x.id]);
      for (const job of jobs) out.push(applyAction(g, job.id));
      if (place === 'secretariat') {
        out.push({ id: 'petition', label: 'Petition the chairman', detail: 'Join others complaining about levies, drains and refuse.', energy: -8, tone: 'politics' });
        if (p.office === p.at) out.push(governAction());
      }
      break;
    }
    case 'skills':
      for (const s of ['edu', 'tech', 'biz', 'people'] as Skill[]) {
        const cost = Math.round(LEARN[s].cost * Math.sqrt(P(g)));
        out.push({ id: `learn:${s}`, label: LEARN[s].label, detail: `${SKILL_NAMES[s]} ${p.skills[s].toFixed(1)} → up.`, cost, energy: -12, blocked: p.money < cost ? 'Not enough money.' : tired, tone: 'work' });
      }
      break;
    case 'joint':
      out.push({ id: 'network', label: 'Hang out and network', detail: 'Pepper soup, gist and connections. Influence up here.', cost: Math.round(5_000 * P(g)), energy: -10, tone: 'politics' });
      out.push({ id: 'football', label: 'Watch the match', detail: 'Two hours of shouting at a TV. Happiness up.', cost: Math.round(1_500 * P(g)), energy: -4, tone: 'rest' });
      break;
    case 'venue':
      out.push({ id: 'lounge', label: 'Drinks at the event centre bar', detail: 'Chilled drinks and whoever is around. Social up. Check the poster for what is on this week.', cost: Math.round(2_500 * P(g)), energy: -3, tone: 'rest' });
      break;
    case 'party':
      out.push(...partyActions(g));
      break;
    case 'clinic': {
      const hmo = hasPerk(g, 'hmo');
      const cost = hmo ? 0 : Math.round((12_000 + (100 - p.health) * 900) * P(g));
      const lapsed = !hmo && perksOf(p.trade).includes('hmo');
      out.push({
        id: 'clinic',
        label: hmo ? 'See a doctor (HMO)' : 'See a doctor',
        detail: `Health ${Math.round(p.health)} → up to ${Math.min(100, Math.round(p.health + 35))}. ${hmo ? 'Covered by your HMO card.' : lapsed ? 'Your HMO lapsed: the government owes your salary.' : 'No HMO: you pay the full bill.'}`,
        cost,
        energy: 5,
        blocked: p.money < cost ? 'Not enough money.' : null,
        tone: 'rest',
      });
      break;
    }
    case 'bank':
      out.push(...bankActions(g));
      break;
    case 'govhouse':
      out.push({ id: 'protest', label: 'Join the protest outside', detail: 'Placards and chants. Influence up; some governors arrest protesters.', energy: -18, tone: 'politics' });
      if (p.office && (p.office === here.state || p.office === 'FED')) out.push(governAction());
      if (p.campaign?.stage === 'nominee' && campaignHere(g) && p.office === p.campaign.office) {
        out.push({ id: 'campaign:rig', label: '“Deploy the machinery”', detail: 'Government resources quietly behind your campaign. Scandal risk.', energy: -10, tone: 'politics' });
      }
      break;
    case 'palace':
      out.push({ id: 'palace', label: 'Pay homage at the palace', detail: 'Bring a gift; the royal father’s blessing travels far.', cost: Math.round(20_000 * P(g)), energy: -8, tone: 'politics' });
      if (p.campaign?.stage === 'nominee' && campaignHere(g)) out.push(campaignAction(g, 'campaign:palace', 'Seek royal endorsement', 'A photo with the royal father, a speech by the chiefs.', 0.6));
      break;
  }
  if (away && place !== 'park') {
    for (const a of out) if (!a.blocked && a.id === 'work' && p.trade !== 'tech') a.blocked = 'Your work is back home.';
  }
  const open = isOpen(g, place);
  const closesIn = HOURS[place][1] * 60 - g.minute;
  return out.map((a) => {
    // In a shared world you can always act at once, except on what you already did today.
    const occupied = sharedBlock(g, a.id);
    let minutes = a.minutes ?? durationOf(a.id);
    // Shifts end when the place closes.
    if (isShift(a.id)) minutes = Math.max(0, Math.min(minutes, closesIn));
    const short = isShift(a.id) && open && minutes < 60 ? 'Closing soon. Come back tomorrow.' : null;
    return {
      ...a,
      minutes,
      blocked:
        occupied ??
        a.blocked ??
        (!open ? closedNote(place) : null) ??
        short ??
        (a.cost && p.money < a.cost ? 'Not enough money.' : null) ??
        (a.energy < 0 && place !== 'home' && fare > p.money ? 'Not even transport money.' : null),
    };
  });
}

function energyFactor(energy: number) {
  return energy < 25 ? 0.6 : energy < 45 ? 0.85 : 1;
}

/** At a plot: run your business there, or lease the plot and open one. */
function lotActions(g: Game, tired: string | null): Draft[] {
  const p = g.player;
  if (g.lot === null) return [];
  const b = businessOn(g, p.at, g.lot);
  if (b && b.owner === g.me) return ownedActions(g, b, tired);
  if (b) return npcLotActions(g, b);
  const plot = hood(p.at).plots[g.lot];
  return BIZ.filter((t) => !isMobile(t.id) && needsFarmland(t.id) === (plot.kind === 'farm')).flatMap((t) => openOffer(g, t, g.lot!));
}

/** At someone else's business: be a customer, or make them an offer. Your money is their takings. */
function npcLotActions(g: Game, b: Business): Draft[] {
  const p = g.player;
  const owner = g.people[b.owner];
  const out: Draft[] = [];
  const food = foodIdx(g);
  switch (b.type) {
    case 'buka':
      out.push({ id: `shop:eat:${b.id}`, label: `Eat at ${b.name}`, detail: 'Rice, stew and a cold drink. Hunger +55.', cost: Math.round(2_800 * food), energy: 0, minutes: 40, tone: 'food' });
      break;
    case 'restaurant':
      out.push({ id: `shop:dine:${b.id}`, label: `Dinner and drinks at ${b.name}`, detail: 'Pepper soup, grilled fish, music. Hunger +60, social up.', cost: Math.round(7_000 * P(g)), energy: 0, minutes: 90, tone: 'food' });
      break;
    case 'salon':
      out.push({ id: `shop:hair:${b.id}`, label: 'Get your hair done', detail: 'Look fresh. Mood and social up.', cost: Math.round(6_000 * P(g)), energy: 0, minutes: 90, tone: 'rest' });
      break;
    case 'pharmacy':
      out.push({ id: `shop:drugs:${b.id}`, label: 'Buy drugs over the counter', detail: 'Paracetamol, vitamin C and the pharmacist’s advice. Health +12.', cost: Math.round(8_000 * P(g)), energy: 0, minutes: 20, tone: 'rest' });
      break;
    case 'stall':
    case 'supermarket':
    case 'wholesale':
      out.push({ id: `shop:provisions:${b.id}`, label: `Buy provisions at ${b.name}`, detail: 'Bread, noodles, drinks, something to cook. Hunger +25.', cost: Math.round(4_000 * food), energy: 0, minutes: 30, tone: 'food' });
      break;
  }
  const price = buyoutPrice(g, b);
  out.push({
    id: `offer:${b.id}`,
    label: `Offer to buy ${b.name} (${naira(price)})`,
    detail: `${owner.name} runs it with ${b.staff.length} staff; last week it made ${naira(b.lastProfit)}. ${owner.losses >= 2 ? 'It is losing money, so the price is fair.' : owner.relation >= 30 ? 'They like you, so the price is friendly.' : 'They hardly know you, so they want a premium.'}`,
    cost: price,
    energy: -6,
    minutes: 60,
    blocked: p.money < price ? 'Not enough money.' : null,
    tone: 'money',
  });
  return out;
}

/** Run a business you own. */
function ownedActions(g: Game, b: Business, tired: string | null): Draft[] {
  const p = g.player;
  const out: Draft[] = [];
  {
    const t = bizType(b.type);
    const starter = t.kind === 'starter';
    out.push({
      id: `bw:${b.id}`,
      label: starter ? `Work at your ${t.name.toLowerCase()}` : `Manage ${b.name}`,
      detail: starter
        ? `About ${naira(starterShift(g, b) * energyFactor(p.energy))} a shift for you.${b.staff.length ? ' Your staff earn either way, and work harder when you are here.' : ''}`
        : `Optional: your staff earn without you, but work harder when the boss is in. This week so far: ${naira(b.week.profit)}.`,
      energy: -(t.place === 'park' ? 26 : 20),
      blocked: tired,
      tone: 'work',
    });
    const cap = staffCap(b);
    if (b.staff.length < cap) {
      const wage = wageWeekly(g, b);
      const gain = workerGain(g, b);
      out.push({ id: `hire:${b.id}`, label: `Hire a worker (${b.staff.length}/${cap})`, detail: `Pay ${naira(wage)} a week (${WAGES[b.wage].name.toLowerCase()}). ${gain > 0 ? `They bring in about ${naira(gain)} a week on top, even when you are not here.` : 'Prices are so bad right now that a worker barely covers their pay.'}`, energy: -6, blocked: p.money < wage * 2 ? 'You need two weeks’ wages in hand.' : null, tone: 'money' });
    }
    if (b.staff.length > 0) out.push({ id: `fire:${b.id}`, label: 'Let a worker go', detail: 'Cuts your wage bill. People will talk.', energy: -4, tone: 'money' });
    if (b.staff.length > 0) {
      const next = b.wage === 'min' ? 'fair' : b.wage === 'fair' ? 'generous' : 'min';
      out.push({ id: `wage:${b.id}`, label: `Change pay to ${WAGES[next].name.toLowerCase()}`, detail: `Now: ${WAGES[b.wage].name}. Better pay, harder work and loyalty.`, energy: 0, tone: 'money' });
    }
    if (b.level < 5 && !(t.staffPerLevel === 0 && starter)) {
      const cost = growCost(g, b);
      out.push({ id: `grow:${b.id}`, label: `Build up to ${stageName(b.type, b.level + 1)}`, detail: `Level ${b.level + 1}: room for ${t.staffPerLevel} more staff and more customers.`, cost, energy: -8, tone: 'money' });
    }
    out.push({ id: `sell:${b.id}`, label: `Sell this business (~${naira(businessValue(g, b))})`, detail: 'Cash out. Your staff lose their jobs.', energy: 0, tone: 'money' });
  }
  return out;
}

/** What one more worker adds to a business's weekly profit, after their wage, with you away. */
export function workerGain(g: Game, b: Business): number {
  const before = weeklyPnL(g, b, 0).profit;
  const extra = { ...b, staff: [...b.staff, -1] };
  return weeklyPnL(g, extra, 0).profit - before;
}

/** Book tonight's business takings to their owners. Returns what the bound player's businesses made. */
export function bookBusinessDay(g: Game): number {
  let total = 0;
  for (const line of settleDay(g)) {
    const owner = humanOf(g, line.owner);
    if (!owner) continue;
    ledgerFor(owner, line.label, line.amount);
    if (line.owner === g.me) total += line.amount;
  }
  return total;
}

/** Offer to open a business of this type here. */
function openOffer(g: Game, t: BizType, plot: number): Draft[] {
  const p = g.player;
  const out: Draft[] = [];
  {
    if (t.where && !t.where(lgaById(p.at))) return out;
    const cost = openCost(g, t.id);
    const finance = !!t.financed && p.money < cost;
    out.push({
      id: `open:${t.id}`,
      label: finance ? `Get a ${t.name.toLowerCase()} on work-and-pay` : `Open a ${t.name.toLowerCase()}`,
      detail: `${finance ? `No money down. Remit ${naira(t.financed! * Math.pow(P(g), 0.6))} a week for 40 weeks.` : `${t.kind === 'supplier' ? 'Supplies other businesses. ' : t.kind === 'consumer' ? 'Serves the public. ' : 'Starts as a shack. '}${t.blurb}`} No HMO or pension when you are the boss.${rivalsNote(g, p.at, t.id) ? ' ' + rivalsNote(g, p.at, t.id) : ''}`,
      cost: finance ? 0 : cost,
      energy: -10,
      blocked: openBlocked(g, t.id, p.at, plot) ?? (!finance && p.money < cost ? 'Not enough money.' : null),
      tone: 'money',
    });
  }
  return out;
}

function applyAction(g: Game, trade: TradeId): Draft {
  const t = tradeById(trade);
  const why = needsFor(g, trade);
  return {
    id: `apply:${trade}`,
    label: `Apply: ${t.name.toLowerCase()}`,
    detail: `${naira(t.base)} a month at the start. ${t.blurb}`,
    energy: -12,
    blocked: why,
    tone: 'work',
  };
}

function governAction(): Draft {
  return { id: 'govern', label: 'Hold a town hall', detail: 'Listen, promise, commission something. Approval and influence up here.', energy: -15, tone: 'politics' };
}

function campaignHere(g: Game) {
  const c = g.player.campaign;
  return !!c && inCampaign(g.week, levelOf(c.office)) && jurisdictionLgas(c.office).includes(g.player.at);
}

function campaignAction(g: Game, id: string, label: string, detail: string, weight: number): Draft {
  const level = levelOf(g.player.campaign!.office);
  const cost = Math.round(CAMPAIGN_COST[level] * weight * Math.sqrt(P(g)));
  return { id, label, detail, cost, energy: -20, blocked: g.player.money < cost ? 'Not enough money.' : null, tone: 'politics' };
}

/** Trips that leave from this place. */
function travelActions(g: Game, place: PlaceId): Draft[] {
  return tripsFrom(g)
    .filter((t) => t.board === place)
    .map((t) => ({ id: t.id, label: tripLabel(t), detail: tripDetail(t), cost: t.cost, energy: t.energy, minutes: t.minutes, blocked: t.blocked, tone: 'rest' as const }));
}

/** Ride-hailing cars, booked on the phone from wherever you are. */
export function rideHailActions(g: Game): DayAction[] {
  const occupied = sharedBlock(g, 'taxi');
  return tripsFrom(g)
    .filter((t) => t.mode === 'taxi')
    .map((t) => ({ id: t.id, label: tripLabel(t), detail: tripDetail(t), cost: t.cost, energy: t.energy, minutes: t.minutes, tone: 'rest' as const, blocked: occupied ?? t.blocked ?? (g.player.money < t.cost ? 'Not enough money.' : null) }));
}

/** An action available here, or a ride booked on the phone. */
function findAction(g: Game, id: string): DayAction | undefined {
  return actionsAt(g, g.place).find((x) => x.id === id) ?? (id.endsWith(':taxi') ? rideHailActions(g).find((x) => x.id === id) : undefined);
}

function partyActions(g: Game): Draft[] {
  const p = g.player;
  const out: Draft[] = [];
  if (!p.party) {
    for (const party of PARTIES) out.push({ id: `join:${party.id}`, label: `Join ${party.name}`, detail: 'Get a membership card. Politics starts at ward meetings.', cost: Math.round(5_000 * P(g)), energy: -5, tone: 'politics' });
    return out;
  }
  out.push({ id: 'meet', label: 'Attend the ward meeting', detail: 'Show face, contribute, be seen. Party standing up.', cost: Math.round(3_000 * P(g)), energy: -8, tone: 'politics' });
  for (const amount of [100_000, 1_000_000, 10_000_000]) {
    out.push({ id: `donate:${amount}`, label: `Donate ${naira(amount)} to the party`, detail: 'Money talks loudest at party offices.', cost: amount, energy: 0, tone: 'politics' });
  }
  for (const level of ['lga', 'state', 'federal'] as Level[]) {
    if (!inPrimaries(g.week, level)) continue;
    const office = officeFor(g, level);
    out.push({
      id: `form:${level}`,
      label: `Buy nomination form: ${govById(g, office).name}`,
      detail: `₦${(FORM_PRICE[level] / 1e6).toFixed(1)}m. Primaries are this week and next.`,
      cost: FORM_PRICE[level],
      energy: -10,
      blocked: formBlocked(g, level),
      tone: 'politics',
    });
  }
  if (p.campaign?.stage === 'aspirant') {
    const cost = Math.round(FORM_PRICE[levelOf(p.campaign.office)] * 0.5);
    out.push({ id: 'delegates', label: '“Mobilise” the delegates', detail: 'Transport money, hotel rooms, envelopes. Improves your primary odds.', cost, energy: -10, tone: 'politics' });
  }
  if (p.campaign?.stage === 'nominee' && campaignHere(g)) {
    out.push(campaignAction(g, 'campaign:posters', 'Posters and radio jingles', 'Your face on every pole in the area.', 1.5));
  }
  out.push({ id: 'leave', label: `Leave ${partyById(p.party).name}`, detail: 'Decamp. You lose most of your standing.', energy: 0, tone: 'politics' });
  return out;
}

function bankActions(g: Game): Draft[] {
  const p = g.player;
  const fx = g.macro.fxParallel;
  const out: Draft[] = [];
  if (p.money > 50_000) out.push({ id: 'usd:buy', label: 'Change half your naira to dollars', detail: `At ₦${Math.round(fx)}/$ on the parallel market. Protects you when the naira falls.`, energy: -5, tone: 'money' });
  if (p.usd > 1) out.push({ id: 'usd:sell', label: `Sell your $${Math.round(p.usd)}`, detail: `Worth ${naira(p.usd * fx * 0.98)} today.`, energy: -5, tone: 'money' });
  const plot = landPrice(g, p.at);
  out.push({ id: 'land', label: `Buy a plot of land in ${lgaById(p.at).nick}`, detail: 'Grows with rents and services. Sell any time (10% to agents).', cost: plot, energy: -10, tone: 'money' });
  if (p.assets.some((a) => a.kind === 'land' && a.lga === p.at)) out.push({ id: 'land:sell', label: 'Sell a plot here', detail: `About ${naira(plot * 0.9)}.`, energy: -5, tone: 'money' });
  const weekly = Math.max(20_000, tradeIncome(g, p.home, p.trade).income);
  const cap = Math.round(Math.min(5_000_000, weekly * 10) * P(g));
  if (p.loan < cap) out.push({ id: 'loan', label: `Borrow ${naira(cap - p.loan)}`, detail: `Interest ${(g.fed.policy.mpr + 12 - (hasPerk(g, 'staffLoan') ? 6 : 0)).toFixed(0)}% a year, charged weekly.${hasPerk(g, 'staffLoan') ? ' Staff rate.' : ''}`, energy: -5, tone: 'money' });
  if (p.loan > 0) out.push({ id: 'repay', label: `Repay loan (${naira(p.loan)})`, detail: 'Clear what you can.', energy: -5, blocked: p.money <= 0 ? 'Nothing to repay with.' : null, tone: 'money' });
  for (const h of ['room', 'flat', 'duplex'] as Housing[]) {
    if (h === p.housing && p.at === p.home) continue;
    const cost = Math.round(g.rent[p.at] * HOUSING[h].rent * 1.1);
    out.push({ id: `move:${h}`, label: `Rent a ${HOUSING[h].name.toLowerCase()} here`, detail: `${naira(cost)}: a year up front plus agent and legal fees. ${p.at !== p.home ? 'This becomes your home LGA.' : ''}`, cost, energy: -10, tone: 'money' });
  }
  const japa = japaCost(g);
  out.push({ id: 'japa', label: 'Japa: apply to emigrate', detail: `Visa, proof of funds, flight: about ${naira(japa)}. Ends this life.`, cost: japa, energy: 0, tone: 'money' });
  return out;
}

export const landPrice = (g: Game, lga: string) => Math.round(g.rent[lga] * 4);
export const japaCost = (g: Game) => Math.round(8_000_000 * (g.macro.fxParallel / 1500));

// ───────────── doing things ─────────────

/** Applies one day's action (check actionBlocked first). Mutates `g`; returns what happened. */
/** Checks an action is allowed here and now; null when it is. */
export function actionBlocked(g: Game, id: string): string | null {
  const a = findAction(g, id);
  if (!a) return 'You can’t do that here.';
  return a.blocked ?? null;
}

export function act(g: Game, id: string): string {
  const p = g.player;
  const t = tradeById(p.trade);
  const a = findAction(g, id)!;

  if (a.cost) ledger(g, a.label, -a.cost);
  // One round trip a day covers every errand away from home.
  const today = g.week * 7 + g.day;
  const staffBus = id === 'work' && hasPerk(g, 'transport');
  if (g.place !== 'home' && !id.startsWith('travel:') && !(t.levy === 'park' && id === 'work') && !staffBus && g.flags.tripDay !== today) {
    ledger(g, 'Transport', -tripCost(g));
    g.flags.tripDay = today;
  }
  p.energy = clamp(p.energy + a.energy, 0, 100);
  const here = p.at;

  // The clock moves while you do it (offline; in the shared world actions are instant).
  const minutes = a.minutes;
  const working = isShift(id);
  const crowd = working && (g.place === 'market' || g.place === 'park' || g.place === 'lot');
  const startedAt = g.minute;
  const activity = working ? 'work' : id === 'nap' || id === 'family' ? 'rest' : 'idle';
  if (g.shared) {
    // The clock belongs to everyone and nobody waits: the action is done at once. Needs wear down with
    // the world's hours instead.
    if (onceADay(id)) g.flags[`did:${id}`] = today;
  } else passTime(g, minutes, activity, crowd || id === 'network' || id.startsWith('attend:'));

  if (id === 'work') {
    // Salaried job: pay comes at month end; this records attendance.
    if (g.flags.workDay !== today) p.worked++;
    g.flags.workDay = today;
    if (hasPerk(g, 'lunch')) p.hunger = clamp(p.hunger + 30, 0, 100);
    const late = startedAt > 9.5 * 60 && isWorkday(g.day);
    if (late) p.queries = Math.min(3, p.queries + 0.25);
    if (minutes < 300) return `You came in at ${clockLabel(startedAt)} and did ${Math.round(minutes / 60)} hours. Your supervisor looked at the clock.`;
    return isWorkday(g.day) ? `A full day at work, ${clockLabel(startedAt)} to ${clockLabel(startedAt + minutes)}.${late ? ' You were late; it was noted.' : ''} The month-end alert is what keeps you going.` : 'Saturday overtime. Your supervisor saw you.';
  }
  if (id === 'sleep') return pick(g, ['Lights out. The generator next door keeps singing.', 'You slept like a baby.', 'Mosquitoes held a rally in your room, but you slept.']);
  if (id === 'nap') {
    p.health = clamp(p.health + 2, 0, 100);
    return 'Forty winks on the mat. Much better.';
  }
  if (id === 'cook') {
    p.hunger = clamp(p.hunger + 45, 0, 100);
    return pick(g, ['Rice and stew. Simple and sweet.', 'Eba and egusi. You licked your fingers.', 'Indomie and egg, the student special.']);
  }
  if (id === 'eat') {
    p.hunger = clamp(p.hunger + 55, 0, 100);
    p.social = clamp(p.social + 5, 0, 100);
    return pick(g, ['Mama put gave you extra meat. You are her favourite now.', 'Amala, ewedu, gbegiri. The gist at the table was even hotter.', 'Rice and dodo, plus the latest gossip about the chairman.']);
  }
  const homeLife = familyAct(g, id);
  if (homeLife !== null) return homeLife;
  if (id === 'family') {
    p.happiness = clamp(p.happiness + 7, 0, 100);
    p.social = clamp(p.social + 18, 0, 100);
    for (const x of g.people) if (x.role === 'family') x.relation = clamp(x.relation + 6, -100, 100);
    return 'Mama made pepper soup. Your brother asked for “small money”. It was a good day.';
  }
  if (id === 'oddjobs') {
    const earned = 6_000 * Math.pow(P(g), 0.7) * Math.pow(localDemand(g, here), 0.5) * between(g, 0.8, 1.2);
    ledger(g, 'Odd jobs', earned);
    p.health = clamp(p.health - 2, 0, 100);
    return `Hard work in the sun: ${naira(earned)}.`;
  }
  if (id.startsWith('bw:')) {
    const b = g.businesses.find((x) => x.id === Number(id.slice(3)))!;
    const type = bizType(b.type);
    if (b.bossDay !== today) b.ownerDays++;
    b.bossDay = today;
    if (g.flags.workDay !== today) p.worked++;
    g.flags.workDay = today;
    if (type.kind === 'starter') {
      const earned = starterShift(g, b) * (minutes / 240) * energyFactor(p.energy - a.energy) * between(g, 0.85, 1.15);
      ledger(g, 'Work', earned);
      const skill = tradeById(type.trade!).skill;
      p.skills[skill] = Math.min(5, p.skills[skill] + 0.01);
      return minutes < 200 ? `A short shift till closing: ${naira(earned)}.` : `You worked ${clockLabel(startedAt)} to ${clockLabel(startedAt + minutes)} and made ${naira(earned)}.`;
    }
    p.skills.biz = Math.min(5, p.skills.biz + 0.015);
    return pick(g, ['You checked the books, chased two debtors and calmed a supplier.', 'Inventory counted, staff briefed, one customer complaint handled.', 'A long day of meetings, calls and “oga, we need small money for…”.']);
  }
  if (id.startsWith('attend:')) {
    const e = g.culture.find((x) => x.id === Number(id.slice(7)))!;
    return attend(g, e);
  }
  if (id.startsWith('shop:')) {
    const [, kind, bid] = id.split(':');
    const b = g.businesses.find((x) => x.id === Number(bid))!;
    // What you spend is their takings; about half of it is margin.
    const spent = a.cost ?? 0;
    b.week.revenue += spent;
    b.week.inputs += spent * 0.5;
    b.week.profit += spent * 0.5;
    g.people[b.owner].money += spent * 0.5;
    if (kind === 'eat') p.hunger = clamp(p.hunger + 55, 0, 100);
    if (kind === 'dine') {
      p.hunger = clamp(p.hunger + 60, 0, 100);
      p.social = clamp(p.social + 12, 0, 100);
    }
    if (kind === 'hair') {
      p.happiness = clamp(p.happiness + 8, 0, 100);
      p.social = clamp(p.social + 5, 0, 100);
    }
    if (kind === 'drugs') p.health = clamp(p.health + 12, 0, 100);
    if (kind === 'provisions') p.hunger = clamp(p.hunger + 25, 0, 100);
    g.people[b.owner].relation = clamp(g.people[b.owner].relation + 2, -100, 100);
    return pick(g, [`${g.people[b.owner].name.split(' ')[0]} thanked you: “Customer is king. Come again!”`, `Good service at ${b.name}. You will be back.`, `They added a little extra. Loyal customers get “jara”.`]);
  }
  if (id.startsWith('offer:')) {
    const b = g.businesses.find((x) => x.id === Number(id.slice(6)))!;
    const text = buyout(g, b, a.cost ?? 0);
    if (tradeById(p.trade).kind !== 'salary' || p.trade === 'unemployed') p.trade = bizType(b.type).ownerTrade;
    return text;
  }
  if (id.startsWith('open:')) {
    const type = bizType(id.slice(5) as BizTypeId);
    const financed = !!type.financed && !a.cost;
    const b = openBusiness(g, type.id, p.at, financed, isMobile(type.id) ? -1 : g.lot!);
    if (tradeById(p.trade).kind !== 'salary' || p.trade === 'unemployed') p.trade = type.ownerTrade;
    return `Grand opening! ${b.name} is yours.${financed ? ' The owner wants his remittance every Sunday.' : ''}`;
  }
  if (id.startsWith('hire:')) {
    const b = g.businesses.find((x) => x.id === Number(id.slice(5)))!;
    const who = g.people[hire(g, b)];
    return `You hired ${who.name}. “Thank you, boss! I will not disappoint you.”`;
  }
  if (id.startsWith('fire:')) {
    const b = g.businesses.find((x) => x.id === Number(id.slice(5)))!;
    const who = fire(g, b);
    return who !== null ? `You let ${g.people[who].name} go. It was not a happy conversation.` : 'Nobody to let go.';
  }
  if (id.startsWith('wage:')) {
    const b = g.businesses.find((x) => x.id === Number(id.slice(5)))!;
    b.wage = b.wage === 'min' ? 'fair' : b.wage === 'fair' ? 'generous' : 'min';
    for (const s of b.staff) g.people[s].relation = clamp(g.people[s].relation + (b.wage === 'min' ? -15 : 10), -100, 100);
    return `Staff are now on ${WAGES[b.wage].name.toLowerCase()}.`;
  }
  if (id.startsWith('grow:')) {
    const b = g.businesses.find((x) => x.id === Number(id.slice(5)))!;
    b.level++;
    return `${b.name} is now level ${b.level}. Bigger, busier, more staff wanted.`;
  }
  if (id.startsWith('sell:')) {
    const b = g.businesses.find((x) => x.id === Number(id.slice(5)))!;
    const got = sellBusiness(g, b);
    ledger(g, `Sold ${b.name}`, got);
    if (!playerBusinesses(g).length && tradeById(p.trade).kind !== 'salary') p.trade = 'unemployed';
    return `Sold for ${naira(got)}.`;
  }
  if (id.startsWith('apply:')) {
    const trade = id.slice(6) as TradeId;
    const def = tradeById(trade);
    const unemployment = g.cohorts[here].unemployed?.workers ?? 0.05;
    const surplus = Object.entries(def.needs ?? {}).reduce((s, [k, v]) => s + (p.skills[k as Skill] - (v as number)), 0);
    const odds = clamp(0.3 + 0.12 * surplus + 0.004 * p.influence[here] - unemployment * 0.5 + (def.payer !== 'private' ? 0.05 * p.skills.people : 0), 0.05, 0.85);
    if (chance(g, odds)) {
      p.trade = trade;
      p.hired = false;
      p.scale = 1;
      p.queries = 0;
      p.worked = 0;
      return `You got the job! ${def.name}. Resumption is Monday.`;
    }
    return pick(g, ['“We will get back to you.” They will not.', 'The interview went well. Somebody’s nephew got the job.', 'They want three years of experience for an entry-level role.']);
  }
  if (id.startsWith('learn:')) {
    const s = id.slice(6) as Skill;
    const gain = 0.22 * (1 - p.skills[s] / 6);
    p.skills[s] = Math.min(5, p.skills[s] + gain);
    if (g.place === 'workshop') ledger(g, 'Apprentice stipend', Math.round(2_000 * P(g)));
    return `${SKILL_NAMES[s]} skill now ${p.skills[s].toFixed(2)}.`;
  }
  if (id === 'network') {
    p.social = clamp(p.social + 16, 0, 100);
    p.influence[here] = clamp(p.influence[here] + 3 * (1 + p.skills.people / 5), 0, 100);
    p.skills.people = Math.min(5, p.skills.people + 0.03);
    const local = g.people.filter((x) => x.lga === here && !isHuman(g, x.id));
    if (local.length) {
      const friend = pick(g, local);
      friend.relation = clamp(friend.relation + 8, -100, 100);
      return `You gisted with ${friend.name} till late. People here know your face better now.`;
    }
    return 'People here know your face better now.';
  }
  if (id === 'lounge') {
    p.social = clamp(p.social + 8, 0, 100);
    p.happiness = clamp(p.happiness + 3, 0, 100);
    return pick(g, ['A cold drink and the gist about who is performing on Saturday.', 'The DJ was testing the speakers. You stayed for three songs.']);
  }
  if (id === 'football') {
    p.happiness = clamp(p.happiness + 7, 0, 100);
    p.social = clamp(p.social + 10, 0, 100);
    return pick(g, ['Last-minute winner! The whole joint went mad.', 'A boring draw, but the suya was hot.', 'Your team lost. You blame the referee, the coach and NEPA.']);
  }
  if (id.startsWith('join:')) {
    p.party = id.slice(5) as PartyId;
    p.standing = 5;
    return `You are now a card-carrying member of the ${partyById(p.party).name}.`;
  }
  if (id === 'meet') {
    p.standing = clamp(p.standing + 3 + p.skills.people * 0.6, 0, 100);
    p.influence[here] = clamp(p.influence[here] + 1.5, 0, 100);
    return 'You sat through four hours of speeches and one fight. The chairman noted your face.';
  }
  if (id.startsWith('donate:')) {
    const amount = Number(id.slice(7));
    p.standing = clamp(p.standing + Math.min(30, 4 * Math.log10(amount / 10_000) * 2), 0, 100);
    return 'The party chairman called you “a true party man”.';
  }
  if (id.startsWith('form:')) {
    const level = id.slice(5) as Level;
    p.campaign = { office: officeFor(g, level), stage: 'aspirant', spent: 0, push: {} };
    return `You are an aspirant for ${govById(g, p.campaign.office).name}. The delegates vote at the end of the primary window.`;
  }
  if (id === 'delegates') {
    p.campaign!.spent += a.cost ?? 0;
    return 'Envelopes delivered. The delegates are “considering”.';
  }
  if (id === 'leave') {
    p.party = null;
    p.standing = Math.max(0, p.standing * 0.2);
    p.campaign = null;
    return 'You tore your membership card on live TV.';
  }
  if (id.startsWith('campaign:')) {
    const c = p.campaign!;
    const kind = id.slice(9);
    const boost = { rally: 3, market: 2, union: 2, palace: 2.5, posters: 0, tour: 0, rig: 0 }[kind] ?? 1;
    if (kind === 'posters') {
      for (const l of jurisdictionLgas(c.office)) c.push[l] = (c.push[l] ?? 0) + 0.8;
      if (levelOf(c.office) === 'federal') c.push.REST = (c.push.REST ?? 0) + 0.5;
      c.spent += a.cost ?? 0;
      return 'Your face is now on every electric pole. Next to your opponent’s.';
    }
    if (kind === 'tour') {
      c.push.REST = (c.push.REST ?? 0) + 3;
      p.energy = clamp(p.energy - 20, 0, 100);
      return 'Rallies in Ibadan, Enugu, Kaduna and Abuja. You are exhausted but known.';
    }
    if (kind === 'rig') {
      g.wflags[`rig:${c.office}`] = 1;
      p.scandal = clamp(p.scandal + 20, 0, 100);
      return 'Ward agents, “materials” and a friendly electoral officer. Nobody wrote anything down. Hopefully.';
    }
    c.push[here] = (c.push[here] ?? 0) + boost;
    c.spent += a.cost ?? 0;
    p.influence[here] = clamp(p.influence[here] + boost * 1.2, 0, 100);
    return kind === 'rally' ? 'The crowd danced, ate, and chanted your name. Some might even vote.' : 'Hands shaken, promises made, envelopes passed.';
  }
  if (id === 'clinic') {
    p.health = clamp(p.health + 35, 0, 100);
    return hasPerk(g, 'hmo') ? 'The HMO card did the talking. Drip, injection, no bill. You feel better.' : 'Drip, injection, “come back on Thursday”. You feel better.';
  }
  if (id === 'generator') {
    p.hasGenerator = true;
    return 'I better pass my neighbour. Your new generator roars to life.';
  }
  if (id.startsWith('buy:')) {
    const kind = id.slice(4) as 'okada' | 'keke';
    p.assets.push({ kind, lga: here, price: a.cost ?? 0, week: g.week });
    return `You bought a ${kind} and found a rider. Remittance every Sunday, by God’s grace.`;
  }
  if (id.startsWith('travel:')) {
    const trip = parseTrip(id, here)!;
    const to = trip.to;
    p.at = to;
    const arrive = MODES[trip.mode].arrive;
    g.place = placesIn(to).includes(arrive) ? arrive : 'busstop';
    g.lot = null;
    const where = g.place === 'airport' ? lgaById(to).airport : g.place === 'jetty' ? lgaById(to).jetty : g.place === 'park' ? 'the motor park' : 'the bus stop';
    return `You arrive in ${lgaById(to).nick}${where ? `, at ${where}` : ''}.`;
  }
  if (id === 'usd:buy') {
    const naira0 = p.money / 2;
    p.money -= naira0;
    p.usd += naira0 / g.macro.fxParallel;
    p.week.push({ label: 'Changed to dollars', amount: -naira0 });
    return `You now hold $${Math.round(p.usd)}. The mallam at the bureau smiled.`;
  }
  if (id === 'usd:sell') {
    const got = p.usd * g.macro.fxParallel * 0.98;
    p.usd = 0;
    ledger(g, 'Sold dollars', got);
    return `You sold your dollars for ${naira(got)}.`;
  }
  if (id === 'land') {
    p.assets.push({ kind: 'land', lga: here, price: a.cost ?? 0, week: g.week });
    return `You bought a plot in ${lgaById(here).nick}. The omonile says no wahala. For now.`;
  }
  if (id === 'land:sell') {
    const i = p.assets.findIndex((x) => x.kind === 'land' && x.lga === here);
    const got = landPrice(g, here) * 0.9;
    p.assets.splice(i, 1);
    ledger(g, 'Sold land', got);
    return `Sold for ${naira(got)}.`;
  }
  if (id === 'loan') {
    const weekly = Math.max(20_000, tradeIncome(g, p.home, p.trade).income);
    const amount = Math.round(Math.min(5_000_000, weekly * 10) * P(g)) - p.loan;
    p.loan += amount;
    ledger(g, 'Loan', amount);
    return `${naira(amount)} credited. The repayment alerts will start on Sunday.`;
  }
  if (id === 'repay') {
    const amount = Math.min(p.loan, Math.max(0, p.money));
    p.loan -= amount;
    ledger(g, 'Loan repayment', -amount);
    return p.loan > 0 ? `Paid ${naira(amount)}. ${naira(p.loan)} still owed.` : 'Loan cleared. Freedom.';
  }
  if (id.startsWith('move:')) {
    const h = id.slice(5) as Housing;
    p.housing = h;
    p.home = here;
    p.rentDue = g.week + 48;
    return `You moved into a ${HOUSING[h].name.toLowerCase()} in ${lgaById(here).nick}. The landlord's rules are pasted by the door.`;
  }
  if (id === 'japa') {
    g.ending = { kind: 'japa', week: g.week, text: 'You packed two Ghana-must-go bags and left for Manchester. Your family group chat is now 80% voice notes about the cold.' };
    g.phase = 'over';
    return 'Bye bye, Naija.';
  }
  if (id === 'palace') {
    p.influence[here] = clamp(p.influence[here] + 5, 0, 100);
    p.skills.people = Math.min(5, p.skills.people + 0.04);
    return 'The royal father prayed for you. The chiefs will remember your gift.';
  }
  if (id === 'petition') {
    p.influence[here] = clamp(p.influence[here] + 2, 0, 100);
    for (const c of Object.values(g.cohorts[here])) c.sat.lga = clamp(c.sat.lga - 0.4, 0, 100);
    return 'The chairman was “in a meeting”. His PA collected your letter and smiled.';
  }
  if (id === 'protest') {
    p.influence[here] = clamp(p.influence[here] + 4, 0, 100);
    const st = g.states[lgaById(here).state];
    if (st.style === 'tyrant' && !isHuman(g, st.leader) && chance(g, 0.3)) {
      ledger(g, 'Bail', -Math.round(50_000 * P(g)));
      p.health = clamp(p.health - 10, 0, 100);
      return 'Police teargassed the crowd. You spent the night in a cell and paid “bail”.';
    }
    return 'You marched, you chanted, you went viral for one afternoon.';
  }
  if (id === 'govern') {
    const level = levelOf(p.office!);
    for (const c of Object.values(g.cohorts[here])) c.sat[level] = clamp(c.sat[level] + 3, 0, 100);
    p.influence[here] = clamp(p.influence[here] + 3, 0, 100);
    return 'You commissioned a borehole, listened for three hours, and promised a road.';
  }
  return 'Done.';
}

// ───────────── Sunday settlement ─────────────

/** End-of-week money, health and mood for the player. Returns news-worthy lines. */
export function weeklyLife(g: Game): string[] {
  const p = g.player;
  const t = tradeById(p.trade);
  const l = lgaById(p.home);
  const pr = g.prices[l.state];
  const out: string[] = [];

  // Living costs (meals are paid as you eat them).
  ledger(g, 'Foodstuff & household', -5_000 * (pr.food / 1.12) * (p.housing === 'duplex' ? 2 : 1));
  const energy = pr.energy * HOUSING[p.housing].energy * (p.hasGenerator ? 1 : 0.55);
  ledger(g, 'Light & fuel', -energy);
  if (!hasPerk(g, 'data')) ledger(g, 'Data & airtime', -2_500 * Math.sqrt(P(g)));

  // Work.
  if (t.kind === 'salary') {
    if (p.worked < 4) {
      p.queries++;
      out.push(p.queries >= 3 ? `Sacked from your job as ${t.name.toLowerCase()} for absenteeism` : `Query from your employer: you only came to work ${p.worked} days`);
      if (p.queries >= 3) {
        p.trade = 'unemployed';
        p.queries = 0;
      }
    }
    g.flags.salaryWeeks = (g.flags.salaryWeeks ?? 0) + (p.trade === t.id ? 1 : 0);
    if (isMonthEnd(g.week) && p.trade === t.id) {
      const weekly = tradeIncome(g, p.home, p.trade).income;
      const pay = weekly * (g.flags.salaryWeeks ?? 4);
      g.flags.salaryWeeks = 0;
      if (pay < 1) out.push('Salary alert: ₦0. “Funds are being processed.”');
      else {
        ledger(g, 'Salary', pay);
        if (hasPerk(g, 'pension')) p.pension += pay * 0.1;
      }
      // The 13th month lands with December's salary.
      if (pay >= 1 && hasPerk(g, 'bonus') && weekOfYear(g.week) === WEEKS_PER_YEAR - 1) {
        ledger(g, '13th-month bonus', weekly * 4);
        out.push('13th-month bonus paid. Christmas is sorted');
      }
    }
  }
  p.worked = 0;

  // Assets.
  for (const asset of p.assets) {
    if (asset.kind === 'land') continue;
    const rider = tradeIncome(g, asset.lga, asset.kind).income;
    ledger(g, `${asset.kind === 'keke' ? 'Keke' : 'Okada'} remittance`, rider * (asset.kind === 'keke' ? 0.38 : 0.32) * between(g, 0.7, 1.1));
  }

  // Debt.
  if (p.loan > 0) {
    const interest = (p.loan * (g.fed.policy.mpr + 12 - (hasPerk(g, 'staffLoan') ? 6 : 0))) / 100 / 48;
    ledger(g, 'Loan interest', -interest);
  }
  if (p.money < 0) {
    p.loan += -p.money;
    p.week.push({ label: 'Borrowed from a loan app', amount: -p.money });
    p.money = 0;
    p.happiness = clamp(p.happiness - 6, 0, 100);
    out.push('Sapa. You borrowed from a loan app to cover the week');
  }

  // Rent.
  if (p.housing !== 'family' && g.week >= p.rentDue) {
    const rent = g.rent[p.home] * HOUSING[p.housing].rent * (1 + (g.flags.rentPremium ?? 0));
    if (p.money >= rent) {
      ledger(g, 'Rent (a year up front)', -rent);
      if (hasPerk(g, 'housing')) ledger(g, 'Housing allowance', rent * 0.4);
      p.rentDue = g.week + 48;
      g.flags.rentPremium = 0;
      out.push(`Rent paid: ${naira(rent)} for the year`);
    } else {
      p.housing = 'family';
      p.happiness = clamp(p.happiness - 15, 0, 100);
      out.push('Evicted. The landlord changed the locks. You are back in the family house');
    }
  }

  // Body and mind.
  p.energy = clamp(p.energy + 20, 0, 100);
  p.social = clamp(p.social + 8, 0, 100);
  if (p.energy < 25) p.health = clamp(p.health - 5, 0, 100);
  else p.health = clamp(p.health + 1.5, 0, 100);
  const net = p.week.reduce((s, x) => s + x.amount, 0);
  p.happiness = clamp(p.happiness + (net > 0 ? 2 : -3) + (pr.grid > 10 ? 1 : pr.grid < 6 ? -1 : 0) + (p.health < 40 ? -3 : 0), 0, 100);
  for (const k of Object.keys(p.influence)) p.influence[k] *= 0.99;
  p.standing *= 0.995;
  p.scandal *= 0.93;
  if (p.office) {
    // Officeholders gain influence across their whole jurisdiction.
    for (const id of jurisdictionLgas(p.office)) p.influence[id] = clamp(p.influence[id] + 0.6, 0, 100);
    const level = levelOf(p.office);
    ledger(g, 'Official salary', { lga: 300_000, state: 625_000, federal: 900_000 }[level]);
  }

  p.lastWeek = p.week;
  p.week = [];
  checkGoals(g);
  return out;
}

export const GOALS: { id: string; name: string; test: (g: Game) => boolean }[] = [
  { id: 'million', name: 'Your first ₦1 million', test: (g) => netWorth(g) >= 1_000_000 },
  { id: 'dollars', name: 'Savings in dollars', test: (g) => g.player.usd >= 1_000 },
  { id: 'land', name: 'Own a plot of land', test: (g) => g.player.assets.some((a) => a.kind === 'land') },
  { id: 'fleet', name: 'Own a keke or okada on hire', test: (g) => g.player.assets.some((a) => a.kind !== 'land') },
  { id: 'boss', name: 'Expand a business to level 2', test: (g) => playerBusinesses(g).some((b) => b.level >= 2) },
  { id: 'employer', name: 'Employ 5 people', test: (g) => playerBusinesses(g).reduce((s, b) => s + b.staff.length, 0) >= 5 },
  { id: 'chain', name: 'Own a supplier and a business it supplies', test: (g) => playerBusinesses(g).some((s) => bizType(s.type).feeds.some((f) => playerBusinesses(g).some((b) => b.type === f))) },
  { id: 'mogul', name: 'Business mogul: 5 businesses', test: (g) => playerBusinesses(g).length >= 5 },
  { id: 'flat', name: 'Live in your own flat', test: (g) => g.player.housing === 'flat' || g.player.housing === 'duplex' },
  { id: 'chairman', name: 'Become LGA chairman', test: (g) => !!g.player.office && levelOf(g.player.office) === 'lga' },
  { id: 'governor', name: 'Become governor', test: (g) => !!g.player.office && levelOf(g.player.office) === 'state' },
  { id: 'president', name: 'Become president', test: (g) => g.player.office === 'FED' },
  { id: 'hundred', name: 'Net worth ₦100 million', test: (g) => netWorth(g) >= 100_000_000 },
  { id: 'billion', name: 'Billionaire', test: (g) => netWorth(g) >= 1_000_000_000 },
];

function checkGoals(g: Game) {
  for (const goal of GOALS) if (!g.player.goals.includes(goal.id) && goal.test(g)) g.player.goals.push(goal.id);
}

export function netWorth(g: Game): number {
  const p = g.player;
  const assets = p.assets.reduce((s, a) => s + (a.kind === 'land' ? landPrice(g, a.lga) : a.price * 0.6), 0);
  const firms = playerBusinesses(g).reduce((s, b) => s + businessValue(g, b), 0);
  return p.money + p.usd * g.macro.fxParallel + assets + firms + p.pension - p.loan;
}

export const placeName = (place: PlaceId) => PLACES[place].name;
