// What players do with each other in a shared world: talk on the street and in private, send money, lend,
// buy and sell businesses, employ one another, endorse each other's campaigns, and see who is on top.
// Everything here works on the whole world (every player's seat), with the acting player bound; the server
// calls it under its lock and sends each player only what concerns them (socialView).
import { bizType } from '../data/businesses';
import { lgaById } from '../data/world';
import { businessValue, playerBusinesses, staffCap } from './business';
import { jurisdictionLgas, officeTitle } from './elections';
import { naira, netWorth } from './life';
import { bind, eachSeat, humanOf, isHuman, seatOf } from './seats';
import type { Game } from './types';

export interface ChatMsg {
  id: number;
  /** Who said it (a player's person id), or -1 for an announcement. */
  from: number;
  /** A private message to this player; null for the street (everyone in that LGA). */
  to: number | null;
  /** Where it was said. */
  lga: string;
  text: string;
  /** Real time, ms. */
  ms: number;
}

export type OfferType = 'buy' | 'sell' | 'job' | 'loan';

/** Something one player puts to another, waiting for a yes or a no. */
export interface Offer {
  id: number;
  from: number;
  to: number;
  type: OfferType;
  /** The business bought, sold or worked at. */
  business?: number;
  /** The price, the weekly wage, or the sum lent, ₦. */
  amount: number;
  /** For a loan: what comes back, and after how many weeks. */
  repay?: number;
  weeks?: number;
  ms: number;
}

/** One player on another's payroll. */
export interface PlayerJob {
  worker: number;
  business: number;
  wage: number;
}

export interface Debt {
  from: number;
  to: number;
  owed: number;
  due: number;
}

export interface BoardRow {
  id: number;
  name: string;
  worth: number;
  businesses: number;
  staff: number;
  office: string | null;
  at: string;
}

export interface Social {
  next: number;
  chat: ChatMsg[];
  offers: Offer[];
  jobs: PlayerJob[];
  debts: Debt[];
  /** `${endorser}:${candidate}` → the week it was given. */
  endorsed: Record<string, number>;
  /** The richest and the powerful, worked out for whoever is looking. */
  board?: BoardRow[];
}

type Result = { ok: boolean; text: string };
const no = (text: string): Result => ({ ok: false, text });
const yes = (text: string): Result => ({ ok: true, text });

const CHAT_KEPT = 240;
const MAX_TEXT = 240;

export function socialOf(g: Game): Social {
  const world = g as Game & { social?: Social };
  world.social ??= { next: 1, chat: [], offers: [], jobs: [], debts: [], endorsed: {} };
  return world.social;
}

const nameOf = (g: Game, id: number) => g.people[id]?.name ?? 'Someone';
const first = (g: Game, id: number) => nameOf(g, id).split(' ')[0];

function post(g: Game, from: number, to: number | null, lga: string, text: string, ms: number) {
  const s = socialOf(g);
  s.chat.push({ id: s.next++, from, to, lga, text, ms });
  if (s.chat.length > CHAT_KEPT) s.chat.splice(0, s.chat.length - CHAT_KEPT);
}

/** A private note from the world to one player (a receipt, an offer, an answer). */
const tell = (g: Game, to: number, text: string, ms: number) => post(g, -1, to, '', text, ms);
/** An announcement everyone sees. */
const announce = (g: Game, text: string, ms: number) => post(g, -1, null, '*', text, ms);

/** Another player, if `id` is one and is not you. */
function other(g: Game, id: number) {
  return Number.isInteger(id) && id !== g.me && isHuman(g, id) ? humanOf(g, id) : null;
}

/** Says something on the street where you are, or privately to one player. */
export function sendChat(g: Game, text: unknown, to: unknown, ms: number): Result {
  const clean = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
  if (!clean) return no('Say something first.');
  const s = socialOf(g);
  // No flooding: a few lines every ten seconds.
  if (s.chat.filter((m) => m.from === g.me && ms - m.ms < 10_000).length >= 5) return no('Easy. Give others a chance to talk.');
  if (to === null || to === undefined) {
    post(g, g.me, null, g.player.at, clean, ms);
    return yes('');
  }
  if (!other(g, Number(to))) return no('That player is not here.');
  post(g, g.me, Number(to), g.player.at, clean, ms);
  return yes('');
}

