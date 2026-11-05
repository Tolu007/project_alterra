// Getting around. Within Lagos, trips follow the real roads between districts (their length and the
// roads they take come from map data), and traffic decides how long they take: danfos and taxis crawl
// in rush hour, BRT buses less so, and the Red Line train and the lagoon ferries not at all.
// Between states: night-bus-length rides from the motor park, or a flight from the airport.

import city from '../data/city/lagos.json';
import type { PlaceId } from '../data/trades';
import { LGAS, lgaById, lgasOf, stateById, type StateId } from '../data/world';
import { clockLabel } from './calendar';
import type { Game } from './types';

export type Mode = 'danfo' | 'brt' | 'rail' | 'ferry' | 'taxi' | 'bus' | 'flight';

/** Where each way of travelling leaves from (null: booked on the phone, wherever you are) and arrives. */
export const MODES: Record<Mode, { name: string; icon: string; board: PlaceId | null; arrive: PlaceId }> = {
  danfo: { name: 'Danfo', icon: '🚐', board: 'busstop', arrive: 'busstop' },
  brt: { name: 'BRT bus', icon: '🚌', board: 'busstop', arrive: 'busstop' },
  rail: { name: 'Red Line train', icon: '🚆', board: 'busstop', arrive: 'busstop' },
  ferry: { name: 'Ferry', icon: '⛴️', board: 'jetty', arrive: 'jetty' },
  taxi: { name: 'Ride-hailing car', icon: '🚕', board: null, arrive: 'busstop' },
  bus: { name: 'Interstate bus', icon: '🚍', board: 'park', arrive: 'park' },
  flight: { name: 'Flight', icon: '✈️', board: 'airport', arrive: 'airport' },
};

export interface Trip {
  /** The action id: travel:<lga> for the usual danfo or interstate bus, travel:<lga>:<mode> for the rest. */
  id: string;
  mode: Mode;
  to: string;
  board: PlaceId | null;
  arrive: PlaceId;
  km: number;
  minutes: number;
  cost: number;
  energy: number;
  /** Roads (in Lagos) or cities (between states) along the way. */
  via: string[];
  blocked: string | null;
}

interface Table {
  road: Record<string, { km: number; via: string[] }>;
  ferry: Record<string, { km: number }>;
  brt: string[][];
  rail: string[][];
}
const TABLE = (city as unknown as { travel?: Table }).travel;

const pair = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const onLine = (lines: string[][] | undefined, a: string, b: string) => !!lines?.some((l) => l.includes(a) && l.includes(b));
const round5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);

/** Lagos traffic: how many times slower than an empty road at this time of day. */
export function rushFactor(minute: number): number {
  const h = (minute / 60) % 24;
  const bump = (c: number, w: number) => Math.max(0, 1 - Math.abs(h - c) / w);
  return 1 + 1.15 * bump(8, 2) + 1.25 * bump(18.5, 2.5) + 0.25 * bump(13, 2);
}

/** Long-distance routes between the playable states: road km, minutes by bus and in the air, towns on the way (from the first end to the second). */
export const INTERSTATE: Record<string, { km: number; bus: number; air: number; busFare: number; airFare: number; via: string[]; ends: [StateId, StateId] }> = {
  'KN-LA': { ends: ['LA', 'KN'], km: 1_000, bus: 900, air: 85, busFare: 38_000, airFare: 165_000, via: ['Ibadan', 'Ilorin', 'Jebba', 'Mokwa', 'Kaduna', 'Zaria'] },
  'LA-RI': { ends: ['LA', 'RI'], km: 620, bus: 600, air: 65, busFare: 26_000, airFare: 140_000, via: ['Ore', 'Benin City', 'Onitsha', 'Owerri'] },
  'KN-RI': { ends: ['KN', 'RI'], km: 1_150, bus: 1_020, air: 100, busFare: 42_000, airFare: 190_000, via: ['Zaria', 'Kaduna', 'Abuja', 'Makurdi', 'Enugu', 'Aba'] },
};
/** Check-in before a flight and getting out of the airport after. */
const AIRPORT_MINUTES = 90;
const FLIGHTS: [number, number] = [7 * 60, 19 * 60];
const LAST_DAY_MINUTE = 26 * 60;

