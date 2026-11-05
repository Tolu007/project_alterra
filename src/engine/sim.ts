import type { FedPolicy, LgaPolicy, StatePolicy } from '../data/politics';
import type { PlaceId } from '../data/trades';
import { LGAS, STATES, lgaById, type StateId } from '../data/world';
import { isMonthEnd, isYearEnd } from './calendar';
import { updateCohorts, updateMacro, updatePrices, updateRents, updateSatisfaction } from './economy';
import { weeklyElections } from './elections';
import { eventById, scheduleEvents, type Choice } from './events';
import { accrueSubsidy, demolishMarket, govById, levelOf, monthlyGovernment, weeklyGovernment } from './government';
import { HOURS, act, actionBlocked, actionsAt, bookBusinessDay, isOpen, mainWork, naira, passTime, weeklyLife } from './life';
import { chance } from './rng';
import { npcLine } from './talk';
import { cultureNews, resolveCulture, scheduleCulture } from './culture';
import { npcWeek } from './npc';
import { DAY_END, DAY_START, DAYS_PER_WEEK, type Game, type News, type Snapshot, type WeekReport } from './types';
import { absNow, eachSeat, isHuman } from './seats';
import { clamp, okadaBanned } from './economy';
import { hire, settleBusinesses, staffCap, wageWeekly } from './business';

// Every exported function takes a game and returns a new one; the UI never sees a mutation.
const clone = (g: Game): Game => structuredClone(g);

/** A read-only look at what things would be like at another place: no copy of the world. Do not mutate it. */
export const peek = (g: Game, place: PlaceId, lot: number | null = null): Game => ({ ...g, place, lot: place === 'lot' ? lot : null });

export function goTo(g0: Game, place: PlaceId, lot: number | null = null): Game {
  const g = clone(g0);
  g.place = place;
  g.lot = place === 'lot' ? lot : null;
  return g;
}

/** A keke (or okada, where allowed) ride across the neighbourhood: costs money, not time. */
export function rideFare(g: Game): { kind: 'okada' | 'keke'; fare: number } {
  const okada = !okadaBanned(g, g.player.at);
  return { kind: okada ? 'okada' : 'keke', fare: Math.round(g.fares[g.player.at] * (okada ? 0.5 : 0.7)) };
}

export function payRide(g0: Game): { game: Game; ok: boolean } {
  const { kind, fare } = rideFare(g0);
  if (g0.player.money < fare || g0.phase !== 'day') return { game: g0, ok: false };
  const g = clone(g0);
  g.player.money -= fare;
  const line = g.player.week.find((l) => l.label === 'Keke & okada');
  if (line) line.amount -= fare;
  else g.player.week.push({ label: kind === 'okada' ? 'Keke & okada' : 'Keke & okada', amount: -fare });
  return { game: g, ok: true };
}

const takingsNote = (takings: number) => (Math.abs(takings) < 1 ? '' : takings > 0 ? ` Your businesses made ${naira(takings)} today.` : ` Your businesses lost ${naira(-takings)} today.`);

export function doAction(g0: Game, id: string): { game: Game; text: string; ok: boolean } {
  if (g0.phase !== 'day') return { game: g0, text: 'Not now.', ok: false };
  const why = actionBlocked(g0, id);
  if (why) return { game: g0, text: why, ok: false };
  const g = clone(g0);
  return { game: g, text: applyAction(g, id), ok: true };
}

/** Does an allowed action to `g` in place (check actionBlocked first). */
export function applyAction(g: Game, id: string): string {
  const text = act(g, id);
  if (g.ending) {
    g.phase = 'over';
    return text;
  }
  if (id === 'sleep' && g.shared) {
    goToBed(g);
    return text;
  }
  if (id === 'sleep') return text + takingsNote(endDay(g, true));
  if (g.shared) return text;
  if (g.minute >= DAY_END) return `${text} Then you fell asleep where you sat.${takingsNote(endDay(g, false))}`;
  return text;
}

/**
 * Lets the clock run while you walk around or stand still. Past 2am you pass out.
 * Returns a note when the day turned over.
 */
export function advanceClock(g0: Game, minutes: number): { game: Game; text: string | null } {
  if (g0.phase !== 'day' || minutes <= 0) return { game: g0, text: null };
  const g = clone(g0);
  return { game: g, text: runClock(g, minutes) };
}

