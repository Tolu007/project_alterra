import type { PlaceId, Skill } from './trades';
import type { LgaDef, TradeId } from './world';

export type BizTypeId =
  | 'stall'
  | 'pos'
  | 'buka'
  | 'workshop'
  | 'farm'
  | 'okada'
  | 'keke'
  | 'supermarket'
  | 'restaurant'
  | 'pharmacy'
  | 'salon'
  | 'school'
  | 'fleet'
  | 'estate'
  | 'wholesale'
  | 'bakery'
  | 'water'
  | 'logistics'
  | 'blocks'
  | 'solar'
  | 'clearing'
  | 'ricemill';

export interface BizType {
  id: BizTypeId;
  name: string;
  /** starter: a one-person hustle anyone can open. consumer: sells to citizens. supplier: sells to other businesses. */
  kind: 'starter' | 'consumer' | 'supplier';
  place: PlaceId;
  /** Starter businesses earn like their trade does in the street economy. */
  trade?: TradeId;
  /** What the owner counts as for the economy and for gist. */
  ownerTrade: TradeId;
  /** ₦ to open, at start-of-game prices. */
  capital: number;
  /** Starters only: start with nothing and remit weekly to an owner instead. */
  financed?: number;
  /** Weekly takings per working hand at the start, ₦ (growth businesses). */
  unit: number;
  /** Cost of goods and inputs as a share of takings. */
  inputs: number;
  /** How those input costs are exposed (shares of `inputs`, summing to ≤ 1). */
  fx: number;
  fuel: number;
  power: number;
  food: number;
  /** Staff slots per level. */
  staffPerLevel: number;
  /** Starters: how much a hired worker yields compared with one self-employed person in the trade (default 1). */
  staffYield?: number;
  /** Street trades whose spending drives this business (suppliers). */
  clients: TradeId[];
  /** Your own businesses that buy from this one: they get cheaper inputs, it gets more orders. */
  feeds: BizTypeId[];
  needs?: Partial<Record<Skill, number>>;
  /** Only some LGAs can host this business. */
  where?: (l: LgaDef) => boolean;
  blurb: string;
}

const T = (b: Omit<BizType, 'fx' | 'fuel' | 'power' | 'food' | 'clients' | 'feeds' | 'unit' | 'inputs'> & Partial<BizType>): BizType => ({
  fx: 0,
  fuel: 0,
  power: 0,
  food: 0,
  clients: [],
  feeds: [],
  unit: 0,
  inputs: 0,
  ...b,
});

