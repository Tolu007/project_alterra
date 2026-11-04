import { BUDGET_LINES, type FedPolicy, type LeaderStyle, type Level, type LgaPolicy, type StatePolicy } from '../data/politics';
import { tradeById } from '../data/trades';
import { LGAS, STATES, lgaById, stateById, type StateId } from '../data/world';
import { approval, clamp, minWageFactor, nationalDemand, okadaBanned } from './economy';
import { chance, pick } from './rng';
import { PLAYER, type Game, type Gov, type GovLedger } from './types';

// ───────────── tuning ─────────────

/** Default budget shares per style and level. */
export const TEMPLATES: Record<Level, Record<LeaderStyle, Record<string, number>>> = {
  federal: {
    reformer: { power: 0.24, roads: 0.22, security: 0.18, schools: 0.14, health: 0.12, palliatives: 0.05, misc: 0.05 },
    populist: { power: 0.08, roads: 0.12, security: 0.1, schools: 0.07, health: 0.06, palliatives: 0.37, misc: 0.2 },
    looter: { power: 0.04, roads: 0.07, security: 0.09, schools: 0.03, health: 0.03, palliatives: 0.06, misc: 0.68 },
    indifferent: { power: 0.12, roads: 0.14, security: 0.15, schools: 0.09, health: 0.08, palliatives: 0.07, misc: 0.35 },
    tyrant: { power: 0.06, roads: 0.16, security: 0.32, schools: 0.05, health: 0.04, palliatives: 0.02, misc: 0.35 },
  },
  state: {
    reformer: { roads: 0.26, power: 0.16, security: 0.14, schools: 0.17, health: 0.14, palliatives: 0.06, misc: 0.07 },
    populist: { roads: 0.13, power: 0.06, security: 0.1, schools: 0.1, health: 0.09, palliatives: 0.32, misc: 0.2 },
    looter: { roads: 0.08, power: 0.02, security: 0.08, schools: 0.03, health: 0.03, palliatives: 0.06, misc: 0.7 },
    indifferent: { roads: 0.15, power: 0.06, security: 0.14, schools: 0.1, health: 0.1, palliatives: 0.08, misc: 0.37 },
    tyrant: { roads: 0.2, power: 0.04, security: 0.3, schools: 0.05, health: 0.05, palliatives: 0.02, misc: 0.34 },
  },
  lga: {
    reformer: { roads: 0.28, sanitation: 0.22, markets: 0.22, health: 0.18, palliatives: 0.04, misc: 0.06 },
    populist: { roads: 0.14, sanitation: 0.1, markets: 0.12, health: 0.1, palliatives: 0.36, misc: 0.18 },
    looter: { roads: 0.06, sanitation: 0.05, markets: 0.06, health: 0.04, palliatives: 0.07, misc: 0.72 },
    indifferent: { roads: 0.16, sanitation: 0.12, markets: 0.12, health: 0.1, palliatives: 0.1, misc: 0.4 },
    tyrant: { roads: 0.2, sanitation: 0.22, markets: 0.1, health: 0.06, palliatives: 0.02, misc: 0.4 },
  },
};

export const PAY_RATE: Record<LeaderStyle, number> = { reformer: 1, populist: 1, looter: 0.62, indifferent: 0.92, tyrant: 0.85 };
/** Procurement leakage on capital spending: padded contracts, abandoned projects. */
const LEAK: Record<LeaderStyle, number> = { reformer: 0.06, populist: 0.15, looter: 0.45, indifferent: 0.2, tyrant: 0.25 };
/** How much of the "miscellaneous" line ends up private. A player's misc line all goes to the player. */
const MISC_LOOT: Record<LeaderStyle, number> = { reformer: 0.3, populist: 0.5, looter: 0.92, indifferent: 0.6, tyrant: 0.7 };
const PLAYER_LEAK = 0.1;

const FED_COST: Record<string, number> = { power: 70, roads: 70, security: 55, schools: 60, health: 60 };
const STATE_COST: Record<string, number> = { roads: 4, power: 5, security: 3.5, schools: 3.5, health: 3.5 };
const LGA_COST: Record<string, number> = { roads: 0.15, sanitation: 0.08, markets: 0.12, health: 0.1 };
const DECAY: Record<string, number> = { power: 0.02, roads: 0.016, security: 0.02, schools: 0.015, health: 0.015, sanitation: 0.04, markets: 0.015 };