function runClock(g: Game, minutes: number): string | null {
  passTime(g, Math.min(minutes, DAY_END - g.minute));
  if (g.minute >= DAY_END) return `It is 2am. You passed out before you got to bed.${takingsNote(endDay(g, false))}`;
  return null;
}

/**
 * In a shared world, going to bed: you sleep until 6am if it is before midnight (six hours if later), and get back
 * energy for the hours you sleep. The world does not wait; your character is simply asleep until then.
 */
export function goToBed(g: Game) {
  const p = g.player;
  const now = absNow(g);
  const bed = g.minute;
  const wake = bed < DAY_START || bed > 24 * 60 ? now + 6 * 60 : now + (24 * 60 + DAY_START - bed);
  const hours = (wake - now) / 60;
  p.hunger = clamp(p.hunger - hours * 1.2, 0, 100);
  p.social = clamp(p.social - 3, 0, 100);
  p.energy = clamp(p.energy + hours * 7.5 + (p.hasGenerator ? 4 : 0), 0, 100);
  p.health = clamp(p.health + (p.hunger > 20 ? 1 : -3), 0, 100);
  g.asleep = true;
  g.busyUntil = wake;
  g.place = 'home';
  g.lot = null;
}

/**
 * Overnight: the businesses book the day, needs drift, and you get back as much energy as the hours you slept.
 * In bed before midnight you wake at 6am; after midnight you get six hours. Passing out gives poor rest and a late start.
 */
function endDay(g: Game, inBed: boolean): number {
  const p = g.player;
  // Your businesses trade all day whether you were there or not; the takings land tonight.
  const takings = bookBusinessDay(g);
  resolveCulture(g);
  const bed = Math.min(g.minute, DAY_END);
  const wake = inBed ? (bed <= 24 * 60 ? 24 * 60 + DAY_START : bed + 6 * 60) : 24 * 60 + 9 * 60;
  const hours = (wake - bed) / 60;
  p.hunger = clamp(p.hunger - hours * 1.2, 0, 100);
  p.social = clamp(p.social - 3, 0, 100);
  p.energy = clamp(p.energy + hours * (inBed ? 7.5 : 4) + (p.hasGenerator ? 4 : 0), 0, 100);
  p.health = clamp(p.health + (p.hunger > 20 ? 1 : -3), 0, 100);
  g.minute = wake - 24 * 60;
  g.talked = [];
  g.day++;
  g.place = 'home';
  g.lot = null;
  if (g.day >= DAYS_PER_WEEK) endWeek(g);
  return takings;
}

/** Offers a job to someone you are chatting with. Takes no time. */
export function hireTalent(g0: Game, bizId: number, person: number): { game: Game; text: string } {
  const b0 = g0.businesses.find((x) => x.id === bizId);
  const who = g0.people[person];
  if (!b0 || !who || who.employer !== null || who.office || isHuman(g0, person)) return { game: g0, text: 'They are not available.' };
  if (b0.staff.length >= staffCap(b0)) return { game: g0, text: 'That business has no free positions. Expand first.' };
  if (g0.player.money < wageWeekly(g0, b0) * 2) return { game: g0, text: 'You need two weeks of wages in hand.' };
  const g = clone(g0);
  const b = g.businesses.find((x) => x.id === bizId)!;
  hire(g, b, person);
  return { game: g, text: `${who.name} accepted! They start at your ${b.name} tomorrow.` };
}

/** A quick chat: no time cost, once per person per day. */
export function talkTo(g0: Game, person: number): { game: Game; line: string } {
  const who = g0.people[person];
  if (!who || person === g0.me) return { game: g0, line: '' };
  const g = clone(g0);
  const line = npcLine(g, g.people[person]);
  if (!g.talked.includes(person)) {
    g.talked.push(person);
    const w = g.people[person];
    w.relation = clamp(w.relation + 4, -100, 100);
    g.player.social = clamp(g.player.social + 7, 0, 100);
    g.player.influence[w.lga] = clamp(g.player.influence[w.lga] + 0.4, 0, 100);
  }
  return { game: g, line };
}

/** Fills the rest of the week with routine: eat, wait for work to open, work, eat again, sleep. */
export function routineWeek(g0: Game): Game {
  if (g0.phase !== 'day') return g0;
  // One copy for the whole run; every step then works on it in place.
  const g = clone(g0);
  for (let guard = 0; guard < 120 && g.phase === 'day'; guard++) {
    const step = routineStep(g);
    if ('wait' in step) {
      runClock(g, step.wait);
      continue;
    }
    g.place = step.place;
    g.lot = step.place === 'lot' ? (step.lot ?? null) : null;
    if (actionBlocked(g, step.id)) {
      g.place = 'home';
      g.lot = null;
      applyAction(g, 'sleep');
    } else applyAction(g, step.id);
  }
  return g;
}

