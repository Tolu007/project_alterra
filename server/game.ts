import { LGAS } from '../src/data/world';
import { bind, packGame, publicSeats, seatOf, unbind, unpackGame } from '../src/engine/seats';
import { startOptions, type NewLife } from '../src/engine/setup';
import { chooseEvent, closeElection, continueEvent, continueReport, doAction, hireTalent, payRide, peek, submitGovern, talkTo, type GovernPlan } from '../src/engine/sim';
import type { Game, Looks } from '../src/engine/types';
import { AWAY_MS, DEFAULT_RATE, createSharedWorld, joinWorld, minutesDue, tickWorld, validPlace, type Intent } from '../src/engine/world';
import type { Account, Store } from './store';

// The one shared world. Every request brings it up to the present first; changes happen under a lock, and
// each player is sent the world as they see it: their own life in full, everyone else only as faces in town.

const RATE = Number(process.env.WORLD_RATE) || DEFAULT_RATE;
/** How far behind (game minutes) the world may get before a read triggers a tick. */
const TICK_EVERY = 10;
const ONLINE_MS = 90_000;

let cache: { version: number; g: Game } | null = null;

const parse = (json: string) => unpackGame(json, null);

/** Locks the world, brings it up to now, lets `fn` change it, and saves. */
async function mutate<T>(store: Store, fn: (g: Game) => { game?: Game; out: T }): Promise<{ out: T; version: number; g: Game }> {
  const now = Date.now();
  const seen = await store.recentlySeen(now - AWAY_MS - 60_000);
  return store.withWorld(async (cur) => {
    let g: Game;
    if (!cur) g = createSharedWorld(Math.floor(Math.random() * 2 ** 31), now, RATE);
    else g = cache && cache.version === cur.version ? cache.g : parse(cur.data);
    try {
      unbind(g);
      // Who has been around lately: they are not on autopilot.
      for (const r of seen) {
        const s = g.seats.find((x) => x.account === r.account);
        if (s) s.seenMs = Math.max(s.seenMs, r.seenMs);
      }
      tickWorld(g, now);
      const { game, out } = fn(g);
      const next = game ?? g;
      const data = packGame(next);
      const version = (cur?.version ?? 0) + 1;
      cache = { version, g: next };
      return { data, result: { out, version, g: next } };
    } catch (e) {
      cache = null;
      throw e;
    }
  });
}

/** The world as it stands, ticking it first if it has fallen behind. */
async function current(store: Store): Promise<{ g: Game; version: number }> {
  const version = await store.worldVersion();
  if (version === null) return mutate(store, () => ({ out: null }));
  let g: Game;
  if (cache && cache.version === version) g = cache.g;
  else {
    const row = (await store.readWorld())!;
    g = parse(row.data);
    cache = { version: row.version, g };
  }
  if (minutesDue(g, Date.now()) >= TICK_EVERY) return mutate(store, () => ({ out: null }));
  return { g, version };
}

/** A player's view of the world, as JSON: their seat bound, other players reduced to where they are. */
function viewFor(g: Game, seat: number): string | null {
  if (!seatOf(g, seat)) return null;
  bind(g, seat);
  const others = publicSeats(g, Date.now() - AWAY_MS).filter((s) => s.id !== seat);
  const json = JSON.stringify({ ...g, seats: [], others });
  unbind(g);
  return json;
}

function envelope(g: Game, version: number, seat: number | null, online: number, extra: Record<string, unknown> = {}): string {
  const game = seat === null ? null : viewFor(g, seat);
  const meta = JSON.stringify({ version, serverNow: Date.now(), lag: minutesDue(g, Date.now()), rate: g.shared?.rate ?? RATE, online, hasCharacter: game !== null, ...extra });
  return `${meta.slice(0, -1)},"game":${game ?? 'null'}}`;
}

const liveSeat = (g: Game, account: Account) => {
  if (account.seat === null) return null;
  const s = seatOf(g, account.seat);
  return s && s.account === account.id ? s.id : null;
};

const onlineCount = async (store: Store) => (await store.recentlySeen(Date.now() - ONLINE_MS)).length;

/** GET /api/world: your view, or just {same: true} if nothing changed since the version you have. */
export async function worldView(store: Store, account: Account, since: number | null): Promise<string> {
  const { g, version } = await current(store);
  const online = await onlineCount(store);
  if (since === version) return JSON.stringify({ same: true, version, serverNow: Date.now(), lag: minutesDue(g, Date.now()), online });
  return envelope(g, version, liveSeat(g, account), online);
}

export type JoinRequest = { gender: 'm' | 'f'; looks: Looks; home: string; start: NewLife['start'] };

