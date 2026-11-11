// Land and buildings. Every plot in town has an owner: at the start that is the family, the church or the
// company that was always there. A player can buy any of them (bar what belongs to the public), collect
// the rent, pull the building down, and have a construction company put something new up. The companies
// themselves can be bought: then their margin on every job, yours or anybody else's, is your profit.
// It is all kept in `g.estate` (one deed per plot that has changed hands or changed shape) and
// `g.builders`, both missing from old saves and filled in on first use.
import type { PlaceId } from '../data/trades';
import { lgaById } from '../data/world';
import { hood, type Plot } from './map';
import type { Game, Player } from './types';

export type BuildId = 'bungalow' | 'duplex' | 'flats' | 'shops' | 'warehouse' | 'plaza' | 'hotel' | 'office';
/** What the town began with on its ordinary plots. */
export type FillerKind = 'house' | 'flats' | 'church' | 'mosque' | 'kiosks' | 'unfinished' | 'station' | 'trees';

export interface BuildType {
  id: BuildId;
  name: string;
  /** Contract price at the start of the game, ₦, before the builder's rate. */
  cost: number;
  weeks: number;
  /** Rent it brings in, counted in one-bedroom flats. */
  units: number;
  /** Smallest plot (w × d) it fits on. */
  area: number;
  detail: string;
}

export const BUILDS: BuildType[] = [
  { id: 'bungalow', name: 'Bungalow', cost: 18_000_000, weeks: 5, units: 1.3, area: 0, detail: 'Three bedrooms and a compound wall.' },
  { id: 'shops', name: 'Row of lock-up shops', cost: 26_000_000, weeks: 5, units: 2.4, area: 0, detail: 'Six shops facing the road. Traders queue for them.' },
  { id: 'duplex', name: 'Duplex', cost: 42_000_000, weeks: 8, units: 2.6, area: 0, detail: 'Two floors, a water tank and a gate man.' },
  { id: 'warehouse', name: 'Warehouse', cost: 70_000_000, weeks: 7, units: 5, area: 120, detail: 'A big shed and a yard for trailers.' },
  { id: 'flats', name: 'Block of flats', cost: 110_000_000, weeks: 12, units: 8, area: 95, detail: 'Six flats. Rent comes in every year like harvest.' },
  { id: 'plaza', name: 'Shopping plaza', cost: 230_000_000, weeks: 16, units: 19, area: 150, detail: 'Shops, banks and a supermarket under one roof.' },
  { id: 'hotel', name: 'Hotel', cost: 420_000_000, weeks: 22, units: 38, area: 175, detail: 'Rooms, a hall for owambe and a bar by the pool.' },
  { id: 'office', name: 'Office tower', cost: 600_000_000, weeks: 26, units: 58, area: 185, detail: 'Glass and aluminium, let by the floor.' },
];
export const buildType = (id: BuildId) => BUILDS.find((b) => b.id === id)!;

export interface Deed {
  /** Person id of the owner; -1 once it has gone back to the open market. */
  owner: number;
  /** What stands there now, if not what the town began with. */
  on?: BuildId | 'empty';
  /** Building work under way: what, by which company, and the week it is finished. */
  site?: { kind: BuildId; firm: number; done: number };
  /** What the owner has put into it. */
  paid: number;
}

export interface Builder {
  id: number;
  name: string;
  motto: string;
  /** What they charge against the going price, and how long they take against the standard time. */
  rate: number;
  pace: number;
  /** Price of the whole company at the start of the game, ₦. */
  worth: number;
  /** Person id of the owner; -1 while its founders still hold it. */
  owner: number;
  /** Profit on contracts not yet paid over to the owner, and how many jobs it has done. */
  due: number;
  jobs: number;
}

const FIRMS: Omit<Builder, 'id' | 'owner' | 'due' | 'jobs'>[] = [
  { name: 'Julius Bamidele Construction', motto: 'The big name. Fast, and you pay for it.', rate: 1.25, pace: 0.65, worth: 900_000_000 },
  { name: 'Arewa Blocks & Builders', motto: 'Solid work at the going rate.', rate: 1, pace: 1, worth: 350_000_000 },
  { name: 'Sharp-Sharp Building Works', motto: 'Cheap. Sharp-sharp is only the name.', rate: 0.8, pace: 1.45, worth: 120_000_000 },
];
/** A builder's profit on a contract. */
const MARGIN = 0.18;