function routineStep(g: Game): { place: PlaceId; id: string; lot?: number } | { wait: number } {
  const p = g.player;
  const canAfford = (place: PlaceId, id: string, lot: number | null = null) => actionsAt(peek(g, place, lot), place).some((a) => a.id === id && !a.blocked);
  if (p.at !== p.home) return { place: 'home', id: 'sleep' };
  if (p.hunger < 55 && g.minute < 21 * 60 && canAfford('home', 'cook')) return { place: 'home', id: 'cook' };
  const job = mainWork(g);
  const today = g.week * 7 + g.day;
  if (job && g.minute < 12 * 60 && p.energy > 25 && g.flags.workDay !== today) {
    const opens = HOURS[job.place][0] * 60;
    if (!isOpen(g, job.place) && g.minute < opens) return { wait: opens - g.minute };
    if (canAfford(job.place, job.id, job.lot)) return job;
  }
  return { place: 'home', id: 'sleep' };
}

function snapshot(g: Game): Snapshot {
  const per = <T>(f: (s: StateId) => T) => Object.fromEntries(STATES.map((s) => [s.id, f(s.id)])) as Record<StateId, T>;
  const avgFare = (s: StateId) => {
    const ls = LGAS.filter((l) => l.state === s);
    return ls.reduce((a, l) => a + g.fares[l.id], 0) / ls.length;
  };
  const p = g.me >= 0 ? g.player : null;
  return {
    week: g.week,
    fx: g.macro.fxParallel,
    inflation: g.macro.inflation,
    petrol: per((s) => g.prices[s].petrol),
    rice: per((s) => g.prices[s].rice),
    fare: per(avgFare),
    grid: per((s) => g.prices[s].grid),
    approval: { fed: g.fed.approval, state: per((s) => g.states[s].approval) },
    money: p?.money ?? 0,
    income: p ? p.lastWeek.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0) : 0,
  };
}

/**
 * Sunday: the economy, governments, businesses and elections move once for the world, then each player gets
 * their own week (money, events, the paper). In a shared world the calendar moves on at once; each player
 * reads their paper whenever they next look.
 */
