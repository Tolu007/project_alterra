import { PARTIES, type Level, type PartyId } from '../data/politics';
import { LGAS, STATES, lgaById, lgasOf, stateById, REST_OF_NIGERIA_VOTERS, type StateId } from '../data/world';
import { isElectionWeek, isPrimaryWeek } from './calendar';
import { approval } from './economy';
import { TEMPLATES, govById, levelOf } from './government';
import { between, chance, pick, rand } from './rng';
import { randomLooks } from './people';
import { PARTY_BASE } from './setup';
import { humanOf, isHuman, seatOf } from './seats';
import type { ElectionRecord, Game, Player } from './types';

export const FORM_PRICE: Record<Level, number> = { lga: 1_500_000, state: 15_000_000, federal: 60_000_000 };
export const NEEDS: Record<Level, { standing: number; influence: number }> = {
  lga: { standing: 15, influence: 15 },
  state: { standing: 40, influence: 20 },
  federal: { standing: 60, influence: 15 },
};

/** The office a player could run for at each level: their own council, their state, the presidency. */
export function officeFor(g: Game, level: Level, p: Player = g.player): string {
  if (level === 'federal') return 'FED';
  if (level === 'state') return lgaById(p.home).state;
  return p.home;
}

export function jurisdictionLgas(office: string): string[] {
  const level = levelOf(office);
  if (level === 'federal') return LGAS.map((l) => l.id);
  if (level === 'state') return lgasOf(office as StateId).map((l) => l.id);
  return [office];
}

export function avgInfluence(g: Game, office: string, p: Player = g.player): number {
  const ids = jurisdictionLgas(office);
  let s = 0;
  let w = 0;
  for (const id of ids) {
    const v = lgaById(id).voters;
    s += p.influence[id] * v;
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

/** Players who won their party's primary for this office, strongest first. */
function humanNominees(g: Game, office: string, party: PartyId): number[] {
  return g.humans
    .map((id) => ({ id, p: humanOf(g, id) }))
    .filter(({ p }) => p && p.campaign?.office === office && p.campaign.stage === 'nominee' && p.party === party)
    .sort((a, b) => b.p!.standing - a.p!.standing)
    .map(({ id }) => id);
}

function pickCandidate(g: Game, office: string, party: PartyId): number {
  const gov = govById(g, office);
  // A player who won the primary carries the ticket. If two did, the party backs the one it knows better.
  const nominees = humanNominees(g, office, party);
  if (nominees.length) return nominees[0];
  // Sitting officeholders (players included) get their party's ticket until the two-term limit.
  if (gov.party === party && gov.terms < 2) return gov.leader;
  const area = jurisdictionLgas(office);
  const bench = g.people.filter((x) => x.role === 'politician' && x.party === party && !x.office && !isHuman(g, x.id) && area.includes(x.lga));
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
  const human = humanOf(g, person);
  if (human) {
    const c = human.campaign;
    u += human.influence[lga] / 22 + human.standing / 120 + (c?.push[lga] ?? 0) / 10 - human.scandal / 60;
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
  const quality = cands.map((c) => (isHuman(g, c.person) ? 0 : between(g, -0.35, 0.35)));
  const incumbentLeader = gov.leader;
  const rig = isHuman(g, incumbentLeader) ? (g.wflags[`rig:${office}`] ?? 0) > 0 : gov.style === 'looter' || gov.style === 'tyrant';
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
      const human = humanOf(g, c.person);
      if (human) u += human.standing / 150 + avgInfluence(g, 'FED', human) / 30 + (human.campaign?.push.REST ?? 0) / 10 - human.scandal / 60;
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
    playerRan: cands.some((c) => isHuman(g, c.person)),
    humans: cands.filter((c) => isHuman(g, c.person)).map((c) => c.person),
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
    const was = humanOf(g, old);
    if (was) {
      was.office = null;
      (old === g.me ? g.flags : seatOf(g, old)!.flags).leftOffice = g.week;
    } else g.people[old].office = null;
    gov.leader = person;
    gov.party = party;
    gov.terms = 1;
    gov.loot = 0;
    gov.arrears = gov.arrears * 0.8;
    const human = humanOf(g, person);
    if (human) {
      human.office = office;
      g.people[person].office = office;
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
  // The race is over for every player who was in it.
  for (const id of g.humans) {
    const h = humanOf(g, id);
    if (h?.campaign?.office === office) h.campaign = null;
  }
}

/**
 * Runs any primaries or elections falling in this week. Returns news for everyone; `personal` gets each
 * player's own news (their primary, their result) by person id.
 */
export function weeklyElections(g: Game, personal: (id: number, line: string) => void = () => {}): string[] {
  const news: string[] = [];
  for (const level of ['lga', 'state', 'federal'] as Level[]) {
    // Primaries, for every player in a race at this level.
    for (const id of g.humans) {
      const p = humanOf(g, id);
      if (!p || !isPrimaryWeek(g.week, level) || p.campaign?.stage !== 'aspirant' || levelOf(p.campaign.office) !== level) continue;
      const office = p.campaign.office;
      const need = NEEDS[level];
      const score = (p.standing - need.standing) / 12 + (avgInfluence(g, office, p) - need.influence) / 12 + p.campaign.spent / FORM_PRICE[level] / 2 + p.skills.people / 4;
      const odds = 1 / (1 + Math.exp(-(score - 0.4)));
      if (chance(g, odds)) {
        p.campaign.stage = 'nominee';
        personal(id, `You win the ${PARTIES.find((x) => x.id === p.party)!.name} primary for ${govById(g, office).name}. The campaign starts now`);
      } else {
        personal(id, `You lose the party primary for ${govById(g, office).name}. The delegates were "mobilised" by someone else`);
        p.campaign = null;
        p.standing = Math.max(0, p.standing - 5);
      }
    }
    if (isElectionWeek(g.week, level)) {
      const offices = level === 'federal' ? ['FED'] : level === 'state' ? STATES.map((s) => s.id) : LGAS.map((l) => l.id);
      for (const office of offices) {
        const before = govById(g, office).leader;
        // Players who were nominees but lost the ticket to a stronger player in the same party.
        for (const party of PARTIES.map((x) => x.id)) for (const id of humanNominees(g, office, party).slice(1)) personal(id, `Your party fielded a better-known candidate for ${govById(g, office).name}. Your campaign is over`);
        const rec = holdElection(g, office);
        const where = govById(g, office).name;
        const winnerName = g.people[rec.winner].name;
        const contested = level !== 'lga' || rec.playerRan || g.humans.some((id) => humanOf(g, id)?.home === office);
        if (contested) {
          news.push(
            rec.winner === before
              ? `${winnerName} re-elected in ${where}`
              : `${winnerName} (${rec.candidates.find((c) => c.person === rec.winner)!.party}) wins ${level === 'federal' ? 'the presidency' : level === 'state' ? `${where} governorship` : `${where} chairmanship`}`,
          );
        }
        for (const id of rec.humans ?? []) personal(id, rec.winner === id ? `You win: ${officeTitle(office)}` : `You lose the race for ${where}`);
        // Results night for whoever ran, and for everyone on the big nights.
        for (const s of g.seats) {
          const live = s.id === g.me;
          const home = (live ? g.player : s.player).home;
          const show = (rec.humans ?? []).includes(s.id) || level === 'federal' || (level === 'state' && office === lgaById(home).state);
          const current = live ? g.showElection : s.showElection;
          if (!show || (current !== null && !(rec.humans ?? []).includes(s.id))) continue;
          if (live) g.showElection = g.elections.length - 1;
          else s.showElection = g.elections.length - 1;
        }
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
