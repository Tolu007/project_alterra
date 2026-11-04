import type { Level } from '../data/politics';
import { tradeById, TRADES } from '../data/trades';
import { LGAS, STATES, lgaById, stateById, type StateId, type TradeId } from '../data/world';
import { chance, gauss } from './rng';
import type { Cohort, Game } from './types';

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const STATE_IDS = STATES.map((s) => s.id);

// ───────────── services ─────────────

/** What a resident of an LGA actually experiences, combining all three levels of government. */
export function services(g: Game, lga: string) {
  const l = lgaById(lga);
  const f = g.fedInfra;
  const s = g.stateInfra[l.state];
  const li = g.lgaInfra[lga];
  return {
    roads: 0.35 * f.roads + 0.45 * s.roads + 0.2 * li.roads,
    security: 0.5 * f.security + 0.5 * s.security,
    schools: 0.3 * f.schools + 0.7 * s.schools,
    health: 0.2 * f.health + 0.5 * s.health + 0.3 * li.health,
    sanitation: li.sanitation,
    markets: li.markets * (g.demolition[lga] > 0 ? 0.3 : 1),
    grid: g.prices[l.state].grid,
  };
}

export function gridHours(g: Game, state: StateId): number {
  const eff = Math.min(100, 0.8 * g.fedInfra.power + 0.3 * g.stateInfra[state].power);
  const rationing = g.fed.policy.tariff === 'subsidised' ? 0.88 : 1;
  return (2 + (18 * eff) / 100) * rationing;
}

// ───────────── macro (weekly) ─────────────

export function updateMacro(g: Game) {
  const m = g.macro;
  const fp = g.fed.policy;

  m.oilPrice = clamp(m.oilPrice + 0.06 * (72 - m.oilPrice) + gauss(g) * 1.8, 35, 130);
  const riversSecurity = 0.5 * g.fedInfra.security + 0.5 * g.stateInfra.RI.security;
  const target = 1.9 * (0.7 + (0.3 * riversSecurity) / 100);
  m.oilOutput += 0.12 * (target - m.oilOutput);

  // Dollar supply and demand, $bn a week.
  const supply = (m.oilOutput * 7 * m.oilPrice * 0.55) / 1000 + 0.38 + 0.12 * m.confidence * (fp.mpr / 20);
  const demandIdx = nationalDemand(g);
  const fuelImports = 0.2 * (fp.subsidy ? 1.3 : 1);
  const demand = 0.55 * demandIdx * Math.pow(1500 / m.fxParallel, 0.6) + fuelImports + 0.15 * (1 - m.confidence) + 0.05 * (m.inflation / 0.2);

  const before = m.fxParallel;
  if (fp.fx === 'float') {
    m.fxParallel *= Math.exp(0.1 * ((demand - supply) / supply) + 0.0008 + gauss(g) * 0.004);
    m.fxOfficial = m.fxParallel;
    m.peg = m.fxParallel;
  } else {
    // Cheap official dollars invite more demand than supply; reserves cover the gap until they cannot.
    const excess = demand * 1.15 - supply;
    m.reserves = Math.max(0, m.reserves - excess * 0.9);
    m.fxOfficial = m.peg;
    const gap = clamp(0.12 + 1.6 * Math.max(0, excess / supply) + 0.6 * Math.max(0, 1 - m.reserves / 30), 0.05, 1.5);
    m.fxParallel += 0.25 * (m.peg * (1 + gap) - m.fxParallel);
  }
  if (fp.fx === 'float') m.reserves = clamp(m.reserves + (supply - demand) * 0.15, 0, 80);

  // Confidence: stable naira, low inflation and few policy shocks build it.
  const fxMove = Math.abs(Math.log(m.fxParallel / before));
  const debtLoad = g.fed.ledger.debtService / Math.max(1, g.fed.ledger.revenue);
  m.confidence = clamp(
    m.confidence + 0.01 * (0.6 - m.confidence) - 0.6 * fxMove - 0.002 * Math.max(0, m.inflation - 0.2) * 10 - 0.003 * Math.max(0, debtLoad - 0.8) * 10 + (fp.fx === 'peg' ? -0.002 : 0.001),
    0.05,
    1,
  );

  // General price level: base drift, money printing, exchange-rate and fuel pass-through, interest rates.
  const petrolAvg = STATE_IDS.reduce((a, s) => a + g.prices[s].petrol, 0) / STATE_IDS.length;
  const petrolBefore = g.flags.petrolAvg ?? petrolAvg;
  g.flags.petrolAvg = petrolAvg;
  const growth =
    0.0022 +
    0.000006 * fp.print +
    0.0000008 * (fp.borrow + g.fed.budget.palliatives * 300) +
    0.22 * Math.log(m.fxParallel / before) +
    0.07 * Math.log(petrolAvg / petrolBefore) -
    0.00012 * (fp.mpr - 20);
  m.priceLevel *= Math.exp(Math.max(-0.004, growth));
  m.priceHistory.push(m.priceLevel);
  if (m.priceHistory.length > 49) m.priceHistory.shift();
  // History is seeded at setup with the starting inflation rate, so this is always a true 48-week change.
  m.inflation = m.priceLevel / m.priceHistory[0] - 1;
}

