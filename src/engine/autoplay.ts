// Autoplay for tests and soak runs. Not used by the UI.
import { avatarLooks } from './testLooks';
import { newGame, type StartPath } from './setup';
import { chooseEvent, closeElection, continueEvent, continueReport, eventChoices, routineWeek, submitGovern } from './sim';
import { govById } from './government';
import type { Game } from './types';

export function testGame(seed = 7, home = 'IKJ', start: StartPath = { kind: 'business', type: 'stall' }): Game {
  return newGame({ name: 'Ada Test', gender: 'f', looks: avatarLooks, home, start }, seed);
}

/** Plays whole weeks on routine, taking the first open choice in every event. */
export function playWeeks(g: Game, weeks: number, onWeek?: (g: Game) => void): Game {
  const target = g.week + weeks;
  for (let guard = 0; guard < weeks * 20 + 20 && g.week < target && g.phase !== 'over'; guard++) {
    switch (g.phase) {
      case 'day':
        g = routineWeek(g);
        onWeek?.(g);
        break;
      case 'week':
        g = continueReport(g);
        break;
      case 'event': {
        if (g.outcome !== null) {
          g = continueEvent(g);
          break;
        }
        const i = eventChoices(g).findIndex((c) => !c.blocked);
        g = chooseEvent(g, Math.max(0, i));
        if (g.outcome === null) g = continueEvent(g);
        break;
      }
      case 'govern': {
        const gov = govById(g, g.player.office!);
        g = submitGovern(g, { budget: gov.budget, payRate: gov.payRate, policy: {} });
        break;
      }
      case 'election':
        g = closeElection(g);
        break;
    }
  }
  return g;
}
