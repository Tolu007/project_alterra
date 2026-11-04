import { useEffect, useMemo, useRef, useState } from 'react';
import { bizType } from '../data/businesses';
import { ROLE_NAMES } from '../data/people';
import { PLACES, tradeById, type PlaceId } from '../data/trades';
import { lgaById, stateById } from '../data/world';
import { businessOn, freeLots, isMobile, playerBusinesses, stageName, staffCap } from '../engine/business';
import { clockLabel, dateLabel, dayPart, isRainySeason } from '../engine/calendar';
import { officeTitle } from '../engine/elections';
import { HOURS, actionsAt, naira, placesIn, type DayAction } from '../engine/life';
import { COLS, MAIN_Z, PAVEMENT, ROAD_X, ROAD_Z, ROWS, SIDE_HALF, halfWidth, hood, type Pt } from '../engine/map';
import { advanceClock, doAction, goTo, hireTalent, payRide, peek, rideFare, routineWeek, talkTo } from '../engine/sim';
import { DAYS_PER_WEEK, PLAYER, type Game } from '../engine/types';
import { Portrait } from '../ui/Portrait';
import { World, type Float, type Selection, type WalkTarget } from '../world/World';
import { Phone, type AppId } from './Phone';

const ACTION_MS = 1500;
/** Game minutes per real second at each speed: paused, normal, fast, fastest. */
const SPEEDS = [0, 2, 6, 20];
const SPEED_LABELS = ['Pause', 'Normal speed', 'Fast', 'Fastest'];

