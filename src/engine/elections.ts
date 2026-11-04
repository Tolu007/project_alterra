import { PARTIES, type Level, type PartyId } from '../data/politics';
import { LGAS, STATES, lgaById, lgasOf, stateById, REST_OF_NIGERIA_VOTERS, type StateId } from '../data/world';
import { isElectionWeek, isPrimaryWeek } from './calendar';
import { approval } from './economy';
import { TEMPLATES, govById, levelOf } from './government';
import { between, chance, pick, rand } from './rng';
import { randomLooks } from './people';
import { PARTY_BASE } from './setup';
import { PLAYER, type ElectionRecord, type Game } from './types';

export const FORM_PRICE: Record<Level, number> = { lga: 1_500_000, state: 15_000_000, federal: 60_000_000 };
export const NEEDS: Record<Level, { standing: number; influence: number }> = {
  lga: { standing: 15, influence: 15 },
  state: { standing: 40, influence: 20 },
  federal: { standing: 60, influence: 15 },
};

/** The office a player could run for at each level: their own council, their state, the presidency. */
export function officeFor(g: Game, level: Level): string {
  if (level === 'federal') return 'FED';
  if (level === 'state') return lgaById(g.player.home).state;
  return g.player.home;
}

export function jurisdictionLgas(office: string): string[] {
  const level = levelOf(office);
  if (level === 'federal') return LGAS.map((l) => l.id);
  if (level === 'state') return lgasOf(office as StateId).map((l) => l.id);
  return [office];
}

export function avgInfluence(g: Game, office: string): number {
  const ids = jurisdictionLgas(office);
  let s = 0;
  let w = 0;
  for (const id of ids) {
    const v = lgaById(id).voters;
    s += g.player.influence[id] * v;
    w += v;
  }
  return s / w;
}

/** Why the player cannot buy a nomination form for an office right now, or null. */
export function formBlocked(g: Game, level: Level): string | null {
  const p = g.player;
  if (!p.party) return 'Join a party first.';
  if (p.campaign) return 'You are already in a race.';
  const need = NEEDS[level];
  if (p.standing < need.standing) return `The party does not know you yet (standing ${Math.round(p.standing)}/${need.standing}).`;
  if (avgInfluence(g, officeFor(g, level)) < need.influence) return `Not enough people know you there (influence ${Math.round(avgInfluence(g, officeFor(g, level)))}/${need.influence}).`;
  if (p.money < FORM_PRICE[level]) return `The form costs ₦${(FORM_PRICE[level] / 1e6).toFixed(1)}m.`;
  return null;
}

function newPolitician(g: Game, party: PartyId, lga: string): number {
  const l = lgaById(lga);
  const titles = ['Hon.', 'Chief', 'Dr.', 'Barr.', 'Engr.'];
  const first = pick(g, ['Adewale', 'Ibrahim', 'Chinedu', 'Tamuno', 'Halima', 'Folasade', 'Musa', 'Ngozi', 'Boma', 'Kunle', 'Zainab', 'Emeka']);
  const last = pick(g, ['Lawson', 'Danjuma', 'Okoro', 'Briggs', 'Bakare', 'Yusuf', 'Ekwueme', 'Ajibola', 'Abubakar', 'Oputa', 'Iyalla', 'Sanusi']);
  g.people.push({
    id: g.people.length,
    name: `${pick(g, titles)} ${first} ${last}`,
    gender: ['Halima', 'Folasade', 'Ngozi', 'Zainab'].includes(first) ? 'f' : 'm',
    age: Math.round(between(g, 40, 68)),
    lga: l.id,
    trade: 'business',
    role: 'politician',
    relation: 0,
    money: 0,
    losses: 0,
    party,
    style: pick(g, ['reformer', 'populist', 'looter', 'indifferent', 'tyrant'] as const),
    ambition: 0.7 + 0.3 * rand(g),
    looks: randomLooks(g),
    bio: '',
    office: null,
    employer: null,
  });
  return g.people.length - 1;
}