const whole = (v: unknown) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : 0);

/** Sends another player money, there and then. */
export function sendMoney(g: Game, to: unknown, amount: unknown, ms: number): Result {
  const them = other(g, Number(to));
  const n = whole(amount);
  if (!them) return no('That player is not here.');
  if (n < 100) return no('Send at least ₦100.');
  if (n > g.player.money) return no('You do not have that much.');
  g.player.money -= n;
  them.money += n;
  g.player.week.push({ label: `Sent to ${first(g, Number(to))}`, amount: -n });
  them.week.push({ label: `From ${first(g, g.me)}`, amount: n });
  tell(g, Number(to), `${nameOf(g, g.me)} sent you ${naira(n)}.`, ms);
  return yes(`Sent ${naira(n)} to ${first(g, Number(to))}.`);
}

/** Puts an offer to another player: to buy their business, sell them yours, employ them, or lend to them. */
export function makeOffer(g: Game, to: unknown, raw: { type?: unknown; business?: unknown; amount?: unknown; repay?: unknown; weeks?: unknown }, ms: number): Result {
  const id = Number(to);
  const them = other(g, id);
  if (!them) return no('That player is not here.');
  const s = socialOf(g);
  const type = raw?.type as OfferType;
  const amount = whole(raw?.amount);
  if (s.offers.filter((o) => o.from === g.me).length >= 6) return no('You have too many offers waiting. Withdraw one first.');
  if (amount < 100) return no('Name a figure.');
  const b = g.businesses.find((x) => x.id === Number(raw?.business));
  const offer: Offer = { id: s.next++, from: g.me, to: id, type, amount, ms };
  let line: string;
  switch (type) {
    case 'buy':
      if (!b || b.owner !== id) return no('That is not their business.');
      if (amount > g.player.money) return no('You do not have that much.');
      offer.business = b.id;
      line = `${nameOf(g, g.me)} offers ${naira(amount)} for ${b.name}.`;
      break;
    case 'sell':
      if (!b || b.owner !== g.me) return no('That is not your business.');
      offer.business = b.id;
      line = `${nameOf(g, g.me)} offers to sell you ${b.name} for ${naira(amount)}.`;
      break;
    case 'job':
      if (!b || b.owner !== g.me) return no('That is not your business.');
      if (b.staff.length >= staffCap(b)) return no('That business has no opening. Expand it first.');
      if (s.jobs.some((j) => j.worker === id)) return no('They already work for another player.');
      offer.business = b.id;
      line = `${nameOf(g, g.me)} offers you a job at ${b.name}: ${naira(amount)} a week.`;
      break;
    case 'loan': {
      const repay = whole(raw?.repay);
      const weeks = Math.max(1, Math.min(52, whole(raw?.weeks)));
      if (amount > g.player.money) return no('You do not have that much.');
      if (repay < amount) return no('They must pay back at least what you lend.');
      if (repay > amount * 3) return no('That interest is too much, even for Lagos.');
      offer.repay = repay;
      offer.weeks = weeks;
      line = `${nameOf(g, g.me)} offers to lend you ${naira(amount)}; pay back ${naira(repay)} in ${weeks} week${weeks === 1 ? '' : 's'}.`;
      break;
    }
    default:
      return no('Unknown offer.');
  }
  s.offers.push(offer);
  tell(g, id, line, ms);
  return yes(`Offer sent to ${first(g, id)}.`);
}

/** Takes back an offer you made. */
export function withdrawOffer(g: Game, offerId: unknown): Result {
  const s = socialOf(g);
  const o = s.offers.find((x) => x.id === Number(offerId) && x.from === g.me);
  if (!o) return no('No such offer.');
  s.offers = s.offers.filter((x) => x !== o);
  return yes('Offer withdrawn.');
}

