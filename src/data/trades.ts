import type { TradeId } from './world';

export type PlaceId =
  | 'home'
  | 'busstop'
  | 'lot'
  | 'market'
  | 'park'
  | 'workshop'
  | 'farm'
  | 'school'
  | 'secretariat'
  | 'office'
  | 'techhub'
  | 'oilsite'
  | 'factory'
  | 'skills'
  | 'joint'
  | 'party'
  | 'clinic'
  | 'bank'
  | 'govhouse'
  | 'palace'
  | 'venue';

export type Skill = 'edu' | 'tech' | 'biz' | 'people';

/** What a salaried job gives you besides the salary. Running your own business gives you none of these. */
export type PerkId = 'hmo' | 'pension' | 'bonus' | 'transport' | 'lunch' | 'housing' | 'data' | 'staffLoan';
export const PERKS: Record<PerkId, { name: string; short: string; detail: string }> = {
  hmo: { name: 'HMO health cover', short: 'Free clinic', detail: 'Clinic visits and hospital bills are covered.' },
  pension: { name: 'Pension', short: 'Pension', detail: 'Your employer pays 10% of your salary into your retirement account.' },
  bonus: { name: '13th-month bonus', short: '13th month', detail: 'An extra month’s pay at the end of the year.' },
  transport: { name: 'Staff bus', short: 'Staff bus', detail: 'No transport fare on workdays.' },
  lunch: { name: 'Canteen lunch', short: 'Free lunch', detail: 'A hot meal on every shift.' },
  housing: { name: 'Housing allowance', short: 'Rent support', detail: 'Your employer pays 40% of your yearly rent.' },
  data: { name: 'Laptop & data', short: 'Free data', detail: 'Data and airtime are on the company.' },
  staffLoan: { name: 'Staff loan', short: 'Cheap loans', detail: 'Borrow at 6 points below the bank rate.' },
};

export interface TradeDef {
  id: TradeId;
  name: string;
  /** self: earns per day worked. salary: paid monthly by `payer`. */
  kind: 'self' | 'salary' | 'none';
  payer?: 'state' | 'lga' | 'private';
  /** self: weekly net at the start (₦). salary: monthly pay (₦). */
  base: number;
  /** How strongly income follows local spending power. */
  demand: number;
  /** Cost shares at the start: what fraction of gross goes on each input. */
  fuel: number;
  power: number;
  fx: number;
  food: number;
  /** Which local charge hits this trade. */
  levy: 'market' | 'park' | 'none';
  /** How much each service matters to output (0..1). */
  roads: number;
  security: number;
  markets: number;
  place: PlaceId;
  /** Capital to start on your own, ₦. */
  capital: number;
  /** "Work and pay": start with nothing, remit this much a week to the owner. */
  hire?: number;
  needs?: Partial<Record<Skill, number>>;
  /** Fraction of pay tied to the dollar (remote and oil jobs). */
  usd?: number;
  /** Which skill makes you better at it. */
  skill: Skill;
  blurb: string;
  /** Benefits that come with a salaried job. */
  perks?: PerkId[];
}

