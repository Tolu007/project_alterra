import type { PlaceId } from '../data/trades';
import { placesIn } from '../engine/life';

/** The street runs along x. Road |z| < ROAD, pavements up to WALK; buildings beyond. */
export const ROAD = 4;
export const WALK = 6.6;
export const SLOT = 14;
const DEPTH = 10;

export interface Spot {
  place: PlaceId;
  /** Footprint centre. */
  x: number;
  z: number;
  /** -1: north row (faces +z). 1: south row (faces -z). */
  side: -1 | 1;
  /** Where you stand to go in. */
  door: [number, number];
}

export interface Layout {
  spots: Spot[];
  length: number;
}

const memo = new Map<string, Layout>();

/**
 * Every place faces the camera from the north side of the street, in engine order.
 * The south side is kept low (trees, kiosks) so nothing hides the street.
 */
export function layoutFor(lga: string): Layout {
  const hit = memo.get(lga);
  if (hit) return hit;
  const places = placesIn(lga);
  const length = places.length * SLOT;
  const spots: Spot[] = places.map((place, i) => {
    const x = SLOT * (i + 0.5);
    return { place, x, z: -(WALK + 1 + DEPTH / 2), side: -1, door: [x, -(WALK - 0.4)] };
  });
  const out = { spots, length };
  memo.set(lga, out);
  return out;
}

export const spotOf = (lga: string, place: PlaceId) => layoutFor(lga).spots.find((s) => s.place === place)!;

/** Keeps a walking target on the street and pavements. */
export function clampWalk(x: number, z: number, length: number): [number, number] {
  return [Math.min(length + 4, Math.max(-4, x)), Math.min(WALK - 0.3, Math.max(-(WALK - 0.3), z))];
}
