import type { PlaceId } from '../data/trades';
import { LGAS, lgaById } from '../data/world';
import { weekOfYear } from './calendar';
import { clamp } from './economy';
import { between, chance, pick, rand } from './rng';
import { isHuman } from './seats';
import type { CultureEvent, CultureKind, Game, News } from './types';

// Things happening in town: Nollywood premieres, concerts, comedy nights, big matches, festivals and
// owambe parties. They draw crowds (good for the bukas, bars and salons nearby), make headlines, and
// you can go. Titles, stars and acts are invented.

const FILMS = [
  'Jollof Wars', 'Third Mainland', 'Ajebutter Diaries', 'The Bride Price', 'Danfo Driver', 'Area Mama', 'Okrika Gold', 'Kano Nights',
  'Sapa Chronicles', 'Village Boy in Lekki', 'Mama’s Last Wish', 'Owambe Season', 'Agbero', 'The Godfather’s Wife', 'Bonny Light', 'Japa Express',
];
const ACTS = ['Kunle Wavy', 'Tamuno Flex', 'Hadiza Soul', 'Ozzy Gbedu', 'Lady Jollof', 'Mr Shayo', 'Yemi Bounce', 'Kelechi Kruise', 'Boma Rhymz', 'DJ Danfo'];
const COMICS = ['Akpors Junior', 'Mama Gist', 'Baba Lanre', 'Sule Laughs', 'Ebi the Comedian'];
const RIVALS = ['Ghana', 'Cameroon', 'Senegal', 'Egypt', 'South Africa', 'Ivory Coast', 'Algeria', 'Morocco', 'Mali'];
const STAR_FIRST = ['Tola', 'Ngozi', 'Kanayo', 'Funke', 'Bimbo', 'Zainab', 'Ramsey', 'Osas', 'Ebube', 'Adesua'];
const STAR_LAST = ['Adekunle', 'Nwankwo', 'Ibe', 'Bello', 'Oyelaran', 'Danjuma', 'Briggs', 'Okafor'];

/** Big yearly festivals, by week of the year. */
const FESTIVALS: { week: number; lga: string; place: PlaceId; title: string; star: string }[] = [
  { week: 18, lga: 'LIS', place: 'market', title: 'Eyo Festival', star: 'Masquerades in white on Lagos Island' },
  { week: 26, lga: 'KMC', place: 'palace', title: 'Sallah Durbar', star: 'Horsemen in full regalia before the Emir' },
  { week: 38, lga: 'BON', place: 'park', title: 'Bonny Boat Regatta', star: 'War canoes, drums and dancers on the water' },
];

const P = (g: Game) => g.macro.priceLevel;
/** Culture has its own dice. */
const R = (g: Game) => g.rngs.culture;

function make(g: Game, e: Omit<CultureEvent, 'id' | 'attended'>): CultureEvent {
  const id = g.culture.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const ev = { ...e, id, attended: false };
  g.culture.push(ev);
  return ev;
}