const P = (g: Game) => g.macro.priceLevel;
const round = (v: number, to = 10_000) => Math.round(v / to) * to;
const money = (v: number) => (v >= 1e9 ? `₦${(v / 1e9).toFixed(2)}bn` : v >= 1e6 ? `₦${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}m` : `₦${Math.round(v / 1000)}k`);
function book(p: Player, label: string, amount: number) {
  const line = p.week.find((l) => l.label === label);
  if (line) line.amount += amount;
  else p.week.push({ label, amount });
  p.money += amount;
}

export const deedKey = (lga: string, plot: number) => `${lga}:${plot}`;
export const deedOf = (g: Game, lga: string, plot: number): Deed | undefined => g.estate?.[deedKey(lga, plot)];
export function builders(g: Game): Builder[] {
  return g.builders ?? FIRMS.map((f, id) => ({ ...f, id, owner: -1, due: 0, jobs: 0 }));
}
function ownBuilders(g: Game): Builder[] {
  if (!g.builders) g.builders = builders(g);
  return g.builders;
}
function ownDeed(g: Game, lga: string, plot: number): Deed {
  g.estate ??= {};
  return (g.estate[deedKey(lga, plot)] ??= { owner: -1, paid: 0 });
}

// ───────────── what the town began with ─────────────

function seeded(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    h ^= h >>> 15;
    return ((h >>> 0) % 10000) / 10000;
  };
}

const fillerMemo = new Map<string, Map<number, FillerKind>>();

/** The ordinary buildings of a town: which kind stands on each plot that is not a place or a plot for lease. */
export function fillerKinds(lga: string): Map<number, FillerKind> {
  const hit = fillerMemo.get(lga);
  if (hit) return hit;
  const h = hood(lga);
  const style = lgaById(lga).style;
  const rnd = seeded(`fill:${lga}`);
  const out = new Map<number, FillerKind>();
  const big = h.fillers.filter((id) => !h.plots[id].small);
  const small = h.fillers.filter((id) => h.plots[id].small);
  const station = big.find((id) => h.plots[id].onMain) ?? big[0];
  if (station !== undefined) out.set(station, 'station');
  const rest = big.filter((id) => id !== station);
  const worship: FillerKind[] = style.startsWith('kano') ? ['mosque', 'mosque'] : style.startsWith('lagos') ? ['church', 'mosque'] : ['church', 'church'];
  for (const k of worship) {
    const free = rest.filter((id) => !out.has(id));
    if (free.length) out.set(free[Math.floor(rnd() * free.length)], k);
  }
  for (const id of rest) {
    if (out.has(id)) continue;
    const r = rnd();
    out.set(id, r < 0.35 ? 'house' : r < 0.65 ? 'flats' : r < 0.8 ? 'unfinished' : 'kiosks');
  }
  for (const id of small) {
    const r = rnd();
    out.set(id, r < 0.45 ? 'house' : r < 0.7 ? 'kiosks' : 'trees');
  }
  fillerMemo.set(lga, out);
  return out;
}

/** Old buildings: what they are called, what they would cost to put up today, and the rent they bring. */
const OLD: Record<FillerKind, { name: string; cost: number; units: number }> = {
  house: { name: 'House', cost: 11_000_000, units: 1 },
  flats: { name: 'Block of flats', cost: 60_000_000, units: 5 },
  kiosks: { name: 'Row of shops', cost: 12_000_000, units: 1.4 },
  unfinished: { name: 'Uncompleted building', cost: 9_000_000, units: 0 },
  church: { name: 'Church', cost: 55_000_000, units: 0.6 },
  mosque: { name: 'Mosque', cost: 55_000_000, units: 0.6 },
  station: { name: 'Filling station', cost: 260_000_000, units: 20 },
  trees: { name: 'Empty land', cost: 0, units: 0 },
};
/** Famous buildings and the places of the town, by what they are. */
const GRAND: Record<string, { cost: number; units: number }> = {
  mall: { cost: 900_000_000, units: 75 },
  hospital: { cost: 500_000_000, units: 36 },
  campus: { cost: 650_000_000, units: 40 },
  church: { cost: 300_000_000, units: 4 },
  mosque: { cost: 300_000_000, units: 4 },
  museum: { cost: 250_000_000, units: 8 },
  industrial: { cost: 400_000_000, units: 30 },
  stadium: { cost: 1_500_000_000, units: 60 },
  school: { cost: 180_000_000, units: 12 },
  building: { cost: 200_000_000, units: 16 },
};
/** These belong to the public (or to the Emir): nobody can buy them. */
const PUBLIC_LANDMARKS = ['government', 'square', 'station', 'market', 'terminal', 'palace', 'airport', 'jetty', 'toll'];
export const publicLandmark = (kind: string) => PUBLIC_LANDMARKS.includes(kind);
const PUBLIC_PLACES: PlaceId[] = ['home', 'market', 'park', 'govhouse', 'secretariat', 'palace', 'airport', 'jetty', 'busstop', 'farm', 'lot'];

