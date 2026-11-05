import type { BizTypeId, WageTier } from '../data/businesses';
import type { FedPolicy, LeaderStyle, Level, LgaPolicy, PartyId, StatePolicy } from '../data/politics';
import type { Role } from '../data/people';
import type { PlaceId, Skill } from '../data/trades';
import type { StateId, TradeId } from '../data/world';

export const DAYS_PER_WEEK = 6; // Monday–Saturday are playable; Sunday is the weekly wrap-up.
/** The day runs on a clock, in minutes after midnight. You wake at 06:00; stay up past 02:00 and you pass out. */
export const DAY_START = 6 * 60;
export const DAY_END = 26 * 60;
export const WEEKS_PER_MONTH = 4;
export const MONTHS_PER_YEAR = 12;
export const WEEKS_PER_YEAR = WEEKS_PER_MONTH * MONTHS_PER_YEAR;
export const START_YEAR = 2027;
/** Person id of the player in single-player saves made before seats existed. Use `g.me` for "the current player". */
export const PLAYER = 0;

export interface Macro {
  fxOfficial: number;
  fxParallel: number;
  /** Peg rate while the naira is pegged. */
  peg: number;
  /** Foreign reserves, $bn. */
  reserves: number;
  oilPrice: number;
  /** Million barrels a day. */
  oilOutput: number;
  /** General price level, 1 at the start. */
  priceLevel: number;
  /** Investor and household confidence, 0..1. */
  confidence: number;
  /** Year-on-year inflation, e.g. 0.22. */
  inflation: number;
  /** ₦bn spent on fuel subsidy this month so far. */
  subsidyBill: number;
  /** Price level 48 weeks ago, for year-on-year inflation. */
  priceHistory: number[];
}

export interface StatePrices {
  petrol: number;
  diesel: number;
  /** Food index, 1 at the start in Lagos terms. */
  food: number;
  /** A 50kg bag of rice, ₦. */
  rice: number;
  /** Household energy (grid + generator) per week, ₦. */
  energy: number;
  /** Average hours of grid light per day. */
  grid: number;
  /** Consumer price index, 1 at the start. */
  cpi: number;
  /** Fuel queues this week. */
  scarcity: boolean;
}

export interface FedInfra {
  power: number;
  roads: number;
  security: number;
  schools: number;
  health: number;
}
export type StateInfra = FedInfra;
export interface LgaInfra {
  roads: number;
  sanitation: number;
  markets: number;
  health: number;
}

export interface GovLedger {
  revenue: number;
  wages: number;
  wagesPaid: number;
  debtService: number;
  borrowed: number;
  spent: Record<string, number>;
  looted: number;
  subsidy: number;
}

export interface Gov<P> {
  id: string;
  level: Level;
  name: string;
  /** Person id of the officeholder. PLAYER when it is you. */
  leader: number;
  party: PartyId;
  style: LeaderStyle;
  /** ₦bn. */
  treasury: number;
  debt: number;
  /** Months of salary owed to workers. */
  arrears: number;
  /** Share of discretionary money per budget line (sums to 1). */
  budget: Record<string, number>;
  /** Share of the wage bill actually paid each month (0..1). */
  payRate: number;
  policy: P;
  approval: number;
  termStart: number;
  terms: number;
  ledger: GovLedger;
  /** ₦bn diverted so far by the current leader. */
  loot: number;
}

export interface Cohort {
  /** Adults in this trade in this LGA, millions. Also its voters. */
  workers: number;
  /** Weekly income per worker, ₦. */
  income: number;
  /** Real income at the start, for comparisons. */
  base: number;
  /** Share of this cohort with work (salaried trades). */
  employed: number;
  happiness: number;
  /** Satisfaction with each level of government, 0..100. */
  sat: Record<Level, number>;
  /** Palliatives received this month, ₦ per worker. */
  relief: number;
}

export interface Looks {
  skin: number;
  hair: number;
  outfit: number;
  accent: number;
  glasses: boolean;
}

export interface Person {
  id: number;
  name: string;
  gender: 'm' | 'f';
  age: number;
  lga: string;
  trade: TradeId;
  role: Role;
  relation: number;
  party: PartyId | null;
  style: LeaderStyle | null;
  ambition: number;
  looks: Looks;
  bio: string;
  /** Government this person currently leads. */
  office: string | null;
  /** Business this person works for. */
  employer: number | null;
  /** Cash in hand, ₦: what an entrepreneur can open or grow a business with. */
  money: number;
  /** The player character this person is family or a friend of. */
  kin?: number;
  /** Weeks in a row their business has lost money. */
  losses: number;
}