/** Creates your character in the shared world (or a new life, if your last one ended). */
export async function join(store: Store, account: Account, req: JoinRequest): Promise<{ status: number; body: string }> {
  const home = LGAS.find((l) => l.id === req.home);
  if (!home) return { status: 400, body: JSON.stringify({ error: 'Pick a home LGA.' }) };
  const opts = startOptions(home.id);
  const start = req.start;
  const ok = start?.kind === 'job' ? opts.jobs.includes(start.trade) : start?.kind === 'business' ? opts.businesses.includes(start.type) : false;
  if (!ok) return { status: 400, body: JSON.stringify({ error: 'That start is not open in that LGA.' }) };
  const n = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < max ? (v as number) : 0);
  const looks: Looks = { skin: n(req.looks?.skin, 5), hair: n(req.looks?.hair, 5), outfit: n(req.looks?.outfit, 8), accent: n(req.looks?.accent, 8), glasses: !!req.looks?.glasses };
  const life: NewLife = { name: account.name, gender: req.gender === 'm' ? 'm' : 'f', looks, home: home.id, start };
  const { out, g, version } = await mutate(store, (g) => {
    const live = liveSeat(g, account);
    if (live !== null && !seatOf(g, live)!.ending) return { out: { error: 'You already have a character.' as string | null, id: live } };
    if (live !== null) {
      // A new life after an ending: the old character stays in the world as an ordinary resident.
      g.seats = g.seats.filter((s) => s.id !== live);
      g.humans = g.humans.filter((id) => id !== live);
    }
    const id = joinWorld(g, life, account.id, Date.now());
    return { out: { error: null, id } };
  });
  if (out.error) return { status: 409, body: JSON.stringify({ error: out.error }) };
  await store.setSeat(account.id, out.id);
  account.seat = out.id;
  return { status: 200, body: envelope(g, version, out.id, await onlineCount(store)) };
}

/** POST /api/world/act: does one thing for your character, under the world's rules, and sends back your view. */
export async function act(store: Store, account: Account, intent: Intent): Promise<{ status: number; body: string }> {
  if (account.seat === null) return { status: 400, body: JSON.stringify({ error: 'Create your character first.' }) };
  const { out, g, version } = await mutate(store, (g) => {
    const id = liveSeat(g, account);
    if (id === null) return { out: { ok: false, text: 'Create your character first.' } };
    seatOf(g, id)!.seenMs = Date.now();
    bind(g, id);
    return apply(g, intent);
  });
  return { status: 200, body: envelope(g, version, liveSeat(g, account), await onlineCount(store), { result: out }) };
}

function apply(g: Game, intent: Intent): { game?: Game; out: { ok: boolean; text: string } } {
  const fail = (text: string) => ({ out: { ok: false, text } });
  switch (intent?.kind) {
    case 'act': {
      if (!validPlace(g, intent.place, intent.lot)) return fail('You are not there.');
      const r = doAction(peek(g, intent.place, intent.lot), String(intent.id));
      return r.ok ? { game: r.game, out: { ok: true, text: r.text } } : fail(r.text);
    }
    case 'goto':
      if (!validPlace(g, intent.place, intent.lot)) return fail('No such place here.');
      g.place = intent.place;
      g.lot = intent.place === 'lot' ? intent.lot : null;
      return { out: { ok: true, text: '' } };
    case 'ride': {
      const r = payRide(g);
      return r.ok ? { game: r.game, out: { ok: true, text: '' } } : fail('You cannot afford the fare.');
    }
    case 'talk': {
      if (g.humans.includes(Number(intent.person))) return fail('That is another player.');
      const r = talkTo(g, Number(intent.person));
      return { game: r.game, out: { ok: true, text: r.line } };
    }
    case 'hire': {
      const r = hireTalent(g, Number(intent.business), Number(intent.person));
      return { game: r.game, out: { ok: true, text: r.text } };
    }
    case 'report':
      g.player.paperSeen = g.report?.week ?? g.player.paper?.week;
      return { game: continueReport(g), out: { ok: true, text: '' } };
    case 'event':
      return { game: chooseEvent(g, Number(intent.choice)), out: { ok: true, text: '' } };
    case 'eventDone':
      return { game: continueEvent(g), out: { ok: true, text: '' } };
    case 'govern':
      return g.phase === 'govern' ? { game: submitGovern(g, intent.plan as GovernPlan), out: { ok: true, text: '' } } : fail('Not now.');
    case 'electionDone':
      return { game: closeElection(g), out: { ok: true, text: '' } };
    case 'paperSeen':
      g.player.paperSeen = g.player.paper?.week;
      return { out: { ok: true, text: '' } };
  }
  return fail('Unknown request.');
}