export interface Standing {
  plot: Plot;
  /** 'lot' is a plot for lease, 'filler' an ordinary building, 'landmark' a famous one, 'place' somewhere you go in the game. */
  role: 'lot' | 'filler' | 'landmark' | 'place';
  place?: PlaceId;
  /** What stands there now. `site` is building work; `old` what the town began with. */
  on: 'empty' | 'site' | 'old' | BuildId;
  name: string;
  owner: number;
  /** Nobody can buy it. */
  publicLand: boolean;
  /** Its tenants cannot be put out: it can be bought for the rent but not pulled down. */
  inUse: boolean;
  land: number;
  building: number;
  /** Land and building together: what it changes hands for. */
  value: number;
  /** Rent a week, after the agent and the repairs. */
  rent: number;
  deed?: Deed;
}

/** What a plot of this size is worth with nothing on it. */
export function landValue(g: Game, lga: string, plot: Plot): number {
  const size = Math.max(0.35, (plot.w * plot.d) / 200);
  return round(g.rent[lga] * 4 * size * (plot.kind === 'farm' ? 0.35 : plot.onMain ? 1.7 : 1), 50_000);
}

const weeklyRent = (g: Game, lga: string, plot: Plot, units: number) => Math.round((units * g.rent[lga] * (plot.onMain ? 1.25 : 1) * 0.85) / 48 / 100) * 100;

/** Everything about one plot: what is on it, whose it is, what it is worth. */
export function standing(g: Game, lga: string, id: number): Standing | null {
  const h = hood(lga);
  const plot = h.plots[id];
  if (!plot) return null;
  const deed = deedOf(g, lga, id);
  const place = (Object.entries(h.place) as [PlaceId, number][]).find(([, p]) => p === id)?.[0];
  const role: Standing['role'] = place ? 'place' : h.lots.includes(id) ? 'lot' : plot.landmark ? 'landmark' : 'filler';
  const land = landValue(g, lga, plot);
  const p = Math.pow(P(g), 0.9);
  let on: Standing['on'] = role === 'lot' ? 'empty' : 'old';
  let name = plot.kind === 'farm' ? 'Farmland' : 'Empty plot';
  let building = 0;
  let units = 0;
  let publicLand = false;
  if (role === 'place') {
    publicLand = PUBLIC_PLACES.includes(place!);
    name = plot.real ?? 'Premises';
    building = 180_000_000 * p;
    units = 13;
  } else if (role === 'landmark') {
    const k = plot.landmark!.k;
    publicLand = PUBLIC_LANDMARKS.includes(k);
    const v = GRAND[k] ?? GRAND.building;
    name = plot.landmark!.n;
    building = v.cost * p;
    units = v.units;
  } else if (role === 'filler') {
    const k = fillerKinds(lga).get(id) ?? 'house';
    if (k === 'trees') on = 'empty';
    name = OLD[k].name;
    building = OLD[k].cost * p;
    units = OLD[k].units;
  }
  const inUse = role === 'place' || (role === 'lot' && g.businesses.some((b) => b.lga === lga && b.plot === id));
  if (deed?.site && g.week < deed.site.done) {
    const t = buildType(deed.site.kind);
    on = 'site';
    name = `${t.name} going up`;
    // Half built is worth about half the contract.
    building = t.cost * p * 0.5;
    units = 0;
  } else {
    const now = deed?.site ? deed.site.kind : deed?.on;
    if (now === 'empty') {
      on = 'empty';
      name = 'Empty plot';
      building = 0;
      units = 0;
    } else if (now) {
      const t = buildType(now);
      on = now;
      name = t.name;
      building = t.cost * p;
      units = t.units;
    }
  }
  building = round(building, 50_000);
  return { plot, role, place, on, name, owner: deed?.owner ?? -1, publicLand, inUse, land, building, value: land + building, rent: weeklyRent(g, lga, plot, units), deed };
}