/** Spending power across the playable LGAs, 1 at the start. */
export function nationalDemand(g: Game): number {
  let now = 0;
  let base = 0;
  for (const l of LGAS) {
    now += localDemand(g, l.id) * l.voters;
    base += l.voters;
  }
  return now / base;
}

/**
 * Local spending power, 1 at the start. Built only from things outside the self-employed
 * loop (real wages, confidence, relief money): if traders' takings fed back into demand,
 * any good week would compound forever.
 */
export function localDemand(g: Game, lga: string): number {
  const l = lgaById(lga);
  const cpi = g.prices[l.state].cpi;
  const cs = g.cohorts[lga];
  let real = 0;
  let base = 0;
  let relief = 0;
  let workers = 0;
  for (const t of TRADES) {
    const c = cs[t.id];
    if (!c) continue;
    workers += c.workers;
    relief += c.relief * c.workers;
    if (t.kind !== 'salary') continue;
    real += ((c.income * c.employed) / cpi) * c.workers;
    base += c.base * c.workers;
  }
  const wages = base > 0 ? real / base : 1;
  const handouts = relief / Math.max(workers, 1e-9) / (20_000 * g.macro.priceLevel);
  return clamp(0.55 * wages + 0.3 * (g.macro.confidence / 0.55) + 0.15 + 0.1 * handouts, 0.5, 1.8);
}

// ───────────── prices (weekly) ─────────────

function farmSupply(g: Game): number {
  const sec = 0.5 * g.fedInfra.security + 0.5 * g.stateInfra.KN.security;
  const fert = Math.pow(1500 / g.macro.fxParallel, 0.2);
  return (0.5 + (0.5 * sec) / 100) * fert * (g.fed.policy.riceBan ? 1.05 : 1);
}

export function updatePrices(g: Game, first = false) {
  const m = g.macro;
  const fp = g.fed.policy;
  const P = m.priceLevel;
  if (first) g.ref.farm = farmSupply(g);
  const supply = farmSupply(g) / g.ref.farm;

  for (const st of STATES) {
    const pr = g.prices[st.id];
    const landing = m.fxParallel * 0.55 + 120 * Math.sqrt(P);
    const pump = fp.subsidy ? fp.subsidyPrice : landing;
    const gapShare = fp.subsidy ? (landing - pump) / landing : 0;
    // A deep subsidy gap means marketers hoard or smuggle; queues come and go.
    pr.scarcity = !first && fp.subsidy && gapShare > 0.3 && chance(g, Math.min(0.8, (gapShare - 0.3) * 2.5));
    pr.petrol = pump * st.fuelAdj * (pr.scarcity ? 1.4 : 1);
    pr.diesel = (m.fxParallel * 0.68 + 150 * Math.sqrt(P)) * st.fuelAdj;
    pr.grid = gridHours(g, st.id);

    const tariff = fp.tariff === 'cost' ? 210 * Math.pow(P, 0.6) : 90 * Math.pow(P, 0.3);
    pr.energy = (pr.grid * 1.2 * tariff + (24 - pr.grid) * 0.18 * pr.petrol * 0.5) * 7;

    const roads = 0.35 * g.fedInfra.roads + 0.45 * g.stateInfra[st.id].roads + 10;
    const ban = fp.riceBan ? (st.id === 'KN' ? 1.03 : 1.08) : 1;
    pr.food =
      st.foodAdj *
      Math.pow(P, 0.9) *
      Math.pow(m.fxParallel / 1500, 0.22) *
      Math.pow(pr.petrol / (945 * st.fuelAdj), 0.1) *
      (1 + (0.25 * (50 - roads)) / 50) *
      ban /
      (0.75 + 0.25 * supply);
    if (first) g.ref.food[st.id] = pr.food;
    pr.food = (pr.food / g.ref.food[st.id]) * st.foodAdj;
    pr.rice = 78_000 * (pr.food / st.foodAdj) * (st.id === 'KN' ? 0.92 : 1) * (fp.riceBan ? 1.15 : 1);

    if (first) {
      g.ref.petrol[st.id] = pr.petrol;
      g.ref.energy[st.id] = pr.energy;
    }
  }

  for (const l of LGAS) {
    const st = stateById(l.state);
    const pr = g.prices[l.state];
    const sv = services(g, l.id);
    const banned = okadaBanned(g, l.id);
    const dues = g.lgas[l.id].policy.park === 'touts' ? 1.08 : g.lgas[l.id].policy.park === 'official' ? 1.03 : 1;
    const raw =
      Math.pow(pr.petrol / g.ref.petrol[l.state], 0.55) *
      Math.pow(P, 0.35) *
      (1 + (0.3 * (50 - sv.roads)) / 50) *
      (banned ? 1.12 : 1) *
      dues;
    if (first) g.ref.fare[l.id] = raw;
    g.fares[l.id] = st.fare * (raw / g.ref.fare[l.id]);
  }

  for (const st of STATES) {
    const pr = g.prices[st.id];
    const fareIdx = st.fare ? avgFare(g, st.id) / st.fare : 1;
    const rentIdx = avgRent(g, st.id) / avgStartRent(st.id);
    pr.cpi = 0.5 * (pr.food / st.foodAdj) + 0.15 * fareIdx + 0.15 * rentIdx + 0.1 * (pr.energy / g.ref.energy[st.id]) + 0.1 * P;
  }
}

