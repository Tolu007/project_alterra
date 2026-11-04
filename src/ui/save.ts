import { upgradeSave } from '../engine/setup';
import type { Game } from '../engine/types';

const KEY = 'naija-hustle:save:v2';

// Storage can be missing or blocked (private mode, embedded previews), so every access is guarded.
export function loadGame(): Game | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as Game;
    return g.version === 2 ? upgradeSave(g) : null;
  } catch {
    return null;
  }
}

export function saveGame(g: Game | null) {
  try {
    if (g) localStorage.setItem(KEY, JSON.stringify(g));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