const emptyLedger = (): GovLedger => ({ revenue: 0, wages: 0, wagesPaid: 0, debtService: 0, borrowed: 0, spent: {}, looted: 0, subsidy: 0 });

// ───────────── AI policy ─────────────

const FED_WANTS: Record<LeaderStyle, Partial<FedPolicy> | null> = {
  reformer: { subsidy: false, fx: 'float', riceBan: false, tariff: 'cost', borrow: 400, print: 0 },
  populist: { subsidy: true, subsidyPrice: 650, fx: 'peg', mpr: 18, riceBan: true, tariff: 'subsidised', borrow: 900, print: 250 },
  looter: { subsidy: true, subsidyPrice: 700, fx: 'peg', mpr: 22, tariff: 'subsidised', borrow: 800, print: 150 },
  indifferent: null,
  tyrant: { subsidy: true, subsidyPrice: 750, fx: 'peg', mpr: 25, riceBan: true, tariff: 'subsidised', borrow: 600, print: 100 },
};
const STATE_WANTS: Record<LeaderStyle, Partial<StatePolicy> | null> = {
  reformer: { tax: 0.04, okada: 'partial', payMinWage: true, rentControl: false, freeSchool: true, withholdLga: false, borrow: 2 },
  populist: { tax: 0.02, okada: 'none', payMinWage: true, rentControl: true, freeSchool: true, withholdLga: false, borrow: 6 },
  looter: { tax: 0.06, payMinWage: false, freeSchool: false, withholdLga: true, borrow: 5 },
  indifferent: null,
  tyrant: { tax: 0.07, okada: 'full', payMinWage: false, rentControl: false, freeSchool: false, withholdLga: true, borrow: 3 },
};
const LGA_WANTS: Record<LeaderStyle, Partial<LgaPolicy> | null> = {
  reformer: { levy: 0.03, park: 'official', sanitationDay: true },
  populist: { levy: 0.015, park: 'none', sanitationDay: false },
  looter: { levy: 0.07, park: 'touts', sanitationDay: false },
  indifferent: null,
  tyrant: { levy: 0.06, park: 'touts', sanitationDay: true },
};

/** AI leaders drift towards their preferred policies, a lever or two a month. Returns news lines. */
function steer<P extends object>(g: Game, gov: Gov<P>, wants: Partial<P> | null, describe: (k: string, v: unknown) => string | null): string[] {
  if (!wants || gov.leader === PLAYER) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(wants)) {
    const cur = (gov.policy as Record<string, unknown>)[k];
    if (cur === v || !chance(g, 0.45)) continue;
    (gov.policy as Record<string, unknown>)[k] = v;
    const line = describe(k, v);
    if (line) out.push(line);
  }
  return out;
}

function describeFed(g: Game, k: string, v: unknown): string | null {
  switch (k) {
    case 'subsidy':
      return v ? `Federal Government restores fuel subsidy. Pump price fixed at ₦${g.fed.policy.subsidyPrice}` : 'Federal Government removes fuel subsidy. “Subsidy is gone.”';
    case 'fx':
      if (v === 'peg') {
        g.macro.peg = Math.round(g.macro.fxParallel * 0.85);
        return `CBN pegs the naira at ₦${g.macro.peg}/$. Black market rates jump`;
      }
      return 'CBN floats the naira. “Willing buyer, willing seller.”';
    case 'riceBan':
      return v ? 'Borders closed to rice imports. “Eat what we grow.”' : 'Rice import ban lifted';
    case 'tariff':
      return v === 'cost' ? 'Electricity tariffs raised to cost-reflective levels' : 'Electricity tariffs slashed by Federal Government order';
    default:
      return null;
  }
}

function describeState(name: string, k: string, v: unknown): string | null {
  switch (k) {
    case 'okada':
      return v === 'full' ? `${name} bans okada across the state` : v === 'partial' ? `${name} restricts okada in city LGAs` : `${name} lifts okada ban`;
    case 'payMinWage':
      return v ? `${name} agrees to pay the new minimum wage` : `${name} says it cannot afford the minimum wage`;
    case 'rentControl':
      return v ? `${name} caps rent increases` : `${name} scraps rent controls`;
    case 'freeSchool':
      return v ? `${name} declares free education in public schools` : `${name} reintroduces school fees`;
    case 'withholdLga':
      return v ? `${name} “manages” LGA allocations from the state account` : `${name} releases LGA allocations directly to councils`;
    case 'tax':
      return (v as number) > 0.045 ? `${name} raises levies on businesses and workers` : null;
    default:
      return null;
  }
}