function endWeek(g: Game) {
  const shared = !!g.shared;
  type Before = { petrol: number; rice: number; fare: number; fx: number; grid: number };
  const before = new Map<number, Before>();
  eachSeat(g, (s) => {
    // Anyone still sitting on last week's paper gets it filed for them.
    if (shared && g.phase !== 'day') settleInbox(g);
    const home = g.player.home;
    const st = lgaById(home).state;
    before.set(s.id, { petrol: g.prices[st].petrol, rice: g.prices[st].rice, fare: g.fares[home], fx: g.macro.fxParallel, grid: g.prices[st].grid });
  });
  const headlines: News[] = [];
  const WEIGHT: Record<News['scope'], number> = { federal: 4, state: 3, lga: 2, life: 2.5, world: 2 };
  const say = (text: string, tone: News['tone'], scope: News['scope'], where?: string, kind: News['kind'] = scope === 'life' ? 'life' : 'politics', weight = WEIGHT[scope]) =>
    headlines.push({ week: g.week, text, tone, scope, where, kind, weight });
  const mine = new Map<number, News[]>();
  const personal = (id: number, text: string) => {
    if (!mine.has(id)) mine.set(id, []);
    mine.get(id)!.push({ week: g.week, text, tone: 'neutral', scope: 'life', kind: 'life', weight: 2.5 });
  };
  const avgPetrol = () => STATES.reduce((a, s) => a + g.prices[s.id].petrol, 0) / STATES.length;
  const petrolBefore = avgPetrol();
  const fxBefore = g.macro.fxParallel;

  for (const s of STATES) delete g.wflags[`strike:${s.id}`];
  accrueSubsidy(g);
  updateMacro(g);
  updatePrices(g);
  updateCohorts(g);
  updateSatisfaction(g);
  weeklyGovernment(g);
  // Business takings were paid out night by night; this only closes the books.
  settleBusinesses(g);
  eachSeat(g, (s) => {
    for (const line of weeklyLife(g)) personal(s.id, line);
  });
  headlines.push(...npcWeek(g), ...cultureNews(g));

  if (isMonthEnd(g.week)) {
    const p4 = g.macro.priceHistory[Math.max(0, g.macro.priceHistory.length - 5)];
    for (const line of monthlyGovernment(g)) say(line, 'neutral', 'state');
    updateRents(g, g.macro.priceLevel / p4 - 1);
    eachSeat(g, () => {
      if (g.player.office) g.flags.governDue = 1;
    });
  }
  if (isYearEnd(g.week)) g.wageIndex *= 1 + 0.6 * Math.max(0, g.macro.inflation);

  // Strikes: labour walks out when fuel and prices bite and the president is unpopular.
  if (g.fed.approval < 28 && g.macro.inflation > 0.25 && chance(g, 0.25)) {
    for (const s of STATES) g.wflags[`strike:${s.id}`] = 1;
    say('NLC declares a nationwide strike over the cost of living. Roads empty, markets shut', 'bad', 'federal', undefined, 'politics', 8);
  }
  for (const s of STATES) {
    const gov = g.states[s.id];
    if (gov.arrears >= 2 && chance(g, 0.3)) {
      g.stateInfra[s.id].schools = Math.max(0, g.stateInfra[s.id].schools - 1.5);
      say(`${s.name} teachers strike over ${Math.floor(gov.arrears)} months of unpaid salaries`, 'bad', 'state', s.id);
    }
  }
  for (const l of LGAS) {
    for (const [trade, c] of Object.entries(g.cohorts[l.id])) {
      if (c.sat.state < 18 && c.workers > 0.04 && chance(g, 0.05)) {
        say(`${trade === 'okada' ? 'Okada riders' : trade === 'trader' ? 'Traders' : 'Workers'} protest in ${l.nick} against the ${g.states[l.state].name}`, 'bad', 'state', l.id);
        break;
      }
    }
  }

  for (const line of weeklyElections(g, personal)) say(line, 'neutral', 'federal');
  for (const k of Object.keys(g.wflags)) if (k.startsWith('rig:') && govById(g, k.slice(4)).termStart === g.week) delete g.wflags[k];
  eachSeat(g, () => {
    if ((g.flags.relocated ?? 0) > 0) g.flags.relocated--;
  });

  for (const s of STATES) if (g.prices[s.id].scarcity) say(`Fuel queues across ${s.name}. Black market at ₦${Math.round(g.prices[s.id].petrol)}/litre`, 'bad', 'federal', s.id, 'economy', 6);
  const fxMove = g.macro.fxParallel / fxBefore - 1;
  if (Math.abs(fxMove) > 0.04) say(`Naira ${fxMove > 0 ? 'falls' : 'gains'} ${Math.abs(fxMove * 100).toFixed(1)}% this week: ₦${Math.round(g.macro.fxParallel)}/$`, fxMove > 0 ? 'bad' : 'good', 'federal', undefined, 'economy', 3 + Math.abs(fxMove) * 60);
  const petrolMove = avgPetrol() / petrolBefore - 1;
  if (Math.abs(petrolMove) > 0.05) say(`Petrol ${petrolMove > 0 ? 'jumps' : 'falls'} ${Math.abs(petrolMove * 100).toFixed(0)}% to ₦${Math.round(avgPetrol())} a litre`, petrolMove > 0 ? 'bad' : 'good', 'state', undefined, 'economy', 3 + Math.abs(petrolMove) * 30);

  eachSeat(g, () => scheduleEvents(g));
  scheduleCulture(g, g.week + 1);
  g.series.push(snapshot(g));
  if (g.series.length > 520) g.series.shift();
  headlines.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));

  eachSeat(g, (s) => {
    const b = before.get(s.id)!;
    const home = g.player.home;
    const pr = g.prices[lgaById(home).state];
    const own = mine.get(s.id) ?? [];
    const report: WeekReport = {
      week: g.week,
      lines: g.player.lastWeek,
      priceMoves: [
        { label: 'Petrol', before: b.petrol, after: pr.petrol, unit: '/litre' },
        { label: 'Bag of rice', before: b.rice, after: pr.rice, unit: '' },
        { label: 'Bus fare', before: b.fare, after: g.fares[home], unit: '/trip' },
        { label: 'Dollar', before: b.fx, after: g.macro.fxParallel, unit: '' },
        { label: 'Light', before: b.grid, after: pr.grid, unit: 'h/day' },
      ],
      headlines: [...own, ...headlines].sort((x, y) => (y.weight ?? 1) - (x.weight ?? 1)),
    };
    g.report = report;
    g.player.paper = report;
    // Your own week stays private in a shared world; alone, it goes on your news feed too.
    if (!shared) g.news.push(...own);
    g.phase = g.ending ? 'over' : 'week';
  });
  g.news.push(...headlines);
  if (g.news.length > 300) g.news.splice(0, g.news.length - 300);
}

