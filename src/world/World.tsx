import { Html, OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { ROLE_NAMES } from '../data/people';
import { partyById, type LeaderStyle } from '../data/politics';
import { PLACES, tradeById, type PlaceId } from '../data/trades';
import { lgaById, type SceneStyle } from '../data/world';
import { isMobile, stageOf } from '../engine/business';
import { DAY_NAMES, clockLabel, isRainySeason } from '../engine/calendar';
import { okadaBanned } from '../engine/economy';
import { officeTitle } from '../engine/elections';
import { COLS, MAIN_HALF, MAIN_Z, ROAD_X, ROAD_Z, ROWS, SIDE_HALF, doorOf, halfWidth, hood, route, walkable, type Plot, type Pt } from '../engine/map';
import { builders, buildType, estateKey, publicLandmark, type BuildId } from '../engine/property';
import type { Business, Game, Person } from '../engine/types';
import { Brt, Canoe, Car, Danfo, Keke, Mover, Okada, Person3D, Truck, Walker, mat, type Pose } from './Actors';
import { BizBuilding } from './BizBuildings';
import { Building, earthen } from './Buildings';
import { CityPedestrians, CityScene, CityStreetLife, CityTraffic, LANDMARK_HEIGHT, LandmarkModel, PlaceModel, billboardSpots, trafficAt } from './City';
import { useCity, type CityRender } from './cityData';
import { ESTATE_HEIGHT, EstateBuilding } from './Property';
import { labelTexture, nameTexture } from './textures';
import { Billboard, BusStop, Filler, FootBridge, NightLights, StreetLights, Streets, Tree, VacantLot, WALLS, fillerKinds, seeded } from './Town';

export interface WalkTarget {
  place?: PlaceId;
  lot?: number;
  point?: [number, number];
  /** Take a keke (or okada) instead of walking. */
  ride?: boolean;
  /** Stop where you are. */
  stop?: boolean;
  nonce: number;
}

export interface Selection {
  place: PlaceId;
  lot: number | null;
}

export interface Float {
  id: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

interface WorldProps {
  g: Game;
  /** The running clock, minutes after midnight. */
  clock: React.MutableRefObject<number>;
  busy: boolean;
  target: WalkTarget | null;
  selected: Selection | null;
  floats: Float[];
  onWalk: (t: Omit<WalkTarget, 'nonce'>) => void;
  onArrive: (place: PlaceId, lot: number | null) => void;
  onTalk: (person: number) => void;
  /** Written every frame with where you are, for the minimap. */
  track?: React.MutableRefObject<Pt>;
  /** Written every frame with the way still to go (empty when you are standing still), for the minimap and the HUD. */
  trail?: React.MutableRefObject<Pt[]>;
}

const X0 = ROAD_X[0];
const X1 = ROAD_X[1];

/** Sky, sun and ambient light for a time of day. */
function lightFor(t: number, rainy: boolean) {
  // The sun climbs quickly after dawn, so mornings are bright rather than murky.
  const day = Math.pow(Math.max(0, Math.sin(((t - 0.22) / 0.56) * Math.PI)), 0.6);
  const dusk = Math.max(0, 1 - Math.abs(t - 0.74) / 0.06) + Math.max(0, 1 - Math.abs(t - 0.26) / 0.05);
  const night = new THREE.Color('#111832');
  const noon = new THREE.Color(rainy ? '#a7b3bc' : '#a9dcf0');
  const sunset = new THREE.Color('#f0a167');
  const sky = night.clone().lerp(noon, Math.min(1, day * 1.4)).lerp(sunset, Math.min(0.7, dusk * 0.7) * (rainy ? 0.3 : 1));
  // Overhead the sky is deeper than at the horizon.
  const zenith = new THREE.Color('#060a1c').lerp(new THREE.Color(rainy ? '#7f8f9c' : '#3f8fd6'), Math.min(1, day * 1.4)).lerp(new THREE.Color('#6a5a8c'), Math.min(0.5, dusk * 0.5) * (rainy ? 0.3 : 1));
  return {
    sky,
    zenith,
    stars: Math.max(0, 1 - day * 5),
    sun: (rainy ? 1.4 : 3) * day,
    ambient: 0.8 + 1.0 * day,
    angle: (t - 0.25) * Math.PI * 2,
    night: day < 0.12,
    /** Warm sun near dawn and dusk, white at noon. */
    warm: new THREE.Color('#fff4dc').lerp(new THREE.Color('#ffb36b'), Math.min(1, dusk)).getStyle(),
  };
}

/** Does this street have NEPA tonight? Deterministic per day, more likely with more grid hours. */
function hasPower(g: Game): boolean {
  const grid = g.prices[lgaById(g.player.at).state].grid;
  const h = Math.abs(Math.sin(g.week * 12.9898 + g.day * 78.233 + g.player.at.length)) % 1;
  return h < grid / 16;
}

/** The centre of whatever you are standing at, so you can turn to face it. */
function facingPoint(lga: string, place: PlaceId, lot: number | null): Pt | null {
  const h = hood(lga);
  if (place === 'lot' && lot !== null && lot >= 0) return [h.plots[lot].x, h.plots[lot].z];
  if (place === 'busstop') return [h.busStop[0] + Math.sin(h.busRot) * 4, h.busStop[1] + Math.cos(h.busRot) * 4];
  const id = h.place[place];
  return id !== undefined ? [h.plots[id].x, h.plots[id].z] : null;
}

export function World(props: WorldProps) {
  const h = hood(props.g.player.at);
  const city = useCity(h.real ? props.g.player.at : null);
  // Slow machines and phones get a softer picture rather than a stutter: the resolution steps down when
  // frames are slow (and back up when there is room), and at the bottom the sun stops casting shadows.
  const [quality, setQuality] = useState(0.8);
  const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 0.7 + Math.round(quality * 4) * 0.225);
  return (
    <>
      <Canvas flat shadows dpr={dpr} camera={{ fov: 40, near: 0.5, far: 700, position: [20, 22, 34] }} gl={{ antialias: true }} onCreated={(s) => { if (import.meta.env.DEV) (window as unknown as { __gl: unknown }).__gl = s.gl; }}>
        <PerformanceMonitor factor={0.8} bounds={() => [36, 55]} onChange={({ factor }) => setQuality(factor)} />
        <Scene {...props} shadows={quality > 0.12} />
      </Canvas>
      {h.real && !city && <div className="map-loading">Loading the map of {h.real.name}…</div>}
    </>
  );
}

function Scene({ g, clock, busy, target, selected, floats, onWalk: onWalkNow, onArrive, onTalk, track, trail, shadows }: WorldProps & { shadows: boolean }) {
  // One function for the life of the scene, so the buildings are not all rebuilt whenever the game ticks.
  const walkRef = useRef(onWalkNow);
  walkRef.current = onWalkNow;
  const onWalk = useCallback((t: Omit<WalkTarget, 'nonce'>) => walkRef.current(t), []);
  const lga = lgaById(g.player.at);
  const style = lga.style;
  const h = hood(lga.id);
  // Districts built from real map data load their streets first; until then you stay put.
  const city = useCity(h.real ? lga.id : null);
  const mapReady = !h.real || !!city;
  const rainy = isRainySeason(g.week);
  const hour = (g.minute / 60) % 24;
  const night = hour >= 19.5 || hour < 5.5;
  const power = hasPower(g);
  const lightsOn = night && power;
  const player = useRef<THREE.Group>(null);
  const pos = useRef(new THREE.Vector3());
  const path = useRef<Pt[]>([]);
  const dest = useRef<{ place: PlaceId; lot: number | null } | null>(null);
  // The pose and the ride live in refs (read every frame) and in state (to re-render).
  const pose = useRef<Pose>('idle');
  const [poseState, setPoseState] = useState<Pose>('idle');
  const [riding, setRiding] = useState(false);
  const setPose = (p: Pose) => {
    if (pose.current === p) return;
    pose.current = p;
    setPoseState(p);
  };

  // Spawn at the door of the current place when the neighbourhood or the day changes.
  const spawnKey = `${lga.id}:${g.week}:${g.day}`;
  useEffect(() => {
    const [x, z] = doorOf(lga.id, g.place, g.lot);
    pos.current.set(x, 0, z);
    path.current = [];
    dest.current = null;
    setRiding(false);
    if (player.current) player.current.position.copy(pos.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spawnKey]);

  useEffect(() => {
    if (!target || !mapReady) return;
    let to: Pt;
    if (target.stop) {
      path.current = [];
      dest.current = null;
      setRiding(false);
      return;
    }
    if (target.place) {
      to = doorOf(lga.id, target.place, target.lot ?? null);
      dest.current = { place: target.place, lot: target.lot ?? null };
    } else if (target.point) {
      to = walkable(lga.id, target.point);
      dest.current = null;
    } else return;
    path.current = route(lga.id, [pos.current.x, pos.current.z], to, !!target.ride).slice(1);
    setRiding(!!target.ride);
    // Already standing there: open its menu straight away.
    const d = dest.current;
    if (d && Math.hypot(to[0] - pos.current.x, to[1] - pos.current.z) < 0.6) {
      path.current = [];
      dest.current = null;
      setRiding(false);
      onArrive(d.place, d.lot);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, lga.id, mapReady]);

  useFrame((_, dt) => {
    const p = player.current;
    if (!p) return;
    const next = path.current[0];
    if (next && !busy) {
      const dx = next[0] - pos.current.x;
      const dz = next[1] - pos.current.z;
      const dist = Math.hypot(dx, dz);
      const left = path.current.reduce((s, q, i) => s + (i === 0 ? dist : Math.hypot(q[0] - path.current[i - 1][0], q[1] - path.current[i - 1][1])), 0);
      // Long walks across a real district go at a brisk pace; rides faster still.
      const speed = riding ? (left > 200 ? 38 : 26) : left > 150 ? 20 : left > 40 ? 14 : 9;
      if (dist < 0.2) {
        path.current.shift();
        if (!path.current.length) {
          setPose('idle');
          setRiding(false);
          const d = dest.current;
          if (d) {
            const f = facingPoint(lga.id, d.place, d.lot);
            if (f) p.rotation.y = Math.atan2(f[0] - pos.current.x, f[1] - pos.current.z);
            dest.current = null;
            onArrive(d.place, d.lot);
          }
        }
      } else {
        const step = Math.min(dist, speed * dt);
        pos.current.x += (dx / dist) * step;
        pos.current.z += (dz / dist) * step;
        p.rotation.y = Math.atan2(dx, dz);
        if (pose.current !== 'walk') setPose('walk');
      }
    } else if (busy && pose.current !== 'work') setPose('work');
    else if (!busy && !next && pose.current !== 'idle') setPose('idle');
    p.position.copy(pos.current);
    if (track) track.current = [pos.current.x, pos.current.z];
    if (trail) trail.current = path.current;
  });

  const walkTo = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 6) return;
    walkRef.current({ point: [e.point.x, e.point.z] });
  }, []);

  const me = g.people[g.me];
  const party = g.player.party ? partyById(g.player.party) : partyById(g.states[lga.state].party);
  const kekeColor = lga.state === 'KN' ? '#d6b21a' : '#1e8f5a';
  const walls = WALLS[style];
  const prices = g.prices[lga.state];
  // What has been bought, pulled down or built here, and the businesses on the plots: both only change
  // now and then, so what is drawn from them is kept until they do.
  const estKey = estateKey(g, lga.id);
  const est = useMemo(() => estateHere(g, lga.id), [estKey, lga.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const bizKey = g.businesses.map((b) => (b.lga === lga.id && b.plot >= 0 ? `${b.id}:${b.plot}:${b.type}:${b.level}:${b.name}:${b.owner === g.me}` : '')).join('|');
  const bizHere = useMemo(() => g.businesses.filter((b) => b.lga === lga.id && b.plot >= 0), [bizKey, lga.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const selLot = selected && selected.place === 'lot' ? selected.lot : null;
  const bridgeAt = useMemo(() => (h.real ? { x: h.real.road[0] + Math.cos(h.busRot) * 14, z: h.real.road[1] - Math.sin(h.busRot) * 14, rot: h.busRot, span: h.real.span } : undefined), [h]);
  const okada = !okadaBanned(g, lga.id);
  const isSel = (place: PlaceId, lot: number | null) => !!selected && selected.place === place && (place !== 'lot' || selected.lot === lot);
  const ringAt = selected ? doorOf(lga.id, selected.place, selected.lot) : null;
  const pointAt = target?.point ? walkable(lga.id, target.point) : null;

  return (
    <>
      <DayLight clock={clock} rainy={rainy} playerPos={pos} ground={earthen(style) ? '#b5875a' : '#8a8577'} shadows={shadows} />
      <FollowCamera target={pos} />

      {h.real ? (
        city && <CitySceneM city={city} h={h} style={style} tar={g.lgaInfra[lga.id].roads >= 45} lightsOn={lightsOn} night={night} playerPos={pos} onClick={walkTo as never} />
      ) : (
        <>
          <Streets lga={lga.id} style={style} roads={g.lgaInfra[lga.id].roads} onClick={walkTo as never} />
          <StreetLights lightsOn={lightsOn} />
          <NightLights lightsOn={lightsOn} playerPos={pos} />
          <Backdrop style={style} lga={lga.id} lightsOn={lightsOn} />
        </>
      )}

      {(Object.entries(h.place) as [PlaceId, number][]).map(([place, id], i) => {
        const plot = h.plots[id];
        const farmPlot = plot.kind === 'farm';
        // Airports and jetties, and the real markets and motor parks of the mapped districts, fill their whole plot.
        const whole = place === 'airport' || place === 'jetty' || (!!plot.real && (place === 'park' || place === 'palace' || (place === 'market' && !g.demolition[g.player.at])));
        if (whole) {
          return (
            <PlotGroup key={place} plot={plot} playerPos={pos} label={placeLabel(place, plot)} labelY={place === 'airport' ? 21 : 8} labelRange={90} open={place !== 'airport' && place !== 'palace'} selected={isSel(place, null)} onClick={() => onWalk({ place })}>
              <PlaceModelM kind={place} w={plot.w} d={plot.d} style={style} lit={lightsOn} sign={plot.real ?? (place === 'airport' ? lga.airport : place === 'jetty' ? lga.jetty : null) ?? PLACES[place].name} />
            </PlotGroup>
          );
        }
        return (
          <PlotGroup key={place} plot={plot} playerPos={pos} label={placeLabel(place, plot)} labelY={place === 'office' ? 19 : 9.5} labelRange={70} selected={isSel(place, null)} onClick={() => onWalk({ place })}>
            <group position={[0, 0, plot.d / 2 - (farmPlot ? 7 : 4.3)]} scale={farmPlot ? 1.5 : plot.real ? 1.2 : 1}>
              <BuildingM
                kind={place}
                style={style}
                wall={walls[i % walls.length]}
                tall={1}
                night={night}
                power={power}
                housing={g.player.home === g.player.at ? g.player.housing : 'room'}
                generator={g.player.hasGenerator && g.player.home === g.player.at}
                demolished={place === 'market' && g.demolition[g.player.at] > 0}
                party={party}
                ownSign={null}
                kekeColor={kekeColor}
                poster={place === 'venue' ? posterFor(g, lga.id) : null}
              />
            </group>
          </PlotGroup>
        );
      })}

      <PlotLists lga={lga.id} style={style} lightsOn={lightsOn} night={night} power={power} petrol={prices.petrol} scarcity={prices.scarcity} playerPos={pos} onWalk={onWalk} est={est} biz={bizHere} sel={selLot} />

      <group
        onClick={(e) => {
          e.stopPropagation();
          if (e.delta > 6) return;
          onWalk({ place: 'busstop' });
        }}
      >
        <BusStopM lga={lga.id} name={h.real?.stopName ?? lga.nick} lightsOn={lightsOn} />
        <PlaceLabel x={h.busStop[0]} z={h.busStop[1]} y={5.2} text={h.real ? `${h.real.stopName} bus stop` : 'Bus stop'} playerPos={pos} selected={isSel('busstop', null)} />
      </group>
      <FootBridgeM lga={lga.id} at={bridgeAt} />
      <Billboards g={g} lga={lga.id} lit={lightsOn} city={city} />

      {h.real ? (
        city && (
          <>
            <CityTrafficM city={city} h={h} lagos={lga.state === 'LA'} kekeColor={kekeColor} okada={okada} playerPos={pos} busy={trafficAt(hour)} lightsOn={night} />
            <CityPedestriansM city={city} h={h} playerPos={pos} rainy={rainy} />
            <CityStreetLifeM city={city} h={h} playerPos={pos} rainy={rainy} />
          </>
        )
      ) : (
        <>
          <Traffic g={g} style={style} lga={lga.id} kekeColor={kekeColor} okada={okada} />
          <StoppingDanfo lga={lga.id} lagos={lga.state === 'LA'} kekeColor={kekeColor} />
          <Pedestrians seed={lga.id} count={22} rainy={rainy} />
        </>
      )}
      <Townsfolk g={g} lga={lga.id} playerPos={pos} onTalk={onTalk} />
      {rainy && <Rain playerPos={pos} />}

      <group ref={player}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}>
          <circleGeometry args={[0.85, 24]} />
          <meshBasicMaterial color="#f2b705" transparent opacity={0.55} />
        </mesh>
        {riding ? (
          <group rotation={[0, -Math.PI / 2, 0]}>{okada ? <Okada rider={{ skin: 3, hair: 0, outfit: 5, accent: 2, glasses: false }} /> : <Keke color={kekeColor} />}</group>
        ) : (
          <group position={[0, 0.16, 0]}>
          <Person3D looks={me.looks} gender={me.gender} pose={poseState} marker />
        </group>
        )}
        {floats.map((f, i) => (
          <Html key={f.id} position={[0, 3.2 + i * 0.55, 0]} center style={{ pointerEvents: 'none' }}>
            <div className={`float-text ${f.tone}`}>{f.text}</div>
          </Html>
        ))}
      </group>
      <RouteGuide path={path} pos={pos} />
      {ringAt && !busy && <SelectRing x={ringAt[0]} z={ringAt[1]} />}
      {pointAt && !target?.stop && <TargetRing x={pointAt[0]} z={pointAt[1]} />}
    </>
  );
}

const BuildingM = memo(Building);
const PlaceModelM = memo(PlaceModel);
const CitySceneM = memo(CityScene);
const CityTrafficM = memo(CityTraffic);
const CityPedestriansM = memo(CityPedestrians);
const CityStreetLifeM = memo(CityStreetLife);
const BusStopM = memo(BusStop);
const FootBridgeM = memo(FootBridge);

/** What stands on a plot that somebody has bought, cleared or built on. */
interface EstateHere {
  on: BuildId | 'site' | 'empty' | null;
  mine: boolean;
  /** The contractor on site. */
  board?: string;
}

function estateHere(g: Game, lga: string): Map<number, EstateHere> {
  const out = new Map<number, EstateHere>();
  for (const [key, d] of Object.entries(g.estate ?? {})) {
    if (!key.startsWith(`${lga}:`)) continue;
    const site = !!d.site && g.week < d.site.done;
    out.set(Number(key.slice(lga.length + 1)), { on: site ? 'site' : (d.site?.kind ?? d.on ?? null), mine: d.owner === g.me, board: site ? builders(g)[d.site!.firm]?.name : undefined });
  }
  return out;
}

const estateLabel = (e: EstateHere) => (e.on === 'site' ? 'Building site' : e.on === 'empty' ? (e.mine ? 'Your plot' : 'Empty plot') : e.on ? `${e.mine ? 'Your ' : ''}${e.mine ? buildType(e.on).name.toLowerCase() : buildType(e.on).name}` : e.mine ? 'Your property' : undefined);

/**
 * The plots for lease, the ordinary buildings and the famous ones. They are many, and they only change
 * when somebody buys, builds or expands, so they are drawn once and kept while the clock runs.
 */
const PlotLists = memo(function PlotLists({ lga, style, lightsOn, night, power, petrol, scarcity, playerPos, onWalk, est, biz, sel }: { lga: string; style: SceneStyle; lightsOn: boolean; night: boolean; power: boolean; petrol: number; scarcity: boolean; playerPos: React.MutableRefObject<THREE.Vector3>; onWalk: (t: Omit<WalkTarget, 'nonce'>) => void; est: Map<number, EstateHere>; biz: Business[]; sel: number | null }) {
  const h = hood(lga);
  const walls = WALLS[style];
  const kinds = fillerKinds(lga);
  const estate = (id: number, e: EstateHere) => <EstateBuilding plot={h.plots[id]} on={e.on!} style={style} wall={walls[(id * 7) % walls.length]} lit={lightsOn} power={power} board={e.board} />;
  return (
    <>
      {h.lots.map((id) => {
        const plot = h.plots[id];
        const b = biz.find((x) => x.plot === id);
        const e = est.get(id);
        const built = !b && e?.on && e.on !== 'empty' ? e : null;
        const label = b ? b.name : built ? estateLabel(built)! : e?.mine ? (plot.kind === 'farm' ? 'Your farmland' : 'Your plot') : plot.kind === 'farm' ? 'Farmland for sale or lease' : 'Plot for sale or lease';
        const tall = b ? stageOf(b.type, b.level) : 0;
        return (
          <PlotGroup key={`lot${id}`} plot={plot} playerPos={playerPos} label={label} labelY={b ? 5 + tall * 3 : built ? ESTATE_HEIGHT[built.on!] : 4} labelRange={b || built ? 90 : 26} own={!!b || !!e?.mine} selected={sel === id} onClick={() => onWalk({ place: 'lot', lot: id })}>
            {b ? <BizBuilding b={b} w={plot.w} d={plot.d} style={style} wall={walls[id % walls.length]} lit={lightsOn || (night && tall >= 3)} power={power} /> : built ? estate(id, built) : <VacantLot plot={plot} />}
          </PlotGroup>
        );
      })}

      {h.fillers.map((id) => {
        const plot = h.plots[id];
        const e = est.get(id);
        return (
          <PlotGroup key={`f${id}`} plot={plot} playerPos={playerPos} label={e ? estateLabel(e) : undefined} labelY={e?.on ? ESTATE_HEIGHT[e.on] : 7} labelRange={e?.mine ? 90 : 40} own={e?.mine} selected={sel === id} onClick={() => onWalk({ place: 'lot', lot: id })}>
            {e?.on ? estate(id, e) : <Filler plot={plot} kind={kinds.get(id) ?? 'house'} style={style} wall={walls[(id * 7) % walls.length]} lit={lightsOn} power={power} seed={id} petrol={petrol} scarcity={scarcity} />}
          </PlotGroup>
        );
      })}

      {h.real?.landmarks.map((id) => {
        const plot = h.plots[id];
        const lm = plot.landmark!;
        const e = est.get(id);
        return (
          <PlotGroup key={`lm${id}`} plot={plot} playerPos={playerPos} label={e?.on ? estateLabel(e) : lm.n} labelY={e?.on ? ESTATE_HEIGHT[e.on] : (LANDMARK_HEIGHT[lm.k] ?? 7) + 2.5} labelRange={90} own={e?.mine} selected={sel === id} onClick={() => onWalk(publicLandmark(lm.k) ? { point: plot.door } : { place: 'lot', lot: id })}>
            {e?.on ? estate(id, e) : <LandmarkModel kind={lm.k} w={plot.w} d={plot.d} style={style} lit={lightsOn} name={lm.n} />}
          </PlotGroup>
        );
      })}
    </>
  );
});

/** What a place's floating label says: the real name where the map has one ("Computer Village"), with the kind of place for streets. */
function placeLabel(place: PlaceId, plot: Plot): string {
  if (place === 'home') return 'Home';
  if (!plot.real) return PLACES[place].name;
  return /\b(street|way|road|avenue|close|crescent|marina)\b/i.test(plot.real) ? `${PLACES[place].name}, ${plot.real}` : plot.real;
}

/** The next show at this LGA's event centre, for the poster. */
function posterFor(g: Game, lga: string): string | null {
  const next = g.culture
    .filter((e) => e.week === g.week && e.lga === lga && e.place === 'venue' && (e.day > g.day || (e.day === g.day && e.end > g.minute)))
    .sort((a, b) => a.day - b.day || a.start - b.start)[0];
  if (!next) return null;
  return `${next.title.toUpperCase()} · ${next.day === g.day ? 'TONIGHT' : DAY_NAMES[next.day].toUpperCase()} ${clockLabel(next.start)}`;
}

/**
 * A plot and what stands on it. Buildings between you and the camera sink out of the way,
 * the way walls go down in a life sim, so you can always see yourself and the street.
 */
function PlotGroup({ plot, playerPos, label, labelY = 9, labelRange = 60, own, open, selected, onClick, children }: { plot: Plot; playerPos: React.MutableRefObject<THREE.Vector3>; label?: string; labelY?: number; labelRange?: number; own?: boolean; /** Open stalls and sheds you can see through: never sunk. */ open?: boolean; selected?: boolean; onClick: () => void; children: ReactNode }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const tag = useRef<THREE.Sprite>(null);
  const reach = 372 + Math.max(plot.w, plot.d);
  const { camera } = useThree();
  const tex = useMemo(() => (label ? labelTexture(label, !!selected || !!own) : null), [label, selected, own]);
  const box = useRef(new THREE.Box3());
  const measured = useRef(-1);
  useFrame(({ clock }, dt) => {
    const b = body.current;
    const r = root.current;
    if (!b || !r) return;
    // Past where the haze swallows everything there is nothing to draw, and nothing to work out.
    const seen = Math.hypot(plot.x - camera.position.x, plot.z - camera.position.z) < reach;
    if (r.visible !== seen) r.visible = seen;
    if (!seen) return;
    const p = playerPos.current;
    const near = Math.abs(plot.x - p.x) + Math.abs(plot.z - p.z);
    // Only a building close by can stand between you and the camera.
    if (near > 190 && measured.current >= 0) {
      if (b.scale.y !== 1) b.scale.y = 1;
      if (tag.current) {
        tag.current.visible = !!selected;
        tag.current.position.y = labelY;
      }
      return;
    }
    // Measure the building now and then (it grows when you expand), undoing the cutaway's own squash.
    if (clock.elapsedTime - measured.current > 2 || measured.current < 0) {
      measured.current = clock.elapsedTime;
      b.updateWorldMatrix(true, true);
      box.current.setFromObject(b);
      box.current.max.y /= Math.max(0.05, b.scale.y);
    }
    // Sink it only if it actually stands between the camera and you.
    const cut = !open && blocks(box.current, camera.position, p);
    const want = cut ? 0.1 : 1;
    if (Math.abs(b.scale.y - want) > 0.002) b.scale.y += (want - b.scale.y) * Math.min(1, dt * 8);
    if (tag.current) {
      tag.current.visible = !!selected || Math.hypot(plot.x - p.x, plot.z - p.z) < labelRange;
      tag.current.position.y = labelY * b.scale.y + 2.6 * (1 - b.scale.y);
    }
  });
  return (
    <group ref={root} position={[plot.x, 0, plot.z]}>
      <group
        rotation={[0, plot.rot, 0]}
        onClick={(e) => {
          e.stopPropagation();
          if (e.delta > 6) return;
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
      >
        <group ref={body}>{children}</group>
      </group>
      {tex && (
        <sprite ref={tag} position={[0, labelY, 0]} scale={[0.115, 0.025, 1]}>
          <spriteMaterial map={tex} depthTest={false} transparent sizeAttenuation={false} />
        </sprite>
      )}
    </group>
  );
}

const ray = new THREE.Ray();
const aim = new THREE.Vector3();
const hit = new THREE.Vector3();

/** Does this box hide your body (waist or head) from the camera? */
function blocks(box: THREE.Box3, cam: THREE.Vector3, p: THREE.Vector3): boolean {
  if (box.isEmpty()) return false;
  for (const y of [1, 1.9]) {
    aim.set(p.x, y, p.z);
    const dist = cam.distanceTo(aim);
    ray.set(cam, hit.copy(aim).sub(cam).normalize());
    if (ray.intersectBox(box, hit) && cam.distanceTo(hit) < dist - 0.4) return true;
  }
  return false;
}

function PlaceLabel({ x, z, y, text, playerPos, selected }: { x: number; z: number; y: number; text: string; playerPos: React.MutableRefObject<THREE.Vector3>; selected: boolean }) {
  const ref = useRef<THREE.Sprite>(null);
  const tex = useMemo(() => labelTexture(text, selected), [text, selected]);
  useFrame(() => {
    if (ref.current) ref.current.visible = selected || Math.hypot(x - playerPos.current.x, z - playerPos.current.z) < 70;
  });
  return (
    <sprite ref={ref} position={[x, y, z]} scale={[0.115, 0.025, 1]}>
      <spriteMaterial map={tex} depthTest={false} transparent sizeAttenuation={false} />
    </sprite>
  );
}

/** The sky: the horizon's colour low down (so the haze melts into it), deepening overhead. */
const SKY = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: { uLow: { value: new THREE.Color('#a9dcf0') }, uHigh: { value: new THREE.Color('#3f8fd6') } },
  vertexShader: 'varying float vUp; void main() { vUp = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 uLow; uniform vec3 uHigh; varying float vUp; void main() { gl_FragColor = vec4(mix(uLow, uHigh, smoothstep(0.02, 0.75, vUp)), 1.0); }',
});

/** Eases sky, sun and ambient light towards the requested time of day, every frame. The sun's shadow box follows you. */
function DayLight({ clock, rainy, playerPos, ground, shadows }: { clock: React.MutableRefObject<number>; rainy: boolean; playerPos: React.MutableRefObject<THREE.Vector3>; ground: string; shadows: boolean }) {
  const { scene, camera } = useThree();
  const dome = useRef<THREE.Group>(null);
  const stars = useRef<THREE.Points>(null);
  const starGeo = useMemo(() => {
    const arr = new Float32Array(500 * 3);
    for (let i = 0; i < 500; i++) {
      // Scattered over the upper sky.
      const a = Math.random() * Math.PI * 2;
      const up = 0.12 + Math.random() * 0.88;
      const r = Math.sqrt(1 - up * up);
      arr.set([Math.cos(a) * r * 560, up * 560, Math.sin(a) * r * 560], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return geo;
  }, []);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const moon = useRef<THREE.DirectionalLight>(null);
  const shown = useRef((clock.current % 1440) / 1440);
  useEffect(() => {
    scene.fog = new THREE.Fog('#8fcfe8', 130, 360);
  }, [scene]);
  useEffect(() => {
    const s = sun.current;
    if (!s) return;
    // A light's target only updates its matrix while it is part of the scene.
    scene.add(s.target);
    return () => {
      scene.remove(s.target);
    };
  }, [scene]);
  useFrame((_, dt) => {
    const time = (clock.current % 1440) / 1440;
    // Going backwards means a new morning: jump rather than rewind the sun.
    if (time < shown.current - 0.3) shown.current = time;
    shown.current += (time - shown.current) * Math.min(1, dt * 1.8);
    const l = lightFor(shown.current, rainy);
    scene.background = l.sky;
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(l.sky);
    if (dome.current) {
      dome.current.position.copy(camera.position);
      SKY.uniforms.uLow.value.copy(l.sky);
      SKY.uniforms.uHigh.value.copy(l.zenith);
    }
    if (stars.current) (stars.current.material as THREE.PointsMaterial).opacity = l.stars * (rainy ? 0.3 : 0.9);
    if (hemi.current) {
      // Light from the sky is mostly white; only a hint of the sky's colour, so materials keep their saturation.
      hemi.current.color.set('#ffffff').lerp(l.sky, 0.25);
      hemi.current.intensity = l.ambient;
    }
    const p = playerPos.current;
    if (sun.current) {
      sun.current.intensity = l.sun;
      sun.current.color.set(l.warm);
      // Snap the shadow box to a coarse grid so shadows do not shimmer as you walk.
      const sx = Math.round(p.x / 8) * 8;
      const sz = Math.round(p.z / 8) * 8;
      sun.current.position.set(sx + Math.cos(l.angle) * 80, Math.max(8, Math.sin(l.angle) * 90), sz + 40);
      sun.current.target.position.set(sx, 0, sz);
    }
    if (moon.current) moon.current.intensity = l.night ? 0.4 : 0;
  });
  return (
    <>
      <group ref={dome}>
        <mesh material={SKY} renderOrder={-10} frustumCulled={false}>
          <sphereGeometry args={[580, 24, 12]} />
        </mesh>
        <points ref={stars} geometry={starGeo} renderOrder={-9} frustumCulled={false}>
          <pointsMaterial color="#ffffff" size={1.6} sizeAttenuation={false} transparent opacity={0} depthWrite={false} fog={false} />
        </points>
      </group>
      <hemisphereLight ref={hemi} args={['#8fcfe8', ground, 0.8]} />
      <directionalLight ref={sun} castShadow={shadows} shadow-mapSize={[2048, 2048]} shadow-camera-left={-55} shadow-camera-right={55} shadow-camera-top={55} shadow-camera-bottom={-55} shadow-camera-far={300} shadow-bias={-0.0005} />
      <directionalLight ref={moon} position={[-40, 60, -20]} intensity={0} color="#8ea6ff" />
    </>
  );
}

function FollowCamera({ target }: { target: React.MutableRefObject<THREE.Vector3> }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  const last = useRef(new THREE.Vector3());
  const init = useRef(false);
  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    const want = target.current.clone().setY(1.2);
    if (!init.current || want.distanceTo(last.current) > 60) {
      // First frame, or a jump to another neighbourhood: cut rather than glide.
      // Narrow (phone) screens see less sideways, so start further back.
      const k = size.width / size.height < 0.8 ? 1.35 : 1;
      camera.position.set(want.x + 7 * k, 26 * k, want.z + 33 * k);
      c.target.copy(want);
      last.current.copy(want);
      init.current = true;
    }
    const next = last.current.clone().lerp(want, 0.12);
    const delta = next.clone().sub(last.current);
    camera.position.add(delta);
    c.target.copy(next);
    last.current.copy(next);
    c.update();
  });
  return <OrbitControls ref={controls} enablePan={false} minDistance={12} maxDistance={120} minPolarAngle={0.3} maxPolarAngle={1.2} enableDamping dampingFactor={0.12} />;
}

/** The skyline and landscape beyond the neighbourhood. */
function Backdrop({ style, lga, lightsOn }: { style: SceneStyle; lga: string; lightsOn: boolean }) {
  const north = hood(lga).bounds.minZ - 14;
  const items = useMemo(() => {
    const rnd = seeded(`bd:${lga}`);
    const out: ReactNode[] = [];
    const towers = style === 'lagos-rich' || style === 'ph-city' || style === 'lagos-island';
    const blocks = style === 'lagos-dense' || style === 'lagos-port' || style === 'kano-market';
    // A ring of distant buildings: north, west and east.
    const ring: Pt[] = [];
    for (let i = 0; i < 14; i++) ring.push([X0 - 20 + (i / 13) * (X1 - X0 + 40), north - 16 - rnd() * 24]);
    for (let i = 0; i < 6; i++) ring.push([X0 - 30 - rnd() * 20, north + 20 + i * 26]);
    for (let i = 0; i < 6; i++) ring.push([X1 + 30 + rnd() * 20, north + 20 + i * 26]);
    ring.forEach(([x, z], i) => {
      if (towers) {
        const hgt = 14 + rnd() * (style === 'lagos-rich' ? 44 : 24);
        out.push(
          <mesh key={`t${i}`} position={[x, hgt / 2, z]} material={mat(style === 'lagos-rich' ? '#5f9cc2' : '#a9b7c0', style === 'lagos-rich' ? { rough: 0.25, metal: 0.3 } : {})}>
            <boxGeometry args={[8 + rnd() * 6, hgt, 8 + rnd() * 5]} />
          </mesh>,
        );
      } else if (blocks) {
        const hgt = 5 + rnd() * 9;
        out.push(
          <mesh key={`b${i}`} position={[x, hgt / 2, z]} material={mat(style === 'kano-market' ? '#d6a46c' : '#b9b2a2')}>
            <boxGeometry args={[9 + rnd() * 5, hgt, 8]} />
          </mesh>,
        );
      } else {
        out.push(<Tree key={`tr${i}`} x={x} z={z} kind={earthen(style) ? 'neem' : 'palm'} />);
      }
    });
    if (style === 'kano-old') {
      // The ancient city wall, with crenellations, along the north of town.
      const span = X1 - X0 + 60;
      out.push(
        <mesh key="wall" position={[(X0 + X1) / 2, 2.6, north - 6]} material={mat('#b87a43')}>
          <boxGeometry args={[span, 5.2, 2.2]} />
        </mesh>,
      );
      for (let i = 0; i < span / 4; i++) {
        out.push(
          <mesh key={`cr${i}`} position={[X0 - 30 + i * 4, 5.8, north - 6]} material={mat('#b87a43')}>
            <boxGeometry args={[1.6, 1.2, 2.2]} />
          </mesh>,
        );
      }
    }
    if (style === 'kano-farm') {
      for (let i = 0; i < 10; i++) {
        out.push(
          <mesh key={`f${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[(X0 + X1) / 2, 0.005, north - 10 - i * 5]} material={mat(i % 2 ? '#a9b04a' : '#c2b45c')}>
            <planeGeometry args={[X1 - X0 + 80, 3.4]} />
          </mesh>,
        );
      }
    }
    if (style === 'ph-city' || style === 'ph-industrial' || style === 'rivers-water') {
      out.push(
        <group key="flare" position={[X1 + 20, 0, north - 40]}>
          <mesh position={[0, 14, 0]} material={mat('#8f8a80', { metal: 0.5 })}>
            <cylinderGeometry args={[0.6, 0.8, 28, 8]} />
          </mesh>
          <mesh position={[0, 30, 0]} material={mat('#ff8a2a', { emissive: '#ff5a1a' })}>
            <coneGeometry args={[1.4, 5, 8]} />
          </mesh>
          <pointLight position={[0, 31, 0]} color="#ff7a2a" intensity={lightsOn ? 60 : 25} distance={140} decay={1.4} />
        </group>,
      );
    }
    if (style === 'ph-industrial') {
      for (let i = 0; i < 5; i++) {
        out.push(
          <mesh key={`tk${i}`} position={[X0 + 20 + i * 24, 4, north - 22]} material={mat('#dcd6ca', { metal: 0.4 })}>
            <cylinderGeometry args={[6, 6, 8, 16]} />
          </mesh>,
        );
      }
    }
    if (style === 'lagos-port') {
      for (let i = 0; i < 3; i++) {
        out.push(
          <group key={`crane${i}`} position={[X0 + 40 + i * 50, 0, north - 30]}>
            <mesh position={[0, 12, 0]} material={mat('#c2552d')}>
              <boxGeometry args={[1.2, 24, 1.2]} />
            </mesh>
            <mesh position={[8, 23, 0]} material={mat('#c2552d')}>
              <boxGeometry args={[18, 1, 1]} />
            </mesh>
            {[0, 1, 2].map((k) => (
              <mesh key={k} position={[-6 + k * 6.2, 1.3, 8]} material={mat(['#2f63ad', '#d23c22', '#1e8f5a'][k])}>
                <boxGeometry args={[6, 2.6, 2.4]} />
              </mesh>
            ))}
          </group>,
        );
      }
    }
    // Trees in the gaps at the ends of the streets.
    for (let i = 0; i < 18; i++) {
      const side = rnd() > 0.5;
      out.push(<Tree key={`e${i}`} x={side ? X1 + 6 + rnd() * 18 : X0 - 6 - rnd() * 18} z={ROWS[0] + rnd() * (ROWS[ROWS.length - 1] - ROWS[0] + 20)} kind={earthen(style) ? 'neem' : rnd() > 0.5 ? 'palm' : 'neem'} />);
    }
    return out;
  }, [style, lga, north, lightsOn]);

  return (
    <group>
      {items}
      {style === 'rivers-water' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(X0 + X1) / 2, 0.03, north - 30]} material={mat('#3f7f99', { rough: 0.2, metal: 0.1 })}>
          <planeGeometry args={[800, 44]} />
        </mesh>
      )}
      {style === 'rivers-water' &&
        [0, 1, 2].map((i) => (
          <Mover key={`c${i}`} z={north - 20 - i * 9} from={X0 - 60} to={X1 + 60} speed={2 + i} dir={i % 2 ? -1 : 1} offset={i * 30}>
            <Canoe paddler={{ skin: i + 1, hair: 0, outfit: i + 2, accent: 1, glasses: false }} />
          </Mover>
        ))}
    </group>
  );
}

const SLOGANS: Record<LeaderStyle, string> = {
  reformer: 'Building a greater state',
  populist: 'Your welfare, our priority',
  looter: 'Ever working for you',
  indifferent: 'Steady progress',
  tyrant: 'Obey before you complain',
};

const ADS = [
  { head: 'ZOBO FRESH', sub: 'Cold. Sweet. Proudly Naija.', bg: '#7b1f3a', fg: '#ffe6ee' },
  { head: 'CHOPLIFE NOODLES', sub: 'Two minutes. Full belle.', bg: '#f2b705', fg: '#1f1d1a' },
  { head: 'SHARP SHARP DATA', sub: '10GB for the price of your akara', bg: '#2f63ad', fg: '#ffffff' },
];

function Billboards({ g, lga, lit, city }: { g: Game; lga: string; lit: boolean; city: CityRender | null }) {
  const l = lgaById(lga);
  const st = g.states[l.state];
  const gov = g.people[st.leader];
  const party = partyById(st.party);
  const surname = gov ? gov.name.split(' ').slice(-1)[0].toUpperCase() : '';
  const best = g.businesses.filter((b) => b.owner === g.me && stageOf(b.type, b.level) >= 3).sort((a, b) => b.level - a.level)[0];
  const ad = best ? { head: best.name.toUpperCase(), sub: `Now in ${lgaById(best.lga).nick}. Come and see us!`, bg: '#1f1d1a', fg: '#f2b705' } : ADS[g.week % ADS.length];
  const h = hood(lga);
  // In the mapped districts the boards stand on the roofs of tall buildings near the bus stop.
  const spots = h.real
    ? city
      ? billboardSpots(city, h, l.style === 'lagos-rich' ? 1.6 : 1)
      : []
    : [
        { x: X0 + 10, z: -(MAIN_HALF + 7), y: 0, rot: 0 },
        { x: X1 - 10, z: -(MAIN_HALF + 7), y: 0, rot: 0 },
      ];
  const boards = [
    { head: st.leader === g.me ? 'YOUR GOVERNOR' : `GOV. ${surname}`, sub: `${party.id} · ${SLOGANS[st.style]}`, bg: party.color, fg: party.ink },
    { head: ad.head, sub: ad.sub, bg: ad.bg, fg: ad.fg },
  ];
  return (
    <group>
      {spots.map((s, i) => (
        <group key={i} position={[0, s.y, 0]}>
          <Billboard x={s.x} z={s.z} rot={s.rot} {...boards[i]} lit={lit} />
        </group>
      ))}
    </group>
  );
}

// ───────────── traffic and people ─────────────

function Traffic({ g, style, lga, kekeColor, okada }: { g: Game; style: SceneStyle; lga: string; kekeColor: string; okada: boolean }) {
  const lagos = lgaById(lga).state === 'LA';
  const rider = { skin: 2, hair: 0, outfit: 1, accent: 2, glasses: false };
  const list = useMemo(() => {
    const rnd = seeded(`traffic:${lga}`);
    const cars = ['#d6d6d6', '#2f63ad', '#b8352a', '#1f1d1a', '#e9e2d4'];
    const out: { node: ReactNode; axis: 'x' | 'z'; at: number; from: number; to: number; speed: number; dir: 1 | -1; offset: number }[] = [];
    const main = (node: ReactNode, lane: number, dir: 1 | -1, speed: number) => out.push({ node, axis: 'x', at: dir === 1 ? lane : -lane, from: X0 - 30, to: X1 + 30, speed, dir, offset: rnd() * 300 });
    // Drive on the right: eastbound traffic on the south half of the road.
    if (lagos) main(<Brt />, 2.1, 1, 8), main(<Brt />, 2.1, -1, 8);
    for (const dir of [1, -1] as const) {
      main(lagos ? <Danfo /> : <Keke color={kekeColor} />, 4.4, dir, 8 + rnd() * 3);
      main(<Car color={cars[Math.floor(rnd() * cars.length)]} />, lagos ? 4.4 : 2.1, dir, 11 + rnd() * 3);
      main(<Keke color={kekeColor} />, 4.4, dir, 6 + rnd() * 2);
      main(<Truck color={['#c2552d', '#2f63ad', '#1e8f5a'][Math.floor(rnd() * 3)]} />, lagos ? 4.4 : 2.1, dir, 7);
      if (okada) main(<Okada rider={rider} />, 3.2, dir, 12 + rnd() * 3);
      main(<Car color={cars[Math.floor(rnd() * cars.length)]} />, 2.1, dir, 12);
    }
    // Side streets: lighter traffic, mostly kekes and okadas.
    for (const z of ROWS) {
      if (z === MAIN_Z) continue;
      const dir = rnd() > 0.5 ? 1 : -1;
      out.push({ node: <Keke color={kekeColor} />, axis: 'x', at: z + dir * 1.6, from: X0 - 10, to: X1 + 10, speed: 5 + rnd() * 2, dir, offset: rnd() * 200 });
      if (okada) out.push({ node: <Okada rider={rider} />, axis: 'x', at: z - dir * 1.6, from: X0 - 10, to: X1 + 10, speed: 9, dir: dir === 1 ? -1 : 1, offset: rnd() * 200 });
    }
    for (const x of COLS) {
      const dir = rnd() > 0.5 ? 1 : -1;
      // Southbound (+z) keeps to the west half.
      const vehicle = rnd() > 0.5 ? <Car color={cars[Math.floor(rnd() * cars.length)]} /> : <Keke color={kekeColor} />;
      out.push({ node: vehicle, axis: 'z', at: x - dir * 1.6, from: ROAD_Z[0] - 10, to: ROAD_Z[1] + 10, speed: 5 + rnd() * 3, dir, offset: rnd() * 200 });
    }
    return out;
  }, [lga, lagos, okada, kekeColor]);
  void style;
  void g;
  return (
    <group>
      {list.map((v, i) => (
        <Mover key={i} axis={v.axis} z={v.at} from={v.from} to={v.to} speed={v.speed} dir={v.dir} offset={v.offset}>
          {v.node}
        </Mover>
      ))}
    </group>
  );
}

/** A danfo (or keke, outside Lagos) that pulls in at the bus stop, waits for passengers, then goes. */
function StoppingDanfo({ lga, lagos, kekeColor }: { lga: string; lagos: boolean; kekeColor: string }) {
  const ref = useRef<THREE.Group>(null);
  const stopX = hood(lga).busStop[0] - 1;
  const lane = 4.4;
  const s = useRef({ x: X0 - 30, v: 10, wait: 0 });
  useFrame((_, dt) => {
    const st = s.current;
    const left = stopX - st.x;
    if (st.wait > 0) {
      st.wait -= dt;
      st.v = 0;
    } else if (left > 0 && left < 16) {
      st.v = Math.max(1.2, left * 0.7);
      if (left < 0.15) st.wait = 5;
    } else st.v = Math.min(10, st.v + dt * 5);
    st.x += st.v * dt;
    if (st.x > X1 + 30) st.x = X0 - 30;
    if (ref.current) ref.current.position.set(st.x, 0, lane);
  });
  return <group ref={ref}>{lagos ? <Danfo /> : <Keke color={kekeColor} />}</group>;
}

function Pedestrians({ seed, count, rainy }: { seed: string; count: number; rainy: boolean }) {
  const people = useMemo(() => {
    const rnd = seeded(`ped:${seed}`);
    return Array.from({ length: count }, () => {
      const ew = rnd() < 0.65;
      const s = rnd() > 0.5 ? 1 : -1;
      const line = ew ? (() => { const z = ROWS[Math.floor(rnd() * ROWS.length)]; return z + s * (halfWidth(z) + 1.2 + rnd() * 1.2); })() : COLS[Math.floor(rnd() * COLS.length)] + s * (SIDE_HALF + 1.2 + rnd() * 1.2);
      return {
        looks: { skin: Math.floor(rnd() * 5), hair: Math.floor(rnd() * 5), outfit: Math.floor(rnd() * 8), accent: Math.floor(rnd() * 8), glasses: rnd() > 0.85 },
        gender: (rnd() > 0.5 ? 'm' : 'f') as 'm' | 'f',
        axis: (ew ? 'x' : 'z') as 'x' | 'z',
        line,
        from: ew ? X0 : ROAD_Z[0],
        to: ew ? X1 : ROAD_Z[1],
        speed: 1.1 + rnd() * 0.9,
        offset: rnd() * 300,
        brolly: rnd() < 0.7 ? ['#1f1d1a', '#2f63ad', '#b8352a', '#1e8f5a', '#f2b705'][Math.floor(rnd() * 5)] : null,
      };
    });
  }, [seed, count]);
  return (
    <group>
      {people.map((p, i) => (
        <group key={i} position={[0, 0.16, 0]}>
          <Walker looks={p.looks} gender={p.gender} axis={p.axis} z={p.line} from={p.from} to={p.to} speed={p.speed} offset={p.offset} umbrella={rainy ? p.brolly : null} />
        </group>
      ))}
    </group>
  );
}

type Spot = { place: PlaceId; lot: number | null };

/**
 * Where a named person is at this hour: at work in the day, out in the evening, home (unseen) at night.
 * Events pull a crowd. Returns null when they are indoors at home.
 */
function whereNow(g: Game, who: Person, hour: number): Spot | null {
  const at = (place: PlaceId): Spot => ({ place, lot: null });
  const evening = hour >= 19 && hour < 23;
  const night = hour >= 23 || hour < 6;
  const workday = g.day < 5;
  const pick = (a: PlaceId, b: PlaceId) => at(who.id % 2 ? a : b);
  if (who.role === 'family') return night ? null : at('home');
  // A show or a match draws some of the town.
  const on = g.culture.find((e) => e.week === g.week && e.day === g.day && (e.lga === who.lga || e.lga === '*') && hour * 60 >= e.start && hour * 60 < e.end);
  if (on && who.id % 3 !== 0) return at(on.place);
  if (night) return who.id % 5 === 0 && hour < 1.5 ? at('joint') : null;
  if (evening) return who.id % 3 === 0 ? null : pick('joint', 'market');
  const job = who.employer !== null ? g.businesses.find((x) => x.id === who.employer) : undefined;
  if (job) return isMobile(job.type) || job.plot < 0 ? at('park') : { place: 'lot', lot: job.plot };
  const own = g.businesses.find((x) => x.owner === who.id && x.lga === who.lga && x.plot >= 0);
  if (own) return { place: 'lot', lot: own.plot };
  if (who.office) {
    if (hour < 9 || hour >= 17) return at('party');
    return at(who.office === who.lga ? 'secretariat' : lgaById(who.lga).state === who.office ? 'govhouse' : 'party');
  }
  switch (who.role) {
    case 'godfather':
    case 'politician':
      return at('party');
    case 'journalist':
      return hour < 14 ? at('secretariat') : at('joint');
    case 'union-chairman':
    case 'area-boss':
      return at('park');
    case 'market-leader':
      return at('market');
  }
  const t = tradeById(who.trade);
  if (t.kind === 'salary') return workday && hour >= 7.5 && hour < 16.5 ? at(t.place) : pick('market', 'joint');
  if (t.kind === 'none') return pick('park', 'market');
  return hour >= 7 && hour < 19 ? at(t.place === 'home' ? 'market' : t.place) : pick('joint', 'market');
}

function Townsfolk({ g, lga, playerPos, onTalk }: { g: Game; lga: string; playerPos: React.MutableRefObject<THREE.Vector3>; onTalk: (id: number) => void }) {
  const h = hood(lga);
  // Re-plan every half hour of game time.
  const slot = Math.floor(g.minute / 30);
  const folk = useMemo(() => {
    const hour = (slot * 30) / 60;
    const placed: { person: Person; x: number; z: number; face: number; from: Pt }[] = [];
    const counts: Record<string, number> = {};
    for (const who of g.people) {
      if (who.id === g.me) continue;
      let spot: Spot | null;
      if (g.humans.includes(who.id)) {
        // Another player: wherever they really are right now, unless they are asleep at home.
        const o = g.others?.find((x) => x.id === who.id);
        if (!o || o.at !== lga || o.asleep) continue;
        spot = { place: o.place, lot: o.lot };
      } else {
        if (who.lga !== lga) continue;
        if (who.role === 'politician' && !who.office) continue;
        spot = whereNow(g, who, hour % 24);
        // Another player's family keeps to their own house, not yours.
        if (spot && who.role === 'family' && who.kin !== undefined && who.kin !== g.me) spot = { place: 'lot', lot: h.fillers[who.kin % h.fillers.length] };
      }
      if (!spot) continue;
      if (spot.place !== 'lot' && h.place[spot.place] === undefined) spot = { place: 'joint', lot: null };
      const plotId = spot.place === 'lot' ? spot.lot : h.place[spot.place];
      if (plotId === undefined || plotId === null) continue;
      const plot = h.plots[plotId];
      const key = `${spot.place}:${spot.lot}`;
      const n = (counts[key] = (counts[key] ?? 0) + 1);
      if (n > 8) continue;
      const off = (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 1.4 + 0.7;
      const [dx, dz] = plot.door;
      // Spread out along the building's frontage (its local x), a step back from the kerb towards it.
      const ax = Math.cos(plot.rot);
      const az = -Math.sin(plot.rot);
      const bx = -Math.sin(plot.rot) * 0.6;
      const bz = -Math.cos(plot.rot) * 0.6;
      // They come out of one of the houses.
      const house = h.plots[h.fillers[who.id % h.fillers.length]];
      placed.push({ person: who, x: dx + ax * off + bx, z: dz + az * off + bz, face: plot.rot, from: house.door });
      if (placed.length >= 30) break;
    }
    return placed;
  }, [g, lga, h, slot]);

  return (
    <group>
      {folk.map((f) => (
        <NamedPerson key={f.person.id} g={g} lga={lga} who={f.person} x={f.x} z={f.z} from={f.from} face={f.face} playerPos={playerPos} onTalk={onTalk} working={f.person.employer !== null && g.minute >= 7 * 60 && g.minute < 20 * 60} />
      ))}
    </group>
  );
}

/** A named neighbour. When their plan for the hour changes, they walk there along the pavements. */
function NamedPerson({ g, lga, who, x, z, from, face, playerPos, onTalk, working }: { g: Game; lga: string; who: Person; x: number; z: number; from: Pt; face: number; playerPos: React.MutableRefObject<THREE.Vector3>; onTalk: (id: number) => void; working: boolean }) {
  const root = useRef<THREE.Group>(null);
  const tagRef = useRef<THREE.Group>(null);
  const pos = useRef<Pt>([from[0], from[1]]);
  const path = useRef<Pt[]>([]);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    path.current = route(lga, pos.current, [x, z]).slice(1);
    setMoving(path.current.length > 0);
  }, [lga, x, z]);
  useFrame((_, dt) => {
    const r = root.current;
    if (!r) return;
    const next = path.current[0];
    if (next) {
      const dx = next[0] - pos.current[0];
      const dz = next[1] - pos.current[1];
      const d = Math.hypot(dx, dz);
      if (d < 0.15) {
        path.current.shift();
        if (!path.current.length) {
          setMoving(false);
          r.rotation.y = face;
        }
      } else {
        const step = Math.min(d, 4 * dt);
        pos.current = [pos.current[0] + (dx / d) * step, pos.current[1] + (dz / d) * step];
        r.rotation.y = Math.atan2(dx, dz);
      }
    }
    r.position.set(pos.current[0], 0.16, pos.current[1]);
    if (tagRef.current) tagRef.current.visible = Math.hypot(playerPos.current.x - pos.current[0], playerPos.current.z - pos.current[1]) < 11;
  });
  const job = who.employer !== null ? g.businesses.find((b) => b.id === who.employer) : undefined;
  const own = g.businesses.find((b) => b.owner === who.id);
  const other = g.others?.find((x) => x.id === who.id);
  const kinOf = who.kin !== undefined && who.kin !== g.me ? g.people[who.kin]?.name.split(' ')[0] : null;
  const sub = other
    ? `Player · ${other.online ? 'online' : 'away'}`
    : kinOf && (who.role === 'family' || who.role === 'friend')
    ? `${kinOf}’s ${who.role === 'family' ? 'family' : 'friend'}`
    : who.office
    ? officeTitle(who.office)
    : job
      ? job.owner === g.me
        ? 'Works for you'
        : `Works at ${job.name}`
      : own
        ? `Owner, ${own.name}`
        : ROLE_NAMES[who.role] && who.role !== 'neighbour'
          ? ROLE_NAMES[who.role]!
          : tradeById(who.trade).name.split(' (')[0];
  const tag = useMemo(() => ({ name: who.name, sub }), [who.name, sub]);
  const talked = g.talked.includes(who.id);
  return (
    <group ref={root} position={[from[0], 0.16, from[1]]} rotation={[0, face, 0]}>
      <Person3D looks={who.looks} gender={who.gender} pose={moving ? 'walk' : talked ? 'wave' : working ? 'work' : 'idle'} onClick={() => onTalk(who.id)} />
      <group ref={tagRef}>
        <NameTag name={tag.name} sub={tag.sub} />
      </group>
    </group>
  );
}

function NameTag({ name, sub }: { name: string; sub: string }) {
  const tex = useMemo(() => nameTexture(name, sub), [name, sub]);
  return (
    <sprite position={[0, 2.55, 0]} scale={[0.1, 0.027, 1]}>
      <spriteMaterial map={tex} depthTest={false} transparent sizeAttenuation={false} />
    </sprite>
  );
}

/** Rain falls in a box around you, not over the whole town. */
function Rain({ playerPos }: { playerPos: React.MutableRefObject<THREE.Vector3> }) {
  const ref = useRef<THREE.Points>(null);
  const count = 1800;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = -50 + Math.random() * 100;
      arr[i * 3 + 1] = Math.random() * 30;
      arr[i * 3 + 2] = -50 + Math.random() * 100;
    }
    return arr;
  }, []);
  useFrame((_, dt) => {
    const pts = ref.current;
    if (!pts) return;
    pts.position.set(playerPos.current.x, 0, playerPos.current.z);
    const a = pts.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      a[i * 3 + 1] -= dt * 28;
      if (a[i * 3 + 1] < 0) a[i * 3 + 1] = 30;
    }
    pts.geometry.attributes.position.needsUpdate = true;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#a9c6d6" size={0.12} transparent opacity={0.7} />
    </points>
  );
}

const ROUTE_DOT = new THREE.CircleGeometry(0.34, 14);
ROUTE_DOT.rotateX(-Math.PI / 2);
const ROUTE_RIM = new THREE.CircleGeometry(0.5, 14);
ROUTE_RIM.rotateX(-Math.PI / 2);
const ROUTE_MAX = 110;
const ROUTE_GAP = 2.3;

/**
 * The way to where you are going: a line of dots along the streets, flowing towards it, and a beam of light
 * over the place itself so you can see it from far off.
 */
function RouteGuide({ path, pos }: { path: React.MutableRefObject<Pt[]>; pos: React.MutableRefObject<THREE.Vector3> }) {
  const dots = useRef<THREE.InstancedMesh>(null);
  const rims = useRef<THREE.InstancedMesh>(null);
  const beacon = useRef<THREE.Group>(null);
  const gem = useRef<THREE.Mesh>(null);
  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const m = dots.current;
    const r = rims.current;
    if (!m || !r) return;
    const pts = path.current;
    let n = 0;
    let carry = ROUTE_GAP - ((clock.elapsedTime * 2.6) % ROUTE_GAP);
    let ax = pos.current.x;
    let az = pos.current.z;
    let gone = 0;
    for (const q of pts) {
      const L = Math.hypot(q[0] - ax, q[1] - az);
      let s = carry;
      for (; s < L && n < ROUTE_MAX; s += ROUTE_GAP) {
        // The first dots grow from under your feet.
        const k = Math.min(1, (gone + s) / 3.5);
        if (k < 0.25) continue;
        o.position.set(ax + ((q[0] - ax) * s) / L, 0.13, az + ((q[1] - az) * s) / L);
        o.scale.setScalar(k);
        o.updateMatrix();
        r.setMatrixAt(n, o.matrix);
        o.position.y = 0.15;
        o.updateMatrix();
        m.setMatrixAt(n++, o.matrix);
      }
      carry = s - L;
      gone += L;
      ax = q[0];
      az = q[1];
      if (n >= ROUTE_MAX) break;
    }
    m.count = n;
    r.count = n;
    m.instanceMatrix.needsUpdate = true;
    r.instanceMatrix.needsUpdate = true;
    const b = beacon.current;
    if (b) {
      const end = pts[pts.length - 1];
      b.visible = !!end && Math.hypot(end[0] - pos.current.x, end[1] - pos.current.z) > 5;
      if (end) b.position.set(end[0], 0, end[1]);
      if (gem.current) {
        gem.current.position.y = 4.2 + Math.sin(clock.elapsedTime * 3) * 0.35;
        gem.current.rotation.y = clock.elapsedTime * 1.6;
      }
    }
  });
  return (
    <group>
      <instancedMesh ref={rims} args={[ROUTE_RIM, undefined, ROUTE_MAX]} frustumCulled={false}>
        <meshBasicMaterial color="#ffffff" />
      </instancedMesh>
      <instancedMesh ref={dots} args={[ROUTE_DOT, undefined, ROUTE_MAX]} frustumCulled={false}>
        <meshBasicMaterial color="#2a6df4" />
      </instancedMesh>
      <group ref={beacon} visible={false}>
        <mesh position={[0, 11, 0]} renderOrder={5}>
          <cylinderGeometry args={[0.28, 0.5, 22, 10, 1, true]} />
          <meshBasicMaterial color="#5b9bff" transparent opacity={0.3} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh ref={gem} position={[0, 4.2, 0]} scale={[1, 1.5, 1]} renderOrder={6}>
          <octahedronGeometry args={[0.75, 0]} />
          <meshBasicMaterial color="#2a6df4" depthTest={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.16, 0]}>
          <ringGeometry args={[0.95, 1.3, 28]} />
          <meshBasicMaterial color="#2a6df4" />
        </mesh>
      </group>
    </group>
  );
}

function SelectRing({ x, z }: { x: number; z: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.2, z]}>
      <ringGeometry args={[1, 1.35, 24]} />
      <meshBasicMaterial color="#f2b705" />
    </mesh>
  );
}

function TargetRing({ x, z }: { x: number; z: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 6) * 0.15);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.22, z]}>
      <ringGeometry args={[0.5, 0.75, 20]} />
      <meshBasicMaterial color="#f2b705" />
    </mesh>
  );
}