function describeLga(name: string, k: string, v: unknown): string | null {
  switch (k) {
    case 'park':
      return v === 'touts' ? `${name} hands motor parks to the “union”` : v === 'official' ? `${name} takes over motor-park dues collection` : `${name} scraps motor-park dues`;
    case 'levy':
      return (v as number) > 0.045 ? `${name} raises market levies` : (v as number) < 0.025 ? `${name} cuts market levies` : null;
    case 'sanitationDay':
      return v ? `${name} brings back monthly sanitation day. Movement restricted 7–10am` : null;
    default:
      return null;
  }
}

// ───────────── monthly fiscal cycle ─────────────

export function monthlyGovernment(g: Game): string[] {
  const news: string[] = [];
  const m = g.macro;
  const P = m.priceLevel;
  const fp = g.fed.policy;

  // AI policy moves first, so this month's budget reflects them.
  news.push(...steer(g, g.fed, FED_WANTS[g.fed.style], (k, v) => describeFed(g, k, v)));
  if (g.fed.leader !== PLAYER && g.fed.style === 'reformer') {
    fp.mpr = Math.round(clamp(15 + m.inflation * 45, 14, 32));
  }
  for (const st of STATES) {
    const gov = g.states[st.id];
    news.push(...steer(g, gov, STATE_WANTS[gov.style], (k, v) => describeState(st.name, k, v)));
    if (gov.leader !== PLAYER && gov.style === 'tyrant' && chance(g, 0.12)) {
      const target = pick(g, LGAS.filter((l) => l.state === st.id && g.demolition[l.id] <= 0));
      if (target) news.push(demolishMarket(g, target.id));
    }
  }
  for (const l of LGAS) {
    const gov = g.lgas[l.id];
    news.push(...steer(g, gov, LGA_WANTS[gov.style], (k, v) => describeLga(`${l.name} LGA`, k, v)));
  }

  // Crises force hands.
  if (fp.fx === 'peg' && m.reserves < 10 && g.fed.leader !== PLAYER) {
    fp.fx = 'float';
    news.push('Reserves run dry. CBN abandons the peg; naira crashes overnight');
  }
  if (fp.fx === 'peg' && m.reserves <= 0) {
    fp.fx = 'float';
    news.push('With no dollars left to defend it, the peg collapses');
  }

  // FAAC: the federation account, shared between the three tiers.
  const oilRev = (m.oilOutput * 30 * m.oilPrice * m.fxOfficial * 0.25) / 1000;
  const nonOil = 700 * nationalDemand(g) * P;
  const subsidy = m.subsidyBill + (fp.tariff === 'subsidised' ? 60 * Math.sqrt(P) : 0);
  const pool = Math.max(250, oilRev + nonOil - subsidy);
  m.subsidyBill = 0;

  // Federal.
  {
    const f = g.fed;
    const led = emptyLedger();
    led.subsidy = subsidy;
    led.revenue = 0.5268 * pool + 250 * P;
    led.wages = 450 * Math.pow(fp.minWage / 70_000, 0.4) * Math.pow(P, 0.3);
    led.debtService = (f.debt * 0.055) / 12;
    led.borrowed = fp.borrow + fp.print;
    f.debt += fp.borrow;
    runBudget(g, f, led, 'federal', 0);
    f.ledger = led;
  }

  // States.
  for (const st of STATES) {
    const gov = g.states[st.id];
    const led = emptyLedger();
    const demand = stateDemand(g, st.id);
    const igr = st.igr * demand * Math.pow(P, 0.8) * (1 + (gov.policy.tax - 0.03) * 8);
    const withheld = gov.policy.withholdLga ? lgaFaac(pool, st.id) * 0.7 : 0;
    led.revenue = st.faacShare * 0.2672 * pool + st.derivation * oilRev * 0.2 + igr + withheld;
    led.wages = st.wageBill * minWageFactor(g, st.id) * Math.pow(P, 0.3) + (gov.policy.freeSchool ? 1.2 * st.costScale : 0);
    led.debtService = (gov.debt * 0.1) / 12;
    led.borrowed = gov.policy.borrow;
    gov.debt += gov.policy.borrow;
    runBudget(g, gov, led, 'state', st.costScale);
    gov.ledger = led;
    if (gov.policy.freeSchool) g.stateInfra[st.id].schools = clamp(g.stateInfra[st.id].schools + 0.25, 0, 100);
  }

  // LGAs.
  for (const l of LGAS) {
    const gov = g.lgas[l.id];
    const led = emptyLedger();
    const st = g.states[l.state];
    const faac = lgaFaac(pool, l.state) * (l.voters / stateLgaVoters(l.state)) * (st.policy.withholdLga ? 0.3 : 1);
    led.revenue = faac + lgaIgr(g, l.id);
    led.wages = 0.25 * Math.sqrt(l.voters) * minWageFactor(g, l.state) * Math.pow(P, 0.3);
    led.debtService = 0;
    runBudget(g, gov, led, 'lga', 1);
    gov.ledger = led;
  }

  decayInfra(g);
  return news;
}

