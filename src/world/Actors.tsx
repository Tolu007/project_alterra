import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Looks } from '../engine/types';
import { ACCENT, OUTFIT, SKIN } from '../ui/Portrait';
import { coinTexture, nameTexture } from './textures';

// Shared flat-shaded materials, one per colour.
const mats = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, opts: { emissive?: string; rough?: number; metal?: number; transparent?: number; /** Rounded shapes (people, car bodies) shade smoothly. */ smooth?: boolean } = {}) {
  const key = `${color}:${opts.emissive ?? ''}:${opts.rough ?? ''}:${opts.metal ?? ''}:${opts.transparent ?? ''}:${opts.smooth ? 's' : ''}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      flatShading: !opts.smooth,
      roughness: opts.rough ?? 0.85,
      metalness: opts.metal ?? 0,
      // Only glowing materials get an emissive colour; three.js warns about an undefined one.
      ...(opts.emissive ? { emissive: new THREE.Color(opts.emissive), emissiveIntensity: 1 } : {}),
      transparent: opts.transparent !== undefined,
      opacity: opts.transparent ?? 1,
    });
    mats.set(key, m);
  }
  return m;
}

export type Pose = 'idle' | 'walk' | 'work' | 'wave';

// Shared shapes for people: everyone is built from the same few rounded pieces.
const SOFT = { smooth: true } as const;
const LEG = new THREE.CapsuleGeometry(0.095, 0.62, 3, 8);
const SHOE = new THREE.BoxGeometry(0.17, 0.1, 0.3);
const TORSO = new THREE.CapsuleGeometry(0.2, 0.3, 4, 12);
const SLEEVE = new THREE.CapsuleGeometry(0.075, 0.2, 3, 8);
const FOREARM = new THREE.CapsuleGeometry(0.058, 0.28, 3, 8);
const HAND = new THREE.SphereGeometry(0.07, 8, 6);
const HEAD = new THREE.SphereGeometry(0.2, 16, 12);

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
        {/* legs, with shoes */}
        {([
          [legL, -0.12],
          [legR, 0.12],
        ] as const).map(([ref, x]) => (
          <group key={x} ref={ref} position={[x, 0.9, 0]}>
            <mesh position={[0, -0.4, 0]} geometry={LEG} material={mat(gender === 'f' ? skin : '#2b2b33', SOFT)} castShadow />
            <mesh position={[0, -0.82, 0.05]} geometry={SHOE} material={mat('#1c1a18', SOFT)} />
          </group>
        ))}
        {gender === 'f' && (
          <mesh position={[0, 0.74, 0]} material={mat(outfit, SOFT)} castShadow>
            <cylinderGeometry args={[0.24, 0.36, 0.62, 12]} />
          </mesh>
        )}
        {/* body with an ankara band */}
        <mesh position={[0, 1.2, 0]} scale={[1.22, 1, 0.78]} geometry={TORSO} material={mat(outfit, SOFT)} castShadow />
        <mesh position={[0, 1.26, 0.152]} material={mat(accent)}>
          <boxGeometry args={[0.34, 0.09, 0.02]} />
        </mesh>
        <mesh position={[0, 1.11, 0.156]} material={mat(accent)}>
          <boxGeometry args={[0.36, 0.05, 0.02]} />
        </mesh>
        {/* arms */}
        {([
          [armL, -0.33],
          [armR, 0.33],
        ] as const).map(([ref, x]) => (
          <group key={x} ref={ref} position={[x, 1.46, 0]}>
            <mesh position={[0, -0.14, 0]} geometry={SLEEVE} material={mat(outfit, SOFT)} castShadow />
            <mesh position={[0, -0.42, 0]} geometry={FOREARM} material={mat(skin, SOFT)} />
            <mesh position={[0, -0.63, 0]} geometry={HAND} material={mat(skin, SOFT)} />
          </group>
        ))}
        {/* head */}
        <mesh position={[0, 1.56, 0]} material={mat(skin, SOFT)}>
          <cylinderGeometry args={[0.07, 0.08, 0.12, 8]} />
        </mesh>
        <mesh position={[0, 1.77, 0]} scale={[0.96, 1.06, 1]} geometry={HEAD} material={mat(skin, SOFT)} castShadow />
        <mesh position={[-0.07, 1.79, 0.183]} material={mat('#111')}>
          <sphereGeometry args={[0.025, 6, 4]} />
        </mesh>
        <mesh position={[0.07, 1.79, 0.183]} material={mat('#111')}>
          <sphereGeometry args={[0.025, 6, 4]} />
        </mesh>
        {looks.glasses && (
          <mesh position={[0, 1.79, 0.195]} material={mat('#111')}>
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

/** An umbrella held overhead, for the rainy season. */
export function Umbrella({ color }: { color: string }) {
  return (
    <group position={[0.22, 0, 0.05]}>
      <mesh position={[0, 1.75, 0]} material={mat('#2a2a2a')}>
        <cylinderGeometry args={[0.02, 0.02, 1.3, 5]} />
      </mesh>
      <mesh position={[0, 2.5, 0]} material={mat(color)} castShadow>
        <coneGeometry args={[0.85, 0.32, 8]} />
      </mesh>
    </group>
  );
}

/** A tray of goods carried on the head, the way hawkers carry them. */
export function HeadTray({ goods }: { goods: string }) {
  return (
    <group position={[0, 2.02, 0]}>
      <mesh material={mat('#c9a77c')}>
        <cylinderGeometry args={[0.36, 0.3, 0.1, 10]} />
      </mesh>
      {[
        [-0.13, 0.1],
        [0.13, 0.08],
        [0, -0.12],
        [0.02, 0.02],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.13 + (i === 3 ? 0.12 : 0), z]} material={mat(goods)}>
          <boxGeometry args={[0.2, 0.16, 0.2]} />
        </mesh>
      ))}
    </group>
  );
}

/** Walks back and forth along a pavement. With axis 'z', `z` is the fixed x and the walk runs north–south. */
export function Walker({ looks, gender, z, from, to, speed, offset, axis = 'x', umbrella }: { looks: Looks; gender: 'm' | 'f'; z: number; from: number; to: number; speed: number; offset: number; axis?: 'x' | 'z'; umbrella?: string | null }) {
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
      {umbrella && <Umbrella color={umbrella} />}
    </group>
  );
}

// ───────────── vehicles ─────────────

/** A body shape: a side profile (x forward, y up) pushed across the vehicle's width, with rounded edges. */
function hull(profile: [number, number][], width: number, bevel = 0.07): THREE.BufferGeometry {
  const shape = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = Math.max(0.01, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Glass: side windows a hair wider than the body, and screens a hair proud of its slopes. */
function glazing(sides: [number, number][], screens: [number, number][], width: number): THREE.BufferGeometry {
  const a = hull(sides, width + 0.05, 0);
  const b = hull(screens, width - 0.34, 0);
  const g = mergeGeometries([a, b]);
  a.dispose();
  b.dispose();
  return g;
}

const GLASS = { rough: 0.25, metal: 0.2 } as const;
const PAINT = { rough: 0.45, metal: 0.15, smooth: true } as const;
const TYRE = new THREE.CylinderGeometry(1, 1, 0.24, 14);
TYRE.rotateX(Math.PI / 2);
const HUB = new THREE.CylinderGeometry(0.5, 0.5, 0.26, 10);
HUB.rotateX(Math.PI / 2);

function Wheels({ xs, z, r = 0.38 }: { xs: number[]; z: number; r?: number }) {
  return (
    <>
      {xs.flatMap((x) =>
        [-z, z].map((zz) => (
          <group key={`${x}:${zz}`} position={[x, r, zz]} scale={[r, r, 1]}>
            <mesh geometry={TYRE} material={mat('#1b1b1b')} />
            <mesh geometry={HUB} material={mat('#b9bcc0', { metal: 0.5, rough: 0.4 })} />
          </group>
        )),
      )}
    </>
  );
}

/** Headlamps and tail lamps as they look by day. */
function Lights({ front, back, y, z }: { front: number; back: number; y: number; z: number }) {
  return (
    <>
      {[-z, z].map((zz) => (
        <mesh key={`f${zz}`} position={[front, y, zz]} material={mat('#f4efd9', { rough: 0.3 })}>
          <boxGeometry args={[0.06, 0.18, 0.3]} />
        </mesh>
      ))}
      {[-z, z].map((zz) => (
        <mesh key={`b${zz}`} position={[back, y, zz]} material={mat('#b3261e', { rough: 0.3 })}>
          <boxGeometry args={[0.06, 0.16, 0.28]} />
        </mesh>
      ))}
    </>
  );
}

const DANFO_BODY = hull(
  [
    [-2.03, 0.42],
    [1.96, 0.42],
    [2.04, 0.95],
    [1.98, 1.42],
    [1.72, 2.1],
    [-1.96, 2.1],
    [-2.03, 1.9],
  ],
  1.9,
  0.09,
);
const DANFO_GLASS = glazing(
  [
    [1.62, 1.42],
    [1.44, 1.94],
    [-1.8, 1.94],
    [-1.8, 1.42],
  ],
  [
    [2.03, 1.44],
    [1.79, 2.02],
    [1.2, 2.02],
    [1.2, 1.44],
  ],
  1.9,
);

/** The yellow Lagos minibus with its two black stripes. */
export function Danfo() {
  return (
    <group>
      <mesh geometry={DANFO_BODY} material={mat('#f2b705', PAINT)} castShadow />
      <mesh geometry={DANFO_GLASS} material={mat('#2c4656', GLASS)} />
      {[1.0, 1.2].map((y) => (
        <mesh key={y} position={[-0.05, y, 0]} material={mat('#1f1d1a')}>
          <boxGeometry args={[3.9, 0.09, 1.93]} />
        </mesh>
      ))}
      {/* Pillars between the windows, and the sliding door's handle side. */}
      {[-0.95, 0.05, 0.95].map((x) => (
        <mesh key={x} position={[x, 1.68, 0]} material={mat('#f2b705', PAINT)}>
          <boxGeometry args={[0.1, 0.56, 1.97]} />
        </mesh>
      ))}
      <mesh position={[2.08, 0.5, 0]} material={mat('#2a2a2a')}>
        <boxGeometry args={[0.12, 0.2, 1.8]} />
      </mesh>
      <Lights front={2.07} back={-2.06} y={0.98} z={0.66} />
      <Wheels xs={[-1.3, 1.3]} z={0.86} />
    </group>
  );
}

const KEKE_TUB = hull(
  [
    [-1.05, 0.3],
    [0.8, 0.3],
    [1.1, 0.52],
    [1.06, 0.9],
    [0.7, 1.0],
    [-1.05, 1.0],
  ],
  1.3,
  0.08,
);
const KEKE_ROOF = hull(
  [
    [0.66, 1.62],
    [-1.06, 1.62],
    [-1.06, 1.76],
    [0.5, 1.76],
  ],
  1.32,
  0.05,
);
const KEKE_SCREEN = hull(
  [
    [0.98, 0.95],
    [0.66, 1.64],
    [0.6, 1.64],
    [0.92, 0.95],
  ],
  1.12,
  0,
);

/** The three-wheeler: a painted tub, an open cabin and a canopy. */
export function Keke({ color = '#1e8f5a' }: { color?: string }) {
  return (
    <group>
      <mesh geometry={KEKE_TUB} material={mat(color, PAINT)} castShadow />
      <mesh geometry={KEKE_ROOF} material={mat('#1f1d1a', { smooth: true })} castShadow />
      <mesh geometry={KEKE_SCREEN} material={mat('#2c4656', GLASS)} />
      {/* The back of the cabin, and the passengers' bench. */}
      <mesh position={[-0.98, 1.32, 0]} material={mat('#1f1d1a')}>
        <boxGeometry args={[0.08, 0.66, 1.28]} />
      </mesh>
      <mesh position={[-0.6, 1.08, 0]} material={mat('#3a3a3a')}>
        <boxGeometry args={[0.6, 0.18, 1.1]} />
      </mesh>
      {[-0.6, 0.6].map((z) => (
        <mesh key={z} position={[0.62, 1.32, z]} rotation={[0, 0, 0.44]} material={mat('#1f1d1a')}>
          <boxGeometry args={[0.06, 0.74, 0.06]} />
        </mesh>
      ))}
      <mesh position={[1.1, 0.72, 0]} material={mat('#f4efd9', { rough: 0.3 })}>
        <boxGeometry args={[0.06, 0.16, 0.24]} />
      </mesh>
      <Wheels xs={[-0.72]} z={0.62} r={0.3} />
      <group position={[0.92, 0.3, 0]} scale={[0.3, 0.3, 0.8]}>
        <mesh geometry={TYRE} material={mat('#1b1b1b')} />
      </group>
    </group>
  );
}

/** A motorcycle taxi and its rider. */
export function Okada({ rider }: { rider: Looks }) {
  return (
    <group>
      <mesh position={[0.1, 0.72, 0]} scale={[1.5, 0.8, 0.7]} material={mat('#b8352a', PAINT)} castShadow>
        <sphereGeometry args={[0.26, 10, 8]} />
      </mesh>
      <mesh position={[-0.35, 0.7, 0]} material={mat('#1f1d1a')}>
        <boxGeometry args={[0.7, 0.12, 0.28]} />
      </mesh>
      <mesh position={[-0.05, 0.5, 0]} material={mat('#3a3a3a', { metal: 0.4 })}>
        <boxGeometry args={[0.9, 0.22, 0.2]} />
      </mesh>
      {/* Forks and handlebars. */}
      <mesh position={[0.55, 0.66, 0]} rotation={[0, 0, 0.35]} material={mat('#8f8f8f', { metal: 0.5 })}>
        <boxGeometry args={[0.06, 0.7, 0.06]} />
      </mesh>
      <mesh position={[0.44, 1.0, 0]} material={mat('#1f1d1a')}>
        <boxGeometry args={[0.05, 0.05, 0.6]} />
      </mesh>
      <mesh position={[0.7, 0.84, 0]} material={mat('#f4efd9', { rough: 0.3 })}>
        <sphereGeometry args={[0.09, 8, 6]} />
      </mesh>
      {[-0.65, 0.68].map((x) => (
        <group key={x} position={[x, 0.34, 0]} scale={[0.34, 0.34, 0.5]}>
          <mesh geometry={TYRE} material={mat('#1b1b1b')} />
          <mesh geometry={HUB} material={mat('#b9bcc0', { metal: 0.5, rough: 0.4 })} />
        </group>
      ))}
      <group position={[-0.1, 0.2, 0]} rotation={[0, Math.PI / 2, 0]} scale={0.9}>
        <Person3D looks={rider} gender="m" pose="idle" />
      </group>
    </group>
  );
}

const CAR_BODY = hull(
  [
    [-1.84, 0.36],
    [1.82, 0.36],
    [1.9, 0.62],
    [1.8, 0.86],
    [0.95, 0.96],
    [0.45, 1.42],
    [-0.95, 1.42],
    [-1.45, 0.98],
    [-1.86, 0.92],
    [-1.9, 0.6],
  ],
  1.7,
  0.09,
);
const CAR_GLASS = glazing(
  [
    [0.84, 1.0],
    [0.42, 1.36],
    [-0.9, 1.36],
    [-1.3, 1.0],
  ],
  [
    [1.02, 0.97],
    [0.52, 1.4],
    [-1.0, 1.4],
    [-1.52, 0.99],
  ],
  1.7,
);

/** A saloon car. */
export function Car({ color }: { color: string }) {
  return (
    <group>
      <mesh geometry={CAR_BODY} material={mat(color, PAINT)} castShadow />
      <mesh geometry={CAR_GLASS} material={mat('#26343f', GLASS)} />
      {/* The pillar between the doors, and the bumpers. */}
      <mesh position={[-0.22, 1.18, 0]} material={mat(color, PAINT)}>
        <boxGeometry args={[0.09, 0.4, 1.77]} />
      </mesh>
      {[1.9, -1.9].map((x) => (
        <mesh key={x} position={[x, 0.46, 0]} material={mat('#2a2a2a')}>
          <boxGeometry args={[0.1, 0.16, 1.6]} />
        </mesh>
      ))}
      <Lights front={1.92} back={-1.92} y={0.72} z={0.6} />
      <Wheels xs={[-1.2, 1.2]} z={0.78} r={0.34} />
    </group>
  );
}

const TRUCK_CAB = hull(
  [
    [1.1, 0.5],
    [2.66, 0.5],
    [2.72, 1.3],
    [2.52, 2.26],
    [1.1, 2.26],
  ],
  2.0,
  0.08,
);
const TRUCK_GLASS = glazing(
  [
    [2.4, 1.42],
    [2.26, 2.08],
    [1.42, 2.08],
    [1.42, 1.42],
  ],
  [
    [2.72, 1.44],
    [2.58, 2.12],
    [2.2, 2.12],
    [2.2, 1.44],
  ],
  2.0,
);
const TRUCK_BOX = hull(
  [
    [-2.86, 0.72],
    [0.96, 0.72],
    [0.96, 2.9],
    [-2.86, 2.9],
  ],
  2.1,
  0.06,
);

/** A lorry: a cab and a box body. */
export function Truck({ color = '#c2552d', load = '#e9e2d4' }: { color?: string; load?: string }) {
  return (
    <group>
      <mesh geometry={TRUCK_CAB} material={mat(color, PAINT)} castShadow />
      <mesh geometry={TRUCK_GLASS} material={mat('#2c4656', GLASS)} />
      <mesh geometry={TRUCK_BOX} material={mat(load, { smooth: true })} castShadow />
      <mesh position={[0, 0.56, 0]} material={mat('#2a2a2a')}>
        <boxGeometry args={[5.6, 0.26, 1.5]} />
      </mesh>
      <mesh position={[2.76, 0.6, 0]} material={mat('#2a2a2a')}>
        <boxGeometry args={[0.12, 0.24, 1.9]} />
      </mesh>
      <Lights front={2.75} back={-2.9} y={0.96} z={0.72} />
      <Wheels xs={[-2, -1, 1.9]} z={0.9} r={0.42} />
    </group>
  );
}

const BRT_BODY = hull(
  [
    [-4.2, 0.5],
    [4.16, 0.5],
    [4.26, 1.2],
    [4.16, 2.66],
    [3.96, 2.78],
    [-4.1, 2.78],
    [-4.24, 2.6],
  ],
  2.3,
  0.12,
);
const BRT_GLASS = glazing(
  [
    [3.7, 1.58],
    [3.7, 2.4],
    [-3.9, 2.4],
    [-3.9, 1.58],
  ],
  [
    [4.27, 1.3],
    [4.18, 2.5],
    [3.9, 2.5],
    [3.9, 1.3],
  ],
  2.3,
);

/** The long blue-and-red rapid-transit bus on Lagos main roads. */
export function Brt() {
  return (
    <group>
      <mesh geometry={BRT_BODY} material={mat('#2f63ad', PAINT)} castShadow />
      <mesh geometry={BRT_GLASS} material={mat('#22323d', GLASS)} />
      <mesh position={[0, 0.86, 0]} material={mat('#d23c22')}>
        <boxGeometry args={[8.3, 0.4, 2.34]} />
      </mesh>
      {[-2.6, -1.0, 0.6, 2.2].map((x) => (
        <mesh key={x} position={[x, 2, 0]} material={mat('#2f63ad', PAINT)}>
          <boxGeometry args={[0.12, 0.84, 2.37]} />
        </mesh>
      ))}
      <Lights front={4.29} back={-4.28} y={0.98} z={0.84} />
      <Wheels xs={[-3, 2.8]} z={1.06} r={0.45} />
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