/** Plans next week's events (call at the end of a week, or at the start of a game for week 0). */
export function scheduleCulture(g: Game, week: number) {
  g.culture = g.culture.filter((e) => e.week >= week - 1);
  const homes = [...new Set(g.seats.map((s) => (s.id === g.me ? g.player : s.player).home))];
  const homeState = lgaById(homes[0] ?? 'IKJ').state;
  const pickLga = (weights: [string, number][]) => {
    let r = rand(R(g)) * weights.reduce((s, [, w]) => s + w, 0);
    for (const [id, w] of weights) if ((r -= w) <= 0) return id;
    return weights[0][0];
  };
  if (chance(R(g), 0.65)) {
    const film = pick(R(g), FILMS) + (chance(R(g), 0.3) ? ' 2' : '');
    const lga = pickLga([['ETI', 4], ['IKJ', 3], ['LMA', 1], ['PHC', 2], ['KMC', 1]]);
    const star = `${pick(R(g), STAR_FIRST)} ${pick(R(g), STAR_LAST)}`;
    make(g, { kind: 'premiere', title: `“${film}” premiere`, star: `Starring ${star}`, lga, place: 'venue', week, day: chance(R(g), 0.5) ? 4 : 5, start: 19 * 60, end: 22.5 * 60, ticket: Math.round(10_000 * P(g)), hype: between(R(g), 0.3, 1) });
  }
  if (chance(R(g), 0.55)) {
    const comedy = chance(R(g), 0.35);
    const lga = pickLga(LGAS.filter((l) => l.central).map((l) => [l.id, l.state === homeState ? 2 : 1]));
    const act = comedy ? pick(R(g), COMICS) : pick(R(g), ACTS);
    make(g, { kind: comedy ? 'comedy' : 'concert', title: comedy ? `${act} Live: Laugh Till You Japa` : `${act} in concert`, star: act, lga, place: 'venue', week, day: 5, start: 20 * 60, end: 25 * 60, ticket: Math.round((comedy ? 8_000 : 15_000) * P(g)), hype: between(R(g), 0.25, 0.95) });
  }
  if (chance(R(g), 0.35)) {
    const rival = pick(R(g), RIVALS);
    make(g, { kind: 'football', title: `Super Eagles vs ${rival}`, star: rival, lga: '*', place: 'joint', week, day: chance(R(g), 0.5) ? 2 : 5, start: 17 * 60, end: 19 * 60, ticket: Math.round(1_500 * P(g)), hype: between(R(g), 0.5, 1) });
  }
  // An owambe near the players most Saturdays.
  for (const home of homes.slice(0, 6)) {
    if (!chance(R(g), 0.6)) continue;
    const locals = g.people.filter((x) => !isHuman(g, x.id) && x.lga === home && x.role !== 'politician');
    const host = locals.length ? pick(R(g), locals) : null;
    if (host) {
      const why = pick(R(g), ['60th birthday', 'wedding', 'house warming', 'chieftaincy title', 'child dedication', 'burial and thanksgiving']);
      make(g, { kind: 'owambe', title: `${host.name.split(' ')[0]}’s ${why}`, star: host.name, lga: home, place: 'venue', week, day: 5, start: 13 * 60, end: 19 * 60, ticket: Math.round(5_000 * P(g)), hype: between(R(g), 0.3, 0.7) });
    }
  }
  for (const f of FESTIVALS) {
    if (weekOfYear(week) !== f.week) continue;
    make(g, { kind: 'festival', title: f.title, star: f.star, lga: f.lga, place: f.place, week, day: 5, start: 10 * 60, end: 18 * 60, ticket: 0, hype: 0.95 });
  }
}

export const eventsHere = (g: Game, lga: string) => g.culture.filter((e) => e.week === g.week && (e.lga === lga || e.lga === '*'));
export const isOn = (g: Game, e: CultureEvent) => e.week === g.week && e.day === g.day && g.minute >= e.start - 30 && g.minute < e.end;

export const KIND_NAMES: Record<CultureKind, string> = { premiere: 'Premiere', concert: 'Concert', comedy: 'Comedy show', festival: 'Festival', football: 'Big match', owambe: 'Owambe' };

/** What going does for you. Applied by the attend action. */
export function attend(g: Game, e: CultureEvent): string {
  const p = g.player;
  e.attended = true;
  p.happiness = clamp(p.happiness + 8 + 10 * e.hype, 0, 100);
  p.social = clamp(p.social + 20, 0, 100);
  if (e.kind === 'owambe') {
    p.hunger = clamp(p.hunger + 40, 0, 100);
    const host = g.people.find((x) => x.name === e.star);
    if (host) host.relation = clamp(host.relation + 15, -100, 100);
    p.influence[e.lga] = clamp((p.influence[e.lga] ?? 0) + 2, 0, 100);
    return pick(R(g), ['Jollof, small chops and a live band. You sprayed money and danced till your feet begged.', 'Aso ebi, asun and a DJ who would not stop. The celebrant hugged you twice.']);
  }
  if (e.kind === 'football') {
    return 'Two hours of shouting at a big screen with strangers who are now your brothers.';
  }
  // Premieres, concerts and festivals: a chance to rub shoulders.
  const vips = g.people.filter((x) => (x.role === 'godfather' || x.role === 'politician' || x.role === 'journalist') && lgaById(x.lga).state === lgaById(g.player.at).state);
  if (vips.length && chance(R(g), 0.35)) {
    const v = pick(R(g), vips);
    v.relation = clamp(v.relation + 8, -100, 100);
    p.influence[g.player.at] = clamp(p.influence[g.player.at] + 3, 0, 100);
    return `Red carpet, flashing cameras and ${e.star.replace('Starring ', '')}. You ended up chatting with ${v.name}, who took your number.`;
  }
  return e.kind === 'festival' ? `${e.star}. You will remember this one.` : `${e.star.replace('Starring ', '')} delivered. The crowd sang every word.`;
}

