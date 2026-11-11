import { useEffect, useMemo, useRef, useState } from 'react';
import { PLACES, type PlaceId } from '../data/trades';
import { lgaById } from '../data/world';
import { businessOn } from '../engine/business';
import { hood, type Plot, type Pt } from '../engine/map';
import type { Game } from '../engine/types';
import { pairs, useCity, type CityRender } from '../world/cityData';
import type { Selection, WalkTarget } from '../world/World';

const pts = (flat: number[]) => pairs(flat).map(([x, z]) => `${x},${z}`).join(' ');
const AREA: Record<string, string> = { park: '#bfe0a6', cemetery: '#cfdcc0', golf_course: '#bfe0a6', stadium: '#c6e2b0', industrial: '#e3ddd3', port: '#dcdad5', apron: '#d9d9d9', military: '#e6d8c4', retail: '#f6e3dc', commercial: '#f4e6dd' };

/** A picture for each kind of place, for the map and its key. */
export const PLACE_ICON: Record<PlaceId, string> = {
  home: '🏠',
  busstop: '🚌',
  lot: '📍',
  market: '🛒',
  park: '🚐',
  workshop: '🔧',
  farm: '🌾',
  school: '🏫',
  secretariat: '🏛️',
  office: '🏢',
  techhub: '💻',
  oilsite: '🛢️',
  factory: '🏭',
  skills: '🎓',
  joint: '⚽',
  party: '🗳️',
  clinic: '➕',
  bank: '🏦',
  govhouse: '🏛️',
  palace: '👑',
  venue: '🎭',
  airport: '✈️',
  jetty: '⛴️',
};

/** One path through every road of a kind, so the map is a handful of shapes rather than hundreds. */
function roadPath(city: CityRender, want: (c: string) => boolean): string {
  let d = '';
  for (const r of city.roads) {
    if (!want(r.c)) continue;
    for (let i = 0; i < r.p.length; i += 2) d += `${i ? 'L' : 'M'}${r.p[i]} ${r.p[i + 1]}`;
  }
  return d;
}

/** A plot as a turned rectangle. */
function PlotRect({ p, fill, stroke, sw, dash }: { p: Plot; fill: string; stroke: string; sw: number; dash?: string }) {
  return <rect x={-p.w / 2} y={-p.d / 2} width={p.w} height={p.d} rx={1.5} transform={`translate(${p.x} ${p.z}) rotate(${(-p.rot * 180) / Math.PI})`} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />;
}

interface Pin {
  key: string;
  x: number;
  z: number;
  icon: string;
  name: string;
  /** Higher wins when names would overlap. */
  rank: number;
  go: Omit<WalkTarget, 'nonce'>;
  sel: boolean;
  own?: boolean;
}

/**
 * The map of a district built from real map data: its real streets, water and open land, the places and
 * plots you can go to, you, and the way to where you are going. Close up it follows you; opened out it shows
 * the whole district, with street names, and you can tap anywhere to go there.
 */
