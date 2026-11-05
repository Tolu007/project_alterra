import { DAYS_PER_WEEK, type Game, type Player, type PublicSeat, type Seat } from './types';

// A world holds any number of players. Each one's private state lives in a seat; to act for a player,
// the engine binds their seat into the top-level fields of the game (g.player, g.place, ...) and the
// rest of the code works exactly as it does for one player. Unbind writes those fields back.

const BOUND = ['player', 'place', 'lot', 'talked', 'phase', 'report', 'eventQueue', 'currentEvent', 'outcome', 'seenEvents', 'showElection', 'ending', 'flags', 'busyUntil', 'asleep'] as const;

export const seatOf = (g: Game, id: number): Seat | undefined => g.seats.find((s) => s.id === id);
export const isHuman = (g: Game, id: number) => g.humans.includes(id);

/** The player record behind a human character, bound or not. */
export function humanOf(g: Game, id: number): Player | null {
  if (id === g.me && g.me >= 0) return g.player;
  return seatOf(g, id)?.player ?? null;
}

export function unbind(g: Game) {
  if (g.me < 0) return;
  const s = seatOf(g, g.me) as unknown as Record<string, unknown> | undefined;
  const top = g as unknown as Record<string, unknown>;
  if (s) for (const k of BOUND) s[k] = top[k];
  g.me = -1;
}

export function bind(g: Game, id: number) {
  if (g.me === id) return;
  unbind(g);
  const s = seatOf(g, id) as unknown as Record<string, unknown> | undefined;
  if (!s) throw new Error(`No seat ${id}`);
  const top = g as unknown as Record<string, unknown>;
  for (const k of BOUND) top[k] = s[k];
  g.me = id;
}

/** Runs `fn` once for each player with their seat bound, then puts back whoever was bound. */
export function eachSeat(g: Game, fn: (s: Seat) => void) {
  const was = g.me;
  unbind(g);
  for (const s of g.seats) {
    bind(g, s.id);
    fn(s);
    unbind(g);
  }
  if (was >= 0 && seatOf(g, was)) bind(g, was);
}

/** Absolute game minutes since the world began. */
export const absNow = (g: Game) => (g.week * DAYS_PER_WEEK + g.day) * 1440 + g.minute;

/**
 * Your own time. In a shared world actions take no real time: each one moves your own clock on by its
 * length while the world's clock keeps its pace, so you run ahead of it until it catches up (or night
 * falls). Asleep, you are on the world's time. Offline there is only one clock.
 */
export const ownAbs = (g: Game) => (g.shared && !g.asleep ? Math.max(absNow(g), g.busyUntil) : absNow(g));

/** Your own time of day, in minutes after midnight on the world's date (past 24 hours for the small hours). */
export const ownMinute = (g: Game) => g.minute + (ownAbs(g) - absNow(g));

/** Runs fn with the game's clock set to your own time, then puts the world's clock back. */
export function onOwnClock<T>(g: Game, fn: () => T): T {
  const ahead = ownAbs(g) - absNow(g);
  if (ahead <= 0) return fn();
  g.minute += ahead;
  try {
    return fn();
  } finally {
    g.minute -= ahead;
  }
}

/** For saving or sending: a copy with the bound seat written back and nothing left bound. */
export function packGame(g: Game): string {
  const was = g.me;
  unbind(g);
  const out = JSON.stringify(g);
  if (was >= 0) bind(g, was);
  return out;
}

export function unpackGame(json: string, me: number | null): Game {
  const g = JSON.parse(json) as Game;
  g.me = -1;
  if (me !== null && seatOf(g, me)) bind(g, me);
  return g;
}

export function publicSeats(g: Game, onlineSince: number): PublicSeat[] {
  return g.seats.map((s) => {
    const live = s.id === g.me;
    return {
      id: s.id,
      place: live ? g.place : s.place,
      lot: live ? g.lot : s.lot,
      at: (live ? g.player : s.player).at,
      busyUntil: live ? g.busyUntil : s.busyUntil,
      asleep: live ? g.asleep : s.asleep,
      online: s.seenMs >= onlineSince,
    };
  });
}
