/** What the admin stats page shows. Shared by the server (which computes it) and the page. */
export interface Stats {
  onlineNow: number;
  online: { name: string; seenAgoS: number }[];
  players: number;
  playersWithCharacter: number;
  visitsToday: number;
  visitorsToday: number;
  visits7d: number;
  visitors7d: number;
  days: { day: string; visits: number; visitors: number; signups: number }[];
}
