import { fillerKinds as kindsOf, type FillerKind } from '../engine/property';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { SceneStyle } from '../data/world';
import { COLS, MAIN_HALF, MAIN_Z, PAVEMENT, ROAD_X, ROAD_Z, ROWS, SIDE_HALF, halfWidth, hood, type Plot } from '../engine/map';
import { Car, Person3D, mat } from './Actors';
import { Box, Roof, Sign, Smoke, WaterTank, Windows, earthen } from './Buildings';
import { billboardTexture, signTexture } from './textures';

// The neighbourhood itself: roads, pavements, gutters, lamps, the houses and churches that fill
// the plots nobody uses, empty plots for lease, the bus stop, the footbridge and billboards.

/** Deterministic noise from a string. */
export function seeded(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    h ^= h >>> 15;
    return ((h >>> 0) % 10000) / 10000;
  };
}

export const WALLS: Record<SceneStyle, string[]> = {
  'lagos-dense': ['#e9b5a0', '#a7d3b8', '#b8cfe6', '#f0d58c', '#e3c3e0'],
  'lagos-rich': ['#f4f1ea', '#dfe6ea', '#e9e2d4', '#cfdce4'],
  'lagos-island': ['#e0c28c', '#cfa0a0', '#9fc0b0', '#e6d0a8'],
  'lagos-port': ['#b8cfe6', '#e0c28c', '#c9c2b2', '#e9b5a0'],
  'kano-old': ['#c98c4f', '#b87a43', '#d49a5e', '#c4854a'],
  'kano-market': ['#c98c4f', '#e0c28c', '#d49a5e', '#b8cfe6'],
  'kano-gra': ['#e9e2d4', '#d49a5e', '#dfe6ea', '#e0c28c'],
  'kano-farm': ['#c98c4f', '#d49a5e', '#b87a43'],
  'ph-city': ['#dcc7a4', '#b8cfe6', '#e9b5a0', '#a7d3b8'],
  'ph-industrial': ['#c9c2b2', '#dcc7a4', '#b8cfe6'],
  'rivers-water': ['#b98d5f', '#a7d3b8', '#c9a77c', '#dcc7a4'],
};

const X0 = ROAD_X[0];
const X1 = ROAD_X[1];
const Z0 = ROAD_Z[0];
const Z1 = ROAD_Z[1];
const CX = (X0 + X1) / 2;
const CZ = (Z0 + Z1) / 2;

/** Segments of a line from a to b with gaps where crossing roads are. */
function between(a: number, b: number, cuts: { at: number; half: number }[]): [number, number][] {
  const out: [number, number][] = [];
  let start = a;
  for (const c of cuts.slice().sort((p, q) => p.at - q.at)) {
    if (c.at + c.half < a || c.at - c.half > b) continue;
    if (c.at - c.half > start) out.push([start, c.at - c.half]);
    start = Math.max(start, c.at + c.half);
  }
  if (b > start) out.push([start, b]);
  return out;
}

function Strip({ x0, x1, z0, z1, y, c, h = 0, onClick }: { x0: number; x1: number; z0: number; z1: number; y: number; c: string; h?: number; onClick?: (e: never) => void }) {
  const w = x1 - x0;
  const d = z1 - z0;
  if (w <= 0 || d <= 0) return null;
  if (h > 0) {
    return (
      <mesh position={[(x0 + x1) / 2, y + h / 2, (z0 + z1) / 2]} material={mat(c)} receiveShadow onClick={onClick}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
    );
  }
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(x0 + x1) / 2, y, (z0 + z1) / 2]} material={mat(c)} receiveShadow onClick={onClick}>
      <planeGeometry args={[w, d]} />
    </mesh>
  );
}

