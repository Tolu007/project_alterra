import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { PlaceId } from '../data/trades';
import type { SceneStyle } from '../data/world';
import type { Housing } from '../engine/types';
import { Danfo, Keke, mat } from './Actors';
import { flagTexture, partyFlagTexture, signTexture } from './textures';

export interface BuildingProps {
  kind: PlaceId;
  style: SceneStyle;
  wall: string;
  /** Height multiplier; the row nearest the camera is kept low. */
  tall: number;
  night: boolean;
  /** NEPA has power right now. */
  power: boolean;
  housing: Housing;
  generator: boolean;
  demolished: boolean;
  party: { id: string; color: string; ink: string };
  /** Your own business sign here, if any. */
  ownSign: string | null;
  kekeColor: string;
  /** What is showing next, on the event centre's poster. */
  poster?: string | null;
}

export const earthen = (s: SceneStyle) => s.startsWith('kano');

export function Box({ p, s, c, cast = true, opts }: { p: [number, number, number]; s: [number, number, number]; c: string; cast?: boolean; opts?: Parameters<typeof mat>[1] }) {
  return (
    <mesh position={p} material={mat(c, opts)} castShadow={cast} receiveShadow>
      <boxGeometry args={s} />
    </mesh>
  );
}

export function Sign({ text, y, z, w = 5, bg, fg }: { text: string; y: number; z: number; w?: number; bg?: string; fg?: string }) {
  return (
    <mesh position={[0, y, z]}>
      <planeGeometry args={[w, w / 4]} />
      <meshStandardMaterial map={signTexture(text, bg, fg)} roughness={0.9} />
    </mesh>
  );
}

/** Corrugated zinc gable, or an earthen flat roof with zanko horns in Kano. */
export function Roof({ w, d, y, style, rusty }: { w: number; d: number; y: number; style: SceneStyle; rusty?: boolean }) {
  if (earthen(style)) {
    return (
      <group>
        <Box p={[0, y + 0.25, 0]} s={[w + 0.3, 0.5, d + 0.3]} c="#a86c3a" />
        {[
          [-w / 2, -d / 2],
          [w / 2, -d / 2],
          [-w / 2, d / 2],
          [w / 2, d / 2],
        ].map(([x, z]) => (
          <mesh key={`${x}${z}`} position={[x, y + 0.95, z]} material={mat('#a86c3a')} castShadow>
            <coneGeometry args={[0.28, 0.9, 5]} />
          </mesh>
        ))}
      </group>
    );
  }
  const angle = 0.38;
  const half = d / 2 / Math.cos(angle) + 0.25;
  const color = rusty ? '#9a5f45' : '#9fb0b8';
  return (
    <group position={[0, y, 0]}>
      <mesh position={[0, Math.tan(angle) * (d / 4), d / 4]} rotation={[angle, 0, 0]} material={mat(color, { metal: 0.3, rough: 0.6 })} castShadow>
        <boxGeometry args={[w + 0.8, 0.12, half]} />
      </mesh>
      <mesh position={[0, Math.tan(angle) * (d / 4), -d / 4]} rotation={[-angle, 0, 0]} material={mat(color, { metal: 0.3, rough: 0.6 })} castShadow>
        <boxGeometry args={[w + 0.8, 0.12, half]} />
      </mesh>
    </group>
  );
}

export function Windows({ w, y, z, n, rows = 1, lit }: { w: number; y: number; z: number; n: number; rows?: number; lit: boolean }) {
  const glass = lit ? mat('#ffe2a1', { emissive: '#ffb347' }) : mat('#33505f', { rough: 0.3 });
  const step = w / n;
  return (
    <group>
      {Array.from({ length: n * rows }, (_, i) => {
        const c = i % n;
        const r = Math.floor(i / n);
        return (
          <mesh key={i} position={[-w / 2 + step * (c + 0.5), y + r * 2.6, z]} material={glass}>
            <boxGeometry args={[step * 0.55, 1, 0.08]} />
          </mesh>
        );
      })}
    </group>
  );
}

export function WaterTank({ x, y }: { x: number; y: number }) {
  return (
    <group position={[x, y, 0]}>
      <mesh position={[0, 0.9, 0]} material={mat('#1f1d1a')} castShadow>
        <cylinderGeometry args={[0.6, 0.6, 1.2, 10]} />
      </mesh>
      <Box p={[0, 0.15, 0]} s={[1.3, 0.3, 1.3]} c="#6d6a64" />
    </group>
  );
}