export function CityMinimap({ g, track, trail, selected, onWalk, onClose, onWhole }: { g: Game; track: React.MutableRefObject<Pt>; trail?: React.MutableRefObject<Pt[]>; selected: Selection | null; onWalk: (t: Omit<WalkTarget, 'nonce'>) => void; onClose: () => void; /** Told when the map is opened out. */ onWhole?: () => void }) {
  const lga = g.player.at;
  const h = hood(lga);
  const city = useCity(lga);
  const [whole, setWhole] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const me = useRef<SVGGElement>(null);
  const way = useRef<SVGPolylineElement>(null);
  const wayCase = useRef<SVGPolylineElement>(null);
  const flag = useRef<SVGGElement>(null);
  const span = whole ? null : 230;
  const b = h.bounds;
  // Map units per screen pixel, near enough, so pins and names stay the same size on screen at either zoom.
  const u = whole ? Math.max(b.maxX - b.minX, (b.maxZ - b.minZ) * 0.95) / 700 : 230 / 220;

  useEffect(() => {
    let raf = 0;
    let last: Pt = [...track.current];
    let face = 0;
    let frame = 0;
    let drawn = '';
    let wayDrawn = '';
    const tick = () => {
      const [x, z] = track.current;
      const moved = Math.hypot(x - last[0], z - last[1]);
      if (moved > 0.15) {
        face = (Math.atan2(x - last[0], -(z - last[1])) * 180) / Math.PI;
        last = [x, z];
      }
      // Every change to the map makes the browser draw all its streets again, so it moves a few times a
      // second, and not at all while you stand still.
      const tf = `translate(${x.toFixed(1)} ${z.toFixed(1)}) rotate(${face.toFixed(0)})`;
      const due = frame++ % 4 === 0;
      if (due && tf !== drawn) {
        drawn = tf;
        me.current?.setAttribute('transform', tf);
        if (span && svg.current) svg.current.setAttribute('viewBox', `${(x - span / 2).toFixed(1)} ${(z - span * 0.42).toFixed(1)} ${span} ${(span * 0.84).toFixed(1)}`);
      }
      // The way to go changes slowly: redraw it a few times a second.
      if (frame % 8 === 1) {
        const path = trail?.current ?? [];
        const line = path.length ? `${x.toFixed(1)},${z.toFixed(1)} ${path.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}` : '';
        if (line !== wayDrawn) {
          wayDrawn = line;
          way.current?.setAttribute('points', line);
          wayCase.current?.setAttribute('points', line);
          const end = path[path.length - 1];
          if (flag.current) {
            flag.current.style.display = end ? '' : 'none';
            if (end) flag.current.setAttribute('transform', `translate(${end[0].toFixed(1)} ${end[1].toFixed(1)})`);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [track, trail, span]);

  const base = useMemo(() => {
    if (!city) return null;
    const big = (c: string) => c === 'major';
    const mid = (c: string) => c === 'minor' || c === 'link';
    const small = (c: string) => c === 'local';
    return (
      <g>
        {city.areas.filter((a) => AREA[a.k]).map((a, i) => (
          <polygon key={`a${i}`} points={pts(a.p)} fill={AREA[a.k]} />
        ))}
        {city.water.map((w, i) => (
          <polygon key={`w${i}`} points={pts(w)} fill="#a9d3ea" />
        ))}
        {city.islands.map((w, i) => (
          <polygon key={`i${i}`} points={pts(w)} fill="#f3efe4" />
        ))}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {/* Kerbs first, then the road surfaces over them, so junctions join cleanly. */}
          <path d={roadPath(city, small)} stroke="#cfc8ba" strokeWidth={6.6} />
          <path d={roadPath(city, mid)} stroke="#bdb5a5" strokeWidth={9.4} />
          <path d={roadPath(city, big)} stroke="#c9a23a" strokeWidth={13.6} />
          <path d={roadPath(city, small)} stroke="#ffffff" strokeWidth={4.8} />
          <path d={roadPath(city, mid)} stroke="#ffffff" strokeWidth={7.4} />
          <path d={roadPath(city, big)} stroke="#fbdc7e" strokeWidth={11} />
        </g>
        {city.rail.map((r, i) => (
          <g key={`r${i}`} fill="none">
            <polyline points={pts(r)} stroke="#6b6b6b" strokeWidth={2.4} />
            <polyline points={pts(r)} stroke="#f3efe4" strokeWidth={1.2} strokeDasharray="5 5" />
          </g>
        ))}
      </g>
    );
  }, [city]);

  // Street names, the right way up, on the opened-out map.
  const streets = useMemo(() => {
    if (!city || !whole) return null;
    return city.labels.map((l) => {
      let deg = (l.a * 180) / Math.PI;
      if (deg > 90) deg -= 180;
      if (deg < -90) deg += 180;
      return (
        <text key={l.n} className="mm-street" fontSize={9.5 * u} strokeWidth={2.4 * u} textAnchor="middle" dominantBaseline="central" transform={`translate(${l.x} ${l.z}) rotate(${deg.toFixed(0)})`}>
          {l.n}
        </text>
      );
    });
  }, [city, whole, u]);

  // Smaller pins on the small map, so the streets still show.
  const pin = whole ? 9 : 7;
  const isSel = (place: PlaceId, lot: number | null) => !!selected && selected.place === place && (place !== 'lot' || selected.lot === lot);
  const pins: Pin[] = [];
  for (const [place, id] of Object.entries(h.place) as [PlaceId, number][]) {
    const p = h.plots[id];
    pins.push({ key: place, x: p.x, z: p.z, icon: PLACE_ICON[place], name: place === 'home' ? 'Home' : PLACES[place].name, rank: place === 'home' ? 9 : place === 'market' || place === 'park' ? 6 : 4, go: { place }, sel: isSel(place, null) });
  }
  pins.push({ key: 'busstop', x: h.busStop[0], z: h.busStop[1], icon: PLACE_ICON.busstop, name: h.real ? `${h.real.stopName} bus stop` : 'Bus stop', rank: 8, go: { place: 'busstop' }, sel: isSel('busstop', null) });
  for (const id of h.lots) {
    const biz = businessOn(g, lga, id);
    if (!biz) continue;
    const p = h.plots[id];
    const mine = biz.owner === g.me;
    pins.push({ key: `b${id}`, x: p.x, z: p.z, icon: mine ? '⭐' : '🏪', name: biz.name, rank: mine ? 7 : 2, go: { place: 'lot', lot: id }, sel: isSel('lot', id), own: mine });
  }
  // Names that would sit on top of a more important one are left out; the pin still shows what it is when you point at it.
  const named = new Set<string>();
  if (whole) {
    const boxes: [number, number, number, number][] = [];
    for (const p of [...pins].sort((a, c) => Number(c.sel) - Number(a.sel) || c.rank - a.rank)) {
      const w = p.name.length * 6.2 * u + 6 * u;
      const box: [number, number, number, number] = [p.x - w / 2, p.z + 10 * u, p.x + w / 2, p.z + 23 * u];
      if (boxes.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) continue;
      boxes.push(box, [p.x - 10 * u, p.z - 10 * u, p.x + 10 * u, p.z + 10 * u]);
      named.add(p.key);
    }
  }

  /** Tapping the map itself (not a pin) walks you to that spot. */
  const tapGround = (e: React.MouseEvent<SVGSVGElement>) => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return;
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    onWalk({ point: [q.x, q.y] });
    if (whole) setWhole(false);
  };
  const go = (p: Pin) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onWalk(p.go);
    if (whole) setWhole(false);
  };

  const view = span ? `${-span / 2} ${-span * 0.42} ${span} ${span * 0.84}` : `${b.minX} ${b.minZ} ${b.maxX - b.minX} ${b.maxZ - b.minZ}`;
  const name = h.real?.name ?? lgaById(lga).nick;
  return (
    <div className={`minimap city-map${whole ? ' whole' : ''}`}>
      {whole && (
        <div className="map-head">
          <b>{name}</b>
          <span>Tap a place, or anywhere on a street, to go there</span>
        </div>
      )}
      <svg ref={svg} viewBox={view} role="img" aria-label={`Map of ${name}`} onClick={tapGround}>
        <rect x={b.minX - 400} y={b.minZ - 400} width={b.maxX - b.minX + 800} height={b.maxZ - b.minZ + 800} fill="#f3efe4" />
        {base}
        {h.lots.map((id) => {
          const p = h.plots[id];
          if (businessOn(g, lga, id)) return null;
          return (
            <g key={`l${id}`} className="mm-hit" onClick={go({ key: '', x: 0, z: 0, icon: '', name: '', rank: 0, go: { place: 'lot', lot: id }, sel: false })}>
              <PlotRect p={p} fill="rgba(242,183,5,0.22)" stroke={isSel('lot', id) ? '#d23c22' : '#c99400'} sw={(isSel('lot', id) ? 2.2 : 1.1) * Math.max(1, u * 0.7)} dash={`${3 * u} ${2 * u}`} />
              <title>{p.kind === 'farm' ? 'Farmland for lease' : 'Plot for lease'}</title>
            </g>
          );
        })}
        {streets}
        {h.real?.landmarks.map((id) => (
          <circle key={`m${id}`} cx={h.plots[id].x} cy={h.plots[id].z} r={3.4 * u} fill="#8a5bb5" stroke="#ffffff" strokeWidth={1.2 * u}>
            <title>{h.plots[id].landmark?.n}</title>
          </circle>
        ))}
        <polyline ref={wayCase} fill="none" stroke="#ffffff" strokeWidth={6.5 * u} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
        <polyline ref={way} fill="none" stroke="#2a6df4" strokeWidth={3.6 * u} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
        {pins.map((p) => (
          <g key={p.key} className="mm-pin" transform={`translate(${p.x} ${p.z})`} onClick={go(p)}>
            <circle r={pin * u} fill={p.sel ? '#d23c22' : p.own ? '#f2b705' : '#ffffff'} stroke={p.sel ? '#7a1f10' : '#1f1d1a'} strokeWidth={1.3 * u} />
            <text fontSize={pin * 1.15 * u} textAnchor="middle" dominantBaseline="central" y={0.6 * u}>
              {p.icon}
            </text>
            {named.has(p.key) && (
              <text className="mm-label" fontSize={10.5 * u} strokeWidth={3 * u} textAnchor="middle" y={20 * u}>
                {p.name}
              </text>
            )}
            <title>{p.name}</title>
          </g>
        ))}
        <g ref={flag} style={{ display: 'none' }} pointerEvents="none">
          <circle r={5 * u} fill="#2a6df4" stroke="#ffffff" strokeWidth={1.6 * u} />
        </g>
        <g ref={me} pointerEvents="none">
          <circle r={11 * u} fill="rgba(210,60,34,0.18)" />
          <path d={`M0 ${-8 * u} L${5.6 * u} ${6 * u} L0 ${3 * u} L${-5.6 * u} ${6 * u} Z`} fill="#d23c22" stroke="#ffffff" strokeWidth={1.5 * u} strokeLinejoin="round" />
        </g>
      </svg>
      {whole && (
        <div className="map-key">
          <span><i className="k-me" /> You</span>
          <span><i className="k-way" /> Your way</span>
          <span><i className="k-lot" /> Plot for lease</span>
          <span><i className="k-own" /> Your business</span>
          <span><i className="k-mark" /> Landmark</span>
          <span><i className="k-main" /> Main road</span>
        </div>
      )}
      <button
        className="minimap-grow"
        onClick={() => {
          if (!whole) onWhole?.();
          setWhole((v) => !v);
        }} aria-label={whole ? 'Show the streets around you' : 'Show the whole district'} title={whole ? 'Close up' : 'Whole district'}>
        {whole ? '－' : '＋'}
      </button>
      <button className="minimap-x" onClick={whole ? () => setWhole(false) : onClose} aria-label={whole ? 'Close the big map' : 'Hide the map'}>
        ✕
      </button>
      <div className="map-credit">© OpenStreetMap contributors</div>
    </div>
  );
}
