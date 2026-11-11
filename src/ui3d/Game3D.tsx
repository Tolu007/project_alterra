import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { bizType } from '../data/businesses';
import { ROLE_NAMES } from '../data/people';
import { PLACES, tradeById, type PlaceId } from '../data/trades';
import { lgaById, stateById } from '../data/world';
import { businessOn, freeLots, isMobile, playerBusinesses, stageName, staffCap } from '../engine/business';
import { clockLabel, dateLabel, dayPart, duration, isRainySeason } from '../engine/calendar';
import { officeTitle } from '../engine/elections';
import { standing } from '../engine/property';
import { HOURS, actionsAt, naira, placesIn, rideHailActions, type DayAction } from '../engine/life';
import { COLS, MAIN_Z, PAVEMENT, ROAD_X, ROAD_Z, ROWS, SIDE_HALF, halfWidth, hood, type Pt } from '../engine/map';
import { activeShocks } from '../engine/shocks';
import { courtBlocked, datingOf, weddingCost } from '../engine/family';
import { advanceClock, courtPerson, doAction, goTo, hireTalent, payRide, peek, rideFare, routineWeek, talkTo } from '../engine/sim';
import { DAYS_PER_WEEK, type Game } from '../engine/types';
import type { Intent } from '../engine/world';
import { WeekReport } from '../ui/Modals';
import { Portrait } from '../ui/Portrait';
import { trafficAt } from '../world/City';
import { World, type Float, type Selection, type WalkTarget } from '../world/World';
import { CityMinimap } from './CityMap';
import { Guide, useGuide } from './Guide';
import { Phone, type AppId } from './Phone';
import { SocialPanel, unreadSocial, type SocialTab } from './Social';
import { sound } from './sound';
import { TripOverlay, type TripShow } from './Travel';

const ACTION_MS = 1500;
/** Game minutes per real second at each speed: paused, normal, fast, fastest. */
const SPEEDS = [0, 2, 6, 20];
const SPEED_LABELS = ['Pause', 'Normal speed', 'Fast', 'Fastest'];

/** Online play: the server owns the world and its clock; the screen sends requests and shows the answers. */
export interface Online {
  send(intent: Intent): Promise<{ ok: boolean; text: string } | null>;
  /** Real time of the last update, how far the world had run past its last step then, and its speed. */
  serverNow: number;
  lag: number;
  rate: number;
  count: number;
}

interface Props {
  g: Game;
  setGame: (g: Game) => void;
  onQuit: () => void;
  online?: Online;
}

/** The shared world's clock as this screen sees it: minutes after midnight, continuing past the last update. */
const liveMinute = (g: Game, o: Online) => g.minute + o.lag + ((Date.now() - o.serverNow) / 60_000) * o.rate;
const liveAbs = (g: Game, o: Online) => (g.week * DAYS_PER_WEEK + g.day) * 1440 + liveMinute(g, o);

