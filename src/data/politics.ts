// Parties are the same invented ones as Who Go Win, so the two games share a universe.
export type PartyId = 'JRP' | 'SPM' | 'GUC' | 'PFP';

export const PARTIES: { id: PartyId; name: string; color: string; ink: string }[] = [
  { id: 'JRP', name: 'Jollof Rice Party', color: '#d23c22', ink: '#fff7ea' },
  { id: 'SPM', name: "Suya People's Movement", color: '#2f63ad', ink: '#fbf3e4' },
  { id: 'GUC', name: 'Garri Unity Congress', color: '#d9a521', ink: '#1b1a17' },
  { id: 'PFP', name: 'Puff-Puff Freedom Party', color: '#1f8a5b', ink: '#f3ecdc' },
];
export const partyById = (id: PartyId) => PARTIES.find((p) => p.id === id)!;

export type Level = 'federal' | 'state' | 'lga';

/** How an AI leader governs. A player in office makes all of these choices themselves. */
export type LeaderStyle = 'reformer' | 'populist' | 'looter' | 'indifferent' | 'tyrant';

export const STYLES: Record<LeaderStyle, { name: string; text: string }> = {
  reformer: { name: 'Reformer', text: 'Hard medicine now, roads and light later. Pays salaries. Steals little.' },
  populist: { name: 'Populist', text: 'Subsidies, handouts and borrowing. Feels good until the bill arrives.' },
  looter: { name: 'Looter', text: 'Most of the money goes somewhere private. Salaries are “being processed”.' },
  indifferent: { name: 'Indifferent', text: 'Keeps things as they are. Things as they are slowly fall apart.' },
  tyrant: { name: 'Strongman', text: 'Bans, demolitions, levies and loud security. Critics get “invited”.' },
};

/** Budget lines each level can spend on, in display order. */
export const BUDGET_LINES: Record<Level, { id: string; name: string; text: string }[]> = {
  federal: [
    { id: 'power', name: 'National grid', text: 'More hours of light everywhere.' },
    { id: 'roads', name: 'Federal highways', text: 'Cheaper transport and food.' },
    { id: 'security', name: 'Army & police', text: 'Safer farms, fewer pipeline attacks.' },
    { id: 'schools', name: 'Universities & UBE', text: 'Slowly raises skills.' },
    { id: 'health', name: 'Federal hospitals', text: 'Fewer people ruined by illness.' },
    { id: 'palliatives', name: 'Cash transfers', text: 'Immediate relief for the poor. Gone next month.' },
    { id: 'misc', name: '“Miscellaneous”', text: 'Nobody will ask. Some of it may end up in your account.' },
  ],
  state: [
    { id: 'roads', name: 'State roads', text: 'Cheaper fares and faster markets.' },
    { id: 'power', name: 'State power (IPPs)', text: 'Adds hours of light on top of the grid.' },
    { id: 'security', name: 'State security', text: 'Community police and vigilantes.' },
    { id: 'schools', name: 'Schools', text: 'Better schools and teachers.' },
    { id: 'health', name: 'Hospitals', text: 'State hospitals and drugs.' },
    { id: 'palliatives', name: 'Palliatives', text: 'Food and cash handouts.' },
    { id: 'misc', name: '“Security vote”', text: 'Unaudited. Very flexible.' },
  ],
  lga: [
    { id: 'roads', name: 'Local roads & drains', text: 'Fewer potholes, less flooding.' },
    { id: 'sanitation', name: 'Waste & sanitation', text: 'Cleaner streets, healthier people.' },
    { id: 'markets', name: 'Markets', text: 'Better stalls, more trade.' },
    { id: 'health', name: 'Primary health centres', text: 'Cheaper care close to home.' },
    { id: 'palliatives', name: 'Palliatives', text: 'Bags of rice with your face on them.' },
    { id: 'misc', name: '“Logistics”', text: 'For the boys. And for you.' },
  ],
};

export type FedPolicy = {
  subsidy: boolean;
  /** Pump price when the subsidy is on, ₦/litre. */
  subsidyPrice: number;
  fx: 'float' | 'peg';
  mpr: number;
  minWage: number;
  riceBan: boolean;
  tariff: 'subsidised' | 'cost';
  /** Monthly borrowing, ₦bn. */
  borrow: number;
  /** Central bank "ways and means" printing, ₦bn a month. Pure inflation. */
  print: number;
};

export type StatePolicy = {
  /** Extra levies and taxes on top of the base (0 .. 0.1). */
  tax: number;
  okada: 'none' | 'partial' | 'full';
  payMinWage: boolean;
  rentControl: boolean;
  freeSchool: boolean;
  /** Keep the LGAs' federal allocation in the state account. Illegal, common. */
  withholdLga: boolean;
  borrow: number;
};

export type LgaPolicy = {
  /** Daily market levy as a share of takings (0 .. 0.1). */
  levy: number;
  /** Who collects motor park dues. */
  park: 'touts' | 'official' | 'none';
  sanitationDay: boolean;
};

export const FED_START: FedPolicy = {
  subsidy: false,
  subsidyPrice: 650,
  fx: 'float',
  mpr: 27,
  minWage: 70_000,
  riceBan: false,
  tariff: 'cost',
  borrow: 500,
  print: 0,
};