export const BIZ: BizType[] = [
  // ── starters: anyone can begin here ──
  T({ id: 'stall', name: 'Market stall', kind: 'starter', place: 'market', trade: 'trader', ownerTrade: 'trader', capital: 150_000, staffPerLevel: 1, blurb: 'Buy at the big market, sell at a markup. Margins move with the naira.' }),
  T({ id: 'pos', name: 'POS stand', kind: 'starter', place: 'market', trade: 'pos', ownerTrade: 'pos', capital: 120_000, staffPerLevel: 1, blurb: 'A card machine under an umbrella. Busy when banks fail.' }),
  T({ id: 'buka', name: 'Mama put (buka)', kind: 'starter', place: 'market', trade: 'foodvendor', ownerTrade: 'foodvendor', capital: 80_000, staffPerLevel: 2, blurb: 'Rice, stew and swallow. Food prices decide your margin.' }),
  T({ id: 'workshop', name: 'Workshop (tailor, mechanic, stylist)', kind: 'starter', place: 'workshop', trade: 'artisan', ownerTrade: 'artisan', capital: 80_000, staffPerLevel: 2, needs: { tech: 1 }, blurb: 'Your hands are the business. NEPA decides your hours.' }),
  T({ id: 'farm', name: 'Farm or fishing canoe', kind: 'starter', place: 'farm', trade: 'farmer', ownerTrade: 'farmer', capital: 150_000, staffPerLevel: 3, staffYield: 1.25, where: (l) => !!l.farm || (l.mix.farmer ?? 0) > 0.05, blurb: 'Feed the nation. Security and fertiliser prices decide the harvest.' }),
  T({ id: 'okada', name: 'Okada', kind: 'starter', place: 'park', trade: 'okada', ownerTrade: 'okada', capital: 1_300_000, financed: 25_000, staffPerLevel: 0, blurb: 'Fastest way through traffic. Banned in some places.' }),
  T({ id: 'keke', name: 'Keke', kind: 'starter', place: 'park', trade: 'keke', ownerTrade: 'keke', capital: 3_800_000, financed: 45_000, staffPerLevel: 0, blurb: 'Three wheels, four passengers, five agbero tickets a day.' }),

  // ── consumer businesses: cater to citizens ──
  T({ id: 'supermarket', name: 'Supermarket', kind: 'consumer', place: 'market', ownerTrade: 'business', capital: 4_000_000, unit: 120_000, inputs: 0.7, fx: 0.5, power: 0.1, food: 0.3, staffPerLevel: 4, feeds: [], needs: { biz: 2 }, blurb: 'Provisions, toiletries, drinks. Imports make it naira-sensitive.' }),
  T({ id: 'restaurant', name: 'Restaurant & bar', kind: 'consumer', place: 'joint', ownerTrade: 'business', capital: 3_000_000, unit: 105_000, inputs: 0.55, food: 0.7, power: 0.2, staffPerLevel: 4, needs: { biz: 1.5 }, blurb: 'Pepper soup, small chops, cold drinks and football on the big screen.' }),
  T({ id: 'pharmacy', name: 'Pharmacy', kind: 'consumer', place: 'clinic', ownerTrade: 'business', capital: 5_000_000, unit: 140_000, inputs: 0.65, fx: 0.8, power: 0.05, staffPerLevel: 3, needs: { edu: 3 }, blurb: 'Drugs are imported; when hospitals fail, people come to you.' }),
  T({ id: 'salon', name: 'Salon & barbershop', kind: 'consumer', place: 'workshop', ownerTrade: 'artisan', capital: 1_500_000, unit: 48_000, inputs: 0.2, power: 0.6, fx: 0.3, staffPerLevel: 4, needs: { tech: 1.5 }, blurb: 'Clippers, dryers and gist. Power is your biggest cost.' }),
  T({ id: 'school', name: 'Private school', kind: 'consumer', place: 'school', ownerTrade: 'business', capital: 8_000_000, unit: 160_000, inputs: 0.25, power: 0.3, staffPerLevel: 5, needs: { edu: 3.5 }, blurb: 'When public schools fail, parents pay you instead.' }),
  T({ id: 'fleet', name: 'Transport company', kind: 'consumer', place: 'park', ownerTrade: 'business', capital: 10_000_000, unit: 150_000, inputs: 0.35, fuel: 0.9, staffPerLevel: 5, needs: { biz: 2 }, blurb: 'A fleet of kekes and buses with hired drivers. Fuel is everything.' }),
  T({ id: 'estate', name: 'Real estate (flats to let)', kind: 'consumer', place: 'bank', ownerTrade: 'business', capital: 25_000_000, unit: 0, inputs: 0.1, staffPerLevel: 2, needs: { biz: 2.5 }, blurb: 'Build flats, collect rent a year up front. Rents follow inflation and services.' }),

  // ── suppliers: support other businesses ──
  T({ id: 'wholesale', name: 'Foodstuff wholesaler', kind: 'supplier', place: 'market', ownerTrade: 'business', capital: 6_000_000, unit: 200_000, inputs: 0.78, food: 0.9, fuel: 0.1, staffPerLevel: 4, clients: ['foodvendor', 'trader'], feeds: ['buka', 'restaurant', 'supermarket', 'stall'], needs: { biz: 2 }, blurb: 'Bags of rice, beans and garri to every buka and shop around.' }),
  T({ id: 'bakery', name: 'Bakery', kind: 'supplier', place: 'factory', ownerTrade: 'business', capital: 5_000_000, unit: 130_000, inputs: 0.55, fx: 0.5, power: 0.3, food: 0.2, staffPerLevel: 5, clients: ['trader', 'foodvendor'], feeds: ['supermarket', 'restaurant', 'stall'], needs: { biz: 1.5 }, blurb: 'Agege bread for every street. Flour is imported.' }),
  T({ id: 'water', name: 'Pure water factory', kind: 'supplier', place: 'factory', ownerTrade: 'business', capital: 4_000_000, unit: 100_000, inputs: 0.35, power: 0.6, fuel: 0.2, staffPerLevel: 5, clients: ['trader', 'foodvendor', 'okada', 'keke', 'danfo'], feeds: ['restaurant', 'supermarket', 'buka', 'stall'], blurb: 'Sachet water: everybody drinks it, every shop sells it.' }),
  T({ id: 'logistics', name: 'Haulage & logistics', kind: 'supplier', place: 'park', ownerTrade: 'business', capital: 15_000_000, unit: 250_000, inputs: 0.45, fuel: 0.85, fx: 0.15, staffPerLevel: 4, clients: ['trader', 'business', 'factory'], feeds: ['wholesale', 'supermarket', 'bakery', 'blocks', 'ricemill'], needs: { biz: 2.5 }, blurb: 'Trucks moving goods between markets, ports and farms. Roads decide your margins.' }),
  T({ id: 'blocks', name: 'Block industry', kind: 'supplier', place: 'workshop', ownerTrade: 'business', capital: 6_000_000, unit: 150_000, inputs: 0.55, fx: 0.4, fuel: 0.2, power: 0.2, staffPerLevel: 5, clients: ['business'], feeds: ['estate'], blurb: 'Cement blocks for every building project, including the government’s.' }),
  T({ id: 'solar', name: 'Solar installation', kind: 'supplier', place: 'techhub', ownerTrade: 'business', capital: 7_000_000, unit: 180_000, inputs: 0.6, fx: 0.85, staffPerLevel: 4, clients: ['business', 'artisan', 'pos', 'office'], feeds: ['salon', 'school', 'water', 'bakery', 'restaurant'], needs: { tech: 2.5 }, blurb: 'Panels and inverters for people tired of NEPA. Worse grid, more orders.' }),
  T({ id: 'clearing', name: 'Clearing & import agency', kind: 'supplier', place: 'office', ownerTrade: 'business', capital: 8_000_000, unit: 220_000, inputs: 0.3, fx: 0.4, staffPerLevel: 4, clients: ['trader', 'business'], feeds: ['supermarket', 'pharmacy', 'solar'], needs: { biz: 2.5 }, where: (l) => ['APP', 'ELE', 'IKJ'].includes(l.id), blurb: 'Getting containers out of the port. Cheap naira means fewer imports.' }),
  T({ id: 'ricemill', name: 'Rice mill', kind: 'supplier', place: 'farm', ownerTrade: 'business', capital: 12_000_000, unit: 260_000, inputs: 0.6, food: 0.8, power: 0.2, staffPerLevel: 6, clients: ['farmer', 'foodvendor'], feeds: ['wholesale', 'buka', 'restaurant'], needs: { biz: 2 }, where: (l) => l.farm === 'Rice farming', blurb: 'Buy paddy from Kura farmers, sell bagged rice to the nation. A rice ban is your best friend.' }),
];

export const bizType = (id: BizTypeId) => BIZ.find((b) => b.id === id)!;

export type WageTier = 'min' | 'fair' | 'generous';
export const WAGES: Record<WageTier, { name: string; mult: number; output: number }> = {
  min: { name: 'Minimum wage', mult: 1, output: 0.85 },
  fair: { name: 'Fair pay', mult: 1.35, output: 1 },
  generous: { name: 'Generous pay', mult: 1.75, output: 1.12 },
};
