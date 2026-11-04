// Dev-only helpers, loaded from main.tsx behind import.meta.env.DEV. Not in production builds.
import { playWeeks } from './engine/autoplay';
import { loadGame, saveGame } from './ui/save';

export function install() {
  (window as unknown as { __nh: unknown }).__nh = {
    /** Plays the saved game forward on routine for some weeks, saves, and reloads. */
    skip(weeks = 4) {
      const g = loadGame();
      if (!g) return 'no saved game';
      saveGame(playWeeks(g, weeks));
      location.reload();
      return 'ok';
    },
    /** Puts the player in office for testing the budget session. */
    office(id: string) {
      const g = loadGame();
      if (!g) return 'no saved game';
      g.player.office = id;
      const gov = id === 'FED' ? g.fed : id in g.states ? g.states[id as 'LA'] : g.lgas[id];
      gov.leader = 0;
      g.player.party = gov.party;
      g.flags.governDue = 1;
      saveGame(g);
      location.reload();
      return 'ok';
    },
  };
}