export const airportOf = (st: StateId) => LGAS.find((l) => l.state === st && l.airport);

/** Distance by road between two Lagos districts, and the main roads it takes (from map data). */
export function lagosRoad(a: string, b: string): { km: number; via: string[] } | null {
  return TABLE?.road[pair(a, b)] ?? null;
}

/** Splits a trip id into where it goes and how. */
export function parseTrip(id: string, from: string): { to: string; mode: Mode } | null {
  const [kind, to, mode] = id.split(':');
  if (kind !== 'travel' || !to) return null;
  if (mode) return { to, mode: mode as Mode };
  return { to, mode: lgaById(to).state === lgaById(from).state ? 'danfo' : 'bus' };
}

/** Every trip you could take from this LGA right now, wherever it leaves from. */
export function tripsFrom(g: Game, from = g.player.at): Trip[] {
  const here = lgaById(from);
  const out: Trip[] = [];
  const now = g.minute;
  const rush = rushFactor(now);
  const fare = g.fares[from];
  const P = g.macro.priceLevel;
  const add = (t: Omit<Trip, 'id' | 'board' | 'arrive'> & { plain?: boolean }) => {
    const { plain, ...rest } = t;
    out.push({ ...rest, id: plain ? `travel:${t.to}` : `travel:${t.to}:${t.mode}`, board: MODES[t.mode].board, arrive: MODES[t.mode].arrive, minutes: round5(t.minutes) });
  };
  const hours = (open: number, close: number, what: string) => (now < open || now >= close ? `${what} run ${clockLabel(open)}–${clockLabel(close)}.` : null);

  for (const l of lgasOf(here.state)) {
    if (l.id === from) continue;
    const road = TABLE ? lagosRoad(from, l.id) : null;
    if (!road) {
      // Outside the mapped city: the old flat fare and an hour and a quarter on the road.
      add({ mode: 'danfo', to: l.id, km: 0, minutes: 75, cost: Math.round(fare * 2), energy: -6, via: [], blocked: null, plain: true });
      continue;
    }
    const km = road.km;
    add({ mode: 'danfo', to: l.id, km, minutes: 12 + (km / (24 / rush)) * 60, cost: Math.round(fare * (0.8 + km / 7)), energy: -Math.round(4 + km / 6), via: road.via, blocked: null, plain: true });
    if (onLine(TABLE?.brt, from, l.id)) {
      add({ mode: 'brt', to: l.id, km, minutes: 10 + (km / (30 / (1 + (rush - 1) * 0.35))) * 60, cost: Math.round(fare * (0.7 + km / 12)), energy: -Math.round(3 + km / 10), via: road.via, blocked: hours(5.5 * 60, 22 * 60, 'BRT buses') });
    }
    if (onLine(TABLE?.rail, from, l.id)) {
      add({ mode: 'rail', to: l.id, km, minutes: 15 + (km / 40) * 60, cost: Math.round(fare * (0.9 + km / 14)), energy: -3, via: ['Red Line'], blocked: hours(6 * 60, 21 * 60, 'Trains') });
    }
    if (l.jetty && here.jetty) {
      const f = TABLE?.ferry[pair(from, l.id)];
      if (f) add({ mode: 'ferry', to: l.id, km: f.km, minutes: 20 + (f.km / 25) * 60, cost: Math.round(fare * (2 + f.km / 9)), energy: -4, via: ['Lagos Lagoon'], blocked: hours(6.5 * 60, 19.5 * 60, 'Ferries') });
    }
    const surge = 1 + 0.5 * (rush - 1);
    add({ mode: 'taxi', to: l.id, km, minutes: 6 + (km / (30 / rush)) * 60, cost: Math.round((1_200 + 420 * km) * P * surge), energy: -2, via: road.via, blocked: null });
  }

  for (const st of ['LA', 'KN', 'RI'] as const) {
    if (st === here.state) continue;
    const r = INTERSTATE[pair(here.state, st)];
    const fuel = (g.prices[here.state].petrol / g.ref.petrol[here.state]) ** 0.5;
    const capital = stateById(st).capitalLga;
    // Buses leave in the morning, early enough to arrive before the small hours.
    const latest = Math.min(9 * 60, LAST_DAY_MINUTE - r.bus - 60);
    add({
      mode: 'bus',
      to: capital,
      km: r.km,
      minutes: r.bus,
      cost: Math.round(r.busFare * Math.pow(P, 0.8) * fuel),
      energy: -20,
      via: r.via,
      blocked: now > latest ? `Long-distance buses to ${stateById(st).name} leave before ${clockLabel(latest)}.` : null,
      plain: true,
    });
    const port = airportOf(st);
    if (here.airport && port) {
      add({
        mode: 'flight',
        to: port.id,
        km: r.km,
        minutes: AIRPORT_MINUTES + r.air,
        cost: Math.round(r.airFare * Math.pow(P, 0.8) * fuel ** 0.8),
        energy: -10,
        via: [port.airport!],
        blocked: now < FLIGHTS[0] || now > FLIGHTS[1] ? `Flights leave between ${clockLabel(FLIGHTS[0])} and ${clockLabel(FLIGHTS[1])}.` : null,
      });
    }
  }
  return out;
}

