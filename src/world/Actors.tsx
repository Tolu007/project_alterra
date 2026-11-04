import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Looks } from '../engine/types';
import { ACCENT, OUTFIT, SKIN } from '../ui/Portrait';
import { coinTexture, nameTexture } from './textures';

// Shared flat-shaded materials, one per colour.
const mats = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, opts: { emissive?: string; rough?: number; metal?: number; transparent?: number } = {}) {
  const key = `${color}:${opts.emissive ?? ''}:${opts.rough ?? ''}:${opts.metal ?? ''}:${opts.transparent ?? ''}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: opts.rough ?? 0.85,
      metalness: opts.metal ?? 0,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : undefined,
      emissiveIntensity: opts.emissive ? 1 : 0,
      transparent: opts.transparent !== undefined,
      opacity: opts.transparent ?? 1,
    });
    mats.set(key, m);
  }
  return m;
}

export type Pose = 'idle' | 'walk' | 'work' | 'wave';

interface PersonProps {
  looks: Looks;
  gender: 'm' | 'f';
  pose?: Pose;
  speed?: number;
  /** Floating gold ₦ coin: marks the player. */
  marker?: boolean;
  tag?: { name: string; sub: string } | null;
  onClick?: () => void;
  children?: ReactNode;
}

/** A low-poly person. Limbs swing on a sine wave while walking. */
export function Person3D({ looks, gender, pose = 'idle', speed = 1, marker, tag, onClick }: PersonProps) {
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const coin = useRef<THREE.Mesh>(null);
  const phase = useRef(Math.random() * 10);
  const skin = SKIN[looks.skin % SKIN.length];
  const outfit = OUTFIT[looks.outfit % OUTFIT.length];
  const accent = ACCENT[looks.accent % ACCENT.length];
  const hair = looks.hair % 5;
  const dark = '#1a1410';

  useFrame((_, dt) => {
    phase.current += dt * (pose === 'walk' ? 9 * speed : pose === 'work' ? 7 : 2);
    const s = Math.sin(phase.current);
    const walk = pose === 'walk' ? 0.6 : 0;
    if (legL.current && legR.current) {
      legL.current.rotation.x = s * walk;
      legR.current.rotation.x = -s * walk;
    }
    if (armL.current && armR.current) {
      if (pose === 'work') {
        armL.current.rotation.x = -1.1 + s * 0.35;
        armR.current.rotation.x = -1.1 - s * 0.35;
      } else if (pose === 'wave') {
        armR.current.rotation.x = 0;
        armR.current.rotation.z = 2.6 + s * 0.3;
        armL.current.rotation.x = 0;
      } else {
        armL.current.rotation.x = -s * walk * 0.8;
        armR.current.rotation.x = s * walk * 0.8;
        armR.current.rotation.z = 0;
      }
    }
    if (body.current) body.current.position.y = pose === 'walk' ? Math.abs(s) * 0.05 : Math.sin(phase.current * 0.5) * 0.01;
    if (coin.current) coin.current.rotation.z += dt * 2.4;
  });

  const tagTex = useMemo(() => (tag ? nameTexture(tag.name, tag.sub) : null), [tag]);

  return (
    <group
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
    >
      <group ref={body}>
        {/* legs */}
        <group ref={legL} position={[-0.12, 0.9, 0]}>
          <mesh position={[0, -0.43, 0]} material={mat('#2b2b33')} castShadow>
            <boxGeometry args={[0.2, 0.86, 0.22]} />
          </mesh>
        </group>
        <group ref={legR} position={[0.12, 0.9, 0]}>
          <mesh position={[0, -0.43, 0]} material={mat('#2b2b33')} castShadow>
            <boxGeometry args={[0.2, 0.86, 0.22]} />
          </mesh>
        </group>
        {gender === 'f' && (
          <mesh position={[0, 0.72, 0]} material={mat(outfit)} castShadow>
            <cylinderGeometry args={[0.27, 0.38, 0.62, 8]} />
          </mesh>
        )}
        {/* torso with an ankara band */}
        <mesh position={[0, 1.2, 0]} material={mat(outfit)} castShadow>
          <boxGeometry args={[0.52, 0.62, 0.3]} />
        </mesh>
        <mesh position={[0, 1.24, 0.153]} material={mat(accent)}>
          <boxGeometry args={[0.36, 0.1, 0.01]} />
        </mesh>
        <mesh position={[0, 1.08, 0.153]} material={mat(accent)}>
          <boxGeometry args={[0.36, 0.06, 0.01]} />
        </mesh>
        {/* arms */}
        <group ref={armL} position={[-0.34, 1.48, 0]}>
          <mesh position={[0, -0.3, 0]} material={mat(outfit)} castShadow>
            <boxGeometry args={[0.14, 0.6, 0.15]} />
          </mesh>
          <mesh position={[0, -0.64, 0]} material={mat(skin)}>
            <boxGeometry args={[0.12, 0.12, 0.12]} />
          </mesh>
        </group>
        <group ref={armR} position={[0.34, 1.48, 0]}>
          <mesh position={[0, -0.3, 0]} material={mat(outfit)} castShadow>
            <boxGeometry args={[0.14, 0.6, 0.15]} />
          </mesh>
          <mesh position={[0, -0.64, 0]} material={mat(skin)}>
            <boxGeometry args={[0.12, 0.12, 0.12]} />
          </mesh>
        </group>
        {/* head */}
        <mesh position={[0, 1.56, 0]} material={mat(skin)}>
          <cylinderGeometry args={[0.07, 0.08, 0.1, 6]} />
        </mesh>
        <mesh position={[0, 1.76, 0]} material={mat(skin)} castShadow>
          <sphereGeometry args={[0.2, 10, 8]} />
        </mesh>
        <mesh position={[-0.07, 1.78, 0.18]} material={mat('#111')}>
          <sphereGeometry args={[0.025, 6, 4]} />
        </mesh>
        <mesh position={[0.07, 1.78, 0.18]} material={mat('#111')}>
          <sphereGeometry args={[0.025, 6, 4]} />
        </mesh>
        {looks.glasses && (
          <mesh position={[0, 1.78, 0.19]} material={mat('#111')}>
            <boxGeometry args={[0.26, 0.04, 0.01]} />
          </mesh>
        )}
        <Hair gender={gender} hair={hair} dark={dark} accent={accent} />
      </group>
      {marker && (
        <mesh ref={coin} position={[0, 2.75, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.36, 0.36, 0.08, 24]} />
          <meshStandardMaterial attach="material-0" color="#f2b705" metalness={0.4} roughness={0.4} />
          <meshStandardMaterial attach="material-1" map={coinTexture()} metalness={0.3} roughness={0.5} />
          <meshStandardMaterial attach="material-2" map={coinTexture()} metalness={0.3} roughness={0.5} />
        </mesh>
      )}
      {tagTex && (
        <sprite position={[0, 2.5, 0]} scale={[1.9, 0.52, 1]}>
          <spriteMaterial map={tagTex} depthTest={false} />
        </sprite>
      )}
    </group>
  );
}

function Hair({ gender, hair, dark, accent }: { gender: 'm' | 'f'; hair: number; dark: string; accent: string }) {
  if (gender === 'm') {
    if (hair === 2) return null;
    if (hair === 3)
      return (
        <mesh position={[0.02, 1.95, -0.02]} rotation={[0, 0, -0.25]} material={mat(accent)}>
          <cylinderGeometry args={[0.16, 0.21, 0.2, 10]} />
        </mesh>
      );
    if (hair === 4)
      return (
        <mesh position={[0, 1.93, 0]} material={mat(accent)}>
          <cylinderGeometry args={[0.2, 0.21, 0.14, 12]} />
        </mesh>
      );
    return (
      <mesh position={[0, 1.82, -0.01]} material={mat(hair === 1 ? '#2a1f18' : dark)}>
        <sphereGeometry args={[0.205, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.2]} />
      </mesh>
    );
  }
  if (hair === 1)
    return (
      <group>
        <mesh position={[0, 1.82, -0.01]} material={mat(dark)}>
          <sphereGeometry args={[0.21, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.2]} />
        </mesh>
        <mesh position={[0, 2.06, -0.04]} material={mat(dark)}>
          <sphereGeometry args={[0.14, 8, 6]} />
        </mesh>
      </group>
    );
  if (hair === 2)
    return (
      <group>
        <mesh position={[0, 1.96, -0.02]} rotation={[-0.2, 0, 0]} material={mat(accent)}>
          <torusGeometry args={[0.2, 0.09, 6, 12]} />
        </mesh>
        <mesh position={[0, 2.06, -0.06]} rotation={[-0.4, 0, 0]} material={mat(accent)}>
          <coneGeometry args={[0.26, 0.3, 8]} />
        </mesh>
      </group>
    );
  if (hair === 3)
    return (
      <mesh position={[0, 1.72, -0.03]} material={mat(accent)}>
        <sphereGeometry args={[0.24, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.8]} />
      </mesh>
    );
  return (
    <group>
      <mesh position={[0, 1.82, -0.01]} material={mat(hair === 4 ? '#2a1d15' : dark)}>
        <sphereGeometry args={[0.212, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh position={[0, 1.55, -0.16]} material={mat(hair === 4 ? '#2a1d15' : dark)}>
        <boxGeometry args={[0.34, 0.5, 0.08]} />
      </mesh>
    </group>
  );
}

/** A pedestrian pacing up and down a pavement. */
/** Walks back and forth along a pavement. With axis 'z', `z` is the fixed x and the walk runs north–south. */
export function Walker({ looks, gender, z, from, to, speed, offset, axis = 'x' }: { looks: Looks; gender: 'm' | 'f'; z: number; from: number; to: number; speed: number; offset: number; axis?: 'x' | 'z' }) {
  const ref = useRef<THREE.Group>(null);
  const t = useRef(offset);
  useFrame((_, dt) => {
    t.current += dt * speed;
    const span = to - from;
    const cycle = (t.current % (2 * span) + 2 * span) % (2 * span);
    const forward = cycle < span;
    const v = forward ? from + cycle : to - (cycle - span);
    if (ref.current) {
      if (axis === 'x') {
        ref.current.position.set(v, 0, z);
        ref.current.rotation.y = forward ? Math.PI / 2 : -Math.PI / 2;
      } else {
        ref.current.position.set(z, 0, v);
        ref.current.rotation.y = forward ? 0 : Math.PI;
      }
    }
  });
  return (
    <group ref={ref}>
      <Person3D looks={looks} gender={gender} pose="walk" speed={speed / 1.4} />
    </group>
  );
}

// ───────────── vehicles ─────────────

function Wheels({ xs, z, r = 0.38 }: { xs: number[]; z: number; r?: number }) {
  return (
    <>
      {xs.flatMap((x) =>
        [-z, z].map((zz) => (
          <mesh key={`${x}:${zz}`} position={[x, r, zz]} rotation={[Math.PI / 2, 0, 0]} material={mat('#1b1b1b')}>
            <cylinderGeometry args={[r, r, 0.22, 10]} />
          </mesh>
        )),
      )}
    </>
  );
}

export function Danfo() {
  return (
    <group>
      <mesh position={[0, 1.3, 0]} material={mat('#f2b705')} castShadow>
        <boxGeometry args={[4.2, 1.8, 1.9]} />
      </mesh>
      <mesh position={[0, 1.05, 0]} material={mat('#1f1d1a')}>
        <boxGeometry args={[4.22, 0.2, 1.92]} />
      </mesh>
      {[-1.4, -0.35, 0.7].map((x) => (
        <mesh key={x} position={[x, 1.7, 0]} material={mat('#2f4f63', { rough: 0.3 })}>
          <boxGeometry args={[0.85, 0.5, 1.93]} />
        </mesh>
      ))}
      <mesh position={[1.75, 1.6, 0]} material={mat('#2f4f63', { rough: 0.3 })}>
        <boxGeometry args={[0.72, 0.7, 1.7]} />
      </mesh>
      <Wheels xs={[-1.3, 1.3]} z={0.9} />
    </group>
  );
}

export function Keke({ color = '#1e8f5a' }: { color?: string }) {
  return (
    <group>
      <mesh position={[0, 0.85, 0]} material={mat(color)} castShadow>
        <boxGeometry args={[2.2, 0.9, 1.3]} />
      </mesh>
      <mesh position={[0.1, 1.65, 0]} material={mat('#1f1d1a')}>
        <boxGeometry args={[2.0, 0.12, 1.35]} />
      </mesh>
      {[-0.8, 0.9].map((x) => (
        <mesh key={x} position={[x, 1.28, 0]} material={mat('#1f1d1a')}>
          <boxGeometry args={[0.08, 0.75, 1.3]} />
        </mesh>
      ))}
      <Wheels xs={[-0.75]} z={0.62} r={0.3} />
      <mesh position={[0.95, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]} material={mat('#1b1b1b')}>
        <cylinderGeometry args={[0.3, 0.3, 0.2, 10]} />
      </mesh>
    </group>
  );
}

export function Okada({ rider }: { rider: Looks }) {
  return (
    <group>
      <mesh position={[0, 0.6, 0]} material={mat('#b8352a')} castShadow>
        <boxGeometry args={[1.5, 0.35, 0.3]} />
      </mesh>
      {[-0.65, 0.65].map((x) => (
        <mesh key={x} position={[x, 0.36, 0]} rotation={[Math.PI / 2, 0, 0]} material={mat('#1b1b1b')}>
          <torusGeometry args={[0.3, 0.08, 6, 12]} />
        </mesh>
      ))}
      <group position={[-0.1, 0.2, 0]} rotation={[0, Math.PI / 2, 0]} scale={0.9}>
        <Person3D looks={rider} gender="m" pose="idle" />
      </group>
    </group>
  );
}

export function Car({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.75, 0]} material={mat(color, { rough: 0.5 })} castShadow>
        <boxGeometry args={[3.8, 0.75, 1.7]} />
      </mesh>
      <mesh position={[-0.2, 1.4, 0]} material={mat('#2f4f63', { rough: 0.3 })}>
        <boxGeometry args={[2, 0.6, 1.55]} />
      </mesh>
      <Wheels xs={[-1.2, 1.2]} z={0.8} r={0.34} />
    </group>
  );
}

export function Truck({ color = '#c2552d', load = '#e9e2d4' }: { color?: string; load?: string }) {
  return (
    <group>
      <mesh position={[1.9, 1.35, 0]} material={mat(color)} castShadow>
        <boxGeometry args={[1.6, 1.9, 2]} />
      </mesh>
      <mesh position={[2.45, 1.75, 0]} material={mat('#2f4f63', { rough: 0.3 })}>
        <boxGeometry args={[0.55, 0.7, 1.9]} />
      </mesh>
      <mesh position={[-0.9, 1.65, 0]} material={mat(load)} castShadow>
        <boxGeometry args={[3.9, 2.5, 2.1]} />
      </mesh>
      <mesh position={[0, 0.5, 0]} material={mat('#2a2a2a')}>
        <boxGeometry args={[5.6, 0.3, 1.6]} />
      </mesh>
      <Wheels xs={[-2, -1, 1.9]} z={0.9} r={0.42} />
    </group>
  );
}

/** The long blue-and-red rapid-transit bus on Lagos main roads. */
export function Brt() {
  return (
    <group>
      <mesh position={[0, 1.55, 0]} material={mat('#2f63ad')} castShadow>
        <boxGeometry args={[8.5, 2.3, 2.3]} />
      </mesh>
      <mesh position={[0, 0.75, 0]} material={mat('#d23c22')}>
        <boxGeometry args={[8.52, 0.5, 2.32]} />
      </mesh>
      <mesh position={[0.2, 2, 0]} material={mat('#2f4f63', { rough: 0.3 })}>
        <boxGeometry args={[7.6, 0.8, 2.34]} />
      </mesh>
      <Wheels xs={[-3, 2.8]} z={1.1} r={0.45} />
    </group>
  );
}

export function Canoe({ paddler }: { paddler: Looks }) {
  return (
    <group>
      <mesh position={[0, 0.15, 0]} scale={[1, 0.4, 0.35]} material={mat('#7a4f2d')} castShadow>
        <sphereGeometry args={[2, 10, 6]} />
      </mesh>
      <group position={[0.2, -0.2, 0]} rotation={[0, Math.PI / 2, 0]} scale={0.85}>
        <Person3D looks={paddler} gender="m" pose="work" />
      </group>
    </group>
  );
}

/** Moves a vehicle along a lane, wrapping round at the ends of the street. */
export function Mover({ z, from, to, speed, offset, dir = 1, axis = 'x', children }: { z: number; from: number; to: number; speed: number; offset: number; dir?: 1 | -1; axis?: 'x' | 'z'; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const t = useRef(offset);
  useFrame((_, dt) => {
    t.current += dt * speed;
    const span = to - from;
    const p = ((t.current % span) + span) % span;
    const v = dir === 1 ? from + p : to - p;
    const bob = Math.abs(Math.sin(t.current * 3)) * 0.03;
    if (ref.current) {
      if (axis === 'x') {
        ref.current.position.set(v, bob, z);
        ref.current.rotation.y = dir === 1 ? 0 : Math.PI;
      } else {
        ref.current.position.set(z, bob, v);
        ref.current.rotation.y = dir === 1 ? -Math.PI / 2 : Math.PI / 2;
      }
    }
  });
  return <group ref={ref}>{children}</group>;
}
