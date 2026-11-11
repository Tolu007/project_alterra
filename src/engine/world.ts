import type { PlaceId } from '../data/trades';
import { lgaById } from '../data/world';
import { resolveCulture } from './culture';
import { clamp } from './economy';
import { actionBlocked, bookBusinessDay, drift, mainWork, placesIn } from './life';
import { hood } from './map';
import { absNow, bind, eachSeat, seatOf, unbind } from './seats';
import { addSeat, newSharedWorld, type NewLife } from './setup';
import { applyAction, endWeekShared, goToBed, rideFare, settleInbox } from './sim';
import { settleSocial } from './social';
import { DAY_END, DAY_START, DAYS_PER_WEEK, type Game } from './types';

// A shared world runs on a real-time clock that nobody can pause. The server calls tickWorld before every
// request; the world catches up on whatever time has passed, with everyone's day moving together. Players who
// are away are on autopilot: they eat, go to work and sleep on their own.

/** Game minutes per real minute: a game hour every five real minutes, a game day every two hours. */
export const DEFAULT_RATE = 12;
/** The world moves in steps of this many game minutes. */
const STEP = 10;
/** A world nobody has visited for ages does not replay every missed day: it skips ahead at most this far. */
const MAX_CATCH_UP = 7 * 1440;
/** Real time after which a player counts as away and their character runs on autopilot. */
export const AWAY_MS = 3 * 60_000;

export function createSharedWorld(seed: number, nowMs: number, rate = DEFAULT_RATE): Game {
  const g = newSharedWorld(seed, nowMs, rate);
  g.minute = DAY_START;
  return g;
}

/** Real time → how many game minutes the world is behind. */
export function minutesDue(g: Game, nowMs: number): number {
  const c = g.shared!;
  return ((nowMs - c.realMs) / 60_000) * c.rate;
}

/** Brings the world up to the present, step by step. Returns how many game minutes passed. */
export function tickWorld(g: Game, nowMs: number): number {
  const c = g.shared;
  if (!c) return 0;
  let due = minutesDue(g, nowMs);
  if (due > MAX_CATCH_UP) {
    c.realMs = nowMs - (MAX_CATCH_UP / c.rate) * 60_000;
    due = MAX_CATCH_UP;
  }
  let passed = 0;
  const was = g.me;
  unbind(g);
  while (due >= STEP) {
    stepWorld(g, STEP, nowMs - AWAY_MS);
    due -= STEP;
    passed += STEP;
    c.realMs += (STEP / c.rate) * 60_000;
  }
  if (was >= 0 && seatOf(g, was)) bind(g, was);
  return passed;
}

/** Energy back per game hour while you are online: you never sleep then, so you catch your breath as you go. */
const ONLINE_REST = 2.5;

function stepWorld(g: Game, minutes: number, awayBefore: number) {
  g.minute += minutes;
  const now = absNow(g);
  eachSeat(g, (s) => {
    if (g.ending) return;
    if (g.asleep) {
      if (g.busyUntil > now) return;
      g.asleep = false;
      return;
    }
    if (s.seenMs >= awayBefore) {
      drift(g, minutes, 'rest');
      g.player.energy = clamp(g.player.energy + (minutes / 60) * ONLINE_REST, 0, 100);
    } else {
      drift(g, minutes, 'idle');
      autopilot(g);
    }
  });
  if (g.minute >= DAY_END) endDayShared(g, awayBefore);
}

/**
 * 2am for everyone: the day's takings are booked, tonight's shows are reviewed, anyone still up passes out
 * (and wakes at 9), and the calendar turns. After Saturday, Sunday's settlement runs for the whole world.
 */
function endDayShared(g: Game, awayBefore: number) {
  bookBusinessDay(g);
  resolveCulture(g);
  const nineAm = absNow(g) - g.minute + 1440 + 9 * 60;
  eachSeat(g, (s) => {
    g.talked = [];
    // Players who are here play on through the night; only characters left alone pass out.
    if (g.asleep || g.ending || s.seenMs >= awayBefore) return;
    const p = g.player;
    p.energy = clamp(p.energy + 7 * 4, 0, 100);
    p.hunger = clamp(p.hunger - 7 * 1.2, 0, 100);
    g.asleep = true;
    g.busyUntil = nineAm;
    g.place = 'home';
    g.lot = null;
  });
  g.day++;
  g.minute -= 1440;
  if (g.day >= DAYS_PER_WEEK) {
    endWeekShared(g);
    g.week++;
    g.day = 0;
    // Wages between players are paid and loans fall due.
    settleSocial(g, g.shared?.realMs ?? Date.now());
  }
}