/** A business. Owner is a person id (you are 0), so other owners can come later. */
export interface Business {
  id: number;
  type: BizTypeId;
  name: string;
  lga: string;
  /** The plot it stands on, in the LGA's neighbourhood map. */
  plot: number;
  owner: number;
  level: number;
  /** Person ids of employees. */
  staff: number[];
  wage: WageTier;
  opened: number;
  /** Weeks of work-and-pay remittance left (starters bought on credit). */
  financeWeeks: number;
  /** Shifts the owner put in this week. */
  ownerDays: number;
  /** Day stamp (week × 7 + day) of the owner's last shift here, -1 if never. */
  bossDay: number;
  /** Takings and costs booked so far this week; businesses pay out every night. */
  week: PnLTotals;
  lastProfit: number;
  history: number[];
  /** Last week's profit and loss lines. */
  last: LedgerLine[];
}

export interface PnLTotals {
  revenue: number;
  inputs: number;
  wages: number;
  premises: number;
  /** NEPA bill and generator diesel. */
  power: number;
  /** Repairs, security and permits. */
  upkeep: number;
  levies: number;
  finance: number;
  profit: number;
}

export type Housing = 'family' | 'room' | 'flat' | 'duplex';

export interface Asset {
  kind: 'okada' | 'keke' | 'land';
  lga: string;
  price: number;
  week: number;
}

export interface LedgerLine {
  label: string;
  amount: number;
}

export interface Campaign {
  office: string;
  stage: 'aspirant' | 'nominee';
  spent: number;
  /** Campaign effort per LGA. */
  push: Record<string, number>;
}

export interface Player {
  home: string;
  at: string;
  trade: TradeId;
  /** Working on "work and pay" terms, remitting to an owner. */
  hired: boolean;
  /** Weeks of work-and-pay remittance left. */
  hireWeeks: number;
  /** Business size multiplier for self-employed trades, 1..4. */
  scale: number;
  money: number;
  usd: number;
  /** Outstanding loan, ₦. */
  loan: number;
  health: number;
  energy: number;
  happiness: number;
  /** 100 = full. Drops every block; eat to refill. */
  hunger: number;
  /** 100 = well connected. Drops when you are alone; talk, gist and visit family. */
  social: number;
  skills: Record<Skill, number>;
  influence: Record<string, number>;
  party: PartyId | null;
  standing: number;
  housing: Housing;
  rentDue: number;
  /** Days this week with work done, for attendance and pay. */
  worked: number;
  queries: number;
  hasGenerator: boolean;
  assets: Asset[];
  office: string | null;
  campaign: Campaign | null;
  /** Public scandal while in politics, 0..100. */
  scandal: number;
  /** ₦ diverted while in office. */
  loot: number;
  /** Lines added during the current week. */
  week: LedgerLine[];
  lastWeek: LedgerLine[];
  goals: string[];
  /** Days left that you are laid up in hospital. */
  sick: number;
  /** Retirement savings from salaried jobs (RSA), ₦. */
  pension: number;
  /** The latest weekly paper, kept after it is filed, and the week you last read. */
  paper?: WeekReport | null;
  paperSeen?: number;
}

export type NewsKind = 'politics' | 'economy' | 'business' | 'culture' | 'sports' | 'life';

export interface News {
  week: number;
  text: string;
  tone: 'good' | 'bad' | 'neutral';
  scope: Level | 'life' | 'world';
  where?: string;
  kind?: NewsKind;
  /** How big a story it is, for the weekly front page (1 small … 10 huge). */
  weight?: number;
}

export type CultureKind = 'premiere' | 'concert' | 'comedy' | 'festival' | 'football' | 'owambe';

/** Something happening in town that people can go to. */
export interface CultureEvent {
  id: number;
  kind: CultureKind;
  title: string;
  /** The star, the band, the director or the teams. */
  star: string;
  lga: string;
  place: PlaceId;
  week: number;
  day: number;
  /** Minutes after midnight. */
  start: number;
  end: number;
  ticket: number;
  /** 0..1: how much people are talking about it. */
  hype: number;
  attended: boolean;
  result?: { crowd: number; gross: number; note: string };
}

export interface EventInstance {
  id: string;
  lga?: string;
  person?: number;
  amount?: number;
  gov?: string;
  trade?: TradeId;
}

export interface Snapshot {
  week: number;
  fx: number;
  inflation: number;
  petrol: Record<StateId, number>;
  rice: Record<StateId, number>;
  fare: Record<StateId, number>;
  grid: Record<StateId, number>;
  approval: { fed: number; state: Record<StateId, number> };
  money: number;
  income: number;
}

export interface ElectionRecord {
  week: number;
  office: string;
  candidates: { person: number; party: PartyId; votes: number }[];
  byLga: Record<string, number[]>;
  winner: number;
  turnout: number;
  /** "Rest of Nigeria" votes for presidential elections. */
  rest?: number[];
  /** A player was on the ballot. */
  playerRan: boolean;
  /** Which players were on the ballot. */
  humans?: number[];
}