export const tripById = (g: Game, id: string) => tripsFrom(g).find((t) => t.id === id);

/** The long-distance route between two states, with its towns in the order you pass them. */
export function interstate(from: StateId, to: StateId): { km: number; towns: string[] } | null {
  const r = INTERSTATE[pair(from, to)];
  if (!r) return null;
  const towns = r.ends[0] === from ? r.via : [...r.via].reverse();
  return { km: r.km, towns };
}

/** What the trip is called on a button. */
export function tripLabel(t: Trip): string {
  const l = lgaById(t.to);
  switch (t.mode) {
    case 'danfo':
      return `${l.state === 'LA' ? 'Danfo' : 'Bus'} to ${l.nick}`;
    case 'brt':
      return `BRT to ${l.nick}`;
    case 'rail':
      return `Red Line train to ${l.nick}`;
    case 'ferry':
      return `Ferry to ${l.nick}`;
    case 'taxi':
      return `Ride-hailing car to ${l.nick}`;
    case 'bus':
      return `Bus to ${stateById(l.state).name}`;
    case 'flight':
      return `Fly to ${stateById(l.state).name}`;
  }
}

/** A sentence about the way there. */
export function tripDetail(t: Trip): string {
  const l = lgaById(t.to);
  const roads = t.via.slice(0, 2).join(' and ');
  switch (t.mode) {
    case 'danfo':
      return t.km ? `${t.km} km via ${roads}. Conductor shouting “${l.nick.split(' ')[0]}! Enter with your change!”` : `${l.name}. ${l.landmark}.`;
    case 'brt':
      return `${t.km} km on the BRT lane along ${roads}. Tap your card; the bus skips most of the go-slow.`;
    case 'rail':
      return `${t.km} km on the Red Line. No traffic at all, if you can get to the station.`;
    case 'ferry':
      return `${t.km} km across the lagoon. Life jacket on, no go-slow.`;
    case 'taxi':
      return `${t.km} km via ${roads}, door to door with AC. The price surges with the traffic.`;
    case 'bus':
      return `${t.km.toLocaleString()} km to ${stateById(l.state).capital} via ${t.via.slice(0, 3).join(', ')}. Arrives at the motor park.`;
    case 'flight':
      return `To ${t.via[0]}. Check in an hour before; about ${Math.round((t.minutes - AIRPORT_MINUTES) / 5) * 5} minutes in the air.`;
  }
}
