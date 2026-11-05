import { useEffect, useMemo, useRef, useState } from 'react';
import { PLACES, type PlaceId } from '../data/trades';
import { lgaById } from '../data/world';
import { businessOn } from '../engine/business';
import { hood, type Plot, type Pt } from '../engine/map';
import type { Game } from '../engine/types';
import { pairs, useCity } from '../world/cityData';
import type { Selection, WalkTarget } from '../world/World';

const pts = (flat: number[]) => pairs(flat).map(([x, z]) => `${x},${z}`).join(' ');
const AREA: Record<string, string> = { park: '#a9cf8a', cemetery: '#b9c9a8', golf_course: '#a9cf8a', stadium: '#b4d39a', industrial: '#cfc6b8', port: '#c2c0bb', apron: '#bdbdbd', military: '#d9c2a8', retail: '#ecc9c0', commercial: '#ecd3c8' };

/** A plot as a turned rectangle. */
function PlotRect({ p, fill, stroke, sw, dash, onClick, title }: { p: Plot; fill: string; stroke: string; sw: number; dash?: string; onClick?: () => void; title: string }) {
  return (
    <rect x={-p.w / 2} y={-p.d / 2} width={p.w} height={p.d} rx={1.5} transform={`translate(${p.x} ${p.z}) rotate(${(-p.rot * 180) / Math.PI})`} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} className={onClick ? 'mm-hit' : undefined} onClick={onClick}>
      <title>{title}</title>
    </rect>
  );
}

/**
 * The map of a district built from real map data: its real streets, water and open land, the places and
 * plots you can go to, and you. Close up it follows you; opened out it shows the whole district.
 */
export function CityMinimap({ g, track, selected, onWalk, onClose }: { g: Game; track: React.MutableRefObject<Pt>; selected: Selection | null; onWalk: (t: Omit<WalkTarget, 'nonce'>) => void; onClose: () => void }) {
  const lga = g.player.at;
  const h = hood(lga);
  const city = useCity(lga);
  const [whole, setWhole] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const span = whole ? null : 260;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const [x, z] = track.current;
      dot.current?.setAttribute('cx', x.toFixed(1));
      dot.current?.setAttribute('cy', z.toFixed(1));
      if (span && svg.current) svg.current.setAttribute('viewBox', `${(x - span / 2).toFixed(1)} ${(z - span * 0.38).toFixed(1)} ${span} ${span * 0.76}`);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [track, span]);
  const b = h.bounds;
  const base = useMemo(() => {
    if (!city) return null;
    return (
      <g>
        {city.areas.filter((a) => AREA[a.k]).map((a, i) => (
          <polygon key={`a${i}`} points={pts(a.p)} fill={AREA[a.k]} />
        ))}
        {city.water.map((w, i) => (
          <polygon key={`w${i}`} points={pts(w)} fill="#8fc3dc" />
        ))}
        {city.islands.map((w, i) => (
          <polygon key={`i${i}`} points={pts(w)} fill="#e6dcc4" />
        ))}
        {city.rail.map((r, i) => (
          <polyline key={`r${i}`} points={pts(r)} fill="none" stroke="#7b3f6e" strokeWidth={2.2} strokeDasharray="5 3" />
        ))}
        {city.roads.map((r, i) => (
          <polyline key={i} points={pts(r.p)} fill="none" stroke={r.c === 'major' ? '#3d3b38' : r.c === 'minor' ? '#5a5650' : r.c === 'link' ? '#7a6a5a' : '#8a857c'} strokeWidth={r.w + (r.c === 'major' ? 2 : 0)} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </g>
    );
  }, [city]);
  const placeOf = new Map<number, PlaceId>((Object.entries(h.place) as [PlaceId, number][]).map(([p, id]) => [id, p]));
  const isSel = (place: PlaceId, lot: number | null) => !!selected && selected.place === place && (place !== 'lot' || selected.lot === lot);
  const view = span ? undefined : `${b.minX} ${b.minZ} ${b.maxX - b.minX} ${b.maxZ - b.minZ}`;
  const scale = whole ? 2.6 : 1;
  return (
    <div className={`minimap city-map${whole ? ' whole' : ''}`}>
      <svg ref={svg} viewBox={view ?? `${-130} ${-100} 260 198`} role="img" aria-label={`Map of ${h.real?.name ?? lgaById(lga).nick}`}>
        <rect x={b.minX - 400} y={b.minZ - 400} width={b.maxX - b.minX + 800} height={b.maxZ - b.minZ + 800} fill="#e6dcc4" />
        {base}
        {h.lots.map((id) => {
          const p = h.plots[id];
          const biz = businessOn(g, lga, id);
          return <PlotRect key={`l${id}`} p={p} fill={biz ? '#f2b705' : 'rgba(255,250,240,0.6)'} stroke={isSel('lot', id) ? '#d23c22' : '#c99400'} sw={isSel('lot', id) ? 2.5 : 1.2} dash={biz ? undefined : '3 2'} onClick={() => onWalk({ place: 'lot', lot: id })} title={biz ? biz.name : p.kind === 'farm' ? 'Farmland for lease' : 'Plot for lease'} />;
        })}
        {h.real?.landmarks.map((id) => (
          <circle key={`m${id}`} cx={h.plots[id].x} cy={h.plots[id].z} r={3.2 * scale} fill="#7b3fa0" stroke="#fffaf0" strokeWidth={0.8 * scale}>
            <title>{h.plots[id].landmark?.n}</title>
          </circle>
        ))}
        {[...placeOf].map(([id, place]) => {
          const p = h.plots[id];
          return (
            <g key={place} className="mm-hit" onClick={() => onWalk({ place })}>
              <PlotRect p={p} fill={place === 'home' ? '#d23c22' : '#fffaf0'} stroke={isSel(place, null) ? '#d23c22' : '#1f1d1a'} sw={isSel(place, null) ? 2.5 : 0.8} title={place === 'home' ? 'Home' : (p.real ?? PLACES[place].name)} />
              {whole && (
                <text x={p.x} y={p.z - p.d / 2 - 3} fontSize={11} textAnchor="middle" className="mm-label">
                  {place === 'home' ? 'Home' : PLACES[place].name}
                </text>
              )}
            </g>
          );
        })}
        <g className="mm-hit" onClick={() => onWalk({ place: 'busstop' })}>
          <circle cx={h.busStop[0]} cy={h.busStop[1]} r={4 * scale} fill="#2f63ad" stroke="#fffaf0" strokeWidth={1.2 * scale} />
          <title>{h.real ? `${h.real.stopName} bus stop` : 'Bus stop'}</title>
        </g>
        <circle ref={dot} r={4.5 * scale} fill="#d23c22" stroke="#fffaf0" strokeWidth={1.5 * scale} />
      </svg>
      <button className="minimap-grow" onClick={() => setWhole((v) => !v)} aria-label={whole ? 'Show the streets around you' : 'Show the whole district'} title={whole ? 'Close up' : 'Whole district'}>
        {whole ? '－' : '＋'}
      </button>
      <button className="minimap-x" onClick={onClose} aria-label="Hide the map">
        ✕
      </button>
      <div className="map-credit">© OpenStreetMap contributors</div>
    </div>
  );
}