/** Says yes or no to an offer made to you. */
export function answerOffer(g: Game, offerId: unknown, accept: unknown, ms: number): Result {
  const s = socialOf(g);
  const o = s.offers.find((x) => x.id === Number(offerId) && x.to === g.me);
  if (!o) return no('That offer is gone.');
  const drop = () => (s.offers = s.offers.filter((x) => x !== o));
  const them = humanOf(g, o.from);
  if (!accept || !them) {
    drop();
    if (them) tell(g, o.from, `${nameOf(g, g.me)} turned down your offer.`, ms);
    return yes('Offer declined.');
  }
  const me = g.player;
  const b = g.businesses.find((x) => x.id === o.business);
  switch (o.type) {
    case 'buy':
    case 'sell': {
      // Who pays whom: a 'buy' offer is from the buyer; a 'sell' offer is from the seller.
      const [buyer, seller, buyerId, sellerId] = o.type === 'buy' ? [them, me, o.from, g.me] : [me, them, g.me, o.from];
      if (!b || b.owner !== sellerId) {
        drop();
        return no('That business has changed hands already.');
      }
      if (buyer.money < o.amount) return no(o.type === 'buy' ? 'They no longer have the money.' : 'You do not have that much.');
      buyer.money -= o.amount;
      seller.money += o.amount;
      buyer.week.push({ label: `Bought ${b.name}`, amount: -o.amount });
      seller.week.push({ label: `Sold ${b.name}`, amount: o.amount });
      b.owner = buyerId;
      b.ownerDays = 0;
      b.bossDay = -1;
      // A player who worked there for the old owner now owns it.
      endJobs(g, (j) => j.business === b.id && j.worker === buyerId);
      s.offers = s.offers.filter((x) => x.business !== b.id);
      announce(g, `${nameOf(g, buyerId)} buys ${b.name} in ${lgaById(b.lga).nick} from ${nameOf(g, sellerId)} for ${naira(o.amount)}.`, ms);
      return yes(o.type === 'buy' ? `Sold ${b.name} for ${naira(o.amount)}.` : `${b.name} is yours.`);
    }
    case 'job': {
      if (!b || b.owner !== o.from) {
        drop();
        return no('That business has changed hands.');
      }
      if (b.staff.length >= staffCap(b)) return no('The opening has been filled.');
      endJobs(g, (j) => j.worker === g.me);
      const person = g.people[g.me];
      if (person.employer !== null) {
        const old = g.businesses.find((x) => x.id === person.employer);
        if (old) old.staff = old.staff.filter((x) => x !== g.me);
      }
      person.employer = b.id;
      b.staff.push(g.me);
      s.jobs.push({ worker: g.me, business: b.id, wage: o.amount });
      drop();
      tell(g, o.from, `${nameOf(g, g.me)} took the job at ${b.name}.`, ms);
      return yes(`You now work at ${b.name} for ${naira(o.amount)} a week.`);
    }
    case 'loan': {
      if (them.money < o.amount) return no('They no longer have the money.');
      them.money -= o.amount;
      me.money += o.amount;
      them.week.push({ label: `Lent to ${first(g, g.me)}`, amount: -o.amount });
      me.week.push({ label: `Borrowed from ${first(g, o.from)}`, amount: o.amount });
      s.debts.push({ from: o.from, to: g.me, owed: o.repay ?? o.amount, due: g.week + (o.weeks ?? 4) });
      drop();
      tell(g, o.from, `${nameOf(g, g.me)} took your loan of ${naira(o.amount)}.`, ms);
      return yes(`You borrowed ${naira(o.amount)} from ${first(g, o.from)}.`);
    }
  }
  return no('Unknown offer.');
}