export function Streets({ lga, style, roads, onClick }: { lga: string; style: SceneStyle; roads: number; onClick: (e: never) => void }) {
  const h = hood(lga);
  const soil = earthen(style) ? (style === 'kano-farm' ? '#b8b06a' : '#dcb47e') : style === 'rivers-water' ? '#c9b283' : style === 'lagos-rich' ? '#a9cf8a' : '#d2bf98';
  // Side streets are tarred only where the council has kept the roads up.
  const sideTar = roads >= 45 && style !== 'kano-farm' && style !== 'kano-old';
  const mainTar = style !== 'kano-farm';
  const tar = '#3d3b38';
  const laterite = '#b5764a';
  const walkC = earthen(style) ? '#e2bf91' : '#d9d0bc';
  const gutter = '#2b2a27';
  const parts = useMemo(() => {
    const out: ReactNode[] = [];
    const colCuts = COLS.map((c) => ({ at: c, half: SIDE_HALF }));
    const rowCuts = ROWS.map((r) => ({ at: r, half: halfWidth(r) + PAVEMENT }));
    // East–west roads.
    for (const z of ROWS) {
      const hw = halfWidth(z);
      const main = z === MAIN_Z;
      out.push(<Strip key={`r${z}`} x0={X0} x1={X1} z0={z - hw} z1={z + hw} y={0.01} c={main ? (mainTar ? tar : laterite) : sideTar ? tar : laterite} onClick={onClick} />);
      for (const [a, b] of between(X0, X1, colCuts)) {
        for (const s of [-1, 1]) {
          const inner = z + s * hw;
          const outer = z + s * (hw + PAVEMENT);
          out.push(<Strip key={`p${z}:${a}:${s}`} x0={a} x1={b} z0={Math.min(inner, outer)} z1={Math.max(inner, outer)} y={0} h={0.16} c={walkC} onClick={onClick} />);
          const g0 = outer - s * 0.55;
          out.push(<Strip key={`g${z}:${a}:${s}`} x0={a} x1={b} z0={Math.min(g0, outer)} z1={Math.max(g0, outer)} y={0.17} c={gutter} />);
        }
      }
      if (main) {
        // A raised median with a gap at every junction, and lane dashes.
        for (const [a, b] of between(X0, X1, colCuts.map((c) => ({ ...c, half: c.half + 1 })))) {
          out.push(<Strip key={`m${a}`} x0={a} x1={b} z0={-0.6} z1={0.6} y={0} h={0.35} c="#c9c2b2" />);
          out.push(<Strip key={`mk${a}`} x0={a} x1={b} z0={-0.62} z1={0.62} y={0.36} c="#f2b705" h={0.02} />);
        }
        for (let x = X0; x < X1; x += 6) {
          if (COLS.some((c) => Math.abs(x + 1.5 - c) < SIDE_HALF + 1.5)) continue;
          for (const s of [-1, 1]) out.push(<Strip key={`d${x}:${s}`} x0={x} x1={x + 3} z0={s * 3.3 - 0.1} z1={s * 3.3 + 0.1} y={0.02} c="#f4f1ea" />);
        }
      }
    }
    // North–south roads.
    for (const x of COLS) {
      out.push(<Strip key={`c${x}`} x0={x - SIDE_HALF} x1={x + SIDE_HALF} z0={Z0} z1={Z1} y={0.012} c={sideTar ? tar : laterite} onClick={onClick} />);
      for (const [a, b] of between(Z0, Z1, rowCuts)) {
        for (const s of [-1, 1]) {
          const inner = x + s * SIDE_HALF;
          const outer = x + s * (SIDE_HALF + PAVEMENT);
          out.push(<Strip key={`cp${x}:${a}:${s}`} x0={Math.min(inner, outer)} x1={Math.max(inner, outer)} z0={a} z1={b} y={0} h={0.16} c={walkC} onClick={onClick} />);
          const g0 = outer - s * 0.55;
          out.push(<Strip key={`cg${x}:${a}:${s}`} x0={Math.min(g0, outer)} x1={Math.max(g0, outer)} z0={a} z1={b} y={0.17} c={gutter} />);
        }
      }
    }
    // Potholes: more of them the worse the roads.
    const rnd = seeded(`pot:${lga}`);
    const holes = Math.round((100 - roads) / 5);
    for (let i = 0; i < holes; i++) {
      const onRow = rnd() < 0.6;
      const r = 0.5 + rnd() * 0.9;
      const p: [number, number] = onRow ? [X0 + rnd() * (X1 - X0), ROWS[Math.floor(rnd() * ROWS.length)] + (rnd() - 0.5) * 4] : [COLS[Math.floor(rnd() * COLS.length)] + (rnd() - 0.5) * 4, Z0 + rnd() * (Z1 - Z0)];
      out.push(
        <mesh key={`h${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[p[0], 0.03, p[1]]} material={mat('#232120')}>
          <circleGeometry args={[r, 7]} />
        </mesh>,
      );
    }
    return out;
  }, [lga, roads, mainTar, sideTar, walkC]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[CX, -0.02, CZ]} receiveShadow onClick={onClick} material={mat(soil)}>
        <planeGeometry args={[800, 800]} />
      </mesh>
      {h.farmland && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[CX, -0.01, ROWS[0] - 30]} material={mat(earthen(style) ? '#c9a46e' : '#a2b36a')}>
          <planeGeometry args={[X1 - X0 + 40, 44]} />
        </mesh>
      )}
      {parts}
    </group>
  );
}

/** Lamp posts on the median and along side streets, with the famous tangle of NEPA wires. */
export function lampPositions(): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let x = X0 + 6; x < X1; x += 22) out.push([x, 0, MAIN_Z]);
  for (const z of ROWS) {
    if (z === MAIN_Z) continue;
    for (let x = X0 + 10; x < X1; x += 22) out.push([x, 1, z - SIDE_HALF - PAVEMENT + 0.4]);
  }
  for (const x of COLS) for (let z = Z0 + 8; z < Z1; z += 22) out.push([x - SIDE_HALF - PAVEMENT + 0.4, 2, z]);
  return out;
}

export function StreetLights({ lightsOn }: { lightsOn: boolean }) {
  const lamps = useMemo(lampPositions, []);
  const head = lightsOn ? mat('#fff1c2', { emissive: '#ffcf6b' }) : mat('#5a5a5a');
  return (
    <group>
      {lamps.map(([x, kind, z]) => (
        <group key={`${x}:${z}`} position={[x, 0, z]}>
          <mesh position={[0, kind === 0 ? 4 : 3.2, 0]} material={mat('#4a4743')}>
            <cylinderGeometry args={[0.09, 0.13, kind === 0 ? 8 : 6.4, 6]} />
          </mesh>
          {kind === 0 ? (
            [-1, 1].map((s) => (
              <mesh key={s} position={[0, 7.9, s * 1.2]} material={head}>
                <boxGeometry args={[0.5, 0.18, 1.4]} />
              </mesh>
            ))
          ) : (
            <mesh position={kind === 1 ? [0, 6.3, 0.6] : [0.6, 6.3, 0]} material={head}>
              <boxGeometry args={kind === 1 ? [0.5, 0.18, 1.2] : [1.2, 0.18, 0.5]} />
            </mesh>
          )}
        </group>
      ))}
      {ROWS.filter((z) => z !== MAIN_Z).map((z) => (
        <mesh key={`w${z}`} position={[CX, 6.05, z - SIDE_HALF - PAVEMENT + 0.4]} rotation={[0, 0, Math.PI / 2]} material={mat('#1f1d1a')}>
          <cylinderGeometry args={[0.03, 0.03, X1 - X0, 4]} />
        </mesh>
      ))}
      {COLS.map((x) => (
        <mesh key={`wc${x}`} position={[x - SIDE_HALF - PAVEMENT + 0.4, 6.05, CZ]} rotation={[Math.PI / 2, 0, 0]} material={mat('#1f1d1a')}>
          <cylinderGeometry args={[0.03, 0.03, Z1 - Z0, 4]} />
        </mesh>
      ))}
    </group>
  );
}

/** A handful of real lights that follow you, so the street near you glows at night without lighting the whole town. */
export function NightLights({ lightsOn, playerPos }: { lightsOn: boolean; playerPos: React.MutableRefObject<THREE.Vector3> }) {
  const lamps = useMemo(lampPositions, []);
  const refs = useRef<(THREE.PointLight | null)[]>([]);
  useFrame(() => {
    const p = playerPos.current;
    const near = lamps
      .map((l) => ({ l, d: Math.hypot(l[0] - p.x, l[2] - p.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
    near.forEach(({ l }, i) => {
      const light = refs.current[i];
      if (!light) return;
      light.position.set(l[0], 5.6, l[2]);
      light.intensity = lightsOn ? 16 : 0;
    });
  });
  return (
    <group>
      {Array.from({ length: 6 }, (_, i) => (
        <pointLight key={i} ref={(r) => void (refs.current[i] = r)} intensity={0} distance={18} decay={1.6} color="#ffd38a" />
      ))}
    </group>
  );
}

// ───────────── plots nobody uses ─────────────

export type { FillerKind } from '../engine/property';
/** Which ordinary building stands on each plot (the rules need to know too: see property.ts). */
export const fillerKinds = (lga: string, _style?: SceneStyle) => kindsOf(lga);

export function Tree({ x, z, kind }: { x: number; z: number; kind: 'palm' | 'neem' }) {
  if (kind === 'palm') {
    return (
      <group position={[x, 0, z]}>
        <mesh position={[0.3, 3.2, 0]} rotation={[0, 0, -0.1]} material={mat('#7a5a3a')} castShadow>
          <cylinderGeometry args={[0.16, 0.24, 6.4, 6]} />
        </mesh>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <mesh key={i} position={[0.6, 6.4, 0]} rotation={[0.9, (i * Math.PI) / 3, 0]} material={mat('#2f7a3f')} castShadow>
            <boxGeometry args={[0.5, 0.08, 3.2]} />
          </mesh>
        ))}
      </group>
    );
  }
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1.6, 0]} material={mat('#6b4a2b')} castShadow>
        <cylinderGeometry args={[0.22, 0.3, 3.2, 6]} />
      </mesh>
      <mesh position={[0, 4, 0]} material={mat('#4f8a3f')} castShadow>
        <icosahedronGeometry args={[2.2, 0]} />
      </mesh>
    </group>
  );
}

const KIOSK_SIGNS = ['PHONE & ACCESSORIES', 'CHEMIST', 'RECHARGE CARD HERE', 'PROVISIONS', 'BET SHOP', 'PRINTING & PHOTOCOPY', 'FASHION HOUSE', 'SPARE PARTS'];
const CHURCHES = ['GRACE ASSEMBLY', 'CHRIST VICTORY CHAPEL', 'LIVING FAITH TABERNACLE', 'MOUNTAIN OF MERCY'];

export function Filler({ plot, kind, style, wall, lit, power, seed, petrol, scarcity }: { plot: Plot; kind: FillerKind; style: SceneStyle; wall: string; lit: boolean; power: boolean; seed: number; petrol: number; scarcity: boolean }) {
  const { w, d } = plot;
  const front = d / 2;
  const kano = earthen(style);
  switch (kind) {
    case 'house': {
      const bw = Math.min(w - 3, 10);
      const bd = Math.min(d - 4, 7);
      return (
        <group>
          <Box p={[0, 1.7, -front + bd / 2 + 1]} s={[bw, 3.4, bd]} c={wall} />
          <Roof w={bw} d={bd} y={3.4} style={style} rusty={seed % 2 === 0} />
          <Windows w={bw - 1} y={1.7} z={-front + bd + 1.03} n={3} lit={lit} />
          <Box p={[0, 1.1, -front + bd + 1.02]} s={[1.1, 2.2, 0.1]} c="#6b4024" cast={false} />
          {!kano && <WaterTank x={bw / 2 - 1.2} y={4} />}
          <CompoundWall w={w} d={d} c={kano ? '#c4854a' : '#d8cfbd'} gate="#1f1d1a" />
        </group>
      );
    }
    case 'flats': {
      const storeys = 2 + (seed % 2);
      const bw = Math.min(w - 2, 12);
      const bd = Math.min(d - 3, 8);
      const h = storeys * 3.1;
      return (
        <group>
          <group position={[0, 0, -front + bd / 2 + 1]}>
            <Box p={[0, h / 2, 0]} s={[bw, h, bd]} c={wall} />
            <Box p={[0, h + 0.3, 0]} s={[bw + 0.3, 0.6, bd + 0.3]} c="#d8cfbd" />
            <Windows w={bw - 1} y={1.7} z={bd / 2 + 0.03} n={4} rows={storeys} lit={lit} />
            {Array.from({ length: storeys - 1 }, (_, i) => (
              <group key={i} position={[0, 3.1 * (i + 1), bd / 2 + 0.5]}>
                <Box p={[0, 0, 0]} s={[bw, 0.16, 1]} c="#d8cfbd" />
                <Box p={[0, 0.5, 0.45]} s={[bw, 0.8, 0.06]} c="#4a4743" cast={false} />
              </group>
            ))}
            {!kano && <WaterTank x={-bw / 2 + 1.2} y={h + 0.6} />}
            {/* Washing on the balcony. */}
            {storeys > 1 && <Box p={[bw / 4, 3.9, bd / 2 + 0.95]} s={[2.4, 0.7, 0.03]} c={['#d23c22', '#2f63ad', '#f2b705'][seed % 3]} cast={false} />}
          </group>
          <CompoundWall w={w} d={d} c={kano ? '#c4854a' : '#d8cfbd'} gate="#2f4f6f" />
        </group>
      );
    }
    case 'church':
      return (
        <group>
          <group position={[0, 0, -front + 4.8]}>
            <Box p={[0, 2.6, 0]} s={[10, 5.2, 8]} c="#f4f1ea" />
            <Roof w={10} d={8} y={5.2} style={style} />
            <Box p={[-3.6, 4.5, 3.6]} s={[2.4, 9, 2.4]} c="#e9e2d4" />
            <Box p={[-3.6, 10.2, 3.6]} s={[0.25, 2.4, 0.25]} c="#c9a227" />
            <Box p={[-3.6, 10.6, 3.6]} s={[1.3, 0.25, 0.25]} c="#c9a227" />
            <Box p={[1, 1.4, 4.02]} s={[2.4, 2.8, 0.08]} c="#6b4024" cast={false} />
            <Windows w={8} y={2.4} z={4.03} n={4} lit={lit} />
            <Sign text={CHURCHES[seed % CHURCHES.length]} y={4.4} z={4.06} w={5.6} bg="#2f63ad" fg="#ffffff" />
          </group>
          <CompoundWall w={w} d={d} c="#e9e2d4" gate="#c9a227" />
        </group>
      );
    case 'mosque':
      return (
        <group>
          <group position={[0, 0, -front + 4.8]}>
            <Box p={[0, 2.2, 0]} s={[10, 4.4, 8]} c={kano ? '#d49a5e' : '#f4f1ea'} />
            <mesh position={[0, 4.4, 0]} material={mat('#1e8f5a')} castShadow>
              <sphereGeometry args={[2.8, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            </mesh>
            <mesh position={[4.2, 5.5, 3]} material={mat(kano ? '#c98c4f' : '#e9e2d4')} castShadow>
              <cylinderGeometry args={[0.6, 0.7, 11, 8]} />
            </mesh>
            <mesh position={[4.2, 11.4, 3]} material={mat('#1e8f5a')} castShadow>
              <coneGeometry args={[0.8, 1.4, 8]} />
            </mesh>
            {[-2.5, 0, 2.5].map((x) => (
              <Box key={x} p={[x - 1, 1.4, 4.02]} s={[1.4, 2.8, 0.08]} c="#2f5f4f" cast={false} />
            ))}
          </group>
          <CompoundWall w={w} d={d} c={kano ? '#c4854a' : '#e9e2d4'} gate="#1e8f5a" />
        </group>
      );
    case 'kiosks': {
      const n = plot.small ? 1 : 3;
      const kw = plot.small ? 5 : (w - 2) / 3;
      return (
        <group>
          {Array.from({ length: n }, (_, i) => {
            const x = -((n - 1) * (kw + 0.3)) / 2 + i * (kw + 0.3);
            const c = ['#2f63ad', '#d23c22', '#1e8f5a', '#e0782a', '#7b3fa0'][(seed + i) % 5];
            return (
              <group key={i} position={[x, 0, front - 2.6]}>
                <Box p={[0, 1.3, 0]} s={[kw - 0.2, 2.6, 2.4]} c={c} />
                <Box p={[0, 1.1, 1.22]} s={[kw - 1.2, 1.9, 0.05]} c="#2a221c" cast={false} />
                <Sign text={KIOSK_SIGNS[(seed + i) % KIOSK_SIGNS.length]} y={2.95} z={0.5} w={kw - 0.3} bg="#fffaf0" fg={c} />
              </group>
            );
          })}
          <Tree x={-w / 2 + 2} z={-front + 2} kind={kano ? 'neem' : 'palm'} />
        </group>
      );
    }
    case 'unfinished': {
      // A building abandoned at the first slab, with rods sticking out of the columns.
      const cols: [number, number][] = [];
      for (const x of [-4.5, 0, 4.5]) for (const z of [-3, 1]) cols.push([x, z]);
      return (
        <group position={[0, 0, -1]}>
          {cols.map(([x, z]) => (
            <group key={`${x}:${z}`}>
              <Box p={[x, 1.6, z]} s={[0.45, 3.2, 0.45]} c="#a9a59c" />
              <Box p={[x, 4.2, z]} s={[0.4, seed % 2 ? 2 : 0.8, 0.4]} c="#a9a59c" />
              <mesh position={[x + 0.1, 5.5, z]} material={mat('#5a3a2a')}>
                <cylinderGeometry args={[0.03, 0.03, 1.6, 4]} />
              </mesh>
            </group>
          ))}
          <Box p={[0, 3.3, -1]} s={[10, 0.25, 5]} c="#b9b5ac" />
          <Box p={[0, 0.6, 3]} s={[10, 1.2, 0.3]} c="#b9b5ac" />
          <Sign text="THIS HOUSE IS NOT FOR SALE" y={0.7} z={3.17} w={6} bg="#b9b5ac" fg="#b8352a" />
          {[0, 1, 2].map((i) => (
            <Box key={i} p={[-4 + i * 0.5, 0.25 + i * 0.5, -5]} s={[2.4, 0.5, 1.2]} c="#a9a59c" />
          ))}
        </group>
      );
    }
    case 'station':
      return <FillingStation w={w} d={d} lit={lit} power={power} petrol={petrol} scarcity={scarcity} />;
    case 'trees':
      return (
        <group>
          <Tree x={-1.5} z={-1} kind={kano ? 'neem' : 'palm'} />
          <Tree x={2} z={1.5} kind="neem" />
          <Box p={[0, 0.25, front - 1.5]} s={[2.2, 0.12, 0.6]} c="#7a4f2d" />
        </group>
      );
  }
}

function CompoundWall({ w, d, c, gate }: { w: number; d: number; c: string; gate: string }) {
  const hgt = 1.9;
  const gw = 3;
  return (
    <group>
      <Box p={[-(w / 2 + gw / 2) / 2, hgt / 2, d / 2 - 0.15]} s={[w / 2 - gw / 2, hgt, 0.3]} c={c} />
      <Box p={[(w / 2 + gw / 2) / 2, hgt / 2, d / 2 - 0.15]} s={[w / 2 - gw / 2, hgt, 0.3]} c={c} />
      <Box p={[0, hgt / 2, d / 2 - 0.15]} s={[gw, hgt - 0.1, 0.12]} c={gate} cast={false} />
      {[-1, 1].map((s) => (
        <Box key={s} p={[(s * (w - 0.3)) / 2, hgt / 2, 0]} s={[0.3, hgt, d]} c={c} />
      ))}
      <Box p={[0, hgt / 2, -d / 2 + 0.15]} s={[w, hgt, 0.3]} c={c} />
    </group>
  );
}

function FillingStation({ w, d, lit, power, petrol, scarcity }: { w: number; d: number; lit: boolean; power: boolean; petrol: number; scarcity: boolean }) {
  const board = useMemo(() => signTexture(scarcity ? 'NO FUEL' : `PMS ₦${Math.round(petrol).toLocaleString()}/L`, '#1f1d1a', scarcity ? '#ff5a3a' : '#7ee07e'), [petrol, scarcity]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} material={mat('#8f8a80')} receiveShadow>
        <planeGeometry args={[w, d]} />
      </mesh>
      <group position={[0, 0, 1]}>
        {[-4, 4].flatMap((x) => [-2, 2].map((z) => <Box key={`${x}:${z}`} p={[x, 2.5, z]} s={[0.3, 5, 0.3]} c="#e9e2d4" />))}
        <Box p={[0, 5.2, 0]} s={[11, 0.5, 6]} c="#f4f1ea" />
        <Box p={[0, 5.2, 3.02]} s={[11, 0.5, 0.05]} c="#d23c22" cast={false} opts={lit ? { emissive: '#d23c22' } : undefined} />
        {[-2.5, 2.5].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <Box p={[0, 0.8, 0]} s={[0.8, 1.6, 0.6]} c="#d23c22" />
            <Box p={[0, 1.3, 0.31]} s={[0.5, 0.35, 0.02]} c={power || lit ? '#bdf0c0' : '#33505f'} cast={false} />
          </group>
        ))}
      </group>
      <group position={[0, 0, -d / 2 + 2]}>
        <Box p={[0, 1.6, 0]} s={[6, 3.2, 3.4]} c="#f4f1ea" />
        <Box p={[0, 1.2, 1.72]} s={[3, 2, 0.05]} c="#6fa2b8" cast={false} />
      </group>
      <group position={[w / 2 - 1, 0, d / 2 - 1]}>
        <Box p={[0, 2.2, 0]} s={[0.25, 4.4, 0.25]} c="#3a3a3a" />
        <mesh position={[0, 4.2, 0.15]}>
          <planeGeometry args={[3.2, 1]} />
          <meshStandardMaterial map={board} emissiveMap={board} emissive="#ffffff" emissiveIntensity={0.25} />
        </mesh>
      </group>
      {!power && lit && <Smoke x={-w / 2 + 1.5} y={1.4} />}
      {/* A fuel queue when there is scarcity, spilling onto the road. */}
      {scarcity &&
        Array.from({ length: 5 }, (_, i) => (
          <group key={i} position={[w / 2 - 2 - i * 4.4, 0, d / 2 + 4.8]}>
            <Car color={['#d6d6d6', '#1f1d1a', '#b8352a', '#e9e2d4', '#2f63ad'][i]} />
          </group>
        ))}
    </group>
  );
}

/** A plot waiting for someone to lease it. */
export function VacantLot({ plot }: { plot: Plot }) {
  const { w, d } = plot;
  const farm = plot.kind === 'farm';
  const bushes = useMemo(() => {
    const rnd = seeded(`lot:${plot.id}`);
    return Array.from({ length: farm ? 6 : 4 }, () => [(rnd() - 0.5) * (w - 3), (rnd() - 0.5) * (d - 3), 0.5 + rnd() * 0.6]);
  }, [plot.id, w, d, farm]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={mat(farm ? '#b2a170' : '#a8b86e')} receiveShadow>
        <planeGeometry args={[w - 0.4, d - 0.4]} />
      </mesh>
      {bushes.map(([x, z, r], i) => (
        <mesh key={i} position={[x, r * 0.6, z]} material={mat(i % 2 ? '#6f9a45' : '#5f8a3a')} castShadow>
          <icosahedronGeometry args={[r, 0]} />
        </mesh>
      ))}
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Box key={`${sx}${sz}`} p={[(sx * (w - 0.6)) / 2, 0.5, (sz * (d - 0.6)) / 2]} s={[0.18, 1, 0.18]} c="#d8cfbd" />))}
      <group position={[0, 0, d / 2 - 1]}>
        {[-1.6, 1.6].map((x) => (
          <Box key={x} p={[x, 1.2, 0]} s={[0.14, 2.4, 0.14]} c="#4a4743" />
        ))}
        <Sign text={farm ? 'FARMLAND FOR LEASE' : 'PLOT FOR LEASE'} y={2.2} z={0.08} w={3.8} bg="#f2b705" fg="#1f1d1a" />
      </group>
    </group>
  );
}

// ───────────── street landmarks ─────────────

export function BusStop({ lga, name, lightsOn }: { lga: string; name: string; lightsOn: boolean }) {
  const h = hood(lga);
  const [x, z] = h.busStop;
  const waiting = useMemo(() => {
    const rnd = seeded(`bus:${lga}`);
    return Array.from({ length: 3 }, (_, i) => ({
      x: -1.6 + i * 1.5 + rnd() * 0.3,
      looks: { skin: Math.floor(rnd() * 5), hair: Math.floor(rnd() * 5), outfit: Math.floor(rnd() * 8), accent: Math.floor(rnd() * 8), glasses: false },
      gender: (rnd() > 0.5 ? 'm' : 'f') as 'm' | 'f',
    }));
  }, [lga]);
  return (
    <group position={[x, 0, z]} rotation={[0, h.busRot, 0]}>
      {[-2.6, 2.6].map((px) => (
        <Box key={px} p={[px, 1.4, 0.6]} s={[0.15, 2.8, 0.15]} c="#3a3a3a" />
      ))}
      <mesh position={[0, 2.9, -0.2]} rotation={[-0.08, 0, 0]} material={mat('#f2b705')} castShadow>
        <boxGeometry args={[6, 0.14, 2.4]} />
      </mesh>
      <mesh position={[0, 1.6, 0.68]}>
        <planeGeometry args={[5, 1.6]} />
        <meshStandardMaterial map={signTexture(`${name.toUpperCase()} BUS STOP`, '#1f1d1a', '#f2b705')} side={THREE.DoubleSide} emissive={lightsOn ? '#ffffff' : '#000000'} emissiveIntensity={lightsOn ? 0.2 : 0} />
      </mesh>
      <Box p={[0, 0.45, 0.3]} s={[4.6, 0.12, 0.6]} c="#7a4f2d" />
      <group position={[3.6, 0, -1.2]}>
        <Box p={[0, 1.5, 0]} s={[0.1, 3, 0.1]} c="#3a3a3a" />
        <mesh position={[0, 3.1, 0]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[1.6, 0.6]} />
          <meshStandardMaterial map={signTexture('BUS STOP', '#2f63ad', '#ffffff')} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {waiting.map((p, i) => (
        <group key={i} position={[p.x, 0, 0]} rotation={[0, Math.PI, 0]}>
          <Person3D looks={p.looks} gender={p.gender} pose="idle" />
        </group>
      ))}
    </group>
  );
}

/**
 * A pedestrian bridge over the main road, with stairs down to both pavements. In the grid towns it crosses
 * the main road; elsewhere give it the road's centre, the bridge's turn (its deck runs along local z) and the span.
 */
export function FootBridge({ lga, at }: { lga: string; at?: { x: number; z: number; rot: number; span: number } }) {
  const x = at?.x ?? hood(lga).bridgeX;
  const deckY = 5.6;
  const span = at?.span ?? (MAIN_HALF + PAVEMENT) * 2 - 1;
  const half = span / 2 - PAVEMENT + 1.1;
  const run = 10;
  const len = Math.hypot(run, deckY);
  const tilt = Math.atan2(deckY, run);
  const sign = useMemo(() => signTexture('USE THE BRIDGE · SAVE YOUR LIFE', '#1e8f5a', '#ffffff'), []);
  return (
    <group position={[x, 0, at?.z ?? 0]} rotation={[0, at?.rot ?? 0, 0]}>
      <Box p={[0, deckY, 0]} s={[2.2, 0.4, span]} c="#9a9488" />
      {[-1.05, 1.05].map((s) => (
        <Box key={s} p={[s, deckY + 0.7, 0]} s={[0.08, 1, span]} c="#2f63ad" />
      ))}
      <mesh position={[1.12, deckY + 0.7, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[6, 0.9]} />
        <meshStandardMaterial map={sign} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <Box p={[0, deckY / 2, s * half]} s={[0.5, deckY, 0.5]} c="#9a9488" />
          {/* Stairs run along the pavement, down and away from the deck. */}
          <mesh position={[(-s * run) / 2, deckY / 2, s * (span / 2 - 1)]} rotation={[0, 0, s * tilt]} material={mat('#9a9488')} castShadow>
            <boxGeometry args={[len, 0.35, 1.8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Billboard({ x, z, rot = 0, head, sub, bg, fg, lit }: { x: number; z: number; rot?: number; head: string; sub: string; bg: string; fg: string; lit: boolean }) {
  const tex = useMemo(() => billboardTexture(head, sub, bg, fg), [head, sub, bg, fg]);
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      {[-3, 3].map((px) => (
        <Box key={px} p={[px, 3.6, -0.3]} s={[0.3, 7.2, 0.3]} c="#4a4743" />
      ))}
      <Box p={[0, 9.5, -0.2]} s={[10.4, 5.4, 0.3]} c="#2a2a2a" />
      <mesh position={[0, 9.5, 0]}>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={lit ? 0.4 : 0.05} />
      </mesh>
    </group>
  );
}
