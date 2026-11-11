// A life beyond work: someone to come home to, children, a home you furnish, and the years going by.
// It is all kept in the player's own flags (and the people list), so old saves and the shared world need no
// change: `spouse` and `dating` hold a person id + 1, `kids` a count, `own:<thing>` what is in the house.
import { lgaById } from '../data/world';
import { rand } from './rng';
import type { Game, Player } from './types';

const P = (g: Game) => g.macro.priceLevel;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Books money in or out on this week's ledger (as life.ts does). */
function book(p: Player, label: string, amount: number) {
  const line = p.week.find((l) => l.label === label);
  if (line) line.amount += amount;
  else p.week.push({ label, amount });
  p.money += amount;
}

export interface Furnishing {
  id: string;
  name: string;
  /** Price at the start of the game, ₦. */
  price: number;
  detail: string;
  /** What it does for you each week. */
  mood: number;
  health: number;
  /** Needs light: on a week with little grid power and no generator it does nothing. */
  power?: boolean;
}

export const FURNISHINGS: Furnishing[] = [
  { id: 'bed', name: 'A proper bed and mattress', price: 85_000, detail: 'No more mat on the floor. You wake up better.', mood: 1, health: 1 },
  { id: 'fan', name: 'Standing fan', price: 38_000, detail: 'Sleep through the heat, when there is light.', mood: 0.8, health: 0.4, power: true },
  { id: 'tv', name: 'Television and decoder', price: 160_000, detail: 'Football, Nollywood and the news at home.', mood: 1.6, health: 0, power: true },
  { id: 'fridge', name: 'Fridge', price: 220_000, detail: 'Cold water, and soup that lasts the week.', mood: 1, health: 0.6, power: true },
  { id: 'sofa', name: 'Sofa and centre table', price: 180_000, detail: 'Somewhere to receive visitors like a somebody.', mood: 1.2, health: 0 },
  { id: 'ac', name: 'Air conditioner', price: 480_000, detail: 'The big one. Your light bill will know.', mood: 2.2, health: 0.6, power: true },
];

export const owns = (g: Game, id: string) => (g.flags[`own:${id}`] ?? 0) > 0;
export const spouseOf = (g: Game) => ((g.flags.spouse ?? 0) > 0 ? g.people[g.flags.spouse - 1] : null);
export const datingOf = (g: Game) => ((g.flags.dating ?? 0) > 0 ? g.people[g.flags.dating - 1] : null);
export const kidsOf = (g: Game) => g.flags.kids ?? 0;
export const furnishingPrice = (g: Game, f: Furnishing) => Math.round((f.price * Math.pow(P(g), 0.8)) / 1000) * 1000;
export const weddingCost = (g: Game) => Math.round((450_000 * P(g)) / 10_000) * 10_000;
const dateCost = (g: Game) => Math.round(9_000 * P(g));

/** The things you can do at home because of who you live with and what you own. */
export function homeExtras(g: Game): { id: string; label: string; detail: string; cost?: number; energy: number; tone: 'rest' | 'money'; blocked?: string | null }[] {
  const out: ReturnType<typeof homeExtras> = [];
  const partner = spouseOf(g) ?? datingOf(g);
  if (partner) {
    const cost = dateCost(g);
    out.push({ id: 'date', label: `${spouseOf(g) ? 'An evening out' : 'A date'} with ${partner.name.split(' ')[0]}`, detail: 'Suya, a film, a long talk. You grow closer; your mood lifts.', cost, energy: -4, tone: 'rest', blocked: g.player.money < cost ? 'Not enough money.' : null });
  }
  for (const f of FURNISHINGS) {
    if (owns(g, f.id)) continue;
    const cost = furnishingPrice(g, f);
    out.push({ id: `buy:${f.id}`, label: `Buy: ${f.name.toLowerCase()}`, detail: f.detail, cost, energy: -3, tone: 'money', blocked: g.player.money < cost ? 'Not enough money.' : null });
  }
  return out;
}

/** Does one of the home extras (the cost is already booked). Null if `id` is not one of them. */
export function familyAct(g: Game, id: string): string | null {
  const p = g.player;
  if (id === 'date') {
    const partner = spouseOf(g) ?? datingOf(g);
    if (!partner) return 'Nobody to take out.';
    partner.relation = clamp(partner.relation + 9, -100, 100);
    p.happiness = clamp(p.happiness + 9, 0, 100);
    p.social = clamp(p.social + 14, 0, 100);
    return `${partner.name.split(' ')[0]} laughed at all your jokes. Even the bad ones.`;
  }
  if (id.startsWith('buy:')) {
    const f = FURNISHINGS.find((x) => x.id === id.slice(4));
    if (!f) return null;
    g.flags[`own:${f.id}`] = 1;
    p.happiness = clamp(p.happiness + 6, 0, 100);
    return `Delivered and set up: ${f.name.toLowerCase()}. The house is taking shape.`;
  }
  return null;
}