/** Is there a building (or building work) on this plot for lease, so no business can open there? */
export const builtOn = (g: Game, lga: string, plot: number): boolean => {
  const d = deedOf(g, lga, plot);
  return !!d && (!!d.site || (!!d.on && d.on !== 'empty'));
};

/** Does this person own the land this business stands on? Then there is no rent to pay. */
export const ownsPlot = (g: Game, lga: string, plot: number, who: number) => plot >= 0 && deedOf(g, lga, plot)?.owner === who;

/** The plots a person owns, everywhere. */
export function holdings(g: Game, who: number): { lga: string; id: number; s: Standing }[] {
  const out: { lga: string; id: number; s: Standing }[] = [];
  for (const [key, d] of Object.entries(g.estate ?? {})) {
    if (d.owner !== who) continue;
    const [lga, id] = key.split(':');
    const s = standing(g, lga, Number(id));
    if (s) out.push({ lga, id: Number(id), s });
  }
  return out;
}

/** The deeds of one LGA as a short string: it changes when anything on the ground there does. */
export function estateKey(g: Game, lga: string): string {
  let out = '';
  for (const [key, d] of Object.entries(g.estate ?? {})) {
    if (!key.startsWith(`${lga}:`)) continue;
    const site = d.site && g.week < d.site.done;
    out += `${key.slice(lga.length + 1)}=${site ? `site:${d.site!.firm}` : (d.site?.kind ?? d.on ?? '')}:${d.owner === g.me ? 'me' : d.owner};`;
  }
  return out;
}

// ───────────── the companies ─────────────

/** The builder you have chosen for your next job. */
export const chosenBuilder = (g: Game): Builder => builders(g)[g.flags.builder ?? 1] ?? builders(g)[1];
/** A company's ordinary profit a week, from the work it does for everybody else in the country. */
export const builderProfit = (g: Game, f: Builder) => round((f.worth * P(g) * 0.11) / 48, 1000);
export const builderPrice = (g: Game, f: Builder) => round(f.worth * P(g) + f.jobs * 2_000_000 * P(g), 1_000_000);
/** What a job costs you with this builder: your own company works at cost. */
export function buildCost(g: Game, f: Builder, t: BuildType): number {
  const full = t.cost * Math.pow(P(g), 0.9) * f.rate;
  return round(f.owner === g.me ? full * (1 - MARGIN) : full, 50_000);
}
export const buildWeeks = (f: Builder, t: BuildType) => Math.max(2, Math.round(t.weeks * f.pace));
const demolishCost = (g: Game, s: Standing) => round(Math.max(600_000 * P(g), s.building * 0.05), 50_000);
/** Selling goes through an agent and a lawyer: you get a little less than it is worth. */
const salePrice = (s: Standing) => round(s.value * 0.9, 50_000);
/** Buying costs the price plus the agent, the lawyer and the governor's consent. */
const buyPrice = (s: Standing) => round(s.value * 1.08, 50_000);

type Draft = { id: string; label: string; detail: string; cost?: number; energy: number; minutes?: number; blocked?: string | null; tone?: 'money' };