export function Flag({ x, y, z, tex }: { x: number; y: number; z: number; tex: THREE.Texture }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, y / 2, 0]} material={mat('#c9c2b2', { metal: 0.5 })}>
        <cylinderGeometry args={[0.06, 0.06, y, 6]} />
      </mesh>
      <mesh position={[0.7, y - 0.45, 0]}>
        <planeGeometry args={[1.4, 0.9]} />
        <meshStandardMaterial map={tex} side={THREE.DoubleSide} roughness={0.9} />
      </mesh>
    </group>
  );
}

function Flame({ y }: { y: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.scale.set(1 + Math.sin(t * 13) * 0.1, 1 + Math.sin(t * 9) * 0.25, 1);
  });
  return (
    <group position={[0, y, 0]}>
      <mesh ref={ref} position={[0, 0.9, 0]} material={mat('#ff8a2a', { emissive: '#ff5a1a' })}>
        <coneGeometry args={[0.5, 1.8, 8]} />
      </mesh>
      <pointLight position={[0, 1.4, 0]} color="#ff7a2a" intensity={18} distance={22} decay={1.6} />
    </group>
  );
}

export function Smoke({ x, y }: { x: number; y: number }) {
  const puffs = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!puffs.current) return;
    puffs.current.children.forEach((m, i) => {
      const t = (clock.elapsedTime * 0.5 + i / 3) % 1;
      m.position.y = t * 3;
      m.scale.setScalar(0.4 + t * 1.2);
      ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.6 * (1 - t);
    });
  });
  return (
    <group ref={puffs} position={[x, y, 0]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.5, 6, 5]} />
          <meshStandardMaterial color="#b5b0a6" transparent opacity={0.5} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/** Standard walled building with roof, door, windows and an optional sign. */
export function Block({ w, h, d, wall, style, lit, sign, signBg, signFg, rusty, tank, doors = 1 }: { w: number; h: number; d: number; wall: string; style: SceneStyle; lit: boolean; sign?: string; signBg?: string; signFg?: string; rusty?: boolean; tank?: boolean; doors?: number }) {
  const storeys = Math.max(1, Math.round(h / 3.2));
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={wall} />
      <Roof w={w} d={d} y={h} style={style} rusty={rusty} />
      {Array.from({ length: doors }, (_, i) => (
        <Box key={i} p={[doors === 1 ? 0 : -w / 2 + (w / doors) * (i + 0.5), 1.1, d / 2 + 0.02]} s={[1.1, 2.2, 0.1]} c="#6b4024" cast={false} />
      ))}
      <Windows w={w} y={1.7} z={d / 2 + 0.03} n={doors > 1 ? doors : 3} rows={storeys} lit={lit} />
      {tank && !earthen(style) && <WaterTank x={w / 2 - 1.2} y={h + 0.6} />}
      {sign && <Sign text={sign} y={h - 0.7 > 2.8 ? Math.min(h - 0.6, 3.1) : h - 0.5} z={d / 2 + 0.06} w={Math.min(w - 0.6, 6.5)} bg={signBg} fg={signFg} />}
    </group>
  );
}