/** Tonight's results for today's events: crowds, box office, scores. Moods move with the Eagles. */
export function resolveCulture(g: Game) {
  for (const e of g.culture) {
    if (e.week !== g.week || e.day !== g.day || e.result) continue;
    const crowd = Math.round((e.kind === 'football' ? 4e6 : e.kind === 'festival' ? 60_000 : e.kind === 'owambe' ? 400 : 2_500) * e.hype * between(R(g), 0.7, 1.3));
    if (e.kind === 'premiere') {
      const gross = Math.round(e.hype * 120e6 * P(g) * between(R(g), 0.6, 1.4));
      e.result = { crowd, gross, note: `${e.title.replace(' premiere', '')} takes ${money(gross)} in its opening weekend` };
    } else if (e.kind === 'football') {
      const r = rand(R(g));
      const [us, them] = r < 0.45 ? [2, 1] : r < 0.7 ? [1, 1] : r < 0.85 ? [0, 1] : [3, 0];
      const won = us > them;
      const drew = us === them;
      for (const l of LGAS) for (const c of Object.values(g.cohorts[l.id])) c.happiness = clamp(c.happiness + (won ? 1.5 : drew ? 0 : -1.5), 0, 100);
      e.result = { crowd, gross: 0, note: won ? `Super Eagles beat ${e.star} ${us}–${them}! Viewing centres across Nigeria erupt` : drew ? `Super Eagles draw ${us}–${them} with ${e.star}. The coach must go, says everybody` : `Heartbreak: Super Eagles lose ${us}–${them} to ${e.star}` };
    } else if (e.kind === 'concert' || e.kind === 'comedy') {
      const sold = e.hype > 0.75;
      e.result = { crowd, gross: crowd * e.ticket, note: sold ? `${e.star} sells out in ${lgaById(e.lga).nick}: ${crowd.toLocaleString()} fans` : `${e.star} plays to ${crowd.toLocaleString()} in ${lgaById(e.lga).nick}` };
    } else if (e.kind === 'festival') {
      e.result = { crowd, gross: 0, note: `${e.title} draws ${crowd.toLocaleString()} to ${lgaById(e.lga).nick}. ${e.star}` };
    } else {
      e.result = { crowd, gross: 0, note: `${e.title}: ${crowd} guests, three canopies, one live band` };
    }
  }
}

const money = (n: number) => (n >= 1e9 ? `₦${(n / 1e9).toFixed(1)}bn` : `₦${Math.round(n / 1e6)}m`);

/** This week's culture stories for the paper. */
export function cultureNews(g: Game): News[] {
  return g.culture
    .filter((e) => e.week === g.week && e.result)
    .map((e): News => ({
      week: g.week,
      text: e.result!.note + (e.attended ? ' (you were there)' : ''),
      tone: e.kind === 'football' && e.result!.note.startsWith('Heartbreak') ? 'bad' : 'good',
      scope: 'world',
      where: e.lga === '*' ? undefined : e.lga,
      kind: e.kind === 'football' ? 'sports' : 'culture',
      weight: e.kind === 'owambe' ? (e.attended ? 2 : 0.5) : e.kind === 'football' ? 5 : e.kind === 'festival' ? 5 : 2 + 4 * e.hype,
    }));
}