export function okadaBanned(g: Game, lga: string): boolean {
  const l = lgaById(lga);
  const ban = g.states[l.state].policy.okada;
  return ban === 'full' || (ban === 'partial' && l.central);
}

const avgFare = (g: Game, s: StateId) => {
  const ls = LGAS.filter((l) => l.state === s);
  return ls.reduce((a, l) => a + g.fares[l.id], 0) / ls.length;
};
const avgRent = (g: Game, s: StateId) => {
  const ls = LGAS.filter((l) => l.state === s);
  return ls.reduce((a, l) => a + g.rent[l.id], 0) / ls.length;
};
const avgStartRent = (s: StateId) => {
  const ls = LGAS.filter((l) => l.state === s);
  return ls.reduce((a, l) => a + l.rent, 0) / ls.length;
};

/** Monthly rent drift: inflation plus a premium where services are good. Rent control freezes it. */
export function updateRents(g: Game, monthlyInflation: number) {
  for (const l of LGAS) {
    if (g.states[l.state].policy.rentControl) continue;
    const sv = services(g, l.id);
    const quality = (sv.roads + sv.security + sv.grid * 5) / 3;
    g.rent[l.id] *= 1 + 0.65 * Math.max(0, monthlyInflation) + 0.003 * ((quality - 45) / 45);
  }
}

// ───────────── incomes (weekly) ─────────────

const STATE_PAY: Record<StateId, number> = { LA: 1.1, KN: 0.8, RI: 1 };

/** Base weekly income of a trade in an LGA at the start of the game, ₦. */
export function startIncome(lga: string, trade: TradeId): number {
  const t = tradeById(trade);
  const l = lgaById(lga);
  if (t.kind === 'none') return 8_000;
  if (t.kind === 'salary') return t.base / 4;
  return t.base * STATE_PAY[l.state] * (0.75 + 0.5 * l.wealth);
}

/** Share of the month's wage bill a government actually paid. */
export const paidShare = (gov: { ledger: { wages: number; wagesPaid: number } }) =>
  gov.ledger.wages > 0 ? clamp(gov.ledger.wagesPaid / gov.ledger.wages, 0, 1) : 1;

export function minWageFactor(g: Game, state: StateId) {
  return g.states[state].policy.payMinWage ? Math.max(1, Math.pow(g.fed.policy.minWage / 70_000, 0.85)) : 1;
}