function endJobs(g: Game, which: (j: PlayerJob) => boolean) {
  const s = socialOf(g);
  for (const j of s.jobs.filter(which)) {
    const b = g.businesses.find((x) => x.id === j.business);
    if (b) b.staff = b.staff.filter((x) => x !== j.worker);
    if (g.people[j.worker]?.employer === j.business) g.people[j.worker].employer = null;
  }
  s.jobs = s.jobs.filter((j) => !which(j));
}

/** Ends a job between players: the worker resigns, or the owner lets them go. */
export function endJob(g: Game, business: unknown, worker: unknown, ms: number): Result {
  const s = socialOf(g);
  const j = s.jobs.find((x) => x.business === Number(business) && x.worker === Number(worker));
  const b = g.businesses.find((x) => x.id === Number(business));
  if (!j || !b) return no('No such job.');
  if (g.me !== j.worker && g.me !== b.owner) return no('That is not yours to end.');
  endJobs(g, (x) => x === j);
  tell(g, g.me === j.worker ? b.owner : j.worker, g.me === j.worker ? `${nameOf(g, j.worker)} resigned from ${b.name}.` : `${nameOf(g, b.owner)} let you go from ${b.name}.`, ms);
  return yes(g.me === j.worker ? `You resigned from ${b.name}.` : `You let ${first(g, j.worker)} go.`);
}

/** Pays back some or all of what you owe another player, early. */
export function repayDebt(g: Game, to: unknown, amount: unknown, ms: number): Result {
  const s = socialOf(g);
  const d = s.debts.find((x) => x.to === g.me && x.from === Number(to));
  if (!d) return no('You owe them nothing.');
  const lender = humanOf(g, d.from);
  const n = Math.min(d.owed, whole(amount), Math.floor(g.player.money));
  if (n <= 0 || !lender) return no('Nothing to pay with.');
  g.player.money -= n;
  lender.money += n;
  d.owed -= n;
  g.player.week.push({ label: `Repaid ${first(g, d.from)}`, amount: -n });
  lender.week.push({ label: `${first(g, g.me)} repaid`, amount: n });
  if (d.owed <= 0) s.debts = s.debts.filter((x) => x !== d);
  tell(g, d.from, `${nameOf(g, g.me)} repaid ${naira(n)}${d.owed > 0 ? `; ${naira(d.owed)} still owed` : '. The loan is cleared'}.`, ms);
  return yes(`Repaid ${naira(n)}.`);
}

/**
 * Stands behind another player's campaign. Your standing in each LGA rubs off on them there, and everyone
 * hears about it. Once per candidate every twelve weeks.
 */
export function endorse(g: Game, to: unknown, ms: number): Result {
  const id = Number(to);
  const them = other(g, id);
  if (!them) return no('That player is not here.');
  const c = them.campaign;
  if (!c) return no(`${first(g, id)} is not running for anything.`);
  if (g.player.campaign?.office === c.office) return no('You are running against them.');
  const s = socialOf(g);
  const key = `${g.me}:${id}`;
  if (s.endorsed[key] !== undefined && g.week - s.endorsed[key] < 12) return no('You have already endorsed them this season.');
  s.endorsed[key] = g.week;
  for (const l of jurisdictionLgas(c.office)) c.push[l] = (c.push[l] ?? 0) + 0.3 + (g.player.influence[l] ?? 0) / 30 + (g.player.office ? 0.6 : 0);
  them.standing = Math.min(100, them.standing + 2);
  announce(g, `${g.player.office ? `${officeTitle(g.player.office)} ` : ''}${nameOf(g, g.me)} endorses ${nameOf(g, id)} for ${officeTitle(c.office)}.`, ms);
  return yes(`You endorsed ${first(g, id)}.`);
}

