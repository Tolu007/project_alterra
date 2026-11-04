import { tradeById } from '../data/trades';
import { lgaById } from '../data/world';
import { isRainySeason } from './calendar';
import { clamp, okadaBanned, services } from './economy';
import { govById, levelOf } from './government';
import { HOUSING, hasPerk, japaCost, naira } from './life';
import { chance, pick, weightedPick } from './rng';
import type { EventInstance, Game } from './types';

export interface Choice {
  label: string;
  hint?: string;
  blocked?: string | null;
  apply: () => string;
}

export interface EventDef {
  id: string;
  kicker: string;
  /** Random pool weight; 0 means only scheduled directly. */
  weight: (g: Game) => number;
  /** Weeks before it can happen again. */
  cooldown: number;
  bind?: (g: Game) => Omit<EventInstance, 'id'> | null;
  /** One-time effect when the event appears. choices() must stay free of side effects. */
  onShow?: (g: Game, e: EventInstance) => void;
  title: (g: Game, e: EventInstance) => string;
  body: (g: Game, e: EventInstance) => string;
  choices: (g: Game, e: EventInstance) => Choice[];
}

const P = (g: Game) => g.macro.priceLevel;
const p = (g: Game) => g.player;
const spend = (g: Game, label: string, amount: number) => {
  g.player.money -= amount;
  g.player.week.push({ label, amount: -amount });
};
const earn = (g: Game, label: string, amount: number) => {
  g.player.money += amount;
  g.player.week.push({ label, amount });
};
const cant = (g: Game, amount: number) => (g.player.money < amount ? `You need ${naira(amount)}.` : null);
const bump = (v: number, d: number) => clamp(v + d, 0, 100);
const family = (g: Game) => g.people.filter((x) => x.role === 'family');
const trade = (g: Game) => tradeById(g.player.trade);
const homeState = (g: Game) => lgaById(g.player.home).state;