export const TRADES: TradeDef[] = [
  {
    id: 'trader', name: 'Market trader', kind: 'self', base: 55_000, demand: 1, fuel: 0.05, power: 0.05, fx: 0.3, food: 0, levy: 'market',
    roads: 0.3, security: 0.15, markets: 0.5, place: 'market', capital: 150_000, skill: 'biz',
    blurb: 'Buy at Balogun, sell at a markup. Margins live and die with the naira.',
  },
  {
    id: 'pos', name: 'POS agent', kind: 'self', base: 42_000, demand: 0.7, fuel: 0.03, power: 0.1, fx: 0, food: 0, levy: 'market',
    roads: 0.1, security: 0.3, markets: 0.3, place: 'market', capital: 120_000, skill: 'biz',
    blurb: 'Under an umbrella with a card machine. Busy when banks fail, robbed when security fails.',
  },
  {
    id: 'foodvendor', name: 'Mama put (food seller)', kind: 'self', base: 40_000, demand: 0.9, fuel: 0.06, power: 0.04, fx: 0, food: 0.45, levy: 'market',
    roads: 0.15, security: 0.1, markets: 0.4, place: 'market', capital: 80_000, skill: 'biz',
    blurb: 'Rice, stew, swallow. When food prices jump, either your margin shrinks or your portions do.',
  },
  {
    id: 'okada', name: 'Okada rider', kind: 'self', base: 55_000, demand: 0.7, fuel: 0.35, power: 0, fx: 0, food: 0, levy: 'park',
    roads: 0.4, security: 0.2, markets: 0, place: 'park', capital: 1_300_000, hire: 25_000, skill: 'people',
    blurb: 'Fastest way through traffic. Banned in some places, and fuel prices bite first.',
  },
  {
    id: 'keke', name: 'Keke driver', kind: 'self', base: 70_000, demand: 0.75, fuel: 0.3, power: 0, fx: 0, food: 0, levy: 'park',
    roads: 0.4, security: 0.15, markets: 0, place: 'park', capital: 3_800_000, hire: 45_000, skill: 'people',
    blurb: 'Three wheels, four passengers, five tickets from the touts a day.',
  },
  {
    id: 'danfo', name: 'Danfo driver', kind: 'self', base: 85_000, demand: 0.75, fuel: 0.35, power: 0, fx: 0, food: 0, levy: 'park',
    roads: 0.45, security: 0.15, markets: 0, place: 'park', capital: 9_000_000, hire: 70_000, skill: 'people',
    blurb: 'The yellow bus. Conductor shouting, agbero collecting, owner waiting for his remittance.',
  },
  {
    id: 'artisan', name: 'Artisan (tailor, mechanic, stylist)', kind: 'self', base: 38_000, demand: 1, fuel: 0.04, power: 0.25, fx: 0.1, food: 0, levy: 'market',
    roads: 0.15, security: 0.1, markets: 0.2, place: 'workshop', capital: 80_000, needs: { tech: 1 }, skill: 'tech',
    blurb: 'Your hands are your business, and NEPA decides how many hours your machine runs.',
  },
  {
    id: 'farmer', name: 'Farmer / fisher', kind: 'self', base: 32_000, demand: 0.3, fuel: 0.1, power: 0, fx: 0.2, food: 0, levy: 'none',
    roads: 0.35, security: 0.6, markets: 0.1, place: 'farm', capital: 150_000, skill: 'tech',
    blurb: 'Feed the nation. Insecurity, fertiliser prices and bad roads eat the profit.',
  },
  {
    id: 'teacher', name: 'Teacher (state school)', kind: 'salary', payer: 'state', base: 95_000, demand: 0, fuel: 0, power: 0, fx: 0, food: 0, levy: 'none',
    roads: 0, security: 0, markets: 0, place: 'school', capital: 0, needs: { edu: 3 }, skill: 'edu', perks: ['hmo', 'pension'],
    blurb: 'Paid by the state. When the state does not pay, nobody does.',
  },
  {
    id: 'lgstaff', name: 'Local government worker', kind: 'salary', payer: 'lga', base: 80_000, demand: 0, fuel: 0, power: 0, fx: 0, food: 0, levy: 'none',
    roads: 0, security: 0, markets: 0, place: 'secretariat', capital: 0, needs: { edu: 2 }, skill: 'edu', perks: ['hmo', 'pension'],
    blurb: 'Steady work at the LG secretariat, if the chairman remembers salaries.',
  },
  {
    id: 'office', name: 'Office worker (bank, corporate)', kind: 'salary', payer: 'private', base: 380_000, demand: 0.5, fuel: 0, power: 0, fx: 0, food: 0, levy: 'none',
    roads: 0, security: 0, markets: 0, place: 'office', capital: 0, needs: { edu: 3 }, skill: 'edu', perks: ['hmo', 'pension', 'bonus', 'transport', 'staffLoan'],
    blurb: 'Suit, laptop, 5am start to beat the traffic. Raises come yearly; inflation comes weekly.',
  },
  {
    id: 'tech', name: 'Software developer', kind: 'salary', payer: 'private', base: 650_000, demand: 0.3, fuel: 0, power: 0, fx: 0, food: 0, levy: 'none',
    roads: 0, security: 0, markets: 0, place: 'techhub', capital: 0, needs: { tech: 3 }, usd: 0.4, skill: 'tech', perks: ['hmo', 'pension', 'data'],
    blurb: 'Part of your pay is in dollars, so a falling naira is your raise. Needs light and data.',
  },
  {
    id: 'oil', name: 'Oil & gas technician', kind: 'salary', payer: 'private', base: 900_000, demand: 0, fuel: 0, power: 0, fx: 0, food: 0, levy: 'none',
    roads: 0, security: 0, markets: 0, place: 'oilsite', capital: 0, needs: { tech: 3, edu: 3 }, usd: 0.25, skill: 'tech', perks: ['hmo', 'pension', 'bonus', 'housing', 'transport'],
    blurb: 'Top pay, offshore rotations. Jobs follow oil output, which follows the pipelines.',
  },
  {
    id: 'factory', name: 'Factory worker', kind: 'salary', payer: 'private', base: 110_000, demand: 0.6, fuel: 0, power: 0, fx: 0, food: 0, levy: 'none',
    roads: 0, security: 0, markets: 0, place: 'factory', capital: 0, skill: 'tech', perks: ['hmo', 'pension', 'lunch', 'transport'],
    blurb: 'Shift work. When diesel and dollars get dear, factories cut shifts first.',
  },
  {
    id: 'business', name: 'Business owner (shop, importer)', kind: 'self', base: 220_000, demand: 1.1, fuel: 0.05, power: 0.15, fx: 0.35, food: 0, levy: 'market',
    roads: 0.25, security: 0.2, markets: 0.2, place: 'office', capital: 3_000_000, needs: { biz: 2 }, skill: 'biz',
    blurb: 'Import, stock, sell, hire. Big upside, big exposure to the naira and to taxes.',
  },
  {
    id: 'unemployed', name: 'Looking for work', kind: 'none', base: 0, demand: 0, fuel: 0, power: 0, fx: 0, food: 0, levy: 'none',
    roads: 0, security: 0, markets: 0, place: 'home', capital: 0, skill: 'people',
    blurb: 'Waking up with no work to go to. Odd jobs and hope.',
  },
];