export function Building(props: BuildingProps) {
  const { kind, style, wall, tall, night, power, housing, generator, demolished, party, ownSign, kekeColor, poster } = props;
  const lit = night && power;
  const lagosy = !earthen(style);
  // Your business gets its own signboard on posts, in front and to the side.
  const own = ownSign ? (
    <group position={[-3.6, 0, 5.4]}>
      {[-1.6, 1.6].map((x) => (
        <Box key={x} p={[x, 1.3, 0]} s={[0.15, 2.6, 0.15]} c="#3a3a3a" />
      ))}
      <mesh position={[0, 2.5, 0.1]}>
        <planeGeometry args={[4, 1]} />
        <meshStandardMaterial map={signTexture(ownSign, '#f2b705')} roughness={0.9} />
      </mesh>
    </group>
  ) : null;

  const body = (() => {
    switch (kind) {
      case 'home': {
        const h = (housing === 'duplex' ? 7 : housing === 'flat' ? 6.4 : 3.4) * tall;
        return (
          <group>
            <Block w={housing === 'room' ? 11 : 9} h={h} d={7} wall={housing === 'duplex' ? '#f4f1ea' : wall} style={style} lit={lit} rusty={housing === 'room' || housing === 'family'} tank doors={housing === 'room' ? 4 : 1} />
            {generator && (
              <group position={[-5.6, 0, 2]}>
                <Box p={[0, 0.45, 0]} s={[1.2, 0.9, 0.8]} c="#d23c22" />
                {night && !power && <Smoke x={0} y={1} />}
              </group>
            )}
          </group>
        );
      }
      case 'market':
        if (demolished) {
          return (
            <group>
              {Array.from({ length: 9 }, (_, i) => (
                <Box key={i} p={[-4 + (i % 3) * 3.5, 0.4 + (i % 2) * 0.3, -2 + Math.floor(i / 3) * 2.5]} s={[1.6 + (i % 2), 0.7 + (i % 3) * 0.3, 1.4]} c={i % 2 ? '#a89c88' : '#8a7f6e'} />
              ))}
              <group position={[3.5, 0, 2.5]}>
                <Box p={[0, 1.3, 0]} s={[2.6, 1.4, 1.8]} c="#f2b705" />
                <Box p={[-1.9, 0.8, 0]} s={[1.4, 0.5, 1.9]} c="#c99400" />
                <Box p={[0, 0.4, 0]} s={[3, 0.6, 2]} c="#1f1d1a" />
              </group>
            </group>
          );
        }
        return (
          <group>
            {[-3.6, 0, 3.6].flatMap((x, i) =>
              [-1.6, 1.8].map((z, j) => (
                <group key={`${x}:${z}`} position={[x, 0, z]}>
                  <Box p={[0, 0.5, 0]} s={[2.4, 1, 1.4]} c="#c9a77c" />
                  {[0, 1, 2].map((k) => (
                    <mesh key={k} position={[-0.7 + k * 0.7, 1.15, 0]} material={mat(['#e24a2a', '#f2b705', '#7cb342'][(i + j + k) % 3])}>
                      <sphereGeometry args={[0.28, 6, 5]} />
                    </mesh>
                  ))}
                  <mesh position={[0, 1.6, 0]} material={mat('#3a3a3a')}>
                    <cylinderGeometry args={[0.05, 0.05, 1.3, 5]} />
                  </mesh>
                  <mesh position={[0, 2.35, 0]} material={mat(['#d23c22', '#1e8f5a', '#2f63ad', '#f2b705'][(i * 2 + j) % 4])} castShadow>
                    <coneGeometry args={[1.5, 0.7, 8]} />
                  </mesh>
                </group>
              )),
            )}
            <Sign text="MARKET" y={0.55} z={4.2} w={4} bg="#d23c22" fg="#fff7ea" />
          </group>
        );
      case 'park':
        return (
          <group>
            {[-4.5, 4.5].map((x) => (
              <mesh key={x} position={[x, 1.8, 0]} material={mat('#3a3a3a')}>
                <cylinderGeometry args={[0.12, 0.12, 3.6, 6]} />
              </mesh>
            ))}
            <Box p={[0, 3.7, 0]} s={[10.4, 0.25, 6]} c="#c2552d" />
            <group position={[-2, 0, 0]}>{lagosy ? <Danfo /> : <Keke color={kekeColor} />}</group>
            <group position={[3, 0, 1]} rotation={[0, 0.2, 0]}>
              <Keke color={kekeColor} />
            </group>
            <Sign text="MOTOR PARK" y={4.3} z={3.05} w={5} bg="#1f1d1a" fg="#f2b705" />
          </group>
        );
      case 'workshop':
        return (
          <group>
            <Box p={[0, 1.6, -1.5]} s={[10, 3.2, 4]} c={wall} />
            <Box p={[0, 3.3, 0]} s={[10.6, 0.18, 7]} c="#9a5f45" opts={{ metal: 0.3 }} />
            {[-4.8, 4.8].map((x) => (
              <mesh key={x} position={[x, 1.6, 3.2]} material={mat('#3a3a3a')}>
                <cylinderGeometry args={[0.1, 0.1, 3.2, 6]} />
              </mesh>
            ))}
            {[0, 1, 2].map((i) => (
              <mesh key={i} position={[-3.5, 0.3 + i * 0.32, 2.2]} rotation={[Math.PI / 2, 0, 0]} material={mat('#202020')} castShadow>
                <torusGeometry args={[0.5, 0.18, 6, 12]} />
              </mesh>
            ))}
            <Box p={[1.5, 0.75, 1]} s={[1.6, 1.5, 0.9]} c="#7a4f2d" />
            <Sign text="TAILOR · MECHANIC · BARBER" y={2.7} z={0.55} w={6.5} />
          </group>
        );
      case 'farm':
        return style === 'rivers-water' ? (
          <group>
            <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mat('#3f7f99', { rough: 0.25 })} receiveShadow>
              <planeGeometry args={[11, 8]} />
            </mesh>
            {[-3, -1, 1, 3].map((x) => (
              <mesh key={x} position={[x - 1, 1, -2]} material={mat('#6b4a2b')}>
                <cylinderGeometry args={[0.12, 0.12, 2, 5]} />
              </mesh>
            ))}
            <Box p={[-1, 2.6, -2]} s={[6, 2, 3]} c="#b98d5f" />
            <Roof w={6} d={3} y={3.6} style={style} rusty />
            <mesh position={[2.5, 0.25, 2]} scale={[1, 0.35, 0.33]} material={mat('#7a4f2d')} castShadow>
              <sphereGeometry args={[2, 10, 6]} />
            </mesh>
          </group>
        ) : (
          <group>
            {Array.from({ length: 6 }, (_, i) => (
              <Box key={i} p={[0, 0.25, -3.2 + i * 1.3]} s={[10, 0.5, 0.7]} c={i % 2 ? '#7fb04a' : '#5f9a3a'} />
            ))}
            <group position={[4.2, 0, -3]}>
              <Box p={[0, 1.2, 0]} s={[2, 2.4, 2]} c="#c98c4f" />
              <mesh position={[0, 2.9, 0]} material={mat('#d9a521')} castShadow>
                <coneGeometry args={[1.6, 1.2, 8]} />
              </mesh>
            </group>
          </group>
        );
      case 'school':
        return (
          <group>
            <Block w={12} h={3.6 * tall} d={7} wall="#f0d58c" style={style} lit={lit} sign="PUBLIC SCHOOL" doors={1} />
            <Flag x={6.8} y={7} z={3} tex={flagTexture()} />
          </group>
        );
      case 'secretariat':
      case 'govhouse':
      case 'bank': {
        const big = kind === 'govhouse';
        const h = (big ? 7 : 5) * tall;
        const w = big ? 12 : 10;
        return (
          <group>
            <Box p={[0, h / 2, 0]} s={[w, h, 7]} c={kind === 'bank' ? '#e9e2d4' : '#f4f1ea'} />
            <Box p={[0, h + 0.3, 0]} s={[w + 0.6, 0.6, 7.6]} c={kind === 'bank' ? '#2f63ad' : '#1e8f5a'} />
            {Array.from({ length: 5 }, (_, i) => (
              <mesh key={i} position={[-w / 2 + 1 + (i * (w - 2)) / 4, h / 2, 3.8]} material={mat('#fffaf0')} castShadow>
                <cylinderGeometry args={[0.32, 0.36, h, 10]} />
              </mesh>
            ))}
            {big && (
              <mesh position={[0, h + 0.6, 0]} material={mat('#e9e2d4')} castShadow>
                <sphereGeometry args={[2.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
              </mesh>
            )}
            <Box p={[0, 1.2, 3.55]} s={[1.6, 2.4, 0.1]} c="#6b4024" cast={false} />
            <Windows w={w - 2} y={1.8} z={3.53} n={4} rows={Math.max(1, Math.round(h / 3.2))} lit={lit} />
            <Sign text={kind === 'bank' ? 'BANK' : big ? 'GOVERNMENT HOUSE' : 'LG SECRETARIAT'} y={h - 0.8} z={4.2} w={5.2} bg={kind === 'bank' ? '#2f63ad' : '#1e8f5a'} fg="#ffffff" />
            {kind !== 'bank' && <Flag x={-w / 2 - 0.8} y={big ? 9 : 7.5} z={3} tex={flagTexture()} />}
            {kind === 'bank' && <Box p={[w / 2 - 1, 1, 3.7]} s={[0.9, 2, 0.4]} c="#6d6a64" />}
          </group>
        );
      }
      case 'office': {
        const h = 16 * tall;
        return (
          <group>
            <Box p={[0, h / 2, 0]} s={[8, h, 7]} c="#4f8fb5" opts={{ rough: 0.25, metal: 0.3 }} />
            {Array.from({ length: Math.floor(h / 2) }, (_, i) => (
              <Box key={i} p={[0, 1.2 + i * 2, 3.52]} s={[7.6, 0.18, 0.05]} c={lit && i % 3 !== 1 ? '#ffe2a1' : '#cfe3ef'} cast={false} opts={lit && i % 3 !== 1 ? { emissive: '#ffb347' } : undefined} />
            ))}
            <Sign text="OFFICES" y={2.6} z={3.6} w={3.6} bg="#1f1d1a" fg="#a8d8ea" />
          </group>
        );
      }
      case 'techhub':
        return (
          <group>
            <Box p={[0, 3 * tall, 0]} s={[10, 6 * tall, 7]} c="#2a2a2a" />
            <Box p={[0, 2.6 * tall, 3.52]} s={[8, 3 * tall, 0.06]} c={power ? '#a8d8ea' : '#33505f'} cast={false} opts={power ? { emissive: '#4fa3c7' } : undefined} />
            <Sign text="TECH HUB" y={5.4 * tall} z={3.56} w={4} bg="#1f1d1a" fg="#f2b705" />
          </group>
        );
      case 'oilsite':
        return (
          <group>
            {[-3, 0.5].map((x) => (
              <mesh key={x} position={[x, 1.6, -1]} material={mat('#dcd6ca', { metal: 0.4 })} castShadow>
                <cylinderGeometry args={[1.6, 1.6, 3.2, 14]} />
              </mesh>
            ))}
            <mesh position={[4, 5, -1]} material={mat('#8f8a80', { metal: 0.5 })} castShadow>
              <cylinderGeometry args={[0.3, 0.35, 10, 8]} />
            </mesh>
            <group position={[4, 0, -1]}>
              <Flame y={10} />
            </group>
            <Box p={[0, 0.6, 2.6]} s={[10, 0.15, 0.15]} c="#c2552d" />
            <Sign text="OIL & GAS" y={0.8} z={3.3} w={3.6} bg="#1f1d1a" fg="#ff8a2a" />
          </group>
        );
      case 'factory':
        return (
          <group>
            <Box p={[0, 2.4 * tall, 0]} s={[11, 4.8 * tall, 7]} c="#c9c2b2" />
            {[-3.7, 0, 3.7].map((x) => (
              <mesh key={x} position={[x, 4.8 * tall + 0.6, 0]} rotation={[0, 0, Math.PI / 2]} material={mat('#9fb0b8', { metal: 0.3 })} castShadow>
                <cylinderGeometry args={[1.2, 1.2, 3.6, 3]} />
              </mesh>
            ))}
            <mesh position={[4.6, 6.5, -2]} material={mat('#9a8f80')} castShadow>
              <cylinderGeometry args={[0.45, 0.55, 5, 8]} />
            </mesh>
            <Smoke x={4.6} y={9} />
            <Box p={[0, 1.4, 3.52]} s={[4, 2.8, 0.1]} c="#6d6a64" cast={false} />
            <Sign text="FACTORY" y={3.6 * tall} z={3.57} w={3.6} />
          </group>
        );
      case 'skills':
        return <Block w={10} h={4 * tall} d={7} wall={wall} style={style} lit={lit} sign="SKILLS ACQUISITION CENTRE" signBg="#2f63ad" signFg="#ffffff" tank />;
      case 'joint':
        return (
          <group>
            <Block w={10} h={3.6 * tall} d={6} wall={wall} style={style} lit={lit} sign="VIEWING CENTRE & BAR" signBg="#d23c22" signFg="#fff7ea" />
            <Box p={[0, 2.8, 3.8]} s={[10, 0.15, 1.8]} c="#d23c22" />
            {[-3, -1.2, 0.6, 2.4].map((x, i) => (
              <Box key={x} p={[x, 0.4, 4.4]} s={[0.6, 0.8, 0.6]} c={['#d23c22', '#2f63ad', '#1e8f5a', '#f2b705'][i]} />
            ))}
            <Box p={[3.8, 1.8, 3.05]} s={[1.8, 1.1, 0.08]} c={power || night ? '#9fe3ff' : '#22303a'} cast={false} opts={{ emissive: '#2f8fc7' }} />
          </group>
        );
      case 'party':
        return (
          <group>
            <Block w={10} h={4 * tall} d={7} wall="#fffaf0" style={style} lit={lit} sign={`${party.id} SECRETARIAT`} signBg={party.color} signFg={party.ink} />
            <Box p={[0, 0.5, 3.53]} s={[10, 1, 0.05]} c={party.color} cast={false} />
            <Flag x={-5.6} y={6} z={3} tex={partyFlagTexture(party.color, party.id, party.ink)} />
            <Flag x={5.6} y={6} z={3} tex={partyFlagTexture(party.color, party.id, party.ink)} />
          </group>
        );
      case 'clinic':
        return (
          <group>
            <Block w={9} h={4 * tall} d={7} wall="#ffffff" style={style} lit={lit} sign="CLINIC" signBg="#1e8f5a" signFg="#ffffff" />
            <Box p={[3, 3.4 * tall, 3.56]} s={[0.4, 1.3, 0.06]} c="#1e8f5a" cast={false} />
            <Box p={[3, 3.4 * tall, 3.56]} s={[1.3, 0.4, 0.06]} c="#1e8f5a" cast={false} />
          </group>
        );
      case 'venue': {
        const bulb = night ? mat('#ffe9a0', { emissive: '#ffcf6b' }) : mat('#f4e3c6');
        return (
          <group>
            <Box p={[0, 3.2, -0.6]} s={[12, 6.4, 7]} c={earthen(style) ? '#8a5a3a' : '#2a2440'} />
            <Box p={[0, 6.6, -0.6]} s={[12.4, 0.5, 7.4]} c="#c9a227" />
            <Box p={[0, 3.4, 3.7]} s={[7, 0.25, 2.4]} c="#c9a227" />
            {[-3.2, 3.2].map((x) => (
              <Box key={x} p={[x, 1.7, 4.7]} s={[0.15, 3.4, 0.15]} c="#c9a227" />
            ))}
            {Array.from({ length: 9 }, (_, i) => (
              <mesh key={i} position={[-3.2 + i * 0.8, 3.22, 4.92]} material={bulb}>
                <sphereGeometry args={[0.13, 6, 4]} />
              </mesh>
            ))}
            <Box p={[0, 1.3, 2.92]} s={[3.2, 2.6, 0.08]} c="#6b4024" cast={false} />
            <Sign text={poster ?? 'EVENT CENTRE · HALLS FOR HIRE'} y={5.1} z={2.96} w={10} bg="#d23c22" fg="#fff7ea" />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 4.6]} material={mat('#b8352a')}>
              <planeGeometry args={[2.2, 3.4]} />
            </mesh>
          </group>
        );
      }
      case 'palace':
        return earthen(style) ? (
          <group>
            <Box p={[0, 2.2 * tall, -2]} s={[11, 4.4 * tall, 4]} c="#c4854a" />
            <Box p={[0, 1.4, 1.5]} s={[11, 2.8, 0.6]} c="#b87a43" />
            <Roof w={11} d={4} y={4.4 * tall} style={style} />
            <mesh position={[0, 1.2, 1.85]} material={mat('#6b4024')}>
              <cylinderGeometry args={[1.2, 1.2, 0.2, 12, 1, false, 0, Math.PI]} />
            </mesh>
            <Box p={[0, 0.9, 1.82]} s={[2.4, 1.8, 0.1]} c="#6b4024" cast={false} />
            <Box p={[0, 3.2 * tall, -0.02]} s={[9, 0.3, 0.05]} c="#f4e3c6" cast={false} />
          </group>
        ) : (
          <group>
            <Block w={11} h={5 * tall} d={6} wall="#f4f1ea" style={style} lit={lit} />
            <Box p={[0, 1.3, 3.8]} s={[11, 2.6, 0.4]} c="#f4f1ea" />
            <Box p={[0, 1.1, 4.02]} s={[2.4, 2.2, 0.1]} c="#d9a521" cast={false} />
          </group>
        );
    }
  })();

  return (
    <group>
      {body}
      {own}
    </group>
  );
}