function pickCandidate(g: Game, office: string, party: PartyId): number {
  const gov = govById(g, office);
  const p = g.player;
  if (p.campaign?.office === office && p.campaign.stage === 'nominee' && p.party === party) return PLAYER;
  // Sitting officeholders (you included) get their party's ticket until the two-term limit.
  if (gov.party === party && gov.terms < 2) return gov.leader;
  const area = jurisdictionLgas(office);
  const bench = g.people.filter((x) => x.role === 'politician' && x.party === party && !x.office && x.id !== PLAYER && area.includes(x.lga));
  if (bench.length) return pick(g, bench).id;
  return newPolitician(g, party, pick(g, area));
}

/** Utility of a candidate in one LGA; turned into vote shares with a softmax. */
function utility(g: Game, office: string, lga: string, person: number, party: PartyId, incumbentParty: PartyId, rig: boolean): number {
  const l = lgaById(lga);
  const level = levelOf(office);
  let u = 2.4 * PARTY_BASE[l.state][party];
  const app = approval(g, level, level === 'federal' ? undefined : level === 'state' ? l.state : lga);
  u += (party === incumbentParty ? 2.6 : -0.6) * ((app - 52) / 45);
  if (person === PLAYER) {
    const c = g.player.campaign;
    u += g.player.influence[lga] / 22 + g.player.standing / 120 + (c?.push[lga] ?? 0) / 10 - g.player.scandal / 60;
  } else {
    u += 0.8 * (g.people[person].ambition - 0.5);
  }
  if (party === incumbentParty) u += 0.3; // state resources behind the ruling party
  // State electoral commissions rarely let the governor's party lose a council.
  if (level === 'lga' && party === g.states[l.state].party) u += 0.9;
  if (rig && party === incumbentParty) u += 0.55;
  return u;
}

export function holdElection(g: Game, office: string): ElectionRecord {
  const gov = govById(g, office);
  const level = levelOf(office);
  const parties = PARTIES.map((p) => p.id);
  const cands = parties.map((party) => ({ person: pickCandidate(g, office, party), party, votes: 0 }));
  // Some candidates simply campaign better than others this time round.
  const quality = cands.map((c) => (c.person === PLAYER ? 0 : between(g, -0.35, 0.35)));
  const incumbentLeader = gov.leader;
  const rig = incumbentLeader === PLAYER ? (g.flags[`rig:${office}`] ?? 0) > 0 : gov.style === 'looter' || gov.style === 'tyrant';
  const byLga: Record<string, number[]> = {};
  let cast = 0;
  let registered = 0;

  for (const id of jurisdictionLgas(office)) {
    const l = lgaById(id);
    const app = approval(g, level, level === 'federal' ? undefined : level === 'state' ? l.state : id);
    const turnout = 0.26 + (0.12 * Math.abs(app - 50)) / 50 + between(g, -0.03, 0.03);
    const us = cands.map((c, i) => utility(g, office, id, c.person, c.party, gov.party, rig) + quality[i] + between(g, -0.15, 0.15));
    const ex = us.map((u) => Math.exp(u));
    const sum = ex.reduce((a, b) => a + b, 0);
    const votes = ex.map((e) => Math.round(((e / sum) * l.voters * turnout) * 1e6));
    votes.forEach((v, i) => (cands[i].votes += v));
    byLga[id] = votes;
    cast += votes.reduce((a, b) => a + b, 0);
    registered += l.voters * 1e6;
  }

  let rest: number[] | undefined;
  if (level === 'federal') {
    const turnout = 0.27;
    const us = cands.map((c, i) => {
      let u = 2.4 * PARTY_BASE.REST[c.party] + (c.party === gov.party ? 2.6 : -0.6) * ((g.restMood - 52) / 45) + (c.party === gov.party ? 0.3 : 0);
      if (c.person === PLAYER) u += g.player.standing / 150 + avgInfluence(g, 'FED') / 30 + (g.player.campaign?.push.REST ?? 0) / 10 - g.player.scandal / 60;
      else u += 0.8 * (g.people[c.person].ambition - 0.5);
      if (rig && c.party === gov.party) u += 0.4;
      return u + quality[i] + between(g, -0.1, 0.1);
    });
    const ex = us.map((u) => Math.exp(u));
    const sum = ex.reduce((a, b) => a + b, 0);
    rest = ex.map((e) => Math.round((e / sum) * REST_OF_NIGERIA_VOTERS * turnout * 1e6));
    rest.forEach((v, i) => (cands[i].votes += v));
    cast += rest.reduce((a, b) => a + b, 0);
    registered += REST_OF_NIGERIA_VOTERS * 1e6;
  }

  const winner = cands.slice().sort((a, b) => b.votes - a.votes)[0];
  const record: ElectionRecord = {
    week: g.week,
    office,
    candidates: cands,
    byLga,
    winner: winner.person,
    turnout: cast / registered,
    rest,
    playerRan: cands.some((c) => c.person === PLAYER),
  };
  g.elections.push(record);
  installWinner(g, office, winner.person, winner.party);
  return record;
}