export const tradeById = (id: TradeId) => TRADES.find((t) => t.id === id)!;

export const PLACES: Record<PlaceId, { name: string; blurb: string }> = {
  home: { name: 'Home', blurb: 'Rest, family, and the generator outside the window.' },
  busstop: { name: 'Bus stop', blurb: 'Danfos to the rest of the state. “Oshodi! Oshodi! Enter with your change!”' },
  lot: { name: 'Plot', blurb: 'A plot of land on the street.' },
  market: { name: 'Market', blurb: 'Traders, POS umbrellas, mama put and market levies.' },
  park: { name: 'Motor park', blurb: 'Danfos, kekes, okadas, and agberos with tickets.' },
  workshop: { name: 'Workshops', blurb: 'Tailors, mechanics, stylists and vulcanisers.' },
  farm: { name: 'Farms', blurb: 'Fields, ponds or fishing canoes.' },
  school: { name: 'Public school', blurb: 'Classrooms that need roofs and teachers who need pay.' },
  secretariat: { name: 'LG secretariat', blurb: 'The local government council.' },
  office: { name: 'Office district', blurb: 'Banks, corporates, importers.' },
  techhub: { name: 'Tech hub', blurb: 'Laptops, startups, and a backup inverter.' },
  oilsite: { name: 'Oil & gas site', blurb: 'Flare stacks, pipelines, rotations.' },
  factory: { name: 'Factory', blurb: 'Shift work and diesel generators.' },
  skills: { name: 'Skills centre', blurb: 'Courses, evening classes, coding bootcamps.' },
  joint: { name: 'Joint & viewing centre', blurb: 'Pepper soup, football and everybody’s gist.' },
  party: { name: 'Party office', blurb: 'Where ambitions are fed and delegates are “mobilised”.' },
  clinic: { name: 'Clinic', blurb: 'Malaria, drips and bills.' },
  bank: { name: 'Bank', blurb: 'Savings, dollars, loans, and land agents outside.' },
  govhouse: { name: 'Government House', blurb: 'Where the governor sits.' },
  palace: { name: 'Palace', blurb: 'The traditional ruler’s court.' },
  venue: { name: 'Event centre', blurb: 'Premieres, concerts, comedy nights and owambe parties.' },
};