/** What you can do about the land and building at this plot. */
export function propertyActions(g: Game, plotId: number | null): Draft[] {
  if (plotId === null) return [];
  const lga = g.player.at;
  const s = standing(g, lga, plotId);
  if (!s || s.publicLand) return [];
  const p = g.player;
  const out: Draft[] = [];
  const broke = (cost: number) => (p.money < cost ? 'Not enough money.' : null);
  const biz = g.businesses.find((b) => b.lga === lga && b.plot === plotId);
  if (s.owner !== g.me) {
    const price = buyPrice(s);
    const holder = s.owner >= 0 && g.people[s.owner] ? g.people[s.owner].name : null;
    const what = s.on === 'empty' ? 'the land' : s.role === 'place' ? 'the building (the tenants stay)' : 'the land and the building';
    out.push({
      id: 'prop:buy',
      label: `Buy this ${s.on === 'empty' ? 'plot' : 'property'}: ${s.name} (${money(price)})`,
      detail: `${money(s.land)} for the land${s.building ? `, ${money(s.building)} for the building` : ''}, plus agent and legal fees. You get ${what}${s.rent ? `, and about ${money(s.rent)} rent a week` : ''}.`,
      cost: price,
      energy: -6,
      minutes: 90,
      tone: 'money',
      blocked: holder && s.owner >= 0 ? `${holder} owns this.` : biz && biz.owner !== g.me ? 'Somebody’s business is on this plot. Buy the business first.' : broke(price),
    });
    return out;
  }
  const sale = salePrice(s);
  if (s.on === 'site') {
    const site = s.deed!.site!;
    const left = site.done - g.week;
    out.push({ id: 'prop:site', label: `${builders(g)[site.firm].name} are on site`, detail: `${buildType(site.kind).name}: ${left} week${left === 1 ? '' : 's'} to go.`, energy: 0, minutes: 10, blocked: 'Work is going on.', tone: 'money' });
    return out;
  }
  if (s.on !== 'empty' && !s.inUse) {
    const cost = demolishCost(g, s);
    out.push({ id: 'prop:demolish', label: `Pull the ${s.name.toLowerCase()} down`, detail: `A bulldozer, labourers and a tipper to cart it away. You lose the building${s.rent ? ` and its ${money(s.rent)} a week` : ''}, and get a clear plot to build on.`, cost, energy: -8, minutes: 120, tone: 'money', blocked: broke(cost) });
  }
  if (s.on === 'empty' && !biz && s.plot.kind !== 'farm') {
    const f = chosenBuilder(g);
    const area = s.plot.w * s.plot.d;
    for (const t of BUILDS) {
      if (area < t.area) continue;
      const cost = buildCost(g, f, t);
      const weeks = buildWeeks(f, t);
      out.push({ id: `prop:build:${t.id}`, label: `Build: ${t.name.toLowerCase()} (${money(cost)})`, detail: `${t.detail} ${f.name} will take ${weeks} weeks. Rent after that: about ${money(weeklyRent(g, lga, s.plot, t.units))} a week.`, cost, energy: -6, minutes: 60, tone: 'money', blocked: broke(cost) });
    }
    for (const o of builders(g)) {
      if (o.id === f.id) continue;
      out.push({ id: `prop:firm:${o.id}`, label: `Use ${o.name} instead`, detail: `${o.motto} ${o.rate === 1 ? 'The going price' : `${Math.round(Math.abs(o.rate - 1) * 100)}% ${o.rate > 1 ? 'dearer' : 'cheaper'}`}, ${o.pace < 1 ? 'quicker' : o.pace > 1 ? 'slower' : 'on standard time'}.${o.owner === g.me ? ' Your own company: it works for you at cost.' : ''}`, energy: 0, minutes: 5, tone: 'money' });
    }
    if (f.owner === g.me) {
      const price = round(builderPrice(g, f) * 0.85, 1_000_000);
      out.push({ id: `firm:sell:${f.id}`, label: `Sell ${f.name} (${money(price)})`, detail: 'Hand the company back to its managers for cash.', energy: -4, minutes: 60, tone: 'money' });
    } else {
      const price = builderPrice(g, f);
      const holder = f.owner >= 0 && g.people[f.owner] ? g.people[f.owner].name : null;
      out.push({ id: `firm:buy:${f.id}`, label: `Buy ${f.name} itself (${money(price)})`, detail: `Own the builder: about ${money(builderProfit(g, f))} profit a week from its work around the country, its margin on every job players give it, and your own buildings at cost.`, cost: price, energy: -8, minutes: 120, tone: 'money', blocked: holder ? `${holder} owns it.` : broke(price) });
    }
  }
  out.push({ id: 'prop:sell', label: `Sell this ${s.on === 'empty' ? 'plot' : 'property'} (${money(sale)})`, detail: 'Through an agent, at a little under what it is worth.', energy: -4, minutes: 60, tone: 'money', blocked: biz && s.role === 'lot' ? 'Your business stands on it.' : null });
  return out;
}

