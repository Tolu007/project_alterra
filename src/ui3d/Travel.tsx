import { useEffect, useRef, useState } from 'react';
import { NIGERIA, NIGERIA_CITIES, NIGERIA_H, NIGERIA_W } from '../data/geo';
import { PLACES, type PlaceId } from '../data/trades';
import { lgaById, lgasOf, stateById, type StateId } from '../data/world';
import { duration } from '../engine/calendar';
import { naira } from '../engine/life';
import { hood } from '../engine/map';
import { MODES, airportOf, interstate, parseTrip, rushFactor, tripLabel, tripsFrom, type Trip } from '../engine/travel';
import type { Game } from '../engine/types';
import { pairs, useOverview, type CityOverview } from '../world/cityData';
import { TripRide } from './TripRide';

const CAPITAL_CITY: Record<StateId, string> = { LA: 'Lagos', KN: 'Kano', RI: 'Port Harcourt' };
const flatPts = (flat: number[]) => pairs(flat).map(([x, z]) => `${x},${z}`).join(' ');
const pairKey = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Where a trip leaves from, in words. */
function boardName(g: Game, t: Trip): string {
  if (!t.board) return 'Book it from wherever you are';
  const here = lgaById(g.player.at);
  const h = hood(here.id);
  if (t.board === 'busstop') return `From ${h.real?.stopName ?? here.nick} bus stop`;
  if (t.board === 'jetty') return `From ${here.jetty ?? 'the jetty'}`;
  if (t.board === 'airport') return `From ${here.airport ?? 'the airport'}`;
  const park = h.place.park !== undefined ? h.plots[h.place.park].real : undefined;
  return `From ${park ?? 'the motor park'}`;
}

/** The route of a trip in Lagos, in overview kilometres: road, ferry or a straight rail line. */
function lagosPath(o: CityOverview, from: string, to: string, mode: Trip['mode']): [number, number][] {
  if (mode === 'ferry') {
    const f = o.ferries[pairKey(from, to)];
    if (f) {
      const p = pairs(f.p);
      return from < to ? p : p.reverse();
    }
  }
  if (mode !== 'rail') {
    const r = o.routes[pairKey(from, to)];
    if (r) {
      const p = pairs(r.p);
      return from < to ? p : p.reverse();
    }
  }
  return [o.hubs[from], o.hubs[to]].filter(Boolean);
}