/** Once a week: wages between players are paid and loans fall due. */
export function settleSocial(g: Game, ms: number) {
  const s = socialOf(g);
  for (const j of [...s.jobs]) {
    const b = g.businesses.find((x) => x.id === j.business);
    const boss = b ? humanOf(g, b.owner) : null;
    const worker = humanOf(g, j.worker);
    // The business closed, was sold to someone who is not a player, or the worker was let go with the others.
    if (!b || !boss || !worker || !b.staff.includes(j.worker)) {
      endJobs(g, (x) => x === j);
      continue;
    }
    if (boss.money < j.wage) {
      endJobs(g, (x) => x === j);
      tell(g, j.worker, `${b.name} could not pay you this week. You have left.`, ms);
      tell(g, b.owner, `You could not pay ${nameOf(g, j.worker)}; they have left ${b.name}.`, ms);
      continue;
    }
    boss.money -= j.wage;
    worker.money += j.wage;
    boss.week.push({ label: `Wages: ${first(g, j.worker)}`, amount: -j.wage });
    worker.week.push({ label: `Salary, ${b.name}`, amount: j.wage });
  }
  for (const d of [...s.debts]) {
    if (g.week < d.due) continue;
    const borrower = humanOf(g, d.to);
    const lender = humanOf(g, d.from);
    if (!borrower || !lender) {
      s.debts = s.debts.filter((x) => x !== d);
      continue;
    }
    const n = Math.min(d.owed, Math.max(0, Math.floor(borrower.money)));
    if (n > 0) {
      borrower.money -= n;
      lender.money += n;
      d.owed -= n;
      borrower.week.push({ label: `Repaid ${first(g, d.from)}`, amount: -n });
      lender.week.push({ label: `${first(g, d.to)} repaid`, amount: n });
    }
    if (d.owed <= 0) {
      s.debts = s.debts.filter((x) => x !== d);
      tell(g, d.from, `${nameOf(g, d.to)} has repaid your loan in full.`, ms);
    } else {
      // Late: what is left grows, and people hear about it.
      d.owed = Math.round(d.owed * 1.05);
      borrower.standing = Math.max(0, borrower.standing - 1);
      tell(g, d.to, `Your loan from ${nameOf(g, d.from)} is overdue: ${naira(d.owed)} now owed.`, ms);
    }
  }
  // Offers do not wait for ever.
  s.offers = s.offers.filter((o) => ms - o.ms < 3 * 24 * 3600_000);
}

/** Everyone playing, richest first. */
export function leaderboard(g: Game): BoardRow[] {
  const was = g.me;
  const rows: BoardRow[] = [];
  eachSeat(g, (seat) => {
    if (g.ending) return;
    const mine = playerBusinesses(g);
    rows.push({ id: seat.id, name: nameOf(g, seat.id), worth: Math.round(netWorth(g)), businesses: mine.length, staff: mine.reduce((a, b) => a + b.staff.length, 0), office: g.player.office, at: g.player.at });
  });
  if (was >= 0 && g.me !== was) bind(g, was);
  return rows.sort((a, b) => b.worth - a.worth);
}

/** What one player is allowed to see: the street where they are, their own messages, offers, jobs and debts. */
export function socialView(g: Game, me: number): Social {
  const s = socialOf(g);
  const at = (g.me === me ? g.player : seatOf(g, me)?.player)?.at;
  return {
    next: s.next,
    chat: s.chat.filter((m) => (m.to === null ? m.lga === '*' || m.lga === at || m.from === me : m.to === me || m.from === me)),
    offers: s.offers.filter((o) => o.from === me || o.to === me),
    jobs: s.jobs.filter((j) => j.worker === me || g.businesses.find((b) => b.id === j.business)?.owner === me),
    debts: s.debts.filter((d) => d.from === me || d.to === me),
    endorsed: Object.fromEntries(Object.entries(s.endorsed).filter(([k]) => k.startsWith(`${me}:`))),
    board: leaderboard(g),
  };
}

/** What a business is worth, to help name a price. */
export const fairPrice = (g: Game, business: number) => {
  const b = g.businesses.find((x) => x.id === business);
  return b ? Math.round(businessValue(g, b)) : 0;
};

export const bizLabel = (g: Game, business: number) => {
  const b = g.businesses.find((x) => x.id === business);
  return b ? `${b.name} (${bizType(b.type).name.toLowerCase()}, ${lgaById(b.lga).nick})` : 'a business';
};
