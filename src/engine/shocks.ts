// The world outside Nigeria. Wars, cartel decisions, slumps and bad harvests arrive from time to time and
// push on the few numbers the rest of the economy hangs from: the price of crude, how much oil is pumped,
// what imports cost, how nervous money is. Nothing here sets a pump price or a bus fare directly. A war in
// the Middle East lifts crude; crude lifts the landing cost of petrol; petrol lifts fares, generator bills
// and the cost of moving food; and the naira, the subsidy bill and every trade's takings follow.
//
// What is going on is kept in the world's flags (`shock:<id>` = weeks left), so old saves need no change,
// and the dice come from the world's seed and the week, so they do not disturb anything else's luck.
import { isRainySeason } from './calendar';
import { rand } from './rng';
import type { Game } from './types';

export interface Shock {
  id: string;
  /** Short name, for the screen. */
  name: string;
  icon: string;
  /** The headline when it starts and when it ends. */
  start: string;
  end: string;
  /** What it does, in a line, for the phone. */
  effect: string;
  /** How long it lasts, in weeks. */
  weeks: [number, number];
  /** How likely it is, against the others. */
  odds: number;
  /** Multiplies the level crude settles at. */
  oil?: number;
  /** Multiplies how much oil Nigeria pumps. */
  output?: number;
  /** Multiplies food prices everywhere (imports, harvests). */
  food?: number;
  /** Extra dollars a week the country needs for dearer imports, $bn. */
  imports?: number;
  /** Change in confidence each week. */
  confidence?: number;
  /** Only starts in the rainy season. */
  rains?: boolean;
  tone: 'good' | 'bad';
}

export const SHOCKS: Shock[] = [
  {
    id: 'mideast-war',
    name: 'War in the Middle East',
    icon: '🛢️',
    start: 'War in the Middle East: tankers avoid the Gulf and crude oil leaps',
    end: 'Ceasefire in the Middle East: tankers sail again and crude eases',
    effect: 'Crude is dear. Petrol, diesel, fares and food follow it up; oil money props up the naira.',
    weeks: [8, 16],
    odds: 3,
    oil: 1.45,
    imports: 0.05,
    confidence: -0.004,
    tone: 'bad',
  },
  {
    id: 'opec-cut',
    name: 'OPEC+ cuts output',
    icon: '🛢️',
    start: 'OPEC+ agrees deep production cuts; crude climbs',
    end: 'OPEC+ opens the taps again; crude settles',
    effect: 'Crude is up. Dearer fuel at home, more dollars for the federation account.',
    weeks: [6, 12],
    odds: 3,
    oil: 1.2,
    tone: 'bad',
  },
  {
    id: 'global-slump',
    name: 'Global recession',
    icon: '📉',
    start: 'World economy stalls: factories idle abroad and crude oil slumps',
    end: 'World economy picks up; demand for crude returns',
    effect: 'Crude is cheap. Petrol eases, but oil dollars dry up and the naira is under pressure.',
    weeks: [10, 18],
    odds: 2,
    oil: 0.66,
    confidence: -0.006,
    tone: 'bad',
  },
  {
    id: 'pipeline',
    name: 'Pipeline attacks in the Delta',
    icon: '🔥',
    start: 'Militants blow up export pipelines in the Niger Delta; oil output falls',
    end: 'Delta pipelines repaired; oil output recovers',
    effect: 'Less oil is pumped: fewer dollars come in and the naira weakens.',
    weeks: [4, 9],
    odds: 3,
    output: 0.72,
    confidence: -0.003,
    tone: 'bad',
  },
  {
    id: 'grain-war',
    name: 'War closes Black Sea ports',
    icon: '🌾',
    start: 'War closes Black Sea grain ports: wheat and fertiliser prices soar worldwide',
    end: 'Grain ships sail again from the Black Sea; wheat prices ease',
    effect: 'Bread, noodles and fertiliser cost more. Food prices rise everywhere.',
    weeks: [8, 14],
    odds: 2,
    food: 1.14,
    imports: 0.08,
    tone: 'bad',
  },
  {
    id: 'shipping',
    name: 'Shipping crisis',
    icon: '🚢',
    start: 'Attacks on Red Sea shipping send freight rates through the roof',
    end: 'Shipping lanes reopen; freight rates fall back',
    effect: 'Everything imported costs more to land: the naira and food prices feel it.',
    weeks: [6, 12],
    odds: 2,
    food: 1.06,
    imports: 0.12,
    oil: 1.08,
    tone: 'bad',
  },
  {
    id: 'floods',
    name: 'Floods across the food belt',
    icon: '🌊',
    start: 'Floods swallow farmland along the Niger and Benue; harvests lost',
    end: 'Flood waters recede; farmers return to their fields',
    effect: 'Yam, rice and tomatoes are scarce. Food prices jump until the next harvest.',
    weeks: [6, 10],
    odds: 3,
    food: 1.18,
    rains: true,
    tone: 'bad',
  },
  {
    id: 'oil-boom',
    name: 'Asian demand boom',
    icon: '📈',
    start: 'Asia’s factories roar back: demand for Nigerian crude surges',
    end: 'The demand boom for crude cools',
    effect: 'Crude is up and buyers are queuing: more dollars, a firmer naira, dearer fuel.',
    weeks: [6, 12],
    odds: 2,
    oil: 1.25,
    confidence: 0.004,
    tone: 'good',
  },
  {
    id: 'bumper',
    name: 'Bumper harvest',
    icon: '🌽',
    start: 'Good rains bring the best harvest in years',
    end: 'Markets settle as the bumper harvest sells through',
    effect: 'Food is plentiful and cheaper.',
    weeks: [6, 10],
    odds: 2,
    food: 0.9,
    tone: 'good',
  },
];