/** The interstate route through its towns, or a flight from airport to airport, on the Nigeria map. */
function nigeriaPath(from: StateId, to: StateId, mode: Trip['mode']): [number, number][] {
  if (mode === 'flight') {
    const a = NIGERIA_CITIES[`airport:${from}`];
    const b = NIGERIA_CITIES[`airport:${to}`];
    // A gentle arc, like the flight path on a booking screen.
    const mid: [number, number] = [(a[0] + b[0]) / 2 - (b[1] - a[1]) * 0.15, (a[1] + b[1]) / 2 + (b[0] - a[0]) * 0.15];
    return Array.from({ length: 21 }, (_, i) => {
      const t = i / 20;
      return [(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * mid[0] + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * mid[1] + t * t * b[1]];
    });
  }
  const r = interstate(from, to);
  return [CAPITAL_CITY[from], ...(r?.towns ?? []), CAPITAL_CITY[to]].map((c) => NIGERIA_CITIES[c]).filter(Boolean);
}

function LagosMap({ o, from, to, path, onPick, progress }: { o: CityOverview; from: string; to: string | null; path?: [number, number][]; onPick?: (id: string) => void; progress?: number }) {
  return (
    <svg viewBox={`0 0 ${o.size[0]} ${o.size[1]}`} className="travel-map" role="img" aria-label="Map of Lagos">
      <rect width={o.size[0]} height={o.size[1]} fill="#efe6d2" />
      {o.water.map((w, i) => (
        <polygon key={i} points={flatPts(w)} fill="#9fcbe0" />
      ))}
      {o.land.map((w, i) => (
        <polygon key={`l${i}`} points={flatPts(w)} fill="#efe6d2" />
      ))}
      {o.roads.map((r, i) => (
        <polyline key={i} points={flatPts(r.p)} fill="none" stroke={r.c === 'motorway' ? '#c2552d' : r.c === 'trunk' ? '#d98b48' : '#b7ab95'} strokeWidth={r.c === 'motorway' ? 0.16 : r.c === 'trunk' ? 0.12 : 0.07} strokeLinecap="round" />
      ))}
      {path && path.length > 1 && <TripLine pts={path} width={0.32} progress={progress} />}
      {Object.entries(o.hubs).map(([id, [x, y]]) => {
        const l = lgaById(id);
        const mine = id === from;
        return (
          <g key={id} className={onPick ? 'mm-hit' : undefined} onClick={onPick && !mine ? () => onPick(id) : undefined}>
            <circle cx={x} cy={y} r={1.6} className="hit-pad" />
            <circle cx={x} cy={y} r={mine ? 0.55 : 0.42} fill={mine ? '#d23c22' : id === to ? '#f2b705' : '#1f1d1a'} stroke="#fffaf0" strokeWidth={0.14} />
            <text x={x} y={y - 0.75} textAnchor="middle" className="travel-label" fontSize={0.95}>
              {l.nick}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function NigeriaMap({ from, to, path, onPick, progress }: { from: StateId; to: StateId | null; path?: [number, number][]; onPick?: (st: StateId) => void; progress?: number }) {
  return (
    <svg viewBox={`0 0 ${NIGERIA_W} ${NIGERIA_H}`} className="travel-map" role="img" aria-label="Map of Nigeria">
      {Object.entries(NIGERIA).map(([id, s]) => {
        const playable = id === 'LA' || id === 'KN' || id === 'RI';
        const st = playable ? stateById(id as StateId) : null;
        return (
          <path
            key={id}
            d={s.d}
            fill={st ? (id === from ? st.colour : id === to ? '#f2d06b' : '#e9dfc8') : '#f4eee0'}
            stroke="#b9ad94"
            strokeWidth={1}
            className={st && onPick && id !== from ? 'mm-hit' : undefined}
            onClick={st && onPick && id !== from ? () => onPick(id as StateId) : undefined}
          />
        );
      })}
      {path && path.length > 1 && <TripLine pts={path} width={7} progress={progress} />}
      {(['LA', 'KN', 'RI'] as const).map((st) => {
        const [x, y] = NIGERIA_CITIES[CAPITAL_CITY[st]];
        return (
          <g key={st} className={onPick && st !== from ? 'mm-hit' : undefined} onClick={onPick && st !== from ? () => onPick(st) : undefined}>
            <circle cx={x} cy={y} r={34} className="hit-pad" />
            <circle cx={x} cy={y} r={10} fill={st === from ? '#d23c22' : '#1f1d1a'} stroke="#fffaf0" strokeWidth={3} />
            <text x={x + (st === 'LA' ? 16 : 0)} y={y - 16} textAnchor={st === 'LA' ? 'start' : 'middle'} className="travel-label" fontSize={26}>
              {CAPITAL_CITY[st]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** A route line, drawn as far as `progress` (0–1) with a dot travelling at its head. */
function TripLine({ pts, width, progress }: { pts: [number, number][]; width: number; progress?: number }) {
  const line = useRef<SVGPolylineElement>(null);
  const head = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const el = line.current;
    if (!el || progress === undefined) return;
    const len = el.getTotalLength();
    el.style.strokeDasharray = `${len}`;
    el.style.strokeDashoffset = `${len * (1 - progress)}`;
    const p = el.getPointAtLength(len * progress);
    head.current?.setAttribute('cx', String(p.x));
    head.current?.setAttribute('cy', String(p.y));
  }, [progress, pts]);
  const d = pts.map(([x, y]) => `${x},${y}`).join(' ');
  return (
    <g>
      <polyline points={d} fill="none" stroke="#1f1d1a" strokeOpacity={0.25} strokeWidth={width * 1.6} strokeLinecap="round" strokeLinejoin="round" />
      <polyline ref={line} points={d} fill="none" stroke="#f2b705" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
      {progress !== undefined && <circle ref={head} r={width * 1.6} fill="#d23c22" stroke="#fffaf0" strokeWidth={width * 0.5} />}
    </g>
  );
}

function TripRow({ g, t, onWalk, onBook }: { g: Game; t: Trip; onWalk: (p: PlaceId) => void; onBook: (id: string) => void }) {
  const ready = !t.board || g.place === t.board;
  const short = g.player.money < t.cost;
  return (
    <div className="trip-row">
      <span className="trip-icon" aria-hidden="true">
        {MODES[t.mode].icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <b>{tripLabel(t)}</b>
        <div className="kicker">
          ⏱ {duration(t.minutes)} · {naira(t.cost)}
          {t.km ? ` · ${t.km.toLocaleString()} km` : ''}
        </div>
        <div className="muted trip-where">{t.blocked ?? (short ? 'Not enough money.' : t.via.length && t.mode !== 'flight' ? `${boardName(g, t)}. Via ${t.via.slice(0, 3).join(', ')}.` : `${boardName(g, t)}.`)}</div>
      </div>
      {ready ? (
        <button className="btn btn-small btn-danfo" disabled={!!t.blocked || short} onClick={() => onBook(t.id)}>
          {t.board ? 'Go' : 'Book'}
        </button>
      ) : (
        <button className="btn btn-small" onClick={() => onWalk(t.board!)}>
          Walk there
        </button>
      )}
    </div>
  );
}

/** The phone's travel app: real routes across Lagos, and the buses and flights to Kano and Port Harcourt. */
export function TravelApp({ g, onWalk, onBook }: { g: Game; onWalk: (p: PlaceId) => void; onBook: (id: string) => void }) {
  const here = lgaById(g.player.at);
  const o = useOverview();
  const [tab, setTab] = useState<'state' | 'nigeria'>('state');
  const [to, setTo] = useState<string | null>(null);
  const [toState, setToState] = useState<StateId | null>(null);
  const trips = tripsFrom(g);
  const lagos = here.state === 'LA';
  const cityTrips = to ? trips.filter((t) => t.to === to && lgaById(t.to).state === here.state) : [];
  const farTrips = toState ? trips.filter((t) => lgaById(t.to).state === toState) : [];
  const picked = cityTrips.find((t) => t.mode === 'danfo') ?? cityTrips[0];
  const port = airportOf(here.state);
  return (
    <div className="travel-app">
      <div className="ride-toggle" role="tablist">
        <button role="tab" aria-selected={tab === 'state'} className={tab === 'state' ? 'on' : ''} onClick={() => setTab('state')}>
          {stateById(here.state).name}
        </button>
        <button role="tab" aria-selected={tab === 'nigeria'} className={tab === 'nigeria' ? 'on' : ''} onClick={() => setTab('nigeria')}>
          Nigeria
        </button>
      </div>
      {tab === 'state' && (
        <>
          {lagos && o ? (
            <LagosMap o={o} from={here.id} to={to} path={to && picked ? lagosPath(o, here.id, to, picked.mode) : undefined} onPick={setTo} />
          ) : (
            <div className="places-list">
              {lgasOf(here.state)
                .filter((l) => l.id !== here.id)
                .map((l) => (
                  <button key={l.id} className={`chip${to === l.id ? ' chip-own' : ''}`} onClick={() => setTo(l.id)}>
                    {l.nick}
                  </button>
                ))}
            </div>
          )}
          {!to && <p className="muted" style={{ margin: 0 }}>Tap a district to see how to get there.</p>}
          {to && (
            <div style={{ display: 'grid', gap: 6 }}>
              <div className="kicker">
                {here.nick} → {lgaById(to).nick}
              </div>
              {cityTrips.map((t) => (
                <TripRow key={t.id} g={g} t={t} onWalk={onWalk} onBook={onBook} />
              ))}
            </div>
          )}
          {lagos && <p className="map-note">Roads and routes © OpenStreetMap contributors.</p>}
        </>
      )}
      {tab === 'nigeria' && (
        <>
          <NigeriaMap from={here.state} to={toState} path={toState ? nigeriaPath(here.state, toState, farTrips.some((t) => t.mode === 'flight') ? 'flight' : 'bus') : undefined} onPick={setToState} />
          {!toState && <p className="muted" style={{ margin: 0 }}>Tap Kano, Lagos or Port Harcourt.</p>}
          {toState && (
            <div style={{ display: 'grid', gap: 6 }}>
              <div className="kicker">
                {stateById(here.state).name} → {stateById(toState).name} · {interstate(here.state, toState)?.km.toLocaleString()} km by road
              </div>
              {farTrips.map((t) => (
                <TripRow key={t.id} g={g} t={t} onWalk={onWalk} onBook={onBook} />
              ))}
              {!here.airport && port && (
                <div className="trip-row">
                  <span className="trip-icon" aria-hidden="true">
                    ✈️
                  </span>
                  <div>
                    <b>Fly from {port.airport}</b>
                    <div className="muted trip-where">
                      The airport is in {port.nick}. Get there by {lgaById(port.id).state === 'LA' ? 'danfo' : 'bus'} from the bus stop, then fly.
                    </div>
                  </div>
                  <button className="btn btn-small" onClick={() => onWalk('busstop')}>
                    Bus stop
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** What is shown while you travel: the route on the map with you moving along it. */
export interface TripShow {
  id: string;
  from: string;
  /** Real time it started, and how long to show it. */
  t0: number;
  ms: number;
  minutes: number;
  /** Minutes after midnight when you set off, for the light and the traffic on the way. */
  minute: number;
}

export function TripOverlay({ trip, onClose }: { trip: TripShow; onClose: () => void }) {
  const o = useOverview();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const p = parseTrip(trip.id, trip.from);
  if (!p) return null;
  const a = lgaById(trip.from);
  const b = lgaById(p.to);
  const progress = Math.min(1, (now - trip.t0) / trip.ms);
  const inLagos = a.state === 'LA' && b.state === 'LA';
  const road = p.mode === 'danfo' || p.mode === 'brt' || p.mode === 'taxi' ? (o?.routes[pairKey(a.id, b.id)]?.via ?? []) : [];
  const title = `${MODES[p.mode].icon} ${MODES[p.mode].name} to ${a.state === b.state ? b.nick : stateById(b.state).name}`;
  // What the signs over the road say on the way: the roads you take, or the towns you pass.
  const signs = road.length ? road.slice(0, 4) : p.mode === 'bus' ? (interstate(a.state, b.state)?.towns ?? []) : [];
  const sub = p.mode === 'flight' ? `${a.airport} → ${b.airport}` : p.mode === 'bus' ? `Via ${interstate(a.state, b.state)?.towns.join(', ')}` : road.length ? `Via ${road.slice(0, 3).join(', ')}` : p.mode === 'ferry' ? 'Across the lagoon' : p.mode === 'rail' ? 'On the Red Line' : '';
  return (
    <div className="trip-overlay" role="status" onClick={onClose}>
      <div className="trip-card" onClick={(e) => e.stopPropagation()}>
        <div className="am-title">{title}</div>
        <div className="kicker">
          {sub} · {duration(trip.minutes)}
        </div>
        <TripRide mode={p.mode} via={signs} progress={progress} hour={(trip.minute / 60) % 24} rush={a.state === 'LA' ? rushFactor(trip.minute) : 1} />
        {inLagos ? o && <LagosMap o={o} from={a.id} to={b.id} path={lagosPath(o, a.id, b.id, p.mode)} progress={progress} /> : <NigeriaMap from={a.state} to={b.state} path={nigeriaPath(a.state, b.state, p.mode)} progress={progress} />}
        <div className="trip-foot">
          <span className="muted">
            {progress >= 1
              ? `Arrived: ${PLACES[MODES[p.mode].arrive].name.toLowerCase()} in ${b.nick}`
              : signs.length && progress > 0.12
                ? `On ${signs[Math.min(signs.length - 1, Math.floor(progress * signs.length))]}…`
                : `Leaving ${a.nick}…`}
          </span>
          <button className="btn btn-small" onClick={onClose}>
            {progress < 1 ? 'Skip the ride' : p.mode === 'flight' ? 'Get off' : 'Get down'}
          </button>
        </div>
      </div>
    </div>
  );
}