/** The playable LGAs' slice of the LGA pool, scaled to the 774 councils nationally. */
function lgaFaac(pool: number, state: StateId): number {
  const share = { LA: 20, KN: 44, RI: 23 }[state] / 774;
  return 0.206 * pool * share;
}
const stateLgaVoters = (s: StateId) => LGAS.filter((l) => l.state === s).reduce((a, l) => a + l.voters, 0);

function lgaIgr(g: Game, lga: string): number {
  const p = g.lgas[lga].policy;
  const cs = g.cohorts[lga];
  let market = 0;
  let drivers = 0;
  for (const [t, c] of Object.entries(cs)) {
    const def = tradeById(t as never);
    if (def.levy === 'market') market += c.income * c.workers * 1e6 * 4;
    if (def.levy === 'park') drivers += c.workers * 1e6;
  }
  const dues = p.park === 'official' ? 1_500 * 24 * 0.8 : p.park === 'touts' ? 2_500 * 24 * 0.12 : 0;
  // Only a slice of traders and drivers ever pay; the rest dodge or "settle".
  return (market * p.levy * 0.08 + drivers * dues * 0.25) / 1e9;
}

function stateDemand(g: Game, s: StateId): number {
  const ls = LGAS.filter((l) => l.state === s);
  let v = 0;
  let w = 0;
  for (const l of ls) {
    const cs = Object.values(g.cohorts[l.id]);
    const real = cs.reduce((a, c) => a + (c.income * c.employed * c.workers) / g.macro.priceLevel, 0);
    v += real / g.ref.demand[l.id];
    w += cs.reduce((a, c) => a + c.workers, 0);
  }
  return clamp(v / w, 0.4, 2);
}

/** Cash in, wages, debt, then the discretionary lines. Mutates the government and the world. */
function runBudget(g: Game, gov: Gov<unknown>, led: GovLedger, level: Level, costScale: number) {
  const isPlayer = gov.leader === PLAYER;
  gov.treasury += led.revenue + led.borrowed;

  // Wages: the style (or the player) decides what share actually gets paid.
  const payRate = isPlayer ? gov.payRate : PAY_RATE[gov.style];
  gov.payRate = payRate;
  const owed = led.wages * (payRate + (payRate >= 1 && gov.arrears > 0 ? Math.min(gov.arrears, 0.5) : 0));
  const paid = Math.max(0, Math.min(owed, gov.treasury));
  led.wagesPaid = Math.min(paid, led.wages);
  gov.arrears = Math.max(0, gov.arrears + (led.wages - paid) / Math.max(led.wages, 1e-9));
  gov.treasury -= paid;

  gov.treasury -= led.debtService;
  if (gov.treasury < 0) {
    // Nobody stops paying bondholders; the shortfall becomes new debt.
    gov.debt += -gov.treasury;
    gov.treasury = 0;
  }

  const discretionary = Math.max(0, gov.treasury - 0.1 * led.revenue) * 0.9;
  const lines = BUDGET_LINES[level];
  const leak = isPlayer ? PLAYER_LEAK : LEAK[gov.style];
  const costs = level === 'federal' ? FED_COST : level === 'state' ? STATE_COST : LGA_COST;
  const infra: Record<string, number> =
    level === 'federal' ? (g.fedInfra as unknown as Record<string, number>) : level === 'state' ? (g.stateInfra[gov.id as StateId] as unknown as Record<string, number>) : (g.lgaInfra[gov.id] as unknown as Record<string, number>);

  for (const line of lines) {
    const amount = discretionary * (gov.budget[line.id] ?? 0);
    led.spent[line.id] = amount;
    if (line.id === 'misc') {
      const taken = amount * (isPlayer ? 1 : MISC_LOOT[gov.style]);
      led.looted += taken;
      gov.loot += taken;
      if (isPlayer) g.player.loot += taken * 1e9;
      if (isPlayer) g.player.money += taken * 1e9;
    } else if (line.id === 'palliatives') {
      distributeRelief(g, level, gov.id, amount);
    } else {
      const cost = costs[line.id] * (level === 'state' ? costScale : 1);
      led.looted += amount * leak * (isPlayer ? 0 : 1);
      if (!isPlayer) gov.loot += amount * leak * 0.5;
      infra[line.id] = clamp(infra[line.id] + (amount * (1 - leak)) / cost, 0, 100);
    }
  }
  gov.treasury -= discretionary;
}

