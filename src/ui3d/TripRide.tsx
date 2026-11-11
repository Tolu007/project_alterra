import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Mode } from '../engine/travel';
import { Brt, Car, Danfo, Keke, Person3D, Truck, mat } from '../world/Actors';
import { signTexture } from '../world/textures';

// The view from the road while you travel: your danfo (or BRT, taxi, coach, train, ferry or plane) on its
// way, with the street going by and the roads you pass through named on signs overhead. The scenery is one
// stretch that repeats under you, so the ride costs very little to draw.

interface RideProps {
  mode: Mode;
  /** Roads (or towns) on the way, in order: they come up on the signs. */
  via: string[];
  /** 0 to 1, how far along the trip you are. */
  progress: number;
  /** Hour of the day you set off, for the light. */
  hour: number;
  /** How bad the traffic is: 1 is an empty road. */
  rush: number;
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Sky and light for the hour. */
function daylight(hour: number) {
  const day = Math.pow(Math.max(0, Math.sin(((hour - 5.3) / 13.4) * Math.PI)), 0.6);
  const dusk = Math.max(0, 1 - Math.abs(hour - 18.3) / 1.4) + Math.max(0, 1 - Math.abs(hour - 6) / 1.2);
  const sky = new THREE.Color('#141a36').lerp(new THREE.Color('#a9dcf0'), Math.min(1, day * 1.4)).lerp(new THREE.Color('#f0a167'), Math.min(0.65, dusk * 0.65));
  return { sky, sun: 0.3 + 2.6 * day, ambient: 0.7 + 1.1 * day, night: day < 0.15 };
}

const SPAN = 240;
const WALLS = ['#e8dcc6', '#d9cbb0', '#cfc6b8', '#f0d58c', '#c9d6dc', '#e2b8a6', '#bcd2de', '#d8c4b2'];
const ROOFS = ['#9a5f45', '#8c5a42', '#7c8a90', '#6d6a64', '#b07a5a'];

/** Something by the roadside that slides past and comes round again. */
function Scroller({ items, dist, y = 0 }: { items: { x: number; z: number; node: ReactNode }[]; dist: React.MutableRefObject<number>; y?: number }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    items.forEach((it, i) => {
      const g = refs.current[i];
      if (!g) return;
      // Wrap so each thing passes from far ahead to just behind the camera.
      g.position.x = ((((it.x - dist.current) % SPAN) + SPAN) % SPAN) - 40;
    });
  });
  return (
    <>
      {items.map((it, i) => (
        <group key={i} ref={(r) => void (refs.current[i] = r)} position={[it.x, y, it.z]}>
          {it.node}
        </group>
      ))}
    </>
  );
}

/** Other traffic: going your way (you overtake them or they you) and coming the other way. */
function Others({ dist, speed, lanes, lit }: { dist: React.MutableRefObject<number>; speed: number; lanes: number[]; lit: boolean }) {
  const cars = useMemo(() => {
    const rnd = seeded(lanes.length * 97 + Math.round(speed));
    const colours = ['#d6d6d6', '#2f63ad', '#b8352a', '#1f1d1a', '#e9e2d4', '#3d6b4f'];
    return Array.from({ length: 9 }, (_, i) => {
      const oncoming = i % 3 === 0;
      const roll = rnd();
      const node = roll < 0.35 ? <Danfo /> : roll < 0.75 ? <Car color={colours[Math.floor(rnd() * colours.length)]} /> : roll < 0.9 ? <Keke /> : <Truck />;
      return {
        node,
        oncoming,
        // Oncoming traffic keeps to the far side of the median; the rest share your side, in the other lanes.
        z: oncoming ? -(5.2 + (i % 2) * 3.4) : lanes[i % lanes.length],
        v: oncoming ? -(speed * (0.6 + rnd() * 0.4)) : speed * (0.55 + rnd() * 0.8),
        x: rnd() * SPAN,
      };
    });
  }, [lanes, speed]);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const t0 = useRef(0);
  useFrame(({ clock }) => {
    if (!t0.current) t0.current = clock.elapsedTime;
    const t = clock.elapsedTime - t0.current;
    cars.forEach((c, i) => {
      const g = refs.current[i];
      if (g) g.position.x = ((((c.x + c.v * t - dist.current) % SPAN) + SPAN) % SPAN) - 60;
    });
  });
  return (
    <>
      {cars.map((c, i) => (
        <group key={i} ref={(r) => void (refs.current[i] = r)} position={[0, 0, c.z]} rotation={[0, c.oncoming ? Math.PI : 0, 0]}>
          {c.node}
          {lit && <Beams len={4} />}
        </group>
      ))}
    </>
  );
}

