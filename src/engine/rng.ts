// mulberry32. The state lives on the game object so a save or a test replays exactly.
export interface HasRng {
  rng: number;
}

export function rand(g: HasRng): number {
  let t = (g.rng = (g.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const chance = (g: HasRng, p: number) => rand(g) < p;
export const between = (g: HasRng, lo: number, hi: number) => lo + (hi - lo) * rand(g);
export const pick = <T>(g: HasRng, items: readonly T[]): T => items[Math.floor(rand(g) * items.length)];

/** Standard normal via Box-Muller. */
export function gauss(g: HasRng): number {
  const u = Math.max(rand(g), 1e-9);
  const v = rand(g);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function shuffle<T>(g: HasRng, items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand(g) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function weightedPick<T>(g: HasRng, items: readonly T[], weight: (t: T) => number): T | null {
  const total = items.reduce((sum, t) => sum + Math.max(0, weight(t)), 0);
  if (total <= 0) return null;
  let r = rand(g) * total;
  for (const t of items) {
    r -= Math.max(0, weight(t));
    if (r <= 0) return t;
  }
  return items[items.length - 1];
}