const KEY = (id: string) => `shock:${id}`;
/** Weeks of calm before the next thing can happen. */
const QUIET = 'shock:quiet';

export const shockById = (id: string) => SHOCKS.find((s) => s.id === id);

/** What is happening in the world now, with weeks left. */
export function activeShocks(g: Game): { shock: Shock; weeks: number }[] {
  return SHOCKS.filter((s) => (g.wflags[KEY(s.id)] ?? 0) > 0).map((s) => ({ shock: s, weeks: g.wflags[KEY(s.id)] }));
}

/** The push from everything going on, combined. */
export function shockEffects(g: Game): { oil: number; output: number; food: number; imports: number; confidence: number } {
  const out = { oil: 1, output: 1, food: 1, imports: 0, confidence: 0 };
  for (const { shock: s } of activeShocks(g)) {
    out.oil *= s.oil ?? 1;
    out.output *= s.output ?? 1;
    out.food *= s.food ?? 1;
    out.imports += s.imports ?? 0;
    out.confidence += s.confidence ?? 0;
  }
  return out;
}

/** Starts something now (for the weekly roll, tests and the developer console). */
export function startShock(g: Game, id: string, weeks?: number): Shock | null {
  const s = shockById(id);
  if (!s) return null;
  g.wflags[KEY(id)] = weeks ?? s.weeks[1];
  return s;
}

/**
 * Once a week: what is going on moves a week nearer its end, and now and then something new begins.
 * Returns the headlines.
 */
export function stepShocks(g: Game): { text: string; tone: 'good' | 'bad'; weight: number }[] {
  const news: { text: string; tone: 'good' | 'bad'; weight: number }[] = [];
  for (const s of SHOCKS) {
    const left = g.wflags[KEY(s.id)] ?? 0;
    if (left <= 0) continue;
    if (left === 1) {
      delete g.wflags[KEY(s.id)];
      news.push({ text: s.end, tone: s.tone === 'bad' ? 'good' : 'bad', weight: 6 });
    } else g.wflags[KEY(s.id)] = left - 1;
  }
  if ((g.wflags[QUIET] ?? 0) > 0) {
    g.wflags[QUIET]--;
    return news;
  }
  // Its own dice, from the world's seed and the week.
  const dice = { rng: (Math.imul(g.seed | 0, 2654435761) ^ Math.imul(g.week + 1, 40503)) | 0 };
  // The first weeks of a world are calm, and at most two things go on at once.
  if (g.week < 3 || activeShocks(g).length >= 2 || rand(dice) > 0.085) return news;
  const open = SHOCKS.filter((s) => !(g.wflags[KEY(s.id)] > 0) && (!s.rains || isRainySeason(g.week)));
  const total = open.reduce((a, s) => a + s.odds, 0);
  let r = rand(dice) * total;
  const s = open.find((x) => (r -= x.odds) <= 0) ?? open[open.length - 1];
  if (!s) return news;
  g.wflags[KEY(s.id)] = Math.round(s.weeks[0] + rand(dice) * (s.weeks[1] - s.weeks[0]));
  g.wflags[QUIET] = 4;
  news.push({ text: s.start, tone: s.tone, weight: 9 });
  return news;
}