export type Phase = 'day' | 'week' | 'event' | 'govern' | 'election' | 'over';

export interface Ending {
  kind: 'japa' | 'broke' | 'retired' | 'jail';
  week: number;
  text: string;
}

export interface WeekReport {
  week: number;
  lines: LedgerLine[];
  priceMoves: { label: string; before: number; after: number; unit: string }[];
  headlines: News[];
}

/**
 * One person's private slice of the world: their character's life, where they are, their inbox.
 * The engine works on whichever seat is bound into the top-level fields of the game (see seats.ts).
 */
export interface Seat {
  /** Person id of their character. */
  id: number;
  /** Who plays it: an account id online, 'local' offline. */
  account: string;
  player: Player;
  place: PlaceId;
  lot: number | null;
  talked: number[];
  phase: Phase;
  report: WeekReport | null;
  eventQueue: EventInstance[];
  currentEvent: EventInstance | null;
  outcome: string | null;
  seenEvents: Record<string, number>;
  showElection: number | null;
  ending: Ending | null;
  flags: Record<string, number>;
  busyUntil: number;
  asleep: boolean;
  /** Real time (ms) this player was last seen; anyone away for a while is on autopilot. */
  seenMs: number;
}

/** Another player as everyone else sees them. */
export interface PublicSeat {
  id: number;
  place: PlaceId;
  lot: number | null;
  at: string;
  busyUntil: number;
  asleep: boolean;
  online: boolean;
}

export interface Game {
  version: 2;
  /** Which layout of the towns business plots refer to (see MAP_VERSION). Missing in old saves. */
  mapVersion?: number;
  seed: number;
  rng: number;
  /** Everyone with a character in this world, and the one whose life is bound below. -1 when none is. */
  seats: Seat[];
  me: number;
  /** Person ids of characters played by people. */
  humans: number[];
  /** Other players, for drawing them in the world (only in what the server sends you). */
  others?: PublicSeat[];
  /** Flags about the world rather than any one player. */
  wflags: Record<string, number>;
  /** Shared worlds run on a real-time clock: this many game minutes per real minute, from this real moment. */
  shared: { realMs: number; rate: number } | null;
  /** Bound: minute (absolute, see absNow) the bound character is busy until, and whether they are asleep. */
  busyUntil: number;
  asleep: boolean;
  /** Separate random streams, so the town's own life does not change the dice for everything else. */
  rngs: { npc: { rng: number }; culture: { rng: number } };
  week: number;
  day: number;
  /** Minutes after midnight on the current day; past 24:00 is the small hours of the next morning. */
  minute: number;
  /** Premieres, concerts, matches and festivals, this week and next. */
  culture: CultureEvent[];
  /** The plot you are standing at when place is 'lot'. */
  lot: number | null;
  /** People already chatted with today, so a second chat gives nothing. */
  talked: number[];
  phase: Phase;
  macro: Macro;
  prices: Record<StateId, StatePrices>;
  /** Start-of-game reference values used to normalise indices. */
  ref: {
    petrol: Record<StateId, number>;
    fx: number;
    energy: Record<StateId, number>;
    food: Record<StateId, number>;
    /** Raw fare formula value per LGA at the start; displayed fare = state fare × raw / ref. */
    fare: Record<string, number>;
    /** Average real income per LGA at the start, for the local demand index. */
    demand: Record<string, number>;
    farm: number;
  };
  /** Private-sector pay index, adjusted once a year for inflation. */
  wageIndex: number;
  /** One danfo/keke trip per LGA, ₦. */
  fares: Record<string, number>;
  /** One-bedroom flat, ₦ a year, per LGA. */
  rent: Record<string, number>;
  fedInfra: FedInfra;
  stateInfra: Record<StateId, StateInfra>;
  lgaInfra: Record<string, LgaInfra>;
  fed: Gov<FedPolicy>;
  states: Record<StateId, Gov<StatePolicy>>;
  lgas: Record<string, Gov<LgaPolicy>>;
  cohorts: Record<string, Record<TradeId, Cohort>>;
  /** Mood of the 34 states we do not simulate, for federal approval and elections. */
  restMood: number;
  /** Weeks of market disruption after a demolition, per LGA. */
  demolition: Record<string, number>;
  people: Person[];
  businesses: Business[];
  player: Player;
  news: News[];
  series: Snapshot[];
  eventQueue: EventInstance[];
  currentEvent: EventInstance | null;
  outcome: string | null;
  seenEvents: Record<string, number>;
  elections: ElectionRecord[];
  /** The election to show on results night. */
  showElection: number | null;
  flags: Record<string, number>;
  report: WeekReport | null;
  ending: Ending | null;
  /** Place the player last picked, for the scene. */
  place: PlaceId;
}

export const isPlayer = (id: number) => id === PLAYER;
