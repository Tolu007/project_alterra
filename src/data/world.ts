// The playable world: three real states, sixteen real LGAs. Numbers are game figures chosen to
// feel like 2026 Nigeria (rent, fares, voter counts), not official statistics.

export type StateId = 'LA' | 'KN' | 'RI';

export type TradeId =
  | 'trader'
  | 'pos'
  | 'foodvendor'
  | 'okada'
  | 'keke'
  | 'danfo'
  | 'artisan'
  | 'farmer'
  | 'teacher'
  | 'lgstaff'
  | 'office'
  | 'tech'
  | 'oil'
  | 'factory'
  | 'business'
  | 'unemployed';

export type SceneStyle =
  | 'lagos-dense'
  | 'lagos-rich'
  | 'lagos-island'
  | 'lagos-port'
  | 'kano-old'
  | 'kano-market'
  | 'kano-gra'
  | 'kano-farm'
  | 'ph-city'
  | 'ph-industrial'
  | 'rivers-water';

export interface StateDef {
  id: StateId;
  name: string;
  capital: string;
  capitalLga: string;
  /** Registered voters, millions (rough, 2023 register). */
  voters: number;
  /** One danfo/keke trip at the start of the game, ₦. */
  fare: number;
  fuelAdj: number;
  foodAdj: number;
  /** Monthly internally generated revenue at the start, ₦bn. */
  igr: number;
  /** Monthly state wage bill at the start, ₦bn. */
  wageBill: number;
  /** Share of the states' FAAC pool, plus Rivers' 13% oil derivation. */
  faacShare: number;
  derivation: number;
  /** Cost of raising one point of each state service, ₦bn. Bigger, pricier states cost more. */
  costScale: number;
  colour: string;
  blurb: string;
  keke: string;
}

export const STATES: StateDef[] = [
  {
    id: 'LA',
    name: 'Lagos',
    capital: 'Ikeja',
    capitalLga: 'IKJ',
    voters: 7.06,
    fare: 700,
    fuelAdj: 1,
    foodAdj: 1.12,
    igr: 60,
    wageBill: 28,
    faacShare: 0.034,
    derivation: 0,
    costScale: 1.6,
    colour: '#f2b705',
    blurb: 'Eko o ni baje. Ports, markets, banks, tech, and traffic that eats half your day.',
    keke: 'Keke',
  },
  {
    id: 'KN',
    name: 'Kano',
    capital: 'Kano',
    capitalLga: 'KMC',
    voters: 5.92,
    fare: 350,
    fuelAdj: 1.05,
    foodAdj: 0.9,
    igr: 7,
    wageBill: 11,
    faacShare: 0.042,
    derivation: 0,
    costScale: 1,
    colour: '#1e8f5a',
    blurb: 'Centre of commerce. Ancient markets, rice and tomato farms, and the Adaidaita Sahu everywhere.',
    keke: 'Adaidaita Sahu',
  },
  {
    id: 'RI',
    name: 'Rivers',
    capital: 'Port Harcourt',
    capitalLga: 'PHC',
    voters: 3.54,
    fare: 500,
    fuelAdj: 0.97,
    foodAdj: 1.06,
    igr: 14,
    wageBill: 13,
    faacShare: 0.036,
    derivation: 0.13,
    costScale: 1.15,
    colour: '#2f6db5',
    blurb: 'The Garden City. Oil, gas, creeks and fish. When the pipelines are quiet, money flows.',
    keke: 'Keke',
  },
];

export interface LgaDef {
  id: string;
  name: string;
  /** What people actually call the place. */
  nick: string;
  state: StateId;
  lat: number;
  lon: number;
  /** Registered voters, millions. The playable LGAs stand in for the whole state, so they sum to its total. */
  voters: number;
  /** 0 poor .. 1 rich. Shapes the scene and spending. */
  wealth: number;
  /** One-bedroom flat, ₦ per year, at the start. */
  rent: number;
  /** Central LGAs are where a "partial" okada ban applies. */
  central: boolean;
  mix: Partial<Record<TradeId, number>>;
  style: SceneStyle;
  landmark: string;
  blurb: string;
  /** What farming means here. */
  farm?: string;
  palace?: string;
  /** The airport in or beside this LGA, if it has one. */
  airport?: string;
  /** The ferry jetty, if boats call here. */
  jetty?: string;
}