/** What a character does when their player is away: read the paper, eat, work, sleep. */
function autopilot(g: Game) {
  if (g.phase !== 'day') settleInbox(g);
  if (g.phase !== 'day') return;
  const p = g.player;
  const h = g.minute / 60;
  const at = (place: PlaceId, lot: number | null = null) => {
    g.place = place;
    g.lot = place === 'lot' ? lot : null;
  };
  const tryDo = (place: PlaceId, id: string, lot: number | null = null) => {
    at(place, lot);
    if (actionBlocked(g, id)) return false;
    applyAction(g, id);
    return true;
  };
  if (h >= 22 || h < DAY_START / 60) {
    at('home');
    goToBed(g);
    return;
  }
  if (p.at !== p.home) {
    const sameState = lgaById(p.at).state === lgaById(p.home).state;
    if (tryDo(sameState ? 'busstop' : 'park', `travel:${p.home}`)) return;
    return;
  }
  if (p.hunger < 45 && tryDo('home', 'cook')) return;
  const job = mainWork(g);
  const today = g.week * 7 + g.day;
  if (job && g.flags.workDay !== today && h < 15) tryDo(job.place, job.id, job.lot ?? null);
}

/** A new player joins a shared world. Returns their person id. */
export function joinWorld(g: Game, life: NewLife, account: string, nowMs: number): number {
  const was = g.me;
  unbind(g);
  const id = addSeat(g, life, account);
  const s = seatOf(g, id)!;
  s.seenMs = nowMs;
  if (was >= 0 && seatOf(g, was)) bind(g, was);
  return id;
}

/** You are back: the world sees you, and if your character fell asleep while you were away, they wake up. */
export function comeBack(g: Game, id: number, nowMs: number) {
  const s = seatOf(g, id);
  if (!s) return;
  s.seenMs = Math.max(s.seenMs, nowMs);
  const bound = g.me === id;
  if (bound ? g.asleep : s.asleep) {
    if (bound) {
      g.asleep = false;
      g.busyUntil = 0;
    } else {
      s.asleep = false;
      s.busyUntil = 0;
    }
  }
}

/** Things a player can ask the world to do, checked against the rules on the server. */
export type Intent =
  | { kind: 'act'; id: string; place: PlaceId; lot: number | null }
  | { kind: 'goto'; place: PlaceId; lot: number | null }
  | { kind: 'ride' }
  | { kind: 'talk'; person: number }
  | { kind: 'hire'; business: number; person: number }
  | { kind: 'court'; person: number; step: 'ask' | 'propose' }
  | { kind: 'report' }
  | { kind: 'event'; choice: number }
  | { kind: 'eventDone' }
  | { kind: 'govern'; plan: unknown }
  | { kind: 'electionDone' }
  | { kind: 'paperSeen' }
  // Between players (see social.ts).
  | { kind: 'chat'; text: string; to?: number | null }
  | { kind: 'pay'; to: number; amount: number }
  | { kind: 'offer'; to: number; offer: { type: string; business?: number; amount: number; repay?: number; weeks?: number } }
  | { kind: 'answer'; offer: number; accept: boolean }
  | { kind: 'withdraw'; offer: number }
  | { kind: 'endJob'; business: number; worker: number }
  | { kind: 'repay'; to: number; amount: number }
  | { kind: 'endorse'; to: number };

/** Is this a place in the bound player's current LGA (or one of its plots)? */
export function validPlace(g: Game, place: PlaceId, lot: number | null): boolean {
  // Any plot in town can be visited: the ones for lease to do business, the rest to deal in the property.
  if (place === 'lot') return lot !== null && !!hood(g.player.at).plots[lot];
  return placesIn(g.player.at).includes(place);
}

export { rideFare };
