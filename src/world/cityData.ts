import { useEffect, useState } from 'react';
import { registerStreets, type StreetRoad } from '../engine/streets';

/** What the 3D world draws for a district built from map data (see scripts/build-city.mjs). Flat x, z lists. */
export interface CityRender {
  roads: StreetRoad[];
  cross: number[];
  water: number[][];
  islands: number[][];
  rail: number[][];
  areas: { k: string; p: number[] }[];
  runways: number[][];
  /** x, z, w, d, rot, height, colour index for each building along the streets. */
  blocks: number[];
  /** x, z, size, height, rot, colour index for each rooftop behind them. */
  roofs: number[];
  labels: { n: string; x: number; z: number; a: number }[];
}

/** The Lagos-wide travel map: water, main roads, district hubs and the roads between them (km from the NW corner). */
export interface CityOverview {
  size: [number, number];
  water: number[][];
  /** Islands in the lagoon and creeks, drawn over the water. */
  land: number[][];
  roads: { c: string; n?: string; p: number[] }[];
  hubs: Record<string, [number, number]>;
  routes: Record<string, { km: number; via: string[]; p: number[] }>;
  ferries: Record<string, { km: number; p: number[] }>;
}

// Each district is a separate download, fetched when you first go there.
const files = import.meta.glob<{ default: CityRender }>('../data/city/render/*.json');
const loads = new Map<string, Promise<CityRender>>();
const ready = new Map<string, CityRender>();

export function loadCity(lga: string): Promise<CityRender> {
  let p = loads.get(lga);
  if (!p) {
    const file = files[`../data/city/render/${lga}.json`];
    if (!file) return Promise.reject(new Error(`No map data for ${lga}`));
    p = file().then((m) => {
      registerStreets(lga, m.default.roads, m.default.cross);
      ready.set(lga, m.default);
      return m.default;
    });
    loads.set(lga, p);
  }
  return p;
}

/** The district's drawing data once it has arrived (null while loading, or for towns not built from map data). */
export function useCity(lga: string | null): CityRender | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!lga || ready.has(lga)) return;
    let live = true;
    void loadCity(lga).then(() => live && bump((x) => x + 1));
    return () => {
      live = false;
    };
  }, [lga]);
  return lga ? (ready.get(lga) ?? null) : null;
}

let overview: Promise<CityOverview> | null = null;
export function loadOverview(): Promise<CityOverview> {
  overview ??= import('../data/city/overview.json').then((m) => m.default as unknown as CityOverview);
  return overview;
}

export function useOverview(): CityOverview | null {
  const [o, setO] = useState<CityOverview | null>(null);
  useEffect(() => {
    let live = true;
    void loadOverview().then((x) => live && setO(x));
    return () => {
      live = false;
    };
  }, []);
  return o;
}

/** Pairs from a flat x, z list. */
export function pairs(flat: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}