export const LGAS: LgaDef[] = [
  // ── Lagos ──
  {
    id: 'IKJ', name: 'Ikeja', nick: 'Ikeja', state: 'LA', lat: 6.6018, lon: 3.3515, voters: 0.9, wealth: 0.62, rent: 2_000_000, central: true,
    mix: { trader: 0.18, pos: 0.06, foodvendor: 0.07, okada: 0.04, keke: 0.03, danfo: 0.04, artisan: 0.1, teacher: 0.04, lgstaff: 0.02, office: 0.16, tech: 0.06, factory: 0.08, business: 0.05, unemployed: 0.07 },
    style: 'lagos-dense', landmark: 'Computer Village · Alausa secretariat', blurb: 'The state capital. Phone dealers, civil servants and the airport road.',
    airport: 'Murtala Muhammed Airport, domestic terminals',
  },
  {
    id: 'LIS', name: 'Lagos Island', nick: 'Idumota', state: 'LA', lat: 6.4549, lon: 3.3947, voters: 0.7, wealth: 0.45, rent: 1_300_000, central: true,
    mix: { trader: 0.32, pos: 0.07, foodvendor: 0.08, okada: 0.04, keke: 0.03, danfo: 0.05, artisan: 0.1, teacher: 0.03, lgstaff: 0.03, office: 0.08, business: 0.07, unemployed: 0.1 },
    style: 'lagos-island', landmark: 'Balogun & Idumota markets · Iga Idunganran', blurb: 'Old Lagos. The biggest markets in West Africa and the Oba’s palace.',
    jetty: 'Marina/CMS Ferry Terminal',
    palace: 'Iga Idunganran',
  },
  {
    id: 'LMA', name: 'Lagos Mainland', nick: 'Yaba', state: 'LA', lat: 6.5095, lon: 3.3711, voters: 0.8, wealth: 0.5, rent: 1_800_000, central: true,
    mix: { trader: 0.15, pos: 0.06, foodvendor: 0.08, okada: 0.05, keke: 0.04, danfo: 0.05, artisan: 0.1, teacher: 0.05, lgstaff: 0.02, office: 0.1, tech: 0.14, factory: 0.03, business: 0.04, unemployed: 0.09 },
    style: 'lagos-dense', landmark: 'Yaba tech hubs · Tejuosho market · UNILAG', blurb: 'Students, startups and the “Silicon Valley” of Lagos, if the light stays on.',
  },
  {
    id: 'ETI', name: 'Eti-Osa', nick: 'Lekki & VI', state: 'LA', lat: 6.4474, lon: 3.481, voters: 0.9, wealth: 0.86, rent: 4_500_000, central: true,
    mix: { trader: 0.08, pos: 0.04, foodvendor: 0.06, okada: 0.04, keke: 0.04, danfo: 0.03, artisan: 0.1, teacher: 0.03, lgstaff: 0.02, office: 0.22, tech: 0.12, oil: 0.04, business: 0.1, unemployed: 0.08 },
    style: 'lagos-rich', landmark: 'Lekki toll gate · Victoria Island banks', blurb: 'Glass towers, estates, and flooding every rainy season anyway.',
    jetty: 'Five Cowries Terminal, Falomo',
  },
  {
    id: 'OSH', name: 'Oshodi-Isolo', nick: 'Oshodi', state: 'LA', lat: 6.5355, lon: 3.3087, voters: 1.3, wealth: 0.34, rent: 900_000, central: false,
    mix: { trader: 0.22, pos: 0.07, foodvendor: 0.08, okada: 0.08, keke: 0.05, danfo: 0.1, artisan: 0.12, teacher: 0.03, lgstaff: 0.02, office: 0.05, factory: 0.06, business: 0.02, unemployed: 0.1 },
    style: 'lagos-dense', landmark: 'Oshodi interchange · Isolo markets', blurb: 'Where every danfo in Lagos seems to meet. Loud, busy, never sleeps.',
  },
  {
    id: 'APP', name: 'Apapa', nick: 'Apapa', state: 'LA', lat: 6.4489, lon: 3.359, voters: 0.5, wealth: 0.44, rent: 1_000_000, central: true,
    mix: { trader: 0.12, pos: 0.05, foodvendor: 0.08, okada: 0.05, keke: 0.04, danfo: 0.06, artisan: 0.1, teacher: 0.03, lgstaff: 0.02, office: 0.1, factory: 0.12, business: 0.08, unemployed: 0.15 },
    style: 'lagos-port', landmark: 'Apapa & Tin Can ports', blurb: 'Nigeria’s front door for imports. Containers, clearing agents and tanker gridlock.',
    jetty: 'Apapa Liverpool Jetty',
  },
  {
    id: 'IKD', name: 'Ikorodu', nick: 'Ikorodu', state: 'LA', lat: 6.6194, lon: 3.5105, voters: 1.96, wealth: 0.3, rent: 500_000, central: false,
    mix: { trader: 0.18, pos: 0.06, foodvendor: 0.07, okada: 0.1, keke: 0.08, danfo: 0.07, artisan: 0.12, farmer: 0.03, teacher: 0.05, lgstaff: 0.03, office: 0.04, factory: 0.07, business: 0.02, unemployed: 0.08 },
    style: 'lagos-dense', landmark: 'Ikorodu garage · BRT terminal', blurb: 'Where Lagos goes to afford rent. A long ride to everywhere else.',
    jetty: 'Ikorodu Ferry Terminal',
    farm: 'Fish farming',
  },
  // ── Kano ──
  {
    id: 'KMC', name: 'Kano Municipal', nick: 'Kano City', state: 'KN', lat: 11.9964, lon: 8.5167, voters: 1.4, wealth: 0.36, rent: 300_000, central: true,
    mix: { trader: 0.3, pos: 0.05, foodvendor: 0.08, keke: 0.12, okada: 0.01, artisan: 0.14, farmer: 0.04, teacher: 0.04, lgstaff: 0.03, office: 0.03, factory: 0.03, business: 0.05, unemployed: 0.08 },
    style: 'kano-old', landmark: 'Kurmi market · Gidan Rumfa · Kofar Mata dye pits', blurb: 'Inside the ancient walls: a thousand years of trade, dyers and the Emir’s palace.',
    palace: 'Gidan Rumfa',
  },
  {
    id: 'FAG', name: 'Fagge', nick: 'Sabon Gari', state: 'KN', lat: 12.0063, lon: 8.5326, voters: 0.8, wealth: 0.4, rent: 350_000, central: true,
    mix: { trader: 0.35, pos: 0.06, foodvendor: 0.08, keke: 0.1, artisan: 0.12, teacher: 0.03, lgstaff: 0.02, office: 0.04, factory: 0.04, business: 0.08, unemployed: 0.08 },
    style: 'kano-market', landmark: 'Sabon Gari market · Singer market', blurb: 'Traders from every corner of Nigeria. If it is sold anywhere, it is sold here.',
    airport: 'Mallam Aminu Kano International Airport',
  },
  {
    id: 'NAS', name: 'Nassarawa', nick: 'GRA & Bompai', state: 'KN', lat: 11.98, lon: 8.55, voters: 1.1, wealth: 0.6, rent: 800_000, central: true,
    mix: { trader: 0.1, pos: 0.05, foodvendor: 0.06, keke: 0.08, artisan: 0.1, teacher: 0.06, lgstaff: 0.03, office: 0.14, tech: 0.02, factory: 0.16, business: 0.08, unemployed: 0.06 },
    style: 'kano-gra', landmark: 'Bompai industrial estate · Nassarawa GRA', blurb: 'Factories, government quarters and the quieter streets of Kano.',
  },
  {
    id: 'DAL', name: 'Dala', nick: 'Dala', state: 'KN', lat: 12.017, lon: 8.498, voters: 1.2, wealth: 0.25, rent: 200_000, central: true,
    mix: { trader: 0.22, pos: 0.04, foodvendor: 0.08, keke: 0.12, artisan: 0.18, farmer: 0.06, teacher: 0.04, lgstaff: 0.03, factory: 0.04, business: 0.03, unemployed: 0.16 },
    style: 'kano-old', landmark: 'Dala Hill · old city quarters', blurb: 'Where Kano began, on the hill. Crafts, crowded lanes, too few jobs.',
  },
  {
    id: 'KUR', name: 'Kura', nick: 'Kura', state: 'KN', lat: 11.771, lon: 8.43, voters: 1.42, wealth: 0.2, rent: 120_000, central: false,
    mix: { farmer: 0.5, trader: 0.1, pos: 0.03, foodvendor: 0.05, keke: 0.06, okada: 0.03, artisan: 0.07, teacher: 0.05, lgstaff: 0.03, business: 0.02, unemployed: 0.06 },
    style: 'kano-farm', landmark: 'Kura rice fields · irrigation channels', blurb: 'Rice country. Good harvests feed half the North; bad roads keep the profit small.',
    farm: 'Rice farming',
  },
  // ── Rivers ──
  {
    id: 'PHC', name: 'Port Harcourt', nick: 'Mile 1 & GRA', state: 'RI', lat: 4.7774, lon: 7.0134, voters: 1.0, wealth: 0.55, rent: 900_000, central: true,
    mix: { trader: 0.2, pos: 0.06, foodvendor: 0.08, keke: 0.06, okada: 0.02, danfo: 0.03, artisan: 0.1, teacher: 0.05, lgstaff: 0.03, office: 0.12, oil: 0.08, factory: 0.03, business: 0.06, unemployed: 0.08 },
    style: 'ph-city', landmark: 'Mile 1 market · Old GRA · Government House', blurb: 'Oil money, nightlife and pepper soup. The soot in the air is from “kpofire” refineries.',
  },
  {
    id: 'OBI', name: 'Obio/Akpor', nick: 'Rumuokoro', state: 'RI', lat: 4.85, lon: 6.99, voters: 1.2, wealth: 0.5, rent: 700_000, central: true,
    mix: { trader: 0.16, pos: 0.07, foodvendor: 0.08, keke: 0.08, okada: 0.03, artisan: 0.1, teacher: 0.06, lgstaff: 0.03, office: 0.1, tech: 0.04, oil: 0.08, factory: 0.04, business: 0.04, unemployed: 0.09 },
    style: 'ph-city', landmark: 'Rumuokoro junction · UniPort', blurb: 'The busy northern half of Port Harcourt: students, oil workers and traffic.',
    airport: 'Port Harcourt International Airport, Omagwa',
  },
  {
    id: 'ELE', name: 'Eleme', nick: 'Eleme', state: 'RI', lat: 4.79, lon: 7.12, voters: 0.45, wealth: 0.4, rent: 500_000, central: false,
    mix: { trader: 0.12, pos: 0.05, foodvendor: 0.08, keke: 0.07, okada: 0.07, artisan: 0.1, farmer: 0.08, teacher: 0.04, lgstaff: 0.03, oil: 0.14, factory: 0.1, business: 0.03, unemployed: 0.09 },
    style: 'ph-industrial', landmark: 'Refinery · petrochemicals · Onne port', blurb: 'Flare stacks and fertiliser plants beside farming villages.',
    farm: 'Cassava farming',
  },
  {
    id: 'BON', name: 'Bonny', nick: 'Bonny Island', state: 'RI', lat: 4.45, lon: 7.17, voters: 0.35, wealth: 0.5, rent: 800_000, central: false,
    mix: { trader: 0.1, pos: 0.05, foodvendor: 0.08, okada: 0.08, artisan: 0.08, farmer: 0.15, teacher: 0.04, lgstaff: 0.03, oil: 0.2, business: 0.05, unemployed: 0.14 },
    style: 'rivers-water', landmark: 'LNG plant · Amanyanabo’s palace', blurb: 'An island reached by boat. Gas money on one side, fishing villages on the other.',
    farm: 'Fishing', palace: 'Amanyanabo’s palace',
  },
  {
    id: 'OKR', name: 'Okrika', nick: 'Okrika', state: 'RI', lat: 4.74, lon: 7.08, voters: 0.54, wealth: 0.25, rent: 300_000, central: false,
    mix: { farmer: 0.3, trader: 0.15, pos: 0.04, foodvendor: 0.08, keke: 0.05, okada: 0.06, artisan: 0.1, teacher: 0.05, lgstaff: 0.04, oil: 0.03, business: 0.02, unemployed: 0.08 },
    style: 'rivers-water', landmark: 'Okrika waterfront · creeks', blurb: 'Stilt houses and fishing canoes. Oil spills upstream decide whether the nets come back full.',
    farm: 'Fishing',
  },
];

export const stateById = (id: StateId) => STATES.find((s) => s.id === id)!;
export const lgaById = (id: string) => LGAS.find((l) => l.id === id)!;
export const lgasOf = (s: StateId) => LGAS.filter((l) => l.state === s);

/** Voters outside the three playable states, for presidential elections. */
export const REST_OF_NIGERIA_VOTERS = 93.47 - STATES.reduce((a, s) => a + s.voters, 0);
