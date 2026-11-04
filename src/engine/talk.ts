import { tradeById } from '../data/trades';
import { lgaById, stateById } from '../data/world';
import { okadaBanned, services } from './economy';
import { pick } from './rng';
import type { Game, Person } from './types';

const n = (x: number) => `₦${Math.round(x).toLocaleString()}`;

/**
 * What a person says when you stop to gist. Lines come from the simulation itself:
 * the person's trade, their LGA, and whatever their leaders have done lately.
 */
export function npcLine(g: Game, who: Person): string {
  const l = lgaById(who.lga);
  const st = stateById(l.state);
  const pr = g.prices[l.state];
  const c = g.cohorts[who.lga][who.trade];
  const sv = services(g, who.lga);
  const hi = l.state === 'KN' ? 'Sannu' : l.state === 'RI' ? 'My guy' : 'How far';
  const lines: { w: number; text: string }[] = [];
  const add = (w: number, text: string) => lines.push({ w, text });

  if (who.office) {
    const gov = who.office === 'FED' ? g.fed : who.office in g.states ? g.states[who.office as 'LA'] : g.lgas[who.office];
    const byStyle = {
      reformer: 'The medicine is bitter, I know. Give us time; the roads are coming.',
      populist: 'Have you collected your palliative? We are a listening government!',
      looter: 'The projects are ongoing. Very soon, very soon. Please see my PA.',
      indifferent: 'We are monitoring the situation closely.',
      tyrant: 'Anybody disturbing the peace will be dealt with. Go and tell them.',
    } as const;
    return `${byStyle[gov.style]} (Approval: ${Math.round(gov.approval)}%)`;
  }
  if (who.trade === 'okada' && okadaBanned(g, who.lga)) add(5, `${hi}! Since dem ban okada for ${l.nick}, task force don carry my bike twice. How man go survive?`);
  if (who.trade === 'teacher' && g.states[l.state].arrears >= 1) add(6, `${Math.floor(g.states[l.state].arrears)} months now, no salary. ${st.name} government says “funds are being processed”.`);
  if (who.trade === 'lgstaff' && g.lgas[who.lga].arrears >= 1) add(6, `The council has not paid us for ${Math.floor(g.lgas[who.lga].arrears)} months. The chairman just bought a new jeep.`);
  if (tradeById(who.trade).levy === 'market' && g.lgas[who.lga].policy.levy > 0.045) add(4, 'Levy, levy, levy! Every morning one boy with a receipt book. The chairman wants to chop the whole market.');
  if (tradeById(who.trade).levy === 'park' && g.lgas[who.lga].policy.park === 'touts') add(3, 'Agberos collected four tickets from me today before 10am. Four!');
  if (g.demolition[who.lga] > 0) add(7, 'Bulldozers scattered our market. They say a “modern market” is coming. With whose money will we rent the new shops?');
  if (pr.scarcity) add(6, `No fuel anywhere. I queued since 5am. Black market is ${n(pr.petrol * 1.4)} a litre.`);
  if (pr.petrol / g.ref.petrol[l.state] > 1.25) add(4, `Petrol is ${n(pr.petrol)} now. Everything has gone up: transport, food, even sachet water.`);
  if (pr.rice > 110_000) add(4, `A bag of rice is ${n(pr.rice)}. Na garri we dey drink now.`);
  if (pr.grid < 6) add(4, `NEPA did not even bring light this week. Only ${pr.grid.toFixed(0)} hours a day. My generator is eating my money.`);
  if (g.macro.fxParallel / g.ref.fx > 1.3) add(4, `Dollar is ${n(g.macro.fxParallel)} on the street. The goods I import cost double.`);
  if (g.fed.policy.subsidy) add(1, 'At least fuel is cheap since the subsidy came back. For now.');
  if (g.fed.policy.riceBan && who.trade === 'farmer' && l.farm === 'Rice farming') add(5, 'Since they closed the border to foreign rice, my paddy sells fast. God bless this ban!');
  if (sv.security < 35) add(3, 'Thieves broke into three shops on my street last week. Police came two days later.');
  if (sv.roads > 60) add(2, `The road they fixed has really helped. ${who.trade === 'keke' || who.trade === 'danfo' ? 'My tyres last longer now.' : 'Customers come more.'}`);
  if (c && c.happiness > 65) add(2, `${hi}! Business is moving small small. We thank God.`);
  if (c && c.happiness < 30) add(3, 'This country is hard o. I am thinking of japa. Even my pastor is thinking of japa.');
  if (who.role === 'family') add(3, pick(g, ['When are you bringing a wife/husband home? We are waiting.', 'Have you eaten? Come, there is soup.', 'Your brother needs money for data again.']));
  if (who.role === 'godfather') add(5, 'Politics is not for the faint-hearted. Come and see me when you are serious.');
  if (who.role === 'journalist') add(4, `Off the record: ${g.states[l.state].style === 'looter' ? 'the state accounts are a crime scene' : 'there is a story brewing at the secretariat'}.`);
  if (who.role === 'union-chairman') add(4, 'My members move this whole state. Any politician who wants votes must see me first.');
  if (who.role === 'market-leader') add(4, 'If the market women are not happy, no chairman will sleep well. Remember that.');
  if (who.role === 'area-boss') add(4, 'Election season is coming. My boys are “available”. You understand.');
  add(1, `${hi}! ${pick(g, ['How body?', 'Hope you dey hold body.', 'We dey manage.', 'God dey.'])}`);

  const total = lines.reduce((s, x) => s + x.w, 0);
  let r = (Math.abs(Math.sin(g.week * 7 + g.day * 3 + who.id * 13)) * 10_000) % total;
  for (const x of lines) {
    r -= x.w;
    if (r <= 0) return x.text;
  }
  return lines[lines.length - 1].text;
}