export function Game3D({ g, setGame, onQuit, online }: Props) {
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
  const [trip, setTrip] = useState<TripShow | null>(null);
  const floatId = useRef(0);
  const track = useRef<Pt>([0, 0]);
  const trail = useRef<Pt[]>([]);
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
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const [paperOpen, setPaperOpen] = useState(false);
  // Other players: the chat and deals panel, which tab is showing and whose conversation is open.
  const [social, setSocial] = useState<SocialTab | null>(null);
  const [peer, setPeer] = useState<number | null>(null);
  const unread = online ? unreadSocial(g) : 0;
  const heard = useRef(unread);
  useEffect(() => {
    if (unread > heard.current && !social) sound.play('talk');
    heard.current = unread;
  }, [unread, social]);
  // The getting-started list, for lives that have only just begun.
  const guide = useGuide(`nh-guide:${g.seed}:${g.me}`, g.week === 0 && g.day <= 1, hood(g.player.at).real ? [] : ['map']);
  /** Ticks off what an action taught you. */
  const learn = (a: DayAction, hungerUp: number) => {
    if (a.id === 'work' || a.id === 'oddjobs' || /\b(work|shift|sell|drive|ride|farm)\b/i.test(a.label)) guide.mark('work');
    if (hungerUp > 10 || a.id === 'eat' || a.id === 'cook') guide.mark('eat');
  };
  // Online, your character may be busy (or asleep) for a while; the screen counts it down.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!online) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [online]);
  // Online nothing waits. Your character only sleeps while you are away, and wakes when you are back.
  const asleepUntil = online && g.asleep && g.busyUntil > liveAbs(g, online) ? g.busyUntil : null;

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  // Sound starts with your first tap or key, and follows the hour, the traffic, the rain and the light.
  useEffect(() => {
    const wake = () => sound.wake();
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      void sound.set({ hour: 12, rainy: false, busy: 0, grid: 24, loud: 0 });
    };
  }, []);
  const halfHour = Math.floor(g.minute / 30);
  const rainyNow = isRainySeason(g.week);
  useEffect(() => {
    const l = lgaById(g.player.at);
    const hour = (halfHour / 2) % 24;
    sound.set({ hour, rainy: rainyNow, busy: trafficAt(hour), grid: g.prices[l.state].grid, loud: l.state === 'LA' ? 1 : 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halfHour, rainyNow, g.player.at]);
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
      const o = onlineRef.current;
      if (o) {
        // The server keeps time; between updates the clock runs on at the world's speed.
        clock.current = liveMinute(gg, o);
      } else if (a) {
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
    if (asleepUntil) {
      setToast({ text: `You are asleep until ${clockLabel(asleepUntil)}.`, ok: false });
      return;
    }
    setMenu(null);
    setTalk(null);
    setPlaces(false);
    if (byKeke && online && (t.place || t.point)) {
      void online.send({ kind: 'ride' }).then((r) => {
        if (r && !r.ok) setToast({ text: r.text, ok: false });
        else setTarget({ ...t, ride: true, nonce: Date.now() });
      });
      return;
    }
    if (byKeke && (t.place || t.point)) {
      const paid = payRide(g);
      if (!paid.ok) {
        setToast({ text: 'You cannot afford the fare. Walk it.', ok: false });
        return;
      }
      setGame(paid.game);
      sound.play('ride');
      setTarget({ ...t, ride: true, nonce: Date.now() });
      return;
    }
    setTarget({ ...t, nonce: Date.now() });
  };

  const arrive = (place: PlaceId, lot: number | null) => {
    guide.mark('go');
    sound.play('arrive');
    setGame(goTo(g, place, lot));
    setMenu({ place, lot });
    if (online) void online.send({ kind: 'goto', place, lot });
  };

  /** Shows the route on the map for a few seconds while you travel. */
  const showTrip = (a: DayAction, from: string) => {
    if (!a.id.startsWith('travel:')) return;
    setTrip({ id: a.id, from, t0: Date.now(), ms: 9000, minutes: a.minutes, minute: clock.current });
  };

  const run = (a: DayAction, where: Selection | null = menu) => {
    if (busy) return;
    if (online && where) {
      // The world decides; the answer comes back with the new state of things.
      setBusy(true);
      const before = g.player.money;
      const from = g.player.at;
      setMenu(null);
      void online.send({ kind: 'act', id: a.id, place: where.place, lot: where.lot }).then((r) => {
        setBusy(false);
        if (!r) return setToast({ text: 'Could not reach the game server. Try again.', ok: false });
        setToast({ text: r.text, ok: r.ok });
        if (!r.ok) return where === menu ? setMenu(where) : undefined;
        learn(a, 0);
        showTrip(a, from);
        const dm = gRef.current.player.money - before;
        if (Math.abs(dm) >= 500) {
          addFloats([{ text: `${dm > 0 ? '+' : '−'}${naira(Math.abs(dm))}`, tone: dm > 0 ? 'good' : 'bad' }]);
          sound.play(dm > 0 ? 'cash' : 'spend');
        } else sound.play('tap');
      });
      return;
    }
    const r = doAction(g, a.id);
    if (!r.ok) {
      setToast({ text: r.text, ok: false });
      sound.play('bad');
      return;
    }
    showTrip(a, g.player.at);
    const next = r.game;
    const endsDay = next.day !== g.day || next.week !== g.week || next.phase !== 'day';
    const dm = next.player.money - g.player.money;
    const fl: Omit<Float, 'id'>[] = [];
    if (Math.abs(dm) >= 500) fl.push({ text: `${dm > 0 ? '+' : '−'}${naira(Math.abs(dm))}`, tone: dm > 0 ? 'good' : 'bad' });
    sound.play(dm >= 500 ? 'cash' : dm <= -500 ? 'spend' : 'tap');
    const dh = next.player.hunger - g.player.hunger;
    learn(a, dh);
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

  /** A trip chosen on the phone: from where you stand, or a ride-hailing car from anywhere. */
  const book = (id: string) => {
    const a = actionsAt(g, g.place).find((x) => x.id === id) ?? rideHailActions(g).find((x) => x.id === id);
    if (!a) return;
    if (a.blocked) return setToast({ text: a.blocked, ok: false });
    setPhone(null);
    run(a, { place: g.place, lot: g.lot });
  };

  const chat = (id: number) => {
    if (busy) return;
    guide.mark('talk');
    sound.play('talk');
    if (online) {
      if (g.humans.includes(id)) {
        // Another player: open their conversation.
        setMenu(null);
        setPeer(id);
        setSocial('people');
        return;
      }
      setMenu(null);
      void online.send({ kind: 'talk', person: id }).then((r) => r && setTalk({ id, line: r.text }));
      return;
    }
    const r = talkTo(g, id);
    setGame(r.game);
    setMenu(null);
    setTalk({ id, line: r.line });
  };

  const hireThem = (bizId: number) => {
    if (!talk) return;
    if (online) {
      void online.send({ kind: 'hire', business: bizId, person: talk.id }).then((r) => r && setTalk({ ...talk, note: r.text }));
      return;
    }
    const r = hireTalent(g, bizId, talk.id);
    setGame(r.game);
    setTalk({ ...talk, note: r.text });
  };

  const courtThem = (step: 'ask' | 'propose') => {
    if (!talk) return;
    if (online) {
      void online.send({ kind: 'court', person: talk.id, step }).then((r) => r && setTalk({ ...talk, note: r.text }));
      return;
    }
    const r = courtPerson(g, talk.id, step);
    setGame(r.game);
    setTalk({ ...talk, note: r.text });
    if (r.ok) sound.play('done');
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
        <World g={g} clock={clock} busy={busy} target={target} selected={menu} floats={floats} onWalk={(w) => walk(w)} onArrive={arrive} onTalk={chat} track={track} trail={trail} />
      </div>

      <Clock g={g} clock={clock} speed={speed} setSpeed={setSpeed} onQuit={onQuit} online={online} />
      <Wallet g={g} />
      <Minimap g={g} track={track} trail={trail} selected={menu} onWalk={(w) => walk(w, ride)} onWhole={() => guide.mark('map')} />
      {!phone && !paperOpen && <Guide guide={guide} />}
      {!busy && <RouteChip g={g} target={target} track={track} trail={trail} onStop={() => setTarget({ stop: true, nonce: Date.now() })} />}
      <Needs g={g} />

      <div className="hud-br">
        <button className="round-btn" onClick={() => setPlaces((v) => !v)} aria-expanded={places} title="Places on this street">
          🗺️<span>Places</span>
        </button>
        {online && (
          <button className="round-btn" onClick={() => setSocial(social ? null : 'street')} aria-expanded={!!social} title="Chat, deals and the other players">
            💬<span>People</span>
            {unread > 0 && <i className="badge">{unread}</i>}
          </button>
        )}
        <button className="round-btn" onClick={() => walk({ place: 'home' }, ride)} title={ride ? 'Ride home' : 'Walk home'}>
          🏠<span>Home</span>
        </button>
        {online && g.player.paper && g.player.paper.week !== g.player.paperSeen && g.phase === 'day' && (
          <button className="round-btn paper-btn" onClick={() => setPaperOpen(true)} title="Last week's paper">
            📰<span>Paper</span>
          </button>
        )}
        <button
          className="round-btn phone-btn"
          onClick={() => {
            guide.mark('phone');
            setPhone('home');
          }}
          title="Open your phone"
        >
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
          {!online && (
            <button className="btn btn-small" onClick={() => setGame(routineWeek(g))} title="Work, eat and sleep on routine until Sunday">
              ⏩ Routine for the rest of the week
            </button>
          )}
          {online && <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>When you are away, your character keeps going on its own: work, meals and sleep.</p>}
        </div>
      )}

      {menu && !busy && <ActionMenu g={g} sel={menu} actions={actions} onRun={run} onClose={() => setMenu(null)} />}
      {talk && <TalkCard g={g} talk={talk} onClose={() => setTalk(null)} onHire={hireThem} onCourt={courtThem} />}
      {toast && !menu && !talk && <Toast toast={toast} onDone={() => setToast(null)} />}
      {busy && !fade && span && (
        <div className="busy-pill">
          ⏳ {clockLabel(span[0])} → {clockLabel(span[1])}
        </div>
      )}
      {!busy && asleepUntil && online && (
        <div className="busy-pill">
          💤 Asleep until {clockLabel(asleepUntil)} · {Math.max(1, Math.round((asleepUntil - liveAbs(g, online)) / online.rate))} min
        </div>
      )}
      {paperOpen && g.player.paper && (
        <WeekReport
          g={{ ...g, report: g.player.paper }}
          onContinue={() => {
            setPaperOpen(false);
            void online?.send({ kind: 'paperSeen' });
          }}
        />
      )}
      {online && social && !phone && <SocialPanel g={g} tab={social} setTab={setSocial} peer={peer} setPeer={setPeer} send={online.send} onClose={() => setSocial(null)} />}
      {fade && <div className="night-fade">{fade}</div>}
      {phone && <Phone g={g} app={phone} setApp={setPhone} onClose={() => setPhone(null)} onWalk={(p) => { setPhone(null); walk({ place: p }, ride); }} onBook={book} />}
      {trip && <TripOverlay trip={trip} onClose={() => setTrip(null)} />}
      <div className="chip-row">
        {isRainySeason(g.week) && <div className="weather-chip">🌧️ Rainy season</div>}
        {activeShocks(g).map(({ shock, weeks }) => (
          <div key={shock.id} className={`weather-chip world-chip ${shock.tone}`} title={`${shock.effect} About ${weeks} more week${weeks === 1 ? '' : 's'}.`}>
            {shock.icon} {shock.name} · crude ${Math.round(g.macro.oilPrice)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Clock({ g, clock, speed, setSpeed, onQuit, online }: { g: Game; clock: React.MutableRefObject<number>; speed: number; setSpeed: (s: number) => void; onQuit: () => void; online?: Online }) {
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
        {online ? (
          <div className="live-chip" title="The shared world runs on its own clock">
            <span className="dot" aria-hidden="true" /> Live world · {online.count} online
          </div>
        ) : (
          <div className="speed" role="radiogroup" aria-label="Game speed">
            {SPEEDS.map((_, i) => (
              <button key={i} role="radio" aria-checked={speed === i} className={speed === i ? 'on' : ''} onClick={() => setSpeed(i)} title={SPEED_LABELS[i]} aria-label={SPEED_LABELS[i]}>
                {i === 0 ? '⏸' : '▶'.repeat(i)}
              </button>
            ))}
          </div>
        )}
        <div className="kicker" style={{ marginTop: 3 }}>
          📍 {here.nick}, {stateById(here.state).name}
        </div>
      </div>
      <SoundButton />
    </div>
  );
}

/** Turns the street's sound on and off; the choice is remembered. */
function SoundButton() {
  const muted = useSyncExternalStore(
    (fn) => sound.subscribe(fn),
    () => sound.muted,
  );
  return (
    <button className="sound-btn" onClick={() => sound.setMuted(!muted)} aria-pressed={!muted} title={muted ? 'Turn sound on' : 'Turn sound off'}>
      {muted ? '🔇' : '🔊'}
      <span>{muted ? 'Sound off' : 'Sound on'}</span>
    </button>
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
  const me = g.people[g.me];
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
  const st = sel.place === 'lot' && sel.lot !== null ? standing(g, g.player.at, sel.lot) : null;
  // A bare plot nobody has bought is "for sale or lease"; anything else goes by what it is.
  const bare = !st || (st.role === 'lot' && st.on === 'empty' && st.owner < 0);
  const title = sel.place === 'lot' ? (biz ? biz.name : !bare ? (st!.owner === g.me ? `Your ${st!.name.toLowerCase()}` : st!.name) : farm ? 'Farmland for sale or lease' : 'Plot for sale or lease') : sel.place === 'home' ? 'Home' : PLACES[sel.place].name;
  // Real places in the mapped districts go by their real names.
  const h = hood(g.player.at);
  const realName = sel.place === 'busstop' ? h.real?.stopName : sel.place !== 'lot' && sel.place !== 'home' ? h.plots[h.place[sel.place] ?? -1]?.real : undefined;
  const here = lgaById(g.player.at);
  const named = realName ?? (sel.place === 'airport' ? here.airport : sel.place === 'jetty' ? here.jetty : undefined);
  const sub = biz ? `${bizType(biz.type).name} · ${stageName(biz.type, biz.level).replace(/^an? /, '')} · level ${biz.level}` : sel.place === 'lot' ? (bare ? 'Lease it for a business, or buy the land and build on it.' : `${st!.owner === g.me ? 'Yours' : st!.owner >= 0 && g.people[st!.owner] ? `Owned by ${g.people[st!.owner].name}` : 'Privately owned'} · worth ${naira(st!.value)}${st!.rent ? ` · rent ${naira(st!.rent)} a week` : ''}`) : named ?? null;
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

function TalkCard({ g, talk, onClose, onHire, onCourt }: { g: Game; talk: { id: number; line: string; note?: string }; onClose: () => void; onHire: (bizId: number) => void; onCourt: (step: 'ask' | 'propose') => void }) {
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
          {!courtBlocked(g, talk.id) &&
            (datingOf(g)?.id === talk.id ? (
              <button className="btn btn-small" onClick={() => onCourt('propose')} title={`A wedding costs about ${naira(weddingCost(g))}. Needs relationship 80.`}>
                💍 Propose
              </button>
            ) : (
              who.relation >= 30 && (
                <button className="btn btn-small" onClick={() => onCourt('ask')} title="Needs relationship 45">
                  💐 Ask out
                </button>
              )
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

/** While you are on your way somewhere: where to, how far is left, and a button to stop. */
function RouteChip({ g, target, track, trail, onStop }: { g: Game; target: WalkTarget | null; track: React.MutableRefObject<Pt>; trail: React.MutableRefObject<Pt[]>; onStop: () => void }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => {
      let d = 0;
      let at = track.current;
      for (const p of trail.current) {
        d += Math.hypot(p[0] - at[0], p[1] - at[1]);
        at = p;
      }
      setLeft(d);
    }, 200);
    return () => window.clearInterval(t);
  }, [track, trail]);
  if (!target || target.stop || left < 1.5) return null;
  const h = hood(g.player.at);
  const biz = target.place === 'lot' && target.lot !== undefined ? businessOn(g, g.player.at, target.lot) : undefined;
  const plot = target.place && target.place !== 'lot' && target.place !== 'busstop' ? h.plots[h.place[target.place] ?? -1] : undefined;
  const name = !target.place
    ? 'that spot'
    : target.place === 'lot'
      ? (biz?.name ?? 'the plot')
      : target.place === 'home'
        ? 'home'
        : target.place === 'busstop'
          ? h.real ? `${h.real.stopName} bus stop` : 'the bus stop'
          : (plot?.real ?? PLACES[target.place].name);
  // Districts drawn from the real map are shrunk; say the distance as it is on the ground.
  const metres = left * (h.real?.scale ?? 3);
  const far = metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  return (
    <div className="route-chip" role="status">
      <span className="route-dot" aria-hidden="true" />
      <span className="route-text">
        {target.ride ? 'Riding to' : 'Walking to'} <b>{name}</b> · {far}
      </span>
      <button onClick={onStop} aria-label="Stop here" title="Stop here">
        ✕
      </button>
    </div>
  );
}

/** A map of the neighbourhood: roads, places and plots, with you on it. Tap a place to go there. */
function Minimap({ g, track, trail, selected, onWalk, onWhole }: { g: Game; track: React.MutableRefObject<Pt>; trail: React.MutableRefObject<Pt[]>; selected: Selection | null; onWalk: (t: Omit<WalkTarget, 'nonce'>) => void; onWhole?: () => void }) {
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
  if (open && h.real) return <CityMinimap g={g} track={track} trail={trail} selected={selected} onWalk={onWalk} onClose={() => setOpen(false)} onWhole={onWhole} />;
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