/** Can you court this person? A reason why not, or null. */
export function courtBlocked(g: Game, person: number): string | null {
  const who = g.people[person];
  if (!who || person === g.me || g.humans.includes(person)) return 'Not them.';
  if (spouseOf(g)) return 'You are married.';
  if (who.role === 'family' || who.kin !== undefined) return 'They are family.';
  if (who.age < 21) return 'Too young.';
  return null;
}

/**
 * Courting someone you know: ask them out once you get on well, and propose when it is serious.
 * Changes `g` in place; the caller copies the game first.
 */
export function court(g: Game, person: number, step: 'ask' | 'propose'): { ok: boolean; text: string } {
  const why = courtBlocked(g, person);
  if (why) return { ok: false, text: why };
  const who = g.people[person];
  const p = g.player;
  const firstName = who.name.split(' ')[0];
  if (step === 'ask') {
    if (datingOf(g)?.id === person) return { ok: false, text: `You and ${firstName} are already seeing each other.` };
    if (who.relation < 45) return { ok: false, text: `${firstName} smiles politely. Get to know each other first (relationship 45).` };
    g.flags.dating = person + 1;
    who.relation = clamp(who.relation + 8, -100, 100);
    p.happiness = clamp(p.happiness + 8, 0, 100);
    return { ok: true, text: `${firstName} said yes. You are seeing each other now: take them out from home.` };
  }
  if (datingOf(g)?.id !== person) return { ok: false, text: `You are not seeing ${firstName}.` };
  if (who.relation < 80) return { ok: false, text: `${firstName} is not ready. Spend more time together (relationship 80).` };
  const cost = weddingCost(g);
  if (p.money < cost) return { ok: false, text: `A wedding costs about ₦${cost.toLocaleString()}: the hall, the aso ebi, the jollof.` };
  book(p, 'Wedding', -cost);
  g.flags.spouse = person + 1;
  g.flags.dating = 0;
  g.flags.wedWeek = g.week;
  who.role = 'family';
  who.kin = g.me;
  who.lga = p.home;
  who.relation = 100;
  p.happiness = clamp(p.happiness + 25, 0, 100);
  p.social = clamp(p.social + 30, 0, 100);
  p.influence[p.home] = clamp((p.influence[p.home] ?? 0) + 2, 0, 100);
  return { ok: true, text: `You and ${firstName} are married! The owambe was the talk of the street.` };
}

/** How old your character is, and when they next have a birthday. */
export const ageOf = (g: Game) => g.people[g.me]?.age ?? 25;

/**
 * Once a week, for the bound player: the household's money in and out, what the home does for you, children
 * arriving, and a birthday each year. Returns lines for your own news.
 */
export function familyWeek(g: Game): string[] {
  const p = g.player;
  const me = g.people[g.me];
  const news: string[] = [];
  if (!me) return news;
  const spouse = spouseOf(g);
  if (spouse) {
    // Two incomes, one bigger pot of soup.
    book(p, `${spouse.name.split(' ')[0]}’s contribution`, Math.round(14_000 * P(g)));
    book(p, 'Housekeeping', -Math.round(9_000 * P(g)));
    p.happiness = clamp(p.happiness + 2, 0, 100);
    p.social = clamp(p.social + 4, 0, 100);
    const kids = kidsOf(g);
    if (kids < 4 && g.week - (g.flags.wedWeek ?? g.week) >= 10 && g.week - (g.flags.kidWeek ?? -99) >= 40 && rand(g) < 0.05) {
      g.flags.kids = kids + 1;
      g.flags.kidWeek = g.week;
      p.happiness = clamp(p.happiness + 20, 0, 100);
      news.push(`A baby ${rand(g) < 0.5 ? 'girl' : 'boy'}! You and ${spouse.name.split(' ')[0]} now have ${kids + 1} child${kids ? 'ren' : ''}.`);
    }
  } else {
    const d = datingOf(g);
    // Left alone, a courtship cools.
    if (d) {
      d.relation = clamp(d.relation - 1.5, -100, 100);
      if (d.relation < 30) {
        g.flags.dating = 0;
        p.happiness = clamp(p.happiness - 8, 0, 100);
        news.push(`${d.name.split(' ')[0]} says it is not working. You are single again.`);
      }
    }
  }
  const kids = kidsOf(g);
  if (kids) {
    book(p, kids === 1 ? 'Child: food, clothes, school' : 'Children: food, clothes, school', -Math.round(8_000 * P(g) * kids));
    p.happiness = clamp(p.happiness + 1.5 * kids, 0, 100);
  }
  // What is in the house. Things that need light do little when there is none.
  const lit = g.prices[lgaById(p.home).state].grid >= 8 || p.hasGenerator;
  for (const f of FURNISHINGS) {
    if (!owns(g, f.id)) continue;
    const k = f.power && !lit ? 0.25 : 1;
    p.happiness = clamp(p.happiness + f.mood * k, 0, 100);
    p.health = clamp(p.health + f.health * k, 0, 100);
  }
  // A year is 48 weeks.
  if (g.week > 0 && g.week % 48 === 0) {
    me.age++;
    news.push(`Happy birthday: you are ${me.age}.`);
  }
  // The body keeps the score after fifty.
  if (me.age > 50) p.health = clamp(p.health - (me.age - 50) * 0.06, 0, 100);
  return news;
}