/** Weekly income of one worker in a trade in an LGA right now, ₦ (before the player's own skill). */
export function tradeIncome(g: Game, lga: string, trade: TradeId): { income: number; employed: number } {
  const t = tradeById(trade);
  const l = lgaById(lga);
  const P = g.macro.priceLevel;
  const base = startIncome(lga, trade);
  const pr = g.prices[l.state];
  const sv = services(g, lga);
  const dem = localDemand(g, lga);

  if (t.kind === 'none') return { income: base * Math.pow(P, 0.7) * Math.pow(dem, 0.5), employed: 0 };

  if (t.kind === 'salary') {
    let pay = base;
    let employed = 1;
    if (t.payer === 'state') pay *= minWageFactor(g, l.state) * paidShare(g.states[l.state]);
    else if (t.payer === 'lga') pay *= minWageFactor(g, l.state) * paidShare(g.lgas[lga]);
    else {
      const fxIdx = g.macro.fxParallel / g.ref.fx;
      if (t.usd) pay *= (1 - t.usd) * g.wageIndex + t.usd * fxIdx;
      else pay *= g.wageIndex;
      if (trade === 'factory') pay = Math.max(pay, (g.fed.policy.minWage * 1.15) / 4);
      employed =
        trade === 'oil'
          ? clamp(0.92 * Math.pow(g.macro.oilOutput / 1.6, 1.2), 0.5, 1)
          : clamp(0.9 * Math.pow(dem, t.demand) * (0.85 + (0.15 * sv.grid) / 8), 0.55, 0.98);
    }
    return { income: pay, employed };
  }

  // Self-employed: takings follow prices and local spending; costs follow fuel, power, the naira and food.
  const transport = t.levy === 'park';
  const fareIdx = g.fares[lga] / stateById(l.state).fare;
  const foodIdx = pr.food / stateById(l.state).foodAdj;
  let gross = transport ? fareIdx : trade === 'farmer' ? Math.pow(foodIdx, 0.8) : Math.pow(P, 0.85);
  gross *= Math.pow(dem, t.demand);
  gross *= (1 + (t.roads * (sv.roads - 50)) / 100) * (1 + (t.security * (sv.security - 50)) / 100) * (1 + (t.markets * (sv.markets - 50)) / 100);

  const lp = g.lgas[lga].policy;
  const sp = g.states[l.state].policy;
  if (t.levy === 'market') gross *= 1 - (lp.levy - 0.03);
  gross *= 1 - (sp.tax - 0.03) * (trade === 'business' ? 1.5 : 1);
  if (trade === 'okada' && okadaBanned(g, lga)) gross *= 0.35;
  if ((trade === 'keke' || trade === 'danfo') && okadaBanned(g, lga)) gross *= 1.06;
  if (t.markets > 0.2 && g.demolition[lga] > 0) gross *= 0.4;
  if (trade === 'farmer' && g.fed.policy.riceBan && l.farm === 'Rice farming') gross *= 1.25;
  if (g.flags[`strike:${l.state}`] && transport) gross *= 0.7;

  const costs =
    t.fuel * (pr.petrol / g.ref.petrol[l.state] - 1) +
    t.power * (pr.energy / g.ref.energy[l.state] - 1) +
    t.fx * 0.6 * (g.macro.fxParallel / g.ref.fx - 1) +
    t.food * (foodIdx - 1);

  let income = base * (gross - costs);
  if (transport) {
    const daily = lp.park === 'touts' ? 0 : lp.park === 'official' ? 1_500 : 2_500;
    income += daily * 6 * Math.sqrt(P);
  }
  return { income: Math.max(base * 0.15 * Math.sqrt(P), income), employed: 1 };
}

// ───────────── satisfaction (weekly) ─────────────

const sx = (v: number) => clamp(v, -1, 1);

/**
 * How each cohort feels about each level of government. People blame the president for
 * the naira and fuel, the governor for roads and bans, the chairman for markets and levies.
 */