/** Palliatives land on the poorer half of the jurisdiction, as ₦ per worker this month. */
function distributeRelief(g: Game, level: Level, where: string, bn: number) {
  const lgas = LGAS.filter((l) => level === 'federal' || (level === 'state' ? l.state === where : l.id === where));
  const share = level === 'federal' ? 16.5 / 93.47 : 1;
  let poorWorkers = 0;
  for (const l of lgas) for (const c of Object.values(g.cohorts[l.id])) if (c.income < 70_000 * g.macro.priceLevel) poorWorkers += c.workers;
  const perHead = poorWorkers > 0 ? (bn * share * 1e9) / (poorWorkers * 1e6) : 0;
  for (const l of lgas) {
    for (const c of Object.values(g.cohorts[l.id])) {
      if (c.income < 70_000 * g.macro.priceLevel) c.relief += perHead * 0.6; // 40% never reaches anybody
    }
  }
}

function decayInfra(g: Game) {
  const decay = (o: Record<string, number>) => {
    for (const k of Object.keys(o)) o[k] = clamp(o[k] * (1 - (DECAY[k] ?? 0.02)), 0, 100);
  };
  decay(g.fedInfra as unknown as Record<string, number>);
  for (const s of STATES) decay(g.stateInfra[s.id] as unknown as Record<string, number>);
  for (const l of LGAS) decay(g.lgaInfra[l.id] as unknown as Record<string, number>);
  for (const l of LGAS) for (const c of Object.values(g.cohorts[l.id])) c.relief = 0;
}

/** A state "urban renewal" demolition: eight weeks of chaos, then a shiny market with higher levies. */
export function demolishMarket(g: Game, lga: string): string {
  g.demolition[lga] = 8;
  const l = lgaById(lga);
  return `${stateById(l.state).name} Government demolishes ${l.nick} market for “urban renewal”. Traders given 48 hours`;
}

/** Weekly: demolished markets rebuild, sanitation days, approvals. */
export function weeklyGovernment(g: Game) {
  for (const l of LGAS) {
    if (g.demolition[l.id] > 0) {
      g.demolition[l.id]--;
      if (g.demolition[l.id] === 0) {
        g.lgaInfra[l.id].markets = 85;
        g.lgas[l.id].policy.levy = Math.min(0.1, g.lgas[l.id].policy.levy + 0.01);
      }
    }
    if (g.lgas[l.id].policy.sanitationDay) g.lgaInfra[l.id].sanitation = clamp(g.lgaInfra[l.id].sanitation + 0.35, 0, 100);
  }
  g.fed.approval = approval(g, 'federal');
  for (const s of STATES) g.states[s.id].approval = approval(g, 'state', s.id);
  for (const l of LGAS) g.lgas[l.id].approval = approval(g, 'lga', l.id);
}

export const govById = (g: Game, id: string): Gov<FedPolicy> | Gov<StatePolicy> | Gov<LgaPolicy> =>
  id === 'FED' ? g.fed : id in g.states ? g.states[id as StateId] : g.lgas[id];

export const levelOf = (id: string): Level => (id === 'FED' ? 'federal' : STATES.some((s) => s.id === id) ? 'state' : 'lga');

/** Weekly fuel subsidy bill, ₦bn: the gap between landing cost and pump price on ~50m litres a day. */
export function accrueSubsidy(g: Game) {
  const fp = g.fed.policy;
  if (!fp.subsidy) return;
  const landing = g.macro.fxParallel * 0.55 + 120 * Math.sqrt(g.macro.priceLevel);
  g.macro.subsidyBill += (Math.max(0, landing - fp.subsidyPrice) * 0.35 * 1e9) / 1e9;
}

export { okadaBanned };
