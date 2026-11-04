import type { StateId } from './world';

// Invented names. Surnames of famous national politicians are left out on purpose.
type Pool = { m: string[]; f: string[]; last: string[] };

const YORUBA: Pool = {
  m: ['Tunde', 'Segun', 'Bolaji', 'Kehinde', 'Femi', 'Dapo', 'Wale', 'Ayo', 'Gbenga', 'Lanre'],
  f: ['Funmi', 'Yetunde', 'Bisola', 'Folake', 'Kemi', 'Bukola', 'Ronke', 'Tope', 'Shade', 'Iyabo'],
  last: ['Adeyemi', 'Balogun', 'Ogunleye', 'Akinwale', 'Oyelaran', 'Ajayi', 'Oladipo', 'Adeoti', 'Salami', 'Bankole'],
};
const HAUSA: Pool = {
  m: ['Musa', 'Sani', 'Aminu', 'Bashir', 'Kabiru', 'Nasiru', 'Haruna', 'Usman', 'Yakubu', 'Idris'],
  f: ['Hadiza', 'Zainab', 'Halima', 'Rabi', 'Fatima', 'Aisha', 'Hauwa', 'Maryam', 'Binta', 'Saude'],
  last: ['Danladi', 'Garba', 'Tanko', 'Lawal', 'Gwarzo', 'Maikudi', 'Dankano', 'Bello', 'Sule', 'Dahiru'],
};
const IGBO: Pool = {
  m: ['Chukwuemeka', 'Obinna', 'Ifeanyi', 'Uchenna', 'Kelechi', 'Chidi', 'Emeka', 'Nnamdi', 'Ikenna', 'Tobenna'],
  f: ['Ngozi', 'Chiamaka', 'Adaeze', 'Nkechi', 'Amaka', 'Ifeoma', 'Chioma', 'Uju', 'Obioma', 'Ebere'],
  last: ['Okafor', 'Nwosu', 'Okeke', 'Uzor', 'Anyanwu', 'Nwachukwu', 'Ezenwa', 'Obiora', 'Eze', 'Ibe'],
};
const RIVERS: Pool = {
  m: ['Tamuno', 'Boma', 'Ovie', 'Preye', 'Soala', 'Ibim', 'Dagogo', 'Tonye', 'Ebi', 'Sokari'],
  f: ['Ebiere', 'Ibiso', 'Tamara', 'Boma', 'Ibinabo', 'Data', 'Ineba', 'Sotonye', 'Ere', 'Belema'],
  last: ['Dappa', 'Amadi', 'Briggs', 'George', 'Jack', 'Harry', 'Wokoma', 'Opara', 'Iwowari', 'Tobin'],
};

/** Lagos and Port Harcourt are mixed cities; Kano has a large Sabon Gari community. */
const MIX: Record<StateId, [Pool, number][]> = {
  LA: [[YORUBA, 0.62], [IGBO, 0.22], [HAUSA, 0.08], [RIVERS, 0.08]],
  KN: [[HAUSA, 0.86], [IGBO, 0.09], [YORUBA, 0.05]],
  RI: [[RIVERS, 0.68], [IGBO, 0.22], [YORUBA, 0.06], [HAUSA, 0.04]],
};

export function namePool(state: StateId, r: number): Pool {
  let acc = 0;
  for (const [pool, w] of MIX[state]) {
    acc += w;
    if (r < acc) return pool;
  }
  return MIX[state][0][0];
}

export const TITLES = ['Hon.', 'Chief', 'Dr.', 'Alh.', 'Barr.', 'Engr.', 'Sen.'];

/** Roles that give the town its faces. */
export type Role =
  | 'family'
  | 'neighbour'
  | 'friend'
  | 'market-leader'
  | 'union-chairman'
  | 'area-boss'
  | 'godfather'
  | 'journalist'
  | 'politician';

export const ROLE_NAMES: Partial<Record<Role, string>> = {
  family: 'Family',
  neighbour: 'Neighbour',
  friend: 'Friend',
  'market-leader': 'Market women leader',
  'union-chairman': 'Transport union chairman',
  'area-boss': 'Area boys’ boss',
  godfather: 'Political godfather',
  journalist: 'Journalist',
  politician: 'Politician',
};