export function updateSatisfaction(g: Game) {
  const m = g.macro;
  const fp = g.fed.policy;
  const inflationX = -sx((m.inflation - 0.15) / 0.25);
  const fxX = -sx((m.fxParallel / g.ref.fx - 1) / 0.6);
  const fedRelief = g.fed.budget.palliatives > 0.15 ? 0.4 : 0;

  for (const l of LGAS) {
    const st = g.states[l.state];
    const lg = g.lgas[l.id];
    const pr = g.prices[l.state];
    const sv = services(g, l.id);
    const fuelX = -sx((pr.petrol / g.ref.petrol[l.state] - 1) / 0.6);
    const gridX = sx((pr.grid - 8) / 8);
    const secX = sx((sv.security - 50) / 40);
    const roadsX = sx((sv.roads - 45) / 35);
    const schoolsX = sx((sv.schools - 45) / 35);
    const healthX = sx((sv.health - 45) / 35);
    const sanX = sx((sv.sanitation - 45) / 35);
    const mktX = sx((sv.markets - 45) / 35);

    for (const t of TRADES) {
      const c = g.cohorts[l.id][t.id];
      if (!c) continue;
      const real = (c.income * Math.max(c.employed, 0.3)) / pr.cpi / c.base;
      const incomeX = sx((real - 1) / 0.35);
      const relief = sx(c.relief / 8_000);

      let grievState = 0;
      let grievLga = 0;
      let grievFed = 0;
      if (t.id === 'okada' && okadaBanned(g, l.id)) grievState -= 1;
      if (t.markets > 0.2 && g.demolition[l.id] > 0) {
        grievState -= 0.8;
        grievLga -= 0.4;
      }
      if (t.id === 'teacher' && st.arrears > 0.5) grievState -= sx(st.arrears / 2);
      if (t.id === 'lgstaff' && lg.arrears > 0.5) grievLga -= sx(lg.arrears / 2);
      if (t.levy === 'market') grievLga -= sx((lg.policy.levy - 0.03) / 0.05);
      if (t.levy === 'park') grievLga -= lg.policy.park === 'touts' ? 0.5 : lg.policy.park === 'official' ? 0.15 : -0.3;
      grievState -= sx((st.policy.tax - 0.03) / 0.05) * (t.id === 'business' ? 1 : 0.4);
      if (st.policy.freeSchool) grievState += 0.25;
      if (st.policy.rentControl) grievState += 0.15;
      if (fp.subsidy) grievFed += 0.3;
      if (fp.riceBan) grievFed += t.id === 'farmer' && l.state === 'KN' ? 0.7 : -0.2;
      if (t.kind === 'salary' && fp.minWage > 70_000) grievFed += sx((fp.minWage - 70_000) / 60_000) * 0.5;

      const target: Record<Level, number> = {
        federal: 50 + 50 * (0.24 * inflationX + 0.16 * fuelX + 0.1 * fxX + 0.14 * gridX + 0.08 * secX + 0.18 * incomeX + 0.1 * sx(grievFed + fedRelief)),
        state: 50 + 50 * (0.18 * roadsX + 0.08 * schoolsX + 0.08 * healthX + 0.1 * secX + 0.16 * incomeX + 0.3 * sx(grievState) + 0.1 * relief),
        lga: 50 + 50 * (0.2 * mktX + 0.14 * sanX + 0.12 * roadsX + 0.14 * incomeX + 0.3 * sx(grievLga) + 0.1 * relief),
      };
      for (const lv of ['federal', 'state', 'lga'] as Level[]) {
        c.sat[lv] += 0.25 * (clamp(target[lv], 0, 100) - c.sat[lv]);
      }
      const mood = 50 + 50 * (0.5 * incomeX + 0.15 * gridX + 0.1 * secX + 0.1 * healthX + 0.15 * relief);
      c.happiness += 0.3 * (clamp(mood, 0, 100) - c.happiness);
    }
  }

  // The 34 states we do not simulate follow the national picture.
  const restTarget = 50 + 50 * (0.35 * inflationX + 0.2 * fxX + 0.2 * sx((g.prices.LA.grid - 8) / 8) + 0.15 * sx((g.fedInfra.security - 45) / 35) + 0.1 * sx((fp.subsidy ? 0.4 : 0) + fedRelief));
  g.restMood += 0.2 * (clamp(restTarget, 0, 100) - g.restMood);
}

export function updateCohorts(g: Game) {
  for (const l of LGAS) {
    for (const t of TRADES) {
      const c: Cohort | undefined = g.cohorts[l.id][t.id];
      if (!c) continue;
      const r = tradeIncome(g, l.id, t.id);
      c.income = r.income;
      c.employed = r.employed;
    }
  }
}

/** Population-weighted satisfaction with a government across its jurisdiction. */
export function approval(g: Game, level: Level, where?: string): number {
  let sum = 0;
  let n = 0;
  for (const l of LGAS) {
    if (level === 'state' && l.state !== where) continue;
    if (level === 'lga' && l.id !== where) continue;
    for (const c of Object.values(g.cohorts[l.id])) {
      sum += c.sat[level] * c.workers;
      n += c.workers;
    }
  }
  if (level === 'federal') {
    const rest = 76.95;
    return (sum + g.restMood * rest) / (n + rest);
  }
  return n ? sum / n : 50;
}

export function stateAverage(g: Game, state: StateId, pick: (c: Cohort, t: TradeId) => number): number {
  let sum = 0;
  let n = 0;
  for (const l of LGAS) {
    if (l.state !== state) continue;
    for (const [t, c] of Object.entries(g.cohorts[l.id]) as [TradeId, Cohort][]) {
      sum += pick(c, t) * c.workers;
      n += c.workers;
    }
  }
  return n ? sum / n : 0;
}