export const EVENTS: EventDef[] = [
  {
    id: 'collapse',
    kicker: 'HEALTH',
    weight: (g) => (p(g).health < 15 ? 100 : 0),
    cooldown: 4,
    title: () => 'YOU COLLAPSED AT WORK',
    body: () => 'Overwork, no rest, no food. Somebody carried you to the general hospital. The nurse wants a deposit before treatment.',
    choices: (g) => {
      const hmo = hasPerk(g, 'hmo');
      const bill = hmo ? 0 : Math.round(80_000 * P(g));
      return [
        {
          label: hmo ? 'Show your HMO card' : `Pay the deposit (${naira(bill)})`,
          apply: () => {
            if (bill) spend(g, 'Hospital', bill);
            p(g).health = 60;
            p(g).energy = 40;
            return hmo ? 'Your HMO covered three days on a drip. Your boss sent a get-well card and a warning. Rest, please.' : 'Three days on a drip. You are alive and broke. Rest, please.';
          },
        },
        {
          label: 'Beg the nurses and call family',
          apply: () => {
            p(g).health = 40;
            for (const f of family(g)) f.relation = clamp(f.relation - 5, -100, 100);
            spend(g, 'Hospital', Math.round(bill * 0.4));
            return 'Mama sold her wrapper to pay half. You owe her more than money now.';
          },
        },
      ];
    },
  },
  {
    id: 'malaria',
    kicker: 'HEALTH',
    weight: (g) => 0.5 + (isRainySeason(g.week) ? 0.6 : 0) + (services(g, p(g).home).sanitation < 40 ? 0.5 : 0),
    cooldown: 8,
    onShow: (g) => {
      p(g).health = bump(p(g).health, -15);
    },
    title: () => 'MALARIA HAS FINISHED YOU',
    body: () => 'Headache, fever, bitter mouth. Mosquitoes from the blocked gutter outside have done their work.',
    choices: (g) => {
      const cost = hasPerk(g, 'hmo') ? 0 : Math.round(25_000 * P(g));
      return [
        {
          label: cost ? `Go to the clinic (${naira(cost)})` : 'Go to the clinic (HMO covers it)',
          blocked: cant(g, cost),
          apply: () => {
            if (cost) spend(g, 'Clinic', cost);
            p(g).health = bump(p(g).health, 25);
            return 'Test, drugs, injection. You are back on your feet by Thursday.';
          },
        },
        {
          label: 'Agbo from the herb seller',
          apply: () => {
            spend(g, 'Agbo', Math.round(2_000 * P(g)));
            if (chance(g, 0.5)) {
              p(g).health = bump(p(g).health, 10);
              return 'Bitter, but it worked. Or the fever just got tired.';
            }
            p(g).health = bump(p(g).health, -10);
            return 'The fever got worse. You should have gone to the clinic.';
          },
        },
        {
          label: 'Ignore it and keep working',
          apply: () => {
            p(g).health = bump(p(g).health, -10);
            p(g).energy = bump(p(g).energy, -20);
            return 'You worked through it. Your body has filed a formal complaint.';
          },
        },
      ];
    },
  },
  {
    id: 'black-tax',
    kicker: 'FAMILY',
    weight: () => 1.1,
    cooldown: 5,
    bind: (g) => {
      const fam = family(g);
      return fam.length ? { person: pick(g, fam).id, amount: Math.round(pick(g, [30_000, 60_000, 120_000]) * P(g)) } : null;
    },
    title: (g, e) => `${g.people[e.person!].name.split(' ')[0].toUpperCase()} NEEDS MONEY`,
    body: (_, e) => `${['School fees are due', 'Hospital bill for an aunty in the village', 'Rent is due and the landlord is shouting', 'A business idea that “cannot fail”'][Math.floor(e.amount! / 1000) % 4]}. ${naira(e.amount!)}, and they will “pay back next month”.`,
    choices: (g, e) => {
      const who = g.people[e.person!];
      return [
        {
          label: `Send ${naira(e.amount!)}`,
          blocked: cant(g, e.amount!),
          apply: () => {
            spend(g, 'Family support', e.amount!);
            who.relation = clamp(who.relation + 15, -100, 100);
            p(g).happiness = bump(p(g).happiness, 2);
            return `${who.name.split(' ')[0]} sent ten prayer emojis. Family is family.`;
          },
        },
        {
          label: 'Send half',
          blocked: cant(g, e.amount! / 2),
          apply: () => {
            spend(g, 'Family support', e.amount! / 2);
            who.relation = clamp(who.relation + 4, -100, 100);
            return '“Thank you… I will manage the rest.” The guilt is free.';
          },
        },
        {
          label: 'Say you are broke too',
          apply: () => {
            who.relation = clamp(who.relation - 15, -100, 100);
            p(g).happiness = bump(p(g).happiness, -4);
            return 'They saw your new shoes in your WhatsApp status. It is cold in the family group now.';
          },
        },
      ];
    },
  },
  {
    id: 'landlord',
    kicker: 'HOUSING',
    weight: (g) => (p(g).housing !== 'family' && p(g).rentDue - g.week <= 8 && p(g).rentDue - g.week > 0 ? 1.4 : 0),
    cooldown: 40,
    bind: (g) => ({ amount: pick(g, [25, 30, 40]) }),
    title: (_, e) => `LANDLORD RAISES YOUR RENT BY ${e.amount}%`,
    body: (g) => `“Everything has gone up. Cement, diesel, my own rent.” Renewal is in ${p(g).rentDue - g.week} weeks, and it is a year up front.`,
    choices: (g, e) => [
      {
        label: 'Accept it',
        apply: () => {
          g.flags.rentPremium = (g.flags.rentPremium ?? 0) + e.amount! / 100;
          return 'You said “no problem, sir”. You did not mean it.';
        },
      },
      {
        label: 'Negotiate (people skill)',
        apply: () => {
          const ok = chance(g, 0.3 + p(g).skills.people * 0.12);
          g.flags.rentPremium = (g.flags.rentPremium ?? 0) + (ok ? 0.1 : e.amount! / 100);
          return ok ? 'You knelt, you begged, you brought a bottle of Schnapps. Only 10%.' : 'He said, “If you cannot pay, quit.” Full increase.';
        },
      },
      {
        label: `Move somewhere cheaper (${HOUSING.room.name.toLowerCase()})`,
        blocked: p(g).housing === 'room' ? 'You are already in a room.' : null,
        apply: () => {
          p(g).housing = 'room';
          p(g).happiness = bump(p(g).happiness, -5);
          return 'You packed into a smaller room. Shared toilet, but you are not dying.';
        },
      },
    ],
  },
  {
    id: 'agbero',
    kicker: 'MOTOR PARK',
    weight: (g) => (trade(g).levy === 'park' && g.lgas[p(g).home].policy.park === 'touts' ? 1.2 : 0),
    cooldown: 4,
    title: () => 'AGBERO WANTS “OWO TICKET” TWICE',
    body: (g) => `You already paid today. Now a different boy with a bigger stick says it is for “the chairman’s birthday”. ${naira(5_000 * P(g))}.`,
    choices: (g) => {
      const fee = Math.round(5_000 * P(g));
      const chairman = g.people.find((x) => x.role === 'union-chairman' && lgaById(x.lga).state === homeState(g));
      return [
        { label: `Pay ${naira(fee)}`, apply: () => (spend(g, 'Agbero', fee), 'He collected and wished you “safe journey”.') },
        {
          label: 'Refuse',
          apply: () => {
            if (chance(g, 0.45)) {
              p(g).health = bump(p(g).health, -15);
              spend(g, 'Side mirror', Math.round(12_000 * P(g)));
              return 'They broke your mirror and your pride. Mostly your mirror.';
            }
            return 'You stared him down. He went to find someone softer.';
          },
        },
        {
          label: chairman ? `Call ${chairman.name.split(' ')[0]}, the union chairman` : 'Call the union chairman',
          blocked: chairman && chairman.relation < 20 ? 'You do not know the chairman well enough.' : null,
          apply: () => 'One phone call and the boy apologised. Connections are currency.',
        },
      ];
    },
  },
  {
    id: 'task-force',
    kicker: 'TASK FORCE',
    weight: (g) => ((p(g).trade === 'okada' && okadaBanned(g, p(g).home)) || (p(g).trade === 'keke' && chance(g, 0.3)) ? 1.6 : 0),
    cooldown: 4,
    title: (g) => `TASK FORCE IMPOUNDS YOUR ${p(g).trade.toUpperCase()}`,
    body: () => 'They jumped out of a pickup and dragged it away. The yard is far, and the “fine” has no receipt.',
    choices: (g) => {
      const fine = Math.round(60_000 * P(g));
      return [
        { label: `Pay the “fine” (${naira(fine)})`, blocked: cant(g, fine), apply: () => (spend(g, 'Task force fine', fine), 'You got it back with a missing side mirror.') },
        {
          label: 'Go to the mobile court',
          apply: () => {
            spend(g, 'Court fees', Math.round(20_000 * P(g)));
            p(g).energy = bump(p(g).energy, -30);
            return 'Two days in a queue, then a judge who fined you anyway. Smaller, at least.';
          },
        },
        {
          label: 'Leave it. Find another hustle.',
          apply: () => {
            p(g).trade = 'unemployed';
            p(g).hired = false;
            return 'You walked away. You are looking for work now.';
          },
        },
      ];
    },
  },
  {
    id: 'phone',
    kicker: 'ONE CHANCE',
    weight: (g) => (services(g, p(g).home).security < 50 ? 0.7 : 0.2),
    cooldown: 12,
    title: () => 'YOUR PHONE HAS BEEN SNATCHED IN TRAFFIC',
    body: () => 'One second it was in your hand by the window. The next, a bike was disappearing down the road with it.',
    choices: (g) => {
      const good = Math.round(160_000 * P(g));
      const cheap = Math.round(40_000 * P(g));
      return [
        { label: `Buy a proper phone (${naira(good)})`, blocked: cant(g, good), apply: () => (spend(g, 'New phone', good), 'Back online. You blocked the thief on nothing, because you cannot.') },
        { label: `Buy a small phone (${naira(cheap)})`, blocked: cant(g, cheap), apply: () => (spend(g, 'Small phone', cheap), (p(g).happiness = bump(p(g).happiness, -3)), 'It makes calls. That is all it does.') },
        { label: 'Use your old cracked phone', apply: () => ((p(g).happiness = bump(p(g).happiness, -5)), 'Half the screen works. The half that works is the half you need.') },
      ];
    },
  },
  {
    id: 'owambe',
    kicker: 'OWAMBE',
    weight: () => 0.9,
    cooldown: 8,
    title: () => 'YOUR FRIEND’S WEDDING: ASO-EBI IS ₦45K',
    body: () => 'The colour is “champagne gold”. Everybody will be there. Not wearing it is a statement.',
    choices: (g) => {
      const cost = Math.round(45_000 * P(g));
      return [
        {
          label: `Buy the aso-ebi and dance (${naira(cost)})`,
          blocked: cant(g, cost),
          apply: () => {
            spend(g, 'Aso-ebi & spraying', cost);
            p(g).happiness = bump(p(g).happiness, 8);
            p(g).influence[p(g).home] = bump(p(g).influence[p(g).home], 3);
            return 'Jollof, small chops, and you met three people who know people.';
          },
        },
        {
          label: 'Go in your own clothes',
          apply: () => ((p(g).happiness = bump(p(g).happiness, 3)), 'The aunties noticed. The food was still sweet.'),
        },
        {
          label: 'Say you have a prior engagement',
          apply: () => {
            const f = g.people.find((x) => x.role === 'friend');
            if (f) f.relation = clamp(f.relation - 8, -100, 100);
            return 'Your friend has noted it. In pen.';
          },
        },
      ];
    },
  },
  {
    id: 'blackout',
    kicker: 'NEPA',
    weight: (g) => (g.prices[homeState(g)].grid < 7 ? 1.4 : 0.3),
    cooldown: 6,
    title: () => 'NO LIGHT FOR SIX DAYS',
    body: (g) => `The transformer blew. The DisCo says it is “working on it”. ${p(g).hasGenerator ? 'Your generator is drinking fuel like water.' : 'You do not have a generator.'}`,
    choices: (g) => {
      const gen = Math.round(280_000 * Math.pow(P(g), 0.8));
      const fuel = Math.round(15_000 * (g.prices[homeState(g)].petrol / g.ref.petrol[homeState(g)]));
      return [
        p(g).hasGenerator
          ? { label: `Fuel the generator all week (${naira(fuel)})`, blocked: cant(g, fuel), apply: () => (spend(g, 'Generator fuel', fuel), 'The noise is terrible. The fan is beautiful.') }
          : { label: `Buy a generator (${naira(gen)})`, blocked: cant(g, gen), apply: () => (spend(g, 'Generator', gen), (p(g).hasGenerator = true), 'I better pass my neighbour.') },
        {
          label: 'Contribute to fix the transformer',
          apply: () => {
            spend(g, 'Transformer levy', Math.round(10_000 * P(g)));
            p(g).influence[p(g).home] = bump(p(g).influence[p(g).home], 2);
            return 'The whole street contributed. Light came back in two days. Up NEPA!';
          },
        },
        { label: 'Endure', apply: () => ((p(g).happiness = bump(p(g).happiness, -6)), 'Hot nights, warm drinks, dead phone. Endurance is a Nigerian skill.') },
      ];
    },
  },
  {
    id: 'job-offer',
    kicker: 'OPPORTUNITY',
    weight: (g) => (p(g).skills.edu >= 3 || p(g).skills.tech >= 3 ? 0.6 : 0),
    cooldown: 16,
    bind: (g) => {
      const options = (['office', 'tech', 'factory'] as const).filter((t) => t !== p(g).trade && Object.entries(tradeById(t).needs ?? {}).every(([k, v]) => p(g).skills[k as 'edu'] >= (v as number)));
      return options.length ? { trade: pick(g, options) } : null;
    },
    title: (_, e) => `A ${tradeById(e.trade!).name.toUpperCase()} JOB OFFER`,
    body: (_, e) => `A friend of a friend has a vacancy. ${naira(tradeById(e.trade!).base)} a month at the start. ${tradeById(e.trade!).blurb}`,
    choices: (g, e) => [
      {
        label: 'Take it',
        apply: () => {
          p(g).trade = e.trade!;
          p(g).hired = false;
          p(g).scale = 1;
          p(g).queries = 0;
          return 'You resume on Monday. Iron your shirt.';
        },
      },
      { label: 'Decline', apply: () => 'You are building something of your own. Hopefully.' },
    ],
  },
  {
    id: 'flood',
    kicker: 'FLOOD',
    weight: (g) => (isRainySeason(g.week) ? (services(g, p(g).home).sanitation < 45 || ['ETI', 'OKR', 'BON', 'LIS'].includes(p(g).home) ? 1.6 : 0.4) : 0),
    cooldown: 6,
    title: (g) => `FLOOD SUBMERGES ${lgaById(p(g).home).nick.toUpperCase()}`,
    body: () => 'Three hours of rain, blocked drains, and the street is a river. Water in the house, water in the shop.',
    choices: (g) => {
      const loss = Math.round((trade(g).kind === 'self' ? 60_000 : 25_000) * P(g));
      return [
        { label: `Clean up and replace what was ruined (${naira(loss)})`, blocked: cant(g, loss), apply: () => (spend(g, 'Flood damage', loss), 'Gone are the stock and the rug. You are drying everything on the roof.') },
        {
          label: 'Stay with a friend till it drains',
          apply: () => {
            p(g).energy = bump(p(g).energy, -15);
            spend(g, 'Flood damage', loss * 0.5);
            return 'Two days on a friend’s floor. Half your things survived.';
          },
        },
        {
          label: 'Blame the government on X',
          apply: () => {
            spend(g, 'Flood damage', loss);
            for (const c of Object.values(g.cohorts[p(g).home])) c.sat.lga = clamp(c.sat.lga - 1.5, 0, 100);
            return 'Your thread went viral. The drains did not get cleared.';
          },
        },
      ];
    },
  },
  {
    id: 'robbery',
    kicker: 'CRIME',
    weight: (g) => (services(g, p(g).home).security < 40 && p(g).money > 200_000 ? 0.9 : 0),
    cooldown: 12,
    onShow: (g, e) => {
      const taken = Math.round(p(g).money * 0.25);
      e.amount = taken;
      spend(g, 'Robbed', taken);
    },
    title: () => 'ARMED ROBBERS ON YOUR STREET',
    body: (_, e) => `They came at 2am with torches and machetes. They took ${naira(e.amount ?? 0)} in cash.`,
    choices: (g) => [
      {
        label: 'Report to the police',
        apply: () => {
          spend(g, 'Police “mobilisation”', Math.round(20_000 * P(g)));
          return chance(g, 0.1) ? 'Amazingly, they caught one of them. You got some money back.' : 'They took your statement and asked for fuel money. Nothing else.';
        },
      },
      { label: 'Join the street vigilante levy', apply: () => (spend(g, 'Vigilante levy', Math.round(5_000 * P(g))), 'Now there are boys with whistles at the gate. You sleep a bit better.') },
    ],
  },
  {
    id: 'big-order',
    kicker: 'OPPORTUNITY',
    weight: (g) => (g.businesses.some((b) => b.owner === 0) ? 0.8 : 0),
    cooldown: 6,
    title: () => 'A BIG CUSTOMER WANTS A BULK ORDER',
    body: () => 'An event planner, a contractor, or a big man’s PA. They want a lot, fast, and they will pay at once.',
    choices: (g) => [
      {
        label: 'Take it, work through the night',
        apply: () => {
          const amount = Math.round(Math.max(40_000, trade(g).base) * P(g) * 0.6 * (1 + g.businesses.filter((b) => b.owner === 0).length * 0.5));
          earn(g, 'Bulk order', amount);
          p(g).energy = bump(p(g).energy, -25);
          return `Done by morning. ${naira(amount)} in one alert.`;
        },
      },
      { label: 'Decline, you are tired', apply: () => 'They went to your competitor. Who also looks tired.' },
    ],
  },
  {
    id: 'fuel-queue',
    kicker: 'FUEL',
    weight: (g) => (g.prices[homeState(g)].scarcity ? 3 : 0),
    cooldown: 3,
    title: () => 'FUEL SCARCITY: QUEUES EVERYWHERE',
    body: (g) => `Filing stations are “not selling”. Black market jerrycans by the roadside: ${naira(g.prices[homeState(g)].petrol * 1.5)} a litre.`,
    choices: (g) => [
      { label: 'Queue overnight at the station', apply: () => ((p(g).energy = bump(p(g).energy, -25)), 'Seven hours. You got 20 litres and a backache.') },
      { label: 'Buy from the black market', apply: () => (spend(g, 'Black market fuel', Math.round(15_000 * P(g))), 'Adulterated or not, it moves.') },
      { label: 'Trek and stay home more', apply: () => ((p(g).happiness = bump(p(g).happiness, -4)), 'Everything is far when there is no fuel.') },
    ],
  },
  {
    id: 'protest-call',
    kicker: 'PROTEST',
    weight: (g) => {
      const c = Object.values(g.cohorts[p(g).home]);
      const worst = Math.min(...c.map((x) => Math.min(x.sat.state, x.sat.federal)));
      return worst < 28 ? 1.2 : 0;
    },
    cooldown: 10,
    title: (g) => `#ENDHARDSHIP: PROTEST PLANNED IN ${lgaById(p(g).home).nick.toUpperCase()}`,
    body: () => 'Prices, bans, levies, unpaid salaries. People are tired. The group chat says everyone should come out tomorrow.',
    choices: (g) => [
      {
        label: 'March with them',
        apply: () => {
          p(g).influence[p(g).home] = bump(p(g).influence[p(g).home], 6);
          const st = g.states[homeState(g)];
          if ((st.style === 'tyrant' || g.fed.style === 'tyrant') && chance(g, 0.35)) {
            p(g).health = bump(p(g).health, -15);
            spend(g, 'Bail', Math.round(80_000 * P(g)));
            return 'Teargas, then a police van. You were released after paying “bail”. You are angrier now.';
          }
          return 'Thousands came out. The government has promised “dialogue”.';
        },
      },
      { label: 'Stay home', apply: () => 'You watched it on Instagram Live. Safer. Less satisfying.' },
    ],
  },
  {
    id: 'demolition',
    kicker: 'DEMOLITION',
    weight: (g) => (g.demolition[p(g).home] >= 7 && trade(g).markets > 0.2 ? 50 : 0),
    cooldown: 10,
    title: (g) => `BULLDOZERS AT ${lgaById(p(g).home).nick.toUpperCase()} MARKET`,
    body: () => 'Forty-eight hours’ notice, then the bulldozers. Your shop is rubble. The state says a modern market is coming.',
    choices: (g) => [
      {
        label: `Rent a space in another market (${naira(80_000 * P(g))})`,
        blocked: cant(g, 80_000 * P(g)),
        apply: () => {
          spend(g, 'New stall', Math.round(80_000 * P(g)));
          g.flags.relocated = g.demolition[p(g).home];
          return 'Smaller, further, but you are trading again by Thursday.';
        },
      },
      {
        label: 'Join the traders’ protest',
        apply: () => {
          p(g).influence[p(g).home] = bump(p(g).influence[p(g).home], 7);
          return 'The market women were fearsome. Every politician in the area now knows your face.';
        },
      },
      { label: 'Sell from a table by the road', apply: () => 'Roadside trading. Task force will come eventually. Today, you sell.' },
    ],
  },
  {
    id: 'arrears',
    kicker: 'SALARY',
    weight: (g) => {
      const t = trade(g);
      if (t.payer === 'state') return g.states[homeState(g)].arrears >= 1 ? 2 : 0;
      if (t.payer === 'lga') return g.lgas[p(g).home].arrears >= 1 ? 2 : 0;
      return 0;
    },
    cooldown: 6,
    title: () => 'YOUR SALARY IS MONTHS LATE',
    body: (g) => `${trade(g).payer === 'state' ? 'The state' : 'The council'} says “funds are being processed”. Your union is calling a strike.`,
    choices: (g) => [
      { label: 'Join the strike', apply: () => ((p(g).influence[p(g).home] = bump(p(g).influence[p(g).home], 3)), 'Placards outside the secretariat. Solidarity is warm, hunger is cold.') },
      {
        label: 'Start a side hustle',
        apply: () => {
          earn(g, 'Side hustle', Math.round(25_000 * P(g)));
          p(g).energy = bump(p(g).energy, -15);
          return 'Selling recharge cards and doing tutorials. It is something.';
        },
      },
      { label: 'Wait and pray', apply: () => ((p(g).happiness = bump(p(g).happiness, -5)), 'God dey.') },
    ],
  },
  {
    id: 'palliative',
    kicker: 'PALLIATIVE',
    weight: (g) => (Object.values(g.cohorts[p(g).home]).some((c) => c.relief > 2_000) && p(g).money < 400_000 ? 1 : 0),
    cooldown: 6,
    title: () => 'PALLIATIVES BEING SHARED AT THE WARD',
    body: () => 'A bag of rice, some noodles, a sachet of tomato. With a big poster of the governor’s face on the truck.',
    choices: (g) => [
      { label: 'Queue for it', apply: () => (earn(g, 'Palliative (food saved)', Math.round(12_000 * P(g))), (p(g).energy = bump(p(g).energy, -10)), 'You got a bag. Half the queue got nothing.') },
      { label: 'Leave it for those who need it more', apply: () => ((p(g).happiness = bump(p(g).happiness, 2)), 'Somebody’s mother took it home. Good.') },
    ],
  },
  {
    id: 'japa-call',
    kicker: 'JAPA',
    weight: (g) => (g.macro.fxParallel / g.ref.fx > 1.3 || g.macro.inflation > 0.3 ? 0.6 : 0.15),
    cooldown: 24,
    title: () => 'YOUR COUSIN IN MANCHESTER: “COME, THIS PLACE IS BETTER”',
    body: (g) => `He sent pictures of an Asda and a nice coat. It would cost about ${naira(japaCost(g))} for visa, proof of funds and flight.`,
    choices: (g) => [
      {
        label: 'Japa. Start the process.',
        blocked: cant(g, japaCost(g)),
        apply: () => {
          spend(g, 'Japa', japaCost(g));
          g.ending = { kind: 'japa', week: g.week, text: 'You left. Your mum cried at the airport, then asked you to send £100.' };
          return 'Two months later you are in Manchester, wearing three jackets.';
        },
      },
      { label: 'Not now. Naija will be better.', apply: () => 'He sent a laughing emoji. Then a crying one.' },
    ],
  },
  {
    id: 'efcc',
    kicker: 'EFCC',
    weight: (g) => (p(g).loot > 50_000_000 && ((g.flags.leftOffice ?? -99) > g.week - 10 || p(g).scandal > 50) ? 4 : 0),
    cooldown: 12,
    title: () => 'EFCC INVITES YOU FOR “A CHAT”',
    body: (g) => `Investigators have traced ${naira(p(g).loot)} that left public accounts while you were in office. Bring your lawyer. And a toothbrush.`,
    choices: (g) => {
      const half = Math.round(p(g).loot * 0.5);
      const friendly = !!p(g).party && p(g).party === g.fed.party;
      return [
        {
          label: `Plea bargain: return ${naira(half)}`,
          blocked: cant(g, half),
          apply: () => {
            spend(g, 'EFCC plea bargain', half);
            p(g).loot = 0;
            p(g).scandal = bump(p(g).scandal, 10);
            return 'You returned half and kept a low profile. The other half is “working capital”.';
          },
        },
        {
          label: friendly ? 'Call your friends in the ruling party' : 'Defect to the ruling party',
          apply: () => {
            if (!friendly) {
              p(g).party = g.fed.party;
              p(g).standing = 20;
            }
            if (chance(g, 0.65)) {
              p(g).loot = 0;
              return '“Once you join us, your sins are forgiven.” The case file went missing.';
            }
            g.ending = { kind: 'jail', week: g.week, text: 'The judge was not a party member. You were convicted and sent to Kuje.' };
            return 'This time, it did not work.';
          },
        },
        {
          label: 'Fight it in court',
          apply: () => {
            spend(g, 'Senior lawyers', Math.round(p(g).loot * 0.15));
            if (chance(g, 0.55)) {
              p(g).loot = 0;
              return 'Eight adjournments later the case was struck out on a technicality.';
            }
            g.ending = { kind: 'jail', week: g.week, text: 'Convicted on 12 counts of money laundering. Your lawyers have filed an appeal.' };
            return 'Guilty.';
          },
        },
      ];
    },
  },
  {
    id: 'godfather',
    kicker: 'POLITICS',
    weight: (g) => (p(g).office && levelOf(p(g).office!) !== 'federal' ? 0.9 : 0),
    cooldown: 12,
    title: () => 'YOUR GODFATHER WANTS HIS SHARE',
    body: (g) => `“Who put you there? I want the contract for the new ${pick(g, ['road', 'market', 'hospital'])}, and 20% of the security vote.”`,
    choices: (g) => {
      const gov = govById(g, p(g).office!);
      return [
        {
          label: 'Give him what he wants',
          apply: () => {
            gov.budget.misc = Math.min(0.9, (gov.budget.misc ?? 0) + 0.1);
            p(g).standing = bump(p(g).standing, 10);
            p(g).scandal = bump(p(g).scandal, 8);
            return 'He is smiling. The party is calm. The road will be “ongoing” for years.';
          },
        },
        {
          label: 'Refuse',
          apply: () => {
            p(g).standing = bump(p(g).standing, -20);
            for (const id of Object.keys(p(g).influence)) p(g).influence[id] *= 0.9;
            return 'He called a press conference. “I made that small boy.” War has started.';
          },
        },
      ];
    },
  },
  {
    id: 'expose',
    kicker: 'EXCLUSIVE',
    weight: (g) => (p(g).office && p(g).loot > 20_000_000 ? 1.2 : 0),
    cooldown: 10,
    title: () => 'NEWSPAPER: “WHERE IS THE MONEY?”',
    body: (g) => `A journalist has documents on the “${govById(g, p(g).office!).level === 'lga' ? 'logistics' : 'security vote'}” line. Ten thousand shares already.`,
    choices: (g) => [
      {
        label: 'Deny it. Call it fake news.',
        apply: () => {
          if (chance(g, 0.5)) return 'It worked. Your aides flooded the comments.';
          p(g).scandal = bump(p(g).scandal, 25);
          return 'Then they published the bank transfers. Scandal is now a word with your face on it.';
        },
      },
      {
        label: 'Cut the misc line and announce reforms',
        apply: () => {
          const gov = govById(g, p(g).office!);
          gov.budget.misc = Math.max(0, (gov.budget.misc ?? 0) - 0.15);
          p(g).scandal = bump(p(g).scandal, -10);
          return 'You announced a “transparency portal”. It has two pages. People are calmer.';
        },
      },
      {
        label: 'Have the journalist “invited”',
        apply: () => {
          p(g).scandal = bump(p(g).scandal, 15);
          for (const c of Object.values(g.cohorts[p(g).home])) c.sat[levelOf(p(g).office!)] = clamp(c.sat[levelOf(p(g).office!)] - 6, 0, 100);
          return 'The journalist is in detention. Amnesty International is now tweeting about you.';
        },
      },
    ],
  },
  {
    id: 'scholarship',
    kicker: 'OPPORTUNITY',
    weight: (g) => (services(g, p(g).home).schools > 50 ? 0.5 : 0.1),
    cooldown: 16,
    title: () => 'FREE SKILLS PROGRAMME IN YOUR LGA',
    body: () => 'A government-funded training: coding, tailoring, solar installation. Free, with a small stipend.',
    choices: (g) => [
      {
        label: 'Sign up (coding / solar)',
        apply: () => {
          p(g).skills.tech = Math.min(5, p(g).skills.tech + 0.5);
          p(g).energy = bump(p(g).energy, -15);
          return 'Six weeks later you have a certificate and a new skill.';
        },
      },
      {
        label: 'Sign up (business)',
        apply: () => {
          p(g).skills.biz = Math.min(5, p(g).skills.biz + 0.5);
          return 'Bookkeeping, marketing, customer service. You see your hustle differently now.';
        },
      },
      { label: 'No time', apply: () => 'Maybe next year.' },
    ],
  },
];

export const eventById = (id: string) => EVENTS.find((e) => e.id === id)!;

/** Picks at most one personal event a week (two if something urgent is also due). */
export function scheduleEvents(g: Game) {
  const ready = EVENTS.filter((e) => (g.seenEvents[e.id] ?? -999) + e.cooldown <= g.week);
  const urgent = ready.filter((e) => e.weight(g) >= 4);
  const picks: EventInstance[] = [];
  for (const e of urgent.slice(0, 1)) {
    const b = e.bind ? e.bind(g) : {};
    if (b) picks.push({ id: e.id, ...b });
  }
  if (chance(g, 0.65)) {
    const pool = ready.filter((e) => !picks.some((x) => x.id === e.id) && e.weight(g) > 0 && e.weight(g) < 4);
    const def = weightedPick(g, pool, (e) => e.weight(g));
    if (def) {
      const b = def.bind ? def.bind(g) : {};
      if (b) picks.push({ id: def.id, ...b });
    }
  }
  for (const x of picks) g.seenEvents[x.id] = g.week;
  g.eventQueue.push(...picks);
}