/** "4h", "1h30", "45m". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m}m`;
}

interface Props {
  g: Game;
  setGame: (g: Game) => void;
  onQuit: () => void;
}

export function Game3D({ g, setGame, onQuit }: Props) {
  const [target, setTarget] = useState<WalkTarget | null>(null);
  const [menu, setMenu] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [span, setSpan] = useState<[number, number] | null>(null);
  const [floats, setFloats] = useState<Float[]>([]);
  const [talk, setTalk] = useState<{ id: number; line: string; note?: string } | null>(null);
  const [phone, setPhone] = useState<AppId | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [fade, setFade] = useState<string | null>(null);
  const [places, setPlaces] = useState(false);
  const [ride, setRide] = useState(false);
  const floatId = useRef(0);
  const track = useRef<Pt>([0, 0]);
  const timers = useRef<number[]>([]);
  // The clock runs in real time between actions; the game catches up every few game minutes.
  const clock = useRef(g.minute);
  const gRef = useRef(g);
  gRef.current = g;
  const busyRef = useRef(false);
  busyRef.current = busy;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const anim = useRef<{ from: number; to: number; t0: number; ms: number } | null>(null);
  const setGameRef = useRef(setGame);
  setGameRef.current = setGame;

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  useEffect(() => {
    if (!busyRef.current) clock.current = g.minute;
  }, [g.minute, g.day, g.week]);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // Slow machines draw fewer frames; the clock still keeps real time (up to a second per frame).
      const dt = Math.min(1, (now - last) / 1000);
      last = now;
      const a = anim.current;
      const gg = gRef.current;
      if (a) {
        // Fast-forward while an action plays out.
        const k = Math.min(1, (now - a.t0) / a.ms);
        clock.current = a.from + (a.to - a.from) * k;
      } else if (!busyRef.current && gg.phase === 'day') {
        clock.current += SPEEDS[speedRef.current] * dt;
        const step = Math.max(10, SPEEDS[speedRef.current] * 3);
        if (clock.current - gg.minute >= step) {
          const r = advanceClock(gg, Math.floor(clock.current - gg.minute));
          if (r.text) {
            setToast({ text: r.text, ok: false });
            setFade('You passed out…');
            window.setTimeout(() => setFade(null), 1400);
          }
          gRef.current = r.game;
          setGameRef.current(r.game);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    setMenu(null);
    setTalk(null);
  }, [g.player.at]);

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const addFloats = (items: Omit<Float, 'id'>[]) => {
    const made = items.map((f) => ({ ...f, id: ++floatId.current }));
    setFloats((fs) => [...fs, ...made].slice(-4));
    later(2200, () => setFloats((fs) => fs.filter((f) => !made.some((m) => m.id === f.id))));
  };

  const walk = (t: Omit<WalkTarget, 'nonce'>, byKeke = false) => {
    if (busy) return;
    setMenu(null);
    setTalk(null);
    setPlaces(false);
    if (byKeke && (t.place || t.point)) {
      const paid = payRide(g);
      if (!paid.ok) {
        setToast({ text: 'You cannot afford the fare. Walk it.', ok: false });
        return;
      }
      setGame(paid.game);
      setTarget({ ...t, ride: true, nonce: Date.now() });
      return;
    }
    setTarget({ ...t, nonce: Date.now() });
  };

  const arrive = (place: PlaceId, lot: number | null) => {
    setGame(goTo(g, place, lot));
    setMenu({ place, lot });
  };

  const run = (a: DayAction) => {
    if (busy) return;
    const r = doAction(g, a.id);
    if (!r.ok) {
      setToast({ text: r.text, ok: false });
      return;
    }
    const next = r.game;
    const endsDay = next.day !== g.day || next.week !== g.week || next.phase !== 'day';
    const dm = next.player.money - g.player.money;
    const fl: Omit<Float, 'id'>[] = [];
    if (Math.abs(dm) >= 500) fl.push({ text: `${dm > 0 ? '+' : '−'}${naira(Math.abs(dm))}`, tone: dm > 0 ? 'good' : 'bad' });
    const dh = next.player.hunger - g.player.hunger;
    if (dh > 10) fl.push({ text: `Food +${Math.round(dh)}`, tone: 'info' });
    const ds = next.player.social - g.player.social;
    if (ds > 8) fl.push({ text: `Social +${Math.round(ds)}`, tone: 'info' });
    setBusy(true);
    setMenu(null);
    const to = endsDay ? Math.max(g.minute + 30, Math.min(26 * 60, g.minute + a.minutes || 23 * 60)) : next.minute;
    const ms = a.id === 'sleep' ? 600 : ACTION_MS;
    anim.current = { from: g.minute, to, t0: performance.now(), ms };
    setSpan([g.minute, to]);
    if (fl.length) addFloats(fl);
    setToast({ text: r.text, ok: true });
    later(ms, () => {
      anim.current = null;
      setSpan(null);
      if (endsDay) {
        setFade(a.id === 'sleep' ? 'Lights out…' : 'Night falls…');
        later(1100, () => {
          clock.current = next.minute;
          setGame(next);
          setBusy(false);
          setFade(null);
        });
      } else {
        clock.current = next.minute;
        setGame(next);
        setBusy(false);
        setMenu(a.id.startsWith('travel:') ? { place: next.place, lot: null } : menu);
      }
    });
  };

  const chat = (id: number) => {
    if (busy) return;
    const r = talkTo(g, id);
    setGame(r.game);
    setMenu(null);
    setTalk({ id, line: r.line });
  };

  const hireThem = (bizId: number) => {
    if (!talk) return;
    const r = hireTalent(g, bizId, talk.id);
    setGame(r.game);
    setTalk({ ...talk, note: r.text });
  };

  const here = lgaById(g.player.at);
  const today = g.culture.filter((e) => e.week === g.week && e.day === g.day && (e.lga === here.id || e.lga === '*') && e.end > g.minute && !e.attended);
  const actions = menu ? actionsAt(peek(g, menu.place, menu.lot), menu.place) : [];
  const fare = rideFare(g);
  const mine = playerBusinesses(g).filter((b) => b.lga === here.id);
  const nearestFree = (() => {
    const free = freeLots(g, here.id).filter((id) => hood(here.id).plots[id].kind === 'street');
    const [px, pz] = track.current;
    return free.sort((a, b) => Math.hypot(hood(here.id).plots[a].x - px, hood(here.id).plots[a].z - pz) - Math.hypot(hood(here.id).plots[b].x - px, hood(here.id).plots[b].z - pz))[0];
  })();

  return (
    <div className={`g3d${menu && !busy ? ' menu-open' : ''}`}>
      <div className="g3d-canvas">
        <World g={g} clock={clock} busy={busy} target={target} selected={menu} floats={floats} onWalk={(w) => walk(w)} onArrive={arrive} onTalk={chat} track={track} />
      </div>

      <Clock g={g} clock={clock} speed={speed} setSpeed={setSpeed} onQuit={onQuit} />
      <Wallet g={g} />
      <Minimap g={g} track={track} selected={menu} onWalk={(w) => walk(w, ride)} />
      <Needs g={g} />

      <div className="hud-br">
        <button className="round-btn" onClick={() => setPlaces((v) => !v)} aria-expanded={places} title="Places on this street">
          🗺️<span>Places</span>
        </button>
        <button className="round-btn" onClick={() => walk({ place: 'home' }, ride)} title={ride ? 'Ride home' : 'Walk home'}>
          🏠<span>Home</span>
        </button>
        <button className="round-btn phone-btn" onClick={() => setPhone('home')} title="Open your phone">
          📱<span>Phone</span>
          {g.news.filter((n) => n.week === g.week - 1).length > 0 && <i className="badge">{g.news.filter((n) => n.week === g.week - 1).length}</i>}
        </button>
      </div>

      {places && (
        <div className="places-pop" role="menu">
          <div className="kicker">{here.nick} · tap a place to {ride ? 'ride' : 'walk'} there</div>
          {today.length > 0 && (
            <div className="places-list">
              {today.map((e) => (
                <button key={e.id} className="chip chip-event" onClick={() => walk({ place: e.place }, ride)} title={e.star}>
                  🎟️ {clockLabel(e.start)} {e.title}
                </button>
              ))}
            </div>
          )}
          <div className="ride-toggle" role="radiogroup" aria-label="How to get there">
            <button role="radio" aria-checked={!ride} className={!ride ? 'on' : ''} onClick={() => setRide(false)}>
              🚶 Walk · free
            </button>
            <button role="radio" aria-checked={ride} className={ride ? 'on' : ''} onClick={() => setRide(true)}>
              {fare.kind === 'okada' ? '🏍️ Okada' : '🛺 Keke'} · {naira(fare.fare)}
            </button>
          </div>
          {mine.length > 0 && (
            <div className="places-list">
              {mine.map((b) => (
                <button key={b.id} className="chip chip-own" onClick={() => walk(isMobile(b.type) ? { place: 'park' } : { place: 'lot', lot: b.plot }, ride)}>
                  🏪 {b.name}
                </button>
              ))}
            </div>
          )}
          <div className="places-list">
            {placesIn(here.id).map((p) => (
              <button key={p} className="chip" onClick={() => walk({ place: p }, ride)}>
                {PLACES[p].name}
              </button>
            ))}
            {nearestFree !== undefined && (
              <button className="chip chip-lot" onClick={() => walk({ place: 'lot', lot: nearestFree }, ride)}>
                Nearest free plot
              </button>
            )}
          </div>
          <button className="btn btn-small" onClick={() => setGame(routineWeek(g))} title="Work, eat and sleep on routine until Sunday">
            ⏩ Routine for the rest of the week
          </button>
        </div>
      )}

      {menu && !busy && <ActionMenu g={g} sel={menu} actions={actions} onRun={run} onClose={() => setMenu(null)} />}
      {talk && <TalkCard g={g} talk={talk} onClose={() => setTalk(null)} onHire={hireThem} />}
      {toast && !menu && !talk && <Toast toast={toast} onDone={() => setToast(null)} />}
      {busy && !fade && span && (
        <div className="busy-pill">
          ⏳ {clockLabel(span[0])} → {clockLabel(span[1])}
        </div>
      )}
      {fade && <div className="night-fade">{fade}</div>}
      {phone && <Phone g={g} app={phone} setApp={setPhone} onClose={() => setPhone(null)} onWalk={(p) => { setPhone(null); walk({ place: p }, ride); }} />}
      {isRainySeason(g.week) && <div className="weather-chip">🌧️ Rainy season</div>}
    </div>
  );
}

function Clock({ g, clock, speed, setSpeed, onQuit }: { g: Game; clock: React.MutableRefObject<number>; speed: number; setSpeed: (s: number) => void; onQuit: () => void }) {
  // The clock face reads the running clock a few times a second without re-rendering the world.
  const [minute, setMinute] = useState(clock.current);
  useEffect(() => {
    const t = window.setInterval(() => setMinute(clock.current), 250);
    return () => window.clearInterval(t);
  }, [clock]);
  const part = dayPart(minute);
  const icon = { morning: '🌅', afternoon: '☀️', evening: '🌇', night: '🌙' }[part];
  const here = lgaById(g.player.at);
  return (
    <div className="hud-tl">
      <button className="hud-logo" onClick={onQuit} title="Back to the title screen">
        Naija Hustle
      </button>
      <div className="clock">
        <div className="clock-main">
          <span className="clock-icon">{icon}</span>
          <div>
            <b>
              {dateLabel(g.week, g.day).split(' · ')[0]} <span className="clock-time">{clockLabel(minute)}</span>
            </b>
            <div className="kicker">{dateLabel(g.week, g.day).split(' · ')[1]}</div>
          </div>
        </div>
        <div className="pips">
          {Array.from({ length: DAYS_PER_WEEK }, (_, i) => (
            <i key={i} className={i < g.day ? 'done' : i === g.day ? 'now' : ''} />
          ))}
        </div>
        <div className="speed" role="radiogroup" aria-label="Game speed">
          {SPEEDS.map((_, i) => (
            <button key={i} role="radio" aria-checked={speed === i} className={speed === i ? 'on' : ''} onClick={() => setSpeed(i)} title={SPEED_LABELS[i]} aria-label={SPEED_LABELS[i]}>
              {i === 0 ? '⏸' : '▶'.repeat(i)}
            </button>
          ))}
        </div>
        <div className="kicker" style={{ marginTop: 3 }}>
          📍 {here.nick}, {stateById(here.state).name}
        </div>
      </div>
    </div>
  );
}

function Wallet({ g }: { g: Game }) {
  const p = g.player;
  const biz = playerBusinesses(g);
  const staff = biz.reduce((s, b) => s + b.staff.length, 0);
  return (
    <div className="hud-tr">
      <div className="wallet">
        <span className="wallet-main">{naira(p.money)}</span>
        {p.usd >= 1 && <span className="wallet-sub">${Math.round(p.usd).toLocaleString()}</span>}
      </div>
      <div className="role-chip">
        {p.office ? `🏛️ ${officeTitle(p.office)}` : biz.length ? `🏪 ${biz.length} business${biz.length > 1 ? 'es' : ''}${staff ? ` · ${staff} staff` : ''}` : `💼 ${tradeById(p.trade).name.split(' (')[0]}`}
      </div>
    </div>
  );
}

function Needs({ g }: { g: Game }) {
  const p = g.player;
  const me = g.people[PLAYER];
  const bars: [string, string, number, string][] = [
    ['⚡', 'Energy', p.energy, '#f2b705'],
    ['🍲', 'Food', p.hunger, '#e0782a'],
    ['💬', 'Social', p.social, '#7b3fa0'],
    ['❤️', 'Health', p.health, '#1e8f5a'],
    ['😊', 'Mood', p.happiness, '#2f63ad'],
  ];
  return (
    <div className="hud-bl">
      <Portrait looks={me.looks} gender={me.gender} size={54} />
      <div className="needs">
        {bars.map(([icon, label, v, c]) => (
          <div key={label} className={`need${v < 25 ? ' low' : ''}`} title={`${label}: ${Math.round(v)}`}>
            <span className="need-icon" aria-hidden="true">
              {icon}
            </span>
            <span className="need-label">{label}</span>
            <span className="need-bar">
              <i style={{ width: `${v}%`, background: v < 25 ? '#d23c22' : c }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionMenu({ g, sel, actions, onRun, onClose }: { g: Game; sel: Selection; actions: DayAction[]; onRun: (a: DayAction) => void; onClose: () => void }) {
  const [open, close] = HOURS[sel.place];
  const sorted = useMemo(() => actions.slice().sort((a, b) => Number(!!a.blocked) - Number(!!b.blocked)), [actions]);
  const biz = sel.place === 'lot' && sel.lot !== null ? businessOn(g, g.player.at, sel.lot) : undefined;
  const farm = sel.place === 'lot' && sel.lot !== null && hood(g.player.at).plots[sel.lot]?.kind === 'farm';
  const title = sel.place === 'lot' ? (biz ? biz.name : farm ? 'Farmland for lease' : 'Plot for lease') : sel.place === 'home' ? 'Home' : PLACES[sel.place].name;
  const sub = biz ? `${bizType(biz.type).name} · ${stageName(biz.type, biz.level).replace(/^an? /, '')} · level ${biz.level}` : sel.place === 'lot' ? 'Lease it and build. Shacks grow into big buildings as you expand.' : null;
  return (
    <div className="action-menu" role="dialog" aria-label={`${title} actions`}>
      <div className="am-head">
        <div>
          <div className="am-title">{title}</div>
          {sub && <div className="am-sub">{sub}</div>}
          <div className="kicker">
            {clockLabel(g.minute)} · {sel.place === 'home' || sel.place === 'clinic' ? 'Open all hours' : `Open ${clockLabel(open * 60)}–${clockLabel(close * 60)}`}
          </div>
        </div>
        <button className="x-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="am-list">
        {sorted.map((a) => (
          <button key={a.id} className="am-item" data-tone={a.tone} disabled={!!a.blocked} onClick={() => onRun(a)}>
            <span className="am-label">{a.label}</span>
            <span className="am-meta">
              {a.cost ? <b>{naira(a.cost)}</b> : null}
              {a.minutes > 0 && <span>⏱ {duration(a.minutes)}</span>}
              {a.energy !== 0 && <span>{a.energy > 0 ? `+${a.energy}` : a.energy}⚡</span>}
            </span>
            <span className="am-detail">{a.blocked ?? a.detail}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TalkCard({ g, talk, onClose, onHire }: { g: Game; talk: { id: number; line: string; note?: string }; onClose: () => void; onHire: (bizId: number) => void }) {
  const who = g.people[talk.id];
  const openings = playerBusinesses(g).filter((b) => b.lga === g.player.at && b.staff.length < staffCap(b));
  const canHire = who.employer === null && !who.office && who.role !== 'politician' && who.role !== 'godfather' && openings.length > 0;
  const role = who.office ? officeTitle(who.office) : who.employer !== null ? 'Works for you' : (ROLE_NAMES[who.role] ?? '') + ' · ' + tradeById(who.trade).name.split(' (')[0];
  return (
    <div className="talk-card" role="dialog" aria-label={`Talking to ${who.name}`}>
      <Portrait looks={who.looks} gender={who.gender} size={64} />
      <div style={{ minWidth: 0 }}>
        <div className="am-title" style={{ fontSize: 18 }}>
          {who.name}
        </div>
        <div className="kicker">{role}</div>
        <p className="bubble">“{talk.line}”</p>
        {talk.note && <p className="note">{talk.note}</p>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="kicker">Relationship {Math.round(who.relation)}</span>
          {canHire &&
            openings.slice(0, 2).map((b) => (
              <button key={b.id} className="btn btn-small btn-danfo" onClick={() => onHire(b.id)}>
                Hire for {bizType(b.type).name.toLowerCase()}
              </button>
            ))}
          <button className="btn btn-small" onClick={onClose}>
            Bye
          </button>
        </div>
      </div>
    </div>
  );
}

function Toast({ toast, onDone }: { toast: { text: string; ok: boolean }; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 4200);
    return () => window.clearTimeout(t);
  }, [toast, onDone]);
  return (
    <div className={`toast3d${toast.ok ? '' : ' bad'}`} role="status">
      {toast.text}
    </div>
  );
}

/** A map of the neighbourhood: roads, places and plots, with you on it. Tap a place to go there. */
function Minimap({ g, track, selected, onWalk }: { g: Game; track: React.MutableRefObject<Pt>; selected: Selection | null; onWalk: (t: Omit<WalkTarget, 'nonce'>) => void }) {
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 700);
  const dot = useRef<SVGCircleElement>(null);
  const lga = g.player.at;
  const h = hood(lga);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const [x, z] = track.current;
      dot.current?.setAttribute('cx', x.toFixed(1));
      dot.current?.setAttribute('cy', z.toFixed(1));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [track, open]);
  const minZ = h.farmland ? ROWS[0] - 40 : ROAD_Z[0];
  const view = `${ROAD_X[0]} ${minZ} ${ROAD_X[1] - ROAD_X[0]} ${ROAD_Z[1] - minZ}`;
  const placeOf = new Map<number, PlaceId>((Object.entries(h.place) as [PlaceId, number][]).map(([p, id]) => [id, p]));
  if (!open) {
    return (
      <button className="minimap-toggle" onClick={() => setOpen(true)} title="Show the map">
        🗺️ Map
      </button>
    );
  }
  return (
    <div className="minimap">
      <svg viewBox={view} role="img" aria-label={`Map of ${lgaById(lga).nick}`}>
        <rect x={ROAD_X[0]} y={minZ} width={ROAD_X[1] - ROAD_X[0]} height={ROAD_Z[1] - minZ} fill="#d9caa6" />
        {ROWS.map((z) => (
          <rect key={`r${z}`} x={ROAD_X[0]} y={z - halfWidth(z) - PAVEMENT} width={ROAD_X[1] - ROAD_X[0]} height={(halfWidth(z) + PAVEMENT) * 2} fill={z === MAIN_Z ? '#3d3b38' : '#6d6a64'} />
        ))}
        {COLS.map((x) => (
          <rect key={`c${x}`} x={x - SIDE_HALF - PAVEMENT} y={ROAD_Z[0]} width={(SIDE_HALF + PAVEMENT) * 2} height={ROAD_Z[1] - ROAD_Z[0]} fill="#6d6a64" />
        ))}
        {h.plots.map((p) => {
          const across = p.face === 'n' || p.face === 's';
          const w = across ? p.w : p.d;
          const d = across ? p.d : p.w;
          const place = placeOf.get(p.id);
          const lot = h.lots.includes(p.id);
          const b = lot ? businessOn(g, lga, p.id) : undefined;
          const sel = selected && ((selected.place === 'lot' && selected.lot === p.id) || (place && selected.place === place));
          const fill = b ? '#f2b705' : place ? '#fffaf0' : lot ? 'none' : '#bfb39a';
          const go = place ? () => onWalk({ place }) : lot ? () => onWalk({ place: 'lot', lot: p.id }) : undefined;
          return (
            <rect
              key={p.id}
              x={p.x - w / 2}
              y={p.z - d / 2}
              width={w}
              height={d}
              rx={1.5}
              fill={fill}
              stroke={sel ? '#d23c22' : lot && !b ? '#f2b705' : '#1f1d1a'}
              strokeWidth={sel ? 2.5 : lot && !b ? 1.4 : 0.6}
              strokeDasharray={lot && !b ? '3 2' : undefined}
              className={go ? 'mm-hit' : undefined}
              onClick={go}
            >
              <title>{b ? b.name : place ? (place === 'home' ? 'Home' : PLACES[place].name) : lot ? 'Plot for lease' : ''}</title>
            </rect>
          );
        })}
        <rect x={h.busStop[0] - 4} y={h.busStop[1] - 2} width={8} height={4} fill="#2f63ad" className="mm-hit" onClick={() => onWalk({ place: 'busstop' })}>
          <title>Bus stop</title>
        </rect>
        <circle ref={dot} r={4.5} fill="#d23c22" stroke="#fffaf0" strokeWidth={1.5} />
      </svg>
      <button className="minimap-x" onClick={() => setOpen(false)} aria-label="Hide the map">
        ✕
      </button>
    </div>
  );
}