function installWinner(g: Game, office: string, person: number, party: PartyId) {
  const gov = govById(g, office);
  const level = levelOf(office);
  const same = gov.leader === person;
  const old = gov.leader;
  if (!same) {
    if (old !== PLAYER) g.people[old].office = null;
    if (old === PLAYER) {
      g.player.office = null;
      g.flags.leftOffice = g.week;
    }
    gov.leader = person;
    gov.party = party;
    gov.terms = 1;
    gov.loot = 0;
    gov.arrears = gov.arrears * 0.8;
    if (person === PLAYER) {
      g.player.office = office;
      gov.style = 'reformer';
      gov.budget = { ...TEMPLATES[level].reformer };
      gov.payRate = 1;
    } else {
      const p = g.people[person];
      p.office = office;
      gov.style = p.style ?? 'indifferent';
      gov.budget = { ...TEMPLATES[level][gov.style] };
    }
  } else {
    gov.terms++;
  }
  gov.termStart = g.week;
  if (g.player.campaign?.office === office) g.player.campaign = null;
}

/** Runs any primaries or elections falling in this week. Returns news lines. */
export function weeklyElections(g: Game): string[] {
  const news: string[] = [];
  const p = g.player;
  for (const level of ['lga', 'state', 'federal'] as Level[]) {
    if (isPrimaryWeek(g.week, level) && p.campaign?.stage === 'aspirant' && levelOf(p.campaign.office) === level) {
      const office = p.campaign.office;
      const need = NEEDS[level];
      const score = (p.standing - need.standing) / 12 + (avgInfluence(g, office) - need.influence) / 12 + p.campaign.spent / FORM_PRICE[level] / 2 + p.skills.people / 4;
      const odds = 1 / (1 + Math.exp(-(score - 0.4)));
      if (chance(g, odds)) {
        p.campaign.stage = 'nominee';
        news.push(`You win the ${PARTIES.find((x) => x.id === p.party)!.name} primary for ${govById(g, office).name}. The campaign starts now`);
      } else {
        news.push(`You lose the party primary for ${govById(g, office).name}. The delegates were "mobilised" by someone else`);
        p.campaign = null;
        p.standing = Math.max(0, p.standing - 5);
      }
    }
    if (isElectionWeek(g.week, level)) {
      const offices = level === 'federal' ? ['FED'] : level === 'state' ? STATES.map((s) => s.id) : LGAS.map((l) => l.id);
      for (const office of offices) {
        const before = govById(g, office).leader;
        const rec = holdElection(g, office);
        const name = rec.winner === PLAYER ? 'You' : g.people[rec.winner].name;
        const where = govById(g, office).name;
        if (rec.playerRan) g.showElection = g.elections.length - 1;
        if (level !== 'lga' || office === p.home || rec.playerRan) {
          news.push(
            rec.winner === before
              ? `${name} re-elected in ${where}`
              : `${name} (${rec.candidates.find((c) => c.person === rec.winner)!.party}) wins ${level === 'federal' ? 'the presidency' : level === 'state' ? `${where} governorship` : `${where} chairmanship`}`,
          );
        }
        const homeState = lgaById(p.home).state;
        if (g.showElection === null && (level === 'federal' || (level === 'state' && office === homeState))) g.showElection = g.elections.length - 1;
      }
    }
  }
  return news;
}

export const officeTitle = (office: string) => {
  const level = levelOf(office);
  if (level === 'federal') return 'President';
  if (level === 'state') return `Governor of ${stateById(office as StateId).name}`;
  return `Chairman, ${lgaById(office).name} LGA`;
};