/** Sunday for a shared world (the caller turns the calendar). */
export const endWeekShared = (g: Game) => endWeek(g);

/** Files a player's paper and answers their events with the first choice that is open, so their week can go on. */
export function settleInbox(g: Game) {
  for (let guard = 0; guard < 30 && g.phase !== 'day' && g.phase !== 'over'; guard++) {
    if (g.phase === 'event' && g.currentEvent && g.outcome === null) {
      const choices = eventById(g.currentEvent.id).choices(g, g.currentEvent);
      const pickOne = choices.find((c) => !c.blocked) ?? choices[0];
      g.outcome = pickOne ? pickOne.apply() : '';
      continue;
    }
    if (g.phase === 'govern') delete g.flags.governDue;
    if (g.phase === 'election') g.showElection = null;
    nextStep(g);
  }
}

function nextStep(g: Game) {
  g.currentEvent = null;
  g.outcome = null;
  if (g.ending) {
    g.phase = 'over';
    return;
  }
  const next = g.eventQueue.shift();
  if (next) {
    g.currentEvent = next;
    eventById(next.id).onShow?.(g, next);
    g.phase = 'event';
    return;
  }
  if (g.flags.governDue && g.player.office) {
    g.phase = 'govern';
    return;
  }
  if (g.showElection !== null) {
    g.phase = 'election';
    return;
  }
  g.report = null;
  g.phase = 'day';
  // Alone, the new week starts when you have read your paper. In a shared world it already has.
  if (!g.shared) {
    g.week++;
    g.day = 0;
  }
}

export function continueReport(g0: Game): Game {
  const g = clone(g0);
  nextStep(g);
  return g;
}

export function eventChoices(g: Game): { label: string; hint?: string; blocked?: string | null }[] {
  if (!g.currentEvent) return [];
  const scratch = clone(g);
  return eventById(g.currentEvent.id)
    .choices(scratch, scratch.currentEvent!)
    .map(({ label, hint, blocked }) => ({ label, hint, blocked }));
}

export function chooseEvent(g0: Game, index: number): Game {
  if (!g0.currentEvent || g0.outcome !== null) return g0;
  const g = clone(g0);
  const choice: Choice | undefined = eventById(g.currentEvent!.id).choices(g, g.currentEvent!)[index];
  if (!choice || choice.blocked) return g0;
  g.outcome = choice.apply();
  return g;
}

export function continueEvent(g0: Game): Game {
  const g = clone(g0);
  nextStep(g);
  return g;
}

export interface GovernPlan {
  budget: Record<string, number>;
  payRate: number;
  policy: Partial<FedPolicy> | Partial<StatePolicy> | Partial<LgaPolicy>;
  demolish?: string | null;
}

export function submitGovern(g0: Game, plan: GovernPlan): Game {
  const g = clone(g0);
  const office = g.player.office;
  if (office) {
    const gov = govById(g, office);
    const total = Object.values(plan.budget).reduce((a, b) => a + Math.max(0, b), 0) || 1;
    gov.budget = Object.fromEntries(Object.entries(plan.budget).map(([k, v]) => [k, Math.max(0, v) / total]));
    gov.payRate = Math.min(1, Math.max(0, plan.payRate));
    const wasPeg = levelOf(office) === 'federal' && g.fed.policy.fx === 'peg';
    Object.assign(gov.policy as object, plan.policy);
    if (levelOf(office) === 'federal' && g.fed.policy.fx === 'peg' && !wasPeg) g.macro.peg = Math.round(g.macro.fxParallel);
    if (plan.demolish && levelOf(office) === 'state' && g.demolition[plan.demolish] <= 0) {
      g.news.push({ week: g.week, text: demolishMarket(g, plan.demolish), tone: 'bad', scope: 'state' });
    }
  }
  delete g.flags.governDue;
  nextStep(g);
  return g;
}

export function closeElection(g0: Game): Game {
  const g = clone(g0);
  g.showElection = null;
  nextStep(g);
  return g;
}