function Beams({ len }: { len: number }) {
  return (
    <>
      {[-0.6, 0.6].map((z) => (
        <mesh key={z} position={[len / 2 + 0.05, 0.85, z]} material={mat('#fff6d8', { emissive: '#ffe9a8' })}>
          <boxGeometry args={[0.08, 0.2, 0.3]} />
        </mesh>
      ))}
      {[-0.6, 0.6].map((z) => (
        <mesh key={`t${z}`} position={[-len / 2 - 0.05, 0.85, z]} material={mat('#ff3b2f', { emissive: '#ff2a1a' })}>
          <boxGeometry args={[0.08, 0.18, 0.28]} />
        </mesh>
      ))}
    </>
  );
}

/** A green sign on a gantry over the road, naming the road you are joining. */
function RoadSign({ text, x, dist }: { text: string; x: number; dist: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.Group>(null);
  const tex = useMemo(() => signTexture(text.toUpperCase(), '#1e6b45', '#ffffff'), [text]);
  useFrame(() => {
    if (!ref.current) return;
    const at = x - dist.current;
    ref.current.visible = at > -30 && at < 230;
    ref.current.position.x = at;
  });
  return (
    <group ref={ref} visible={false}>
      {[-1.2, 9.4].map((z) => (
        <mesh key={z} position={[0, 3.6, z]} material={mat('#8f8f8f', { metal: 0.4 })}>
          <boxGeometry args={[0.3, 7.2, 0.3]} />
        </mesh>
      ))}
      <mesh position={[0, 7.1, 4.1]} material={mat('#8f8f8f', { metal: 0.4 })}>
        <boxGeometry args={[0.3, 0.3, 10.9]} />
      </mesh>
      <mesh position={[-0.2, 6.1, 4.1]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[8.4, 2.1]} />
        <meshBasicMaterial map={tex} />
      </mesh>
    </group>
  );
}

function Palm() {
  return (
    <group>
      <mesh position={[0, 3, 0]} material={mat('#6b4a2b')}>
        <cylinderGeometry args={[0.18, 0.26, 6, 6]} />
      </mesh>
      <mesh position={[0, 6.4, 0]} material={mat('#3f7f3a')}>
        <coneGeometry args={[2.3, 1.5, 7]} />
      </mesh>
    </group>
  );
}

/** The road and what stands along it. On a bridge there is water where the buildings would be. */
function RoadWorld({ dist, bridge, night }: { dist: React.MutableRefObject<number>; bridge: boolean; night: boolean }) {
  const side = useMemo(() => {
    const rnd = seeded(bridge ? 5 : 11);
    const out: { x: number; z: number; node: ReactNode }[] = [];
    for (let x = 0; x < SPAN; x += 13) {
      for (const s of [-1, 1]) {
        if (bridge) continue;
        const w = 8 + rnd() * 4;
        const h = 3.4 + (rnd() < 0.3 ? 6 + rnd() * 9 : rnd() * 3.5);
        const d = 8 + rnd() * 5;
        const wall = WALLS[Math.floor(rnd() * WALLS.length)];
        const glow = night && rnd() < 0.6;
        out.push({
          x: x + rnd() * 3,
          z: s * (s < 0 ? 19 + d / 2 : 14 + d / 2),
          node: (
            <group>
              <mesh position={[0, h / 2, 0]} material={mat(wall)} castShadow>
                <boxGeometry args={[w, h, d]} />
              </mesh>
              <mesh position={[0, h + 0.25, 0]} material={mat(ROOFS[Math.floor(rnd() * ROOFS.length)])}>
                <boxGeometry args={[w + 0.5, 0.5, d + 0.5]} />
              </mesh>
              {/* A row of windows on each floor, facing the road. */}
              {Array.from({ length: Math.max(1, Math.floor(h / 3)) }, (_, f) => (
                <mesh key={f} position={[0, 1.9 + f * 3, (-s * d) / 2 - s * 0.03]} material={mat(glow && f % 2 === 0 ? '#ffd98a' : '#33505f', glow && f % 2 === 0 ? { emissive: '#ffc35a' } : { rough: 0.3 })}>
                  <boxGeometry args={[w * 0.72, 1.1, 0.06]} />
                </mesh>
              ))}
            </group>
          ),
        });
      }
      if (!bridge && rnd() < 0.5) out.push({ x: x + 6, z: rnd() < 0.5 ? 12 : -17, node: <Palm /> });
    }
    return out;
  }, [bridge, night]);
  const posts = useMemo(() => {
    const out: { x: number; z: number; node: ReactNode }[] = [];
    for (let x = 0; x < SPAN; x += 30) {
      out.push({
        x,
        z: 10.6,
        node: (
          <group>
            <mesh position={[0, 3.5, 0]} material={mat('#4a4743')}>
              <cylinderGeometry args={[0.09, 0.13, 7, 5]} />
            </mesh>
            <mesh position={[0, 6.9, -0.6]} material={night ? mat('#fff1c2', { emissive: '#ffcf6b' }) : mat('#5a5a5a')}>
              <boxGeometry args={[0.5, 0.18, 1.4]} />
            </mesh>
          </group>
        ),
      });
    }
    return out;
  }, [night]);
  const dashes = useMemo(() => {
    const out: { x: number; z: number; node: ReactNode }[] = [];
    for (let x = 0; x < SPAN; x += 8) {
      for (const z of [3.4, 6.8, -6.9]) {
        out.push({
          x,
          z,
          node: (
            <mesh rotation={[-Math.PI / 2, 0, 0]} material={mat('#f4f0e4')}>
              <planeGeometry args={[3, 0.18]} />
            </mesh>
          ),
        });
      }
    }
    return out;
  }, []);
  return (
    <group>
      {/* Ground (or the lagoon), the two carriageways, the median and the kerbs. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[60, -0.05, 0]} material={bridge ? mat('#3b8fb5', { rough: 0.18, metal: 0.25 }) : mat('#cdb68e')}>
        <planeGeometry args={[420, 300]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[60, 0, 4.2]} material={mat('#4c4e52')} receiveShadow>
        <planeGeometry args={[420, 12.4]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[60, 0, -7]} material={mat('#4c4e52')} receiveShadow>
        <planeGeometry args={[420, 8]} />
      </mesh>
      <mesh position={[60, 0.25, -2.5]} material={mat('#c9c2b2')}>
        <boxGeometry args={[420, 0.5, 1]} />
      </mesh>
      {[10.9, -11.4].map((z) => (
        <mesh key={z} position={[60, bridge ? 0.5 : 0.12, z]} material={mat(bridge ? '#c9c2b2' : '#cfc7b8')}>
          <boxGeometry args={[420, bridge ? 1 : 0.24, bridge ? 0.35 : 1.6]} />
        </mesh>
      ))}
      <Scroller items={dashes} dist={dist} y={0.02} />
      <Scroller items={posts} dist={dist} />
      <Scroller items={side} dist={dist} />
    </group>
  );
}

/** Railway: the Red Line on its own track beside the road. */
function Train() {
  return (
    <group>
      {[-9.4, 0, 9.4].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 1.9, 0]} material={mat('#f4f1ea', { smooth: true })} castShadow>
            <boxGeometry args={[9, 2.6, 2.7]} />
          </mesh>
          <mesh position={[0, 1.1, 0]} material={mat('#b8352a')}>
            <boxGeometry args={[9.02, 0.5, 2.72]} />
          </mesh>
          <mesh position={[0, 2.3, 0]} material={mat('#26343f', { rough: 0.25 })}>
            <boxGeometry args={[8, 0.8, 2.74]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Ferry() {
  return (
    <group>
      <mesh position={[0, 0.6, 0]} material={mat('#f4f1ea', { smooth: true })} castShadow>
        <boxGeometry args={[11, 1.4, 3.8]} />
      </mesh>
      <mesh position={[-0.6, 2, 0]} material={mat('#2f63ad')}>
        <boxGeometry args={[7, 1.5, 3.2]} />
      </mesh>
      <mesh position={[-0.6, 2.9, 0]} material={mat('#f4f1ea')}>
        <boxGeometry args={[7.4, 0.2, 3.5]} />
      </mesh>
      <mesh position={[5.6, 0.7, 0]} rotation={[0, Math.PI / 4, 0]} material={mat('#f4f1ea', { smooth: true })}>
        <boxGeometry args={[2.6, 1.3, 2.6]} />
      </mesh>
    </group>
  );
}

function Plane() {
  return (
    <group>
      <mesh rotation={[0, 0, Math.PI / 2]} material={mat('#f4f1ea', { smooth: true })} castShadow>
        <capsuleGeometry args={[1.2, 13, 6, 14]} />
      </mesh>
      <mesh position={[0.4, -0.2, 0]} material={mat('#e9e2d4', { smooth: true })}>
        <boxGeometry args={[3.6, 0.25, 17]} />
      </mesh>
      <mesh position={[-6.6, 1.9, 0]} material={mat('#1e8f5a')}>
        <boxGeometry args={[2.4, 3.2, 0.25]} />
      </mesh>
      <mesh position={[-6.8, 0.5, 0]} material={mat('#e9e2d4')}>
        <boxGeometry args={[1.8, 0.2, 5.6]} />
      </mesh>
      {[-3.6, 3.6].map((z) => (
        <mesh key={z} position={[1.2, -0.9, z]} rotation={[0, 0, Math.PI / 2]} material={mat('#8f8f8f', { metal: 0.4, smooth: true })}>
          <cylinderGeometry args={[0.55, 0.55, 2, 10]} />
        </mesh>
      ))}
    </group>
  );
}

/** Water all round, with a far shore, for the ferry; cloud tops for the flight. */
function OpenWorld({ dist, sky }: { dist: React.MutableRefObject<number>; sky: boolean }) {
  const bits = useMemo(() => {
    const rnd = seeded(sky ? 3 : 9);
    const out: { x: number; z: number; node: ReactNode }[] = [];
    for (let i = 0; i < 26; i++) {
      const z = (rnd() < 0.5 ? -1 : 1) * (10 + rnd() * 70);
      out.push({
        x: rnd() * SPAN,
        z,
        node: sky ? (
          <mesh position={[0, -6 - rnd() * 8, 0]} scale={[1.6 + rnd() * 2, 0.5, 1 + rnd()]} material={mat('#ffffff', { smooth: true })}>
            <sphereGeometry args={[6, 10, 8]} />
          </mesh>
        ) : (
          // Wave crests, and now and then a canoe.
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} material={mat('#8cc3dc')}>
            <planeGeometry args={[3 + rnd() * 5, 0.3]} />
          </mesh>
        ),
      });
    }
    return out;
  }, [sky]);
  return (
    <group>
      {!sky && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[60, 0, 0]} material={mat('#3b8fb5', { rough: 0.18, metal: 0.25 })}>
            <planeGeometry args={[520, 420]} />
          </mesh>
          {/* The far shore: a line of towers. */}
          {Array.from({ length: 16 }, (_, i) => (
            <mesh key={i} position={[-30 + i * 17, 5 + ((i * 7) % 11), -120]} material={mat(i % 3 ? '#a9b7c0' : '#5f9cc2')}>
              <boxGeometry args={[9, 10 + ((i * 7) % 11) * 2, 8]} />
            </mesh>
          ))}
        </>
      )}
      <Scroller items={bits} dist={dist} />
    </group>
  );
}

function Scene({ mode, via, progress, hour, rush }: RideProps) {
  const light = useMemo(() => daylight(hour), [hour]);
  const dist = useRef(0);
  const body = useRef<THREE.Group>(null);
  const road = mode === 'danfo' || mode === 'brt' || mode === 'taxi' || mode === 'bus' || mode === 'trek';
  // Go-slow: the worse the traffic, the slower the street goes by. BRT lanes and rails skip most of it.
  const speed = mode === 'trek' ? 5 : mode === 'flight' ? 60 : mode === 'rail' ? 34 : mode === 'ferry' ? 16 : (mode === 'brt' ? 26 : 30) / Math.max(1, mode === 'brt' ? 1 + (rush - 1) * 0.3 : rush);
  const total = speed * 9;
  // Which road you are on now decides whether you are on a bridge over the lagoon.
  const at = via.length ? via[Math.min(via.length - 1, Math.floor(progress * via.length))] : '';
  const bridge = road && /bridge/i.test(at);
  useFrame(({ camera, clock }, dt) => {
    dist.current += speed * Math.min(dt, 0.1);
    const t = clock.elapsedTime;
    if (body.current) {
      // The sway of the road, the swell of the water, or a gentle bank in the air.
      body.current.position.y = mode === 'ferry' ? Math.sin(t * 1.6) * 0.12 : mode === 'flight' ? Math.sin(t * 0.7) * 0.4 : Math.abs(Math.sin(t * 9)) * 0.035;
      body.current.rotation.x = mode === 'ferry' ? Math.sin(t * 1.1) * 0.03 : mode === 'flight' ? Math.sin(t * 0.5) * 0.05 : 0;
    }
    const far = mode === 'flight' ? 1.7 : mode === 'rail' ? 1.5 : mode === 'trek' ? 0.62 : 1;
    camera.position.set(-13 * far, 5.6 * far + Math.sin(t * 0.5) * 0.15, 8.5 * far);
    camera.lookAt(5, 1.4, mode === 'trek' ? 8 : -1);
  });
  const vehicle =
    mode === 'trek' ? (
      // On foot along the kerb, facing the way you are going.
      <group rotation={[0, Math.PI / 2, 0]}>
        <Person3D looks={{ skin: 2, hair: 1, outfit: 2, accent: 3, glasses: false }} gender="m" pose="walk" speed={1} />
      </group>
    ) : mode === 'danfo' ? <Danfo /> : mode === 'brt' || mode === 'bus' ? <Brt /> : mode === 'taxi' ? <Car color="#1f1d1a" /> : mode === 'rail' ? <Train /> : mode === 'ferry' ? <Ferry /> : <Plane />;
  return (
    <>
      <color attach="background" args={[light.sky]} />
      <fog attach="fog" args={[light.sky, 90, 230]} />
      <hemisphereLight args={['#ffffff', '#8a8577', light.ambient]} />
      <directionalLight position={[-30, 60, 40]} intensity={light.sun} color="#fff4dc" />
      {road ? <RoadWorld key={bridge ? 'b' : 'r'} dist={dist} bridge={bridge} night={light.night} /> : mode === 'rail' ? <RoadWorld dist={dist} bridge={false} night={light.night} /> : <OpenWorld dist={dist} sky={mode === 'flight'} />}
      {road && <Others dist={dist} speed={mode === 'trek' ? 24 : speed} lanes={mode === 'brt' ? [6.8, 9.6] : mode === 'trek' ? [0.4, 3.8, 7.2] : [0.4, 9.6]} lit={light.night} />}
      {mode === 'rail' && (
        <mesh position={[60, 0.3, 4.2]} material={mat('#857c70')}>
          <boxGeometry args={[420, 0.5, 5]} />
        </mesh>
      )}
      {road && via.map((name, i) => <RoadSign key={name} text={name} x={((i + 0.35) / via.length) * total + 30} dist={dist} />)}
      <group ref={body} position={[0, mode === 'rail' ? 0.5 : mode === 'flight' ? 2 : 0, mode === 'brt' ? 3.4 : mode === 'rail' ? 4.2 : mode === 'trek' ? 10.9 : 4.4]}>
        {vehicle}
        {light.night && mode !== 'flight' && mode !== 'ferry' && mode !== 'trek' && <Beams len={mode === 'danfo' ? 4.1 : mode === 'taxi' ? 3.8 : mode === 'rail' ? 27.6 : 8.5} />}
      </group>
    </>
  );
}

/** The window onto your trip. */
export function TripRide(props: RideProps) {
  return (
    <div className="trip-ride">
      <Canvas flat dpr={[1, 1.5]} camera={{ fov: 38, near: 0.5, far: 400, position: [-13, 5.6, 8.5] }} gl={{ antialias: true }}>
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