/** Does one of the property actions (the cost is already booked). Null if `id` is not one of them. */
export function propertyAct(g: Game, id: string, plotId: number | null): string | null {
  if (!id.startsWith('prop:') && !id.startsWith('firm:')) return null;
  const p = g.player;
  const lga = p.at;
  const [, verb, arg] = id.split(':');
  if (id.startsWith('firm:')) {
    const f = ownBuilders(g)[Number(arg)];
    if (!f) return 'No such company.';
    if (verb === 'buy') {
      f.owner = g.me;
      g.flags.builder = f.id;
      return `${f.name} is yours. The site engineers are calling you “Chairman”.`;
    }
    const price = round(builderPrice(g, f) * 0.85, 1_000_000);
    f.owner = -1;
    book(p, 'Sale of company', price + f.due);
    f.due = 0;
    return `You sold ${f.name} for ${money(price)}.`;
  }
  if (verb === 'firm') {
    g.flags.builder = Number(arg);
    return `${builders(g)[Number(arg)]?.name ?? 'They'} will do your next job.`;
  }
  if (plotId === null) return 'Nothing here to deal in.';
  const s = standing(g, lga, plotId);
  if (!s) return 'Nothing here to deal in.';
  const deed = ownDeed(g, lga, plotId);
  // Work that has finished becomes the building.
  if (deed.site && g.week >= deed.site.done) {
    deed.on = deed.site.kind;
    delete deed.site;
  }
  if (verb === 'buy') {
    deed.owner = g.me;
    deed.paid = buyPrice(s);
    return s.on === 'empty' ? 'Signed, stamped and surveyed. The land is yours: nobody will say “this land is not for sale” about it again.' : `The ${s.name.toLowerCase()} is yours.${s.rent ? ` The tenants now pay you: about ${money(s.rent)} a week.` : ''}`;
  }
  if (verb === 'sell') {
    deed.owner = -1;
    book(p, 'Sale of property', salePrice(s));
    return `Sold for ${money(salePrice(s))}.`;
  }
  if (verb === 'demolish') {
    deed.on = 'empty';
    return 'The bulldozer came at dawn. By evening it was a clear plot.';
  }
  if (verb === 'build') {
    const t = buildType(arg as BuildId);
    const f = ownBuilders(g)[chosenBuilder(g).id];
    const cost = buildCost(g, f, t);
    deed.site = { kind: t.id, firm: f.id, done: g.week + buildWeeks(f, t) };
    f.jobs++;
    if (f.owner !== g.me) f.due += Math.round(cost * MARGIN);
    return `${f.name} have moved to site. Your ${t.name.toLowerCase()} will be ready in ${buildWeeks(f, t)} weeks.`;
  }
  return null;
}

/** Sunday: rent from what you own, and the profit of any builder you own. Returns lines for your news. */
export function propertyWeek(g: Game): string[] {
  const out: string[] = [];
  const p = g.player;
  let rent = 0;
  for (const [key, d] of Object.entries(g.estate ?? {})) {
    if (d.owner !== g.me) continue;
    const [lga, id] = key.split(':');
    if (d.site && g.week >= d.site.done) {
      const t = buildType(d.site.kind);
      out.push(`Your ${t.name.toLowerCase()} in ${lgaById(lga).nick} is finished. ${builders(g)[d.site.firm]?.name ?? 'The builders'} handed over the keys.`);
      d.on = d.site.kind;
      delete d.site;
    }
    rent += standing(g, lga, Number(id))?.rent ?? 0;
  }
  if (rent) book(p, 'Rent from your properties', rent);
  for (const f of g.builders ?? []) {
    if (f.owner !== g.me) continue;
    book(p, `Profit: ${f.name}`, builderProfit(g, f) + f.due);
    f.due = 0;
  }
  return out;
}

/** What a person's land, buildings and companies are worth. */
export function propertyWorth(g: Game, who: number): number {
  return holdings(g, who).reduce((s, h) => s + h.s.value, 0) + builders(g).reduce((s, f) => s + (f.owner === who ? builderPrice(g, f) : 0), 0);
}
