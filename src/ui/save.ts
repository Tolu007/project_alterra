import { packGame } from '../engine/seats';
import { bind } from '../engine/seats';
import { upgradeSave } from '../engine/setup';
import type { Game } from '../engine/types';

const KEY = 'naija-hustle:save:v2';

// Storage can be missing or blocked (private mode, embedded previews), so every access is guarded.
export function loadGame(): Game | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as Game;
    if (g.version !== 2) return null;
    if (g.seats?.length) {
      g.me = -1;
      bind(g, g.seats[0].id);
    }
    return upgradeSave(g);
  } catch {
    return null;
  }
}

export function saveGame(g: Game | null) {
  try {
    if (g) localStorage.setItem(KEY, packGame(g));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
