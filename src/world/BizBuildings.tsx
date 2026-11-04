import type { ReactNode } from 'react';
import type { BizTypeId } from '../data/businesses';
import type { SceneStyle } from '../data/world';
import { needsFarmland, stageOf } from '../engine/business';
import type { Business } from '../engine/types';
import { Car, Danfo, Truck, mat } from './Actors';
import * as THREE from 'three';
import { Box, Roof, Sign, Smoke, WaterTank, Windows, earthen } from './Buildings';
import { signTexture } from './textures';

const shade = (c: string, k: number) => new THREE.Color(c).multiplyScalar(k).getStyle();

// Your businesses, drawn on their plots. What you see follows the business's stage:
// 0 zinc shack, 1 container shop, 2 block shop, 3 two-storey, 4 big branded building, 5 flagship.
// Models face +z; the plot's front edge is at z = d / 2.

export const BRAND: Record<BizTypeId, { c: string; ink: string }> = {
  stall: { c: '#e0782a', ink: '#ffffff' },
  pos: { c: '#2f63ad', ink: '#ffffff' },
  buka: { c: '#d23c22', ink: '#fff7ea' },
  workshop: { c: '#5b5853', ink: '#f2b705' },
  farm: { c: '#4f8a3f', ink: '#ffffff' },
  okada: { c: '#b8352a', ink: '#ffffff' },
  keke: { c: '#1e8f5a', ink: '#ffffff' },
  supermarket: { c: '#1e8f5a', ink: '#ffffff' },
  restaurant: { c: '#7b3fa0', ink: '#ffffff' },
  pharmacy: { c: '#178a62', ink: '#ffffff' },
  salon: { c: '#d64f8e', ink: '#ffffff' },
  school: { c: '#2f63ad', ink: '#f2b705' },
  fleet: { c: '#f2b705', ink: '#1f1d1a' },
  estate: { c: '#8a6d4b', ink: '#ffffff' },
  wholesale: { c: '#c2552d', ink: '#ffffff' },
  bakery: { c: '#b8743a', ink: '#ffffff' },
  water: { c: '#3fa7d6', ink: '#ffffff' },
  logistics: { c: '#1f1d1a', ink: '#f2b705' },
  blocks: { c: '#77736b', ink: '#ffffff' },
  solar: { c: '#f2b705', ink: '#1f1d1a' },
  clearing: { c: '#2f4f6f', ink: '#ffffff' },
  ricemill: { c: '#d9a521', ink: '#1f1d1a' },
};

/** Businesses whose plot is mostly a yard of goods or vehicles. */
const YARD: BizTypeId[] = ['fleet', 'logistics', 'blocks', 'clearing', 'wholesale'];

interface Props {
  b: Business;
  w: number;
  d: number;
  style: SceneStyle;
  wall: string;
  lit: boolean;
  power: boolean;
}

export function BizBuilding(props: Props) {
  const { b } = props;
  if (needsFarmland(b.type)) return <FarmBiz {...props} />;
  if (b.type === 'estate') return <Estate {...props} />;
  if (YARD.includes(b.type)) return <YardBiz {...props} />;
  const stage = stageOf(b.type, b.level);
  return (
    <group>
      <Forecourt stage={stage} w={props.w} d={props.d} />
      <Shell {...props} stage={stage} x={0} width={props.w - 1.5} />
      <ShopProps type={b.type} stage={stage} w={props.w} d={props.d} lit={props.lit} />
    </group>
  );
}

function Forecourt({ stage, w, d }: { stage: number; w: number; d: number }) {
  const paved = stage >= 2;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={mat(stage === 0 ? '#c9ad7f' : paved ? '#b9a99a' : '#cdb894')} receiveShadow>
        <planeGeometry args={[w, d]} />
      </mesh>
      {stage === 0 &&
        [-w / 2 + 2, w / 2 - 3, w / 2 - 1.5].map((x, i) => (
          <mesh key={i} position={[x, 0.4, -d / 2 + 1.5 + i]} material={mat('#6f9a45')}>
            <icosahedronGeometry args={[0.7, 0]} />
          </mesh>
        ))}
      {stage >= 2 &&
        [-1, 1].map((s) => (
          <Box key={s} p={[(s * w) / 2, 0.7, -1]} s={[0.3, 1.4, d - 2]} c="#d8cfbd" />
        ))}
      {stage >= 2 && <Box p={[0, 0.9, -d / 2 + 0.15]} s={[w, 1.8, 0.3]} c="#d8cfbd" />}
      {stage >= 3 &&
        [-3, 0, 3].map((x) => (
          <Box key={x} p={[x + 1.5, 0.03, d / 2 - 2]} s={[0.1, 0.02, 3]} c="#f4f1ea" cast={false} />
        ))}
    </group>
  );
}

/** The main building for a stage. `x` and `width` let yard businesses use part of the plot. */
function Shell({ b, d, style, wall, lit, power, stage, x, width }: Props & { stage: number; x: number; width: number }) {
  const brand = BRAND[b.type];
  const name = b.name.toUpperCase();
  const front = d / 2;
  if (stage === 0) {
    // A zinc shack with a painted plank for a sign.
    return (
      <group position={[x - width / 2 + 2.6, 0, front - 3.6]}>
        <Box p={[0, 1.25, 0]} s={[4.4, 2.5, 3.2]} c="#8f6a52" opts={{ metal: 0.2 }} />
        {[-1.6, -0.6, 0.4, 1.4].map((rx) => (
          <Box key={rx} p={[rx, 1.25, 1.62]} s={[0.08, 2.5, 0.04]} c="#7a5a45" cast={false} />
        ))}
        <mesh position={[0, 2.75, 0.2]} rotation={[0.18, 0, 0]} material={mat('#9a5f45', { metal: 0.3 })} castShadow>
          <boxGeometry args={[5, 0.1, 4.2]} />
        </mesh>
        <Box p={[0.4, 1, 1.63]} s={[2.4, 1.7, 0.05]} c="#2a221c" cast={false} />
        <Sign text={name} y={2.35} z={1.72} w={3.8} bg="#f4e3c6" fg="#3a2414" />
      </group>
    );
  }
  if (stage === 1) {
    // A shipping container shop with its front opened and a striped awning.
    return (
      <group position={[x, 0, front - 3.4]}>
        <Box p={[0, 1.3, 0]} s={[Math.min(6.1, width), 2.6, 2.45]} c={brand.c} />
        {[-2.4, -1.2, 0, 1.2, 2.4].map((rx) => (
          <Box key={rx} p={[rx, 1.3, -1.25]} s={[0.12, 2.5, 0.06]} c={shade(brand.c, 0.78)} cast={false} />
        ))}
        <Box p={[0, 1.15, 1.23]} s={[4.4, 2, 0.05]} c="#2a221c" cast={false} />
        <mesh position={[0, 2.3, 1.25]} rotation={[0, 0, Math.PI / 2]} material={mat('#9fb0b8', { metal: 0.4 })}>
          <cylinderGeometry args={[0.18, 0.18, 4.6, 8]} />
        </mesh>
        <mesh position={[0, 2.45, 2.1]} rotation={[0.35, 0, 0]} material={mat('#fff7ea')} castShadow>
          <boxGeometry args={[5.4, 0.06, 1.8]} />
        </mesh>
        <Sign text={name} y={3.15} z={0.4} w={5.6} bg={brand.c} fg={brand.ink} />
        <Box p={[0, 2.85, 0.4]} s={[5.6, 0.12, 0.12]} c="#3a3a3a" />
      </group>
    );
  }
  if (stage === 2) {
    // A painted block shop with roller shutters and a fascia board.
    const bw = Math.min(width, 11);
    return (
      <group position={[x, 0, front - 5]}>
        <Box p={[0, 1.7, 0]} s={[bw, 3.4, 6.5]} c={wall} />
        <Roof w={bw} d={6.5} y={3.4} style={style} />
        <Box p={[0, 2.95, 3.27]} s={[bw, 0.9, 0.08]} c={brand.c} cast={false} />
        <Sign text={name} y={2.95} z={3.34} w={Math.min(bw - 1, 7)} bg={brand.c} fg={brand.ink} />
        {[-bw / 4, bw / 4].map((sx, i) => (
          <group key={sx} position={[sx, 0, 3.27]}>
            <Box p={[0, 1.15, 0]} s={[bw / 2 - 1.2, 2.3, 0.06]} c={i === 0 ? '#2a221c' : '#9fb0b8'} cast={false} opts={i === 1 ? { metal: 0.4 } : undefined} />
            {i === 0 && <Box p={[0, 2.2, 0.05]} s={[bw / 2 - 1.2, 0.25, 0.08]} c="#9fb0b8" cast={false} />}
          </group>
        ))}
        {!earthen(style) && <WaterTank x={bw / 2 - 1.4} y={3.9} />}
        <Generator x={-bw / 2 - 0.9} z={2} lit={lit} power={power} />
      </group>
    );
  }
  // Two storeys and up: glass shopfront, brand band, more floors with every stage.
  const storeys = stage === 3 ? 2 : stage === 4 ? 3 : 4;
  const bw = Math.min(width, 12.5);
  const bd = stage === 3 ? 7 : 8;
  const h = storeys * 3.2;
  const glass = lit || power ? mat('#bfe3f2', { emissive: lit ? '#6fb6d6' : undefined, rough: 0.2, metal: 0.2 }) : mat('#6f93a6', { rough: 0.25, metal: 0.2 });
  return (
    <group position={[x, 0, front - 1.8 - bd / 2]}>
      <Box p={[0, h / 2, 0]} s={[bw, h, bd]} c={stage >= 4 ? '#f4f1ea' : wall} />
      <mesh position={[0, 1.4, bd / 2 + 0.03]} material={glass}>
        <boxGeometry args={[bw - 1, 2.6, 0.06]} />
      </mesh>
      <Box p={[0, 3.05, bd / 2 + 0.06]} s={[bw + 0.2, 0.75, 0.16]} c={brand.c} cast={false} />
      <Sign text={name} y={3.05} z={bd / 2 + 0.16} w={Math.min(bw - 1.5, 8)} bg={brand.c} fg={brand.ink} />
      {stage === 3 && (
        <group>
          <Box p={[0, 3.45, bd / 2 + 0.6]} s={[bw, 0.18, 1.2]} c="#d8cfbd" />
          <Box p={[0, 4.05, bd / 2 + 1.15]} s={[bw, 1, 0.08]} c="#4a4743" cast={false} />
        </group>
      )}
      {stage >= 4 ? (
        // Curtain glass on the upper floors, with mullions.
        <group>
          <mesh position={[0, (h + 3.2) / 2 + 0.2, bd / 2 + 0.03]} material={glass}>
            <boxGeometry args={[bw - 0.8, h - 3.6, 0.06]} />
          </mesh>
          {Array.from({ length: storeys - 1 }, (_, i) => (
            <Box key={i} p={[0, 3.6 + (i + 1) * 3.2, bd / 2 + 0.07]} s={[bw - 0.6, 0.2, 0.06]} c="#e9e2d4" cast={false} />
          ))}
        </group>
      ) : (
        <Windows w={bw - 1.5} y={4.6} z={bd / 2 + 0.03} n={4} rows={storeys - 1} lit={lit} />
      )}
      <Box p={[0, h + 0.4, 0]} s={[bw + 0.3, 0.8, bd + 0.3]} c={stage >= 4 ? brand.c : '#d8cfbd'} />
      {stage >= 4 && (
        // A rooftop sign that lights up at night.
        <group position={[0, h + 0.8, -bd / 4]}>
          {[-2.5, 2.5].map((px) => (
            <Box key={px} p={[px, 0.9, 0]} s={[0.15, 1.8, 0.15]} c="#3a3a3a" />
          ))}
          <mesh position={[0, 2.4, 0]}>
            <planeGeometry args={[7.5, 1.9]} />
            <meshStandardMaterial map={signTextureFor(name, brand)} emissive={lit ? '#ffffff' : '#000000'} emissiveIntensity={lit ? 0.35 : 0} emissiveMap={signTextureFor(name, brand)} />
          </mesh>
        </group>
      )}
      {stage >= 5 && (
        <group position={[bw / 2 + 2, 0, 0.5]}>
          <Box p={[0, 2.4, 0]} s={[3.6, 4.8, bd - 1]} c="#e9e2d4" />
          <mesh position={[0, 1.4, (bd - 1) / 2 + 0.03]} material={glass}>
            <boxGeometry args={[2.8, 2.6, 0.06]} />
          </mesh>
        </group>
      )}
      {stage >= 3 && <Generator x={-bw / 2 - 0.9} z={bd / 2 - 1} lit={lit} power={power} big={stage >= 4} />}
    </group>
  );
}

const signTextureFor = (name: string, brand: { c: string; ink: string }) => signTexture(name, brand.c, brand.ink);

function Generator({ x, z, lit, power, big }: { x: number; z: number; lit: boolean; power: boolean; big?: boolean }) {
  return (
    <group position={[x, 0, z]}>
      <Box p={[0, big ? 0.8 : 0.45, 0]} s={big ? [1.4, 1.6, 2.4] : [1.1, 0.9, 0.8]} c={big ? '#2f6f4f' : '#d23c22'} />
      {lit && !power && <Smoke x={0} y={big ? 1.7 : 1} />}
    </group>
  );
}

/** Things in front of a shop that say what it sells. */
function ShopProps({ type, stage, w, d, lit }: { type: BizTypeId; stage: number; w: number; d: number; lit: boolean }) {
  const front = d / 2;
  const at = (x: number, z: number, node: ReactNode, key: string) => (
    <group key={key} position={[x, 0, z]}>
      {node}
    </group>
  );
  const out: ReactNode[] = [];
  const sx = w / 2 - 2.6;
  const sz = front - 1.6;
  const small = stage <= 1;
  switch (type) {
    case 'buka':
      if (small) {
        out.push(at(sx, sz - 1, <Pot />, 'pot1'), at(sx - 1.6, sz - 1, <Pot />, 'pot2'));
        out.push(at(sx - 0.8, sz + 0.6, <Box p={[0, 0.3, 0]} s={[2.6, 0.12, 0.6]} c="#7a4f2d" />, 'bench'));
      } else {
        for (let i = 0; i < Math.min(4, stage); i++) out.push(at(-w / 2 + 2 + i * 3, front - 0.9, <PlasticTable color={i % 2 ? '#d23c22' : '#2f63ad'} />, 't' + i));
      }
      break;
    case 'stall':
      out.push(at(sx, sz, <ProduceTable />, 'p1'));
      if (stage >= 1) out.push(at(sx - 2.8, sz, <ProduceTable />, 'p2'));
      if (small) out.push(at(sx, sz, <Umbrella color="#e0782a" />, 'u'));
      break;
    case 'pos':
      out.push(at(sx, sz, <Umbrella color="#2f63ad" />, 'u'), at(sx, sz, <Box p={[0, 0.45, 0]} s={[1.2, 0.9, 0.7]} c="#f4f1ea" />, 'tbl'));
      break;
    case 'workshop':
      for (let i = 0; i < 3 + stage; i++)
        out.push(
          at(sx + 0.8, sz - 0.6, (
            <mesh position={[0, 0.3 + i * 0.32, 0]} rotation={[Math.PI / 2, 0, 0]} material={mat('#202020')} castShadow>
              <torusGeometry args={[0.5, 0.18, 6, 12]} />
            </mesh>
          ), 'ty' + i),
        );
      out.push(at(sx - 1.6, sz, <Box p={[0, 0.5, 0]} s={[1.4, 1, 0.8]} c="#7a4f2d" />, 'sew'));
      break;
    case 'salon':
      out.push(at(sx, sz, <Box p={[0, 0.5, 0]} s={[0.8, 1, 0.8]} c="#1f1d1a" />, 'chair'), at(sx - 1.4, sz - 0.4, <Box p={[0, 1.4, 0]} s={[1.6, 2, 0.08]} c="#d64f8e" />, 'board'));
      break;
    case 'restaurant':
      for (let i = 0; i < Math.min(3, stage + 1); i++) out.push(at(-w / 2 + 2.5 + i * 3.6, front - 0.9, <group><PlasticTable color="#7b3fa0" /><Umbrella color={i % 2 ? '#f2b705' : '#7b3fa0'} /></group>, 'r' + i));
      break;
    case 'supermarket':
      if (stage >= 2) for (let i = 0; i < 3; i++) out.push(at(sx - i * 0.9, sz, <Box p={[0, 0.5, 0]} s={[0.7, 0.6, 1]} c="#9fb0b8" opts={{ metal: 0.5 }} />, 'cart' + i));
      break;
    case 'pharmacy':
      out.push(
        at(sx, sz, (
          <group position={[0, 3, 0]}>
            <Box p={[0, 0, 0]} s={[0.4, 1.3, 0.12]} c="#1e8f5a" opts={lit ? { emissive: '#1e8f5a' } : undefined} />
            <Box p={[0, 0, 0]} s={[1.3, 0.4, 0.12]} c="#1e8f5a" opts={lit ? { emissive: '#1e8f5a' } : undefined} />
            <Box p={[0, -1.6, 0]} s={[0.12, 2.4, 0.12]} c="#3a3a3a" />
          </group>
        ), 'cross'),
      );
      break;
    case 'bakery':
      out.push(at(-w / 2 + 3, -1, (
        <group>
          <Box p={[0, 3.5, 0]} s={[1, 7, 1]} c="#9a8f80" />
          <Smoke x={0} y={7.2} />
        </group>
      ), 'chim'));
      if (stage >= 3) out.push(at(sx, sz + 0.2, <group rotation={[0, Math.PI / 2, 0]}><Car color="#b8743a" /></group>, 'van'));
      break;
    case 'water':
      out.push(at(-w / 2 + 2.2, front - 2.4, (
        <group>
          {[0, 1.5].map((x) => (
            <mesh key={x} position={[x, 3.6, 0]} material={mat('#1f1d1a')} castShadow>
              <cylinderGeometry args={[0.7, 0.7, 1.6, 10]} />
            </mesh>
          ))}
          {[-0.5, 2].map((x) => (
            <Box key={x} p={[x, 1.4, 0]} s={[0.12, 2.8, 0.12]} c="#6d6a64" />
          ))}
          <Box p={[0.75, 2.8, 0]} s={[3, 0.12, 1.6]} c="#6d6a64" />
        </group>
      ), 'tanks'));
      for (let i = 0; i < 2 + stage; i++) out.push(at(sx - (i % 3) * 0.8, sz - Math.floor(i / 3) * 0.7, <Box p={[0, 0.3, 0]} s={[0.7, 0.6, 0.6]} c="#eaf4f8" />, 'bag' + i));
      break;
    case 'solar': {
      const n = 2 + stage * 2;
      for (let i = 0; i < n; i++) {
        out.push(
          at(-w / 2 + 1.6 + (i % 5) * 2.4, -d / 2 + 1.8 + Math.floor(i / 5) * 2, (
            <group>
              <mesh position={[0, 1, 0]} rotation={[-0.5, 0, 0]} material={mat('#203a6a', { rough: 0.3, metal: 0.4 })} castShadow>
                <boxGeometry args={[2, 0.06, 1.3]} />
              </mesh>
              <Box p={[0, 0.45, 0]} s={[0.1, 0.9, 0.1]} c="#6d6a64" />
            </group>
          ), 'pv' + i),
        );
      }
      break;
    }
    case 'school':
      out.push(at(w / 2 - 1, front - 1.5, (
        <group>
          <Box p={[0, 4, 0]} s={[0.12, 8, 0.12]} c="#c9c2b2" opts={{ metal: 0.5 }} />
          <Box p={[0.7, 7.4, 0]} s={[1.4, 0.9, 0.04]} c="#1e8f5a" />
        </group>
      ), 'flag'));
      if (stage >= 4) out.push(at(-w / 2 + 3, front - 1.6, <Danfo />, 'bus'));
      break;
  }
  return <group>{out}</group>;
}

function Pot() {
  return (
    <group>
      <mesh position={[0, 0.55, 0]} material={mat('#2a2a2a', { metal: 0.4 })} castShadow>
        <cylinderGeometry args={[0.55, 0.45, 0.7, 10]} />
      </mesh>
      {[0, 2.1, 4.2].map((r) => (
        <Box key={r} p={[Math.cos(r) * 0.4, 0.1, Math.sin(r) * 0.4]} s={[0.25, 0.2, 0.25]} c="#6b6157" />
      ))}
      <Smoke x={0} y={1} />
    </group>
  );
}

function PlasticTable({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.75, 0]} material={mat(color)} castShadow>
        <cylinderGeometry args={[0.6, 0.6, 0.06, 10]} />
      </mesh>
      <Box p={[0, 0.38, 0]} s={[0.1, 0.75, 0.1]} c={color} />
      {[-0.9, 0.9].map((x) => (
        <Box key={x} p={[x, 0.25, 0]} s={[0.45, 0.5, 0.45]} c={color} />
      ))}
    </group>
  );
}

function Umbrella({ color }: { color: string }) {
  return (
    <group>
      <Box p={[0, 1.2, 0]} s={[0.06, 2.4, 0.06]} c="#3a3a3a" />
      <mesh position={[0, 2.45, 0]} material={mat(color)} castShadow>
        <coneGeometry args={[1.5, 0.6, 8]} />
      </mesh>
    </group>
  );
}

function ProduceTable() {
  const colours = ['#e24a2a', '#f2b705', '#7cb342', '#c2552d'];
  return (
    <group>
      <Box p={[0, 0.5, 0]} s={[2.2, 1, 1.2]} c="#c9a77c" />
      {colours.map((c, i) => (
        <mesh key={c} position={[-0.75 + i * 0.5, 1.15, 0]} material={mat(c)}>
          <sphereGeometry args={[0.26, 6, 5]} />
        </mesh>
      ))}
    </group>
  );
}

/** Yard businesses: an office on part of the plot, the rest full of what they trade in. */
function YardBiz(props: Props) {
  const { b, w, d } = props;
  const stage = stageOf(b.type, b.level);
  const officeW = stage >= 3 ? w * 0.55 : w * 0.45;
  const officeX = -w / 2 + officeW / 2 + 0.4;
  const yardX = officeX + officeW / 2 + 0.6;
  const yardW = w / 2 - yardX;
  const items: ReactNode[] = [];
  const n = stage + 1;
  switch (b.type) {
    case 'fleet':
      for (let i = 0; i < Math.min(3, n); i++)
        items.push(
          <group key={i} position={[yardX + 1.2 + i * 2.4, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
            <Danfo />
          </group>,
        );
      break;
    case 'logistics':
      for (let i = 0; i < Math.min(2, Math.ceil(n / 2)); i++)
        items.push(
          <group key={i} position={[yardX + 1.4 + i * 2.6, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
            <Truck color={BRAND.logistics.c} load="#e9e2d4" />
          </group>,
        );
      break;
    case 'blocks':
      for (let i = 0; i < Math.min(8, 2 + stage * 2); i++)
        items.push(<Box key={i} p={[yardX + 0.9 + (i % 3) * 1.4, 0.45 + Math.floor(i / 6) * 0.9, -2.6 + Math.floor(i / 3) * 1.8]} s={[1.2, 0.9, 1.4]} c="#a9a59c" />);
      items.push(
        <mesh key="sand" position={[w / 2 - 1.6, 0.6, d / 2 - 2]} material={mat('#d8b878')} castShadow>
          <coneGeometry args={[1.4, 1.2, 8]} />
        </mesh>,
      );
      break;
    case 'clearing':
      for (let i = 0; i < Math.min(6, 1 + stage); i++) {
        const col = ['#2f63ad', '#d23c22', '#1e8f5a', '#e0782a', '#6d6a64', '#2f4f6f'][i];
        items.push(<Box key={i} p={[yardX + 1.3 + (i % 2) * 2.6, 1.3 + Math.floor(i / 2) * 2.6, -1]} s={[2.4, 2.6, 6]} c={col} />);
      }
      break;
    case 'wholesale':
      for (let i = 0; i < Math.min(12, 3 + stage * 2); i++) items.push(<Box key={i} p={[yardX + 0.7 + (i % 3) * 1, 0.3 + Math.floor(i / 6) * 0.6, -1 + (Math.floor(i / 3) % 2) * 1.2]} s={[0.9, 0.55, 1.1]} c={i % 2 ? '#e9e2d4' : '#d8c8a8'} />);
      if (stage >= 3)
        items.push(
          <group key="truck" position={[w / 2 - 1.6, 0, d / 2 - 3]} rotation={[0, -Math.PI / 2, 0]}>
            <Truck color={BRAND.wholesale.c} load="#d8c8a8" />
          </group>,
        );
      break;
  }
  return (
    <group>
      <Forecourt stage={Math.max(stage, 1)} w={w} d={d} />
      <Shell {...props} stage={stage} x={officeX} width={officeW} />
      {stage >= 3 && (
        <group position={[yardX + yardW / 2, 0, -d / 2 + 2.6]}>
          <Box p={[0, 2.4, 0]} s={[yardW, 4.8, 4.4]} c="#c9c2b2" />
          <Roof w={yardW} d={4.4} y={4.8} style={props.style} />
        </group>
      )}
      {items}
    </group>
  );
}

/** Flats to let: a bungalow first, then storey upon storey with balconies. */
function Estate({ b, w, d, style, wall, lit }: Props) {
  const stage = stageOf(b.type, b.level);
  const storeys = Math.max(1, stage);
  const bw = Math.min(w - 1.5, 12);
  const bd = 7;
  const h = storeys * 3.1;
  return (
    <group>
      <Forecourt stage={stage} w={w} d={d} />
      <group position={[0, 0, d / 2 - 2.6 - bd / 2]}>
        <Box p={[0, h / 2, 0]} s={[bw, h, bd]} c={stage >= 4 ? '#f4f1ea' : wall} />
        {storeys > 1 && <Box p={[0, h + 0.3, 0]} s={[bw + 0.3, 0.6, bd + 0.3]} c="#d8cfbd" />}
        {storeys === 1 && <Roof w={bw} d={bd} y={h} style={style} />}
        <Windows w={bw - 1} y={1.7} z={bd / 2 + 0.03} n={4} rows={storeys} lit={lit} />
        {Array.from({ length: storeys - 1 }, (_, i) => (
          <group key={i} position={[0, 3.1 * (i + 1), bd / 2 + 0.6]}>
            <Box p={[0, 0, 0]} s={[bw, 0.16, 1.2]} c="#d8cfbd" />
            <Box p={[0, 0.55, 0.55]} s={[bw, 0.9, 0.06]} c={BRAND.estate.c} cast={false} />
          </group>
        ))}
        <Box p={[0, 1.1, bd / 2 + 0.02]} s={[1.2, 2.2, 0.06]} c="#6b4024" cast={false} />
        {!earthen(style) && <WaterTank x={bw / 2 - 1.4} y={h + (storeys > 1 ? 0.6 : 0.5)} />}
      </group>
      <group position={[w / 2 - 2.4, 0, d / 2 - 0.8]}>
        {[-1.3, 1.3].map((x) => (
          <Box key={x} p={[x, 1.1, 0]} s={[0.12, 2.2, 0.12]} c="#3a3a3a" />
        ))}
        <Sign text={stage >= 3 ? b.name.toUpperCase() : 'FLATS TO LET'} y={2.2} z={0.08} w={3} bg="#fffaf0" fg={BRAND.estate.c} />
      </group>
      {stage >= 4 && (
        <group position={[-w / 2 + 2, 0, d / 2 - 1.2]}>
          <Box p={[0, 1.2, 0]} s={[1.6, 2.4, 1.6]} c="#e9e2d4" />
          <Box p={[0, 2.5, 0]} s={[2, 0.2, 2]} c={BRAND.estate.c} />
        </group>
      )}
    </group>
  );
}

/** Farms and mills on farmland at the edge of town. */
function FarmBiz({ b, w, d, style, lit, power }: Props) {
  const stage = stageOf(b.type, b.level);
  const water = style === 'rivers-water';
  const crop = earthen(style) ? ['#b9a44a', '#a38f3a'] : ['#6fa84a', '#4f8a3f'];
  const mill = b.type === 'ricemill';
  const rows = Math.min(12, 3 + stage * 2);
  const brand = BRAND[b.type];
  const items: ReactNode[] = [];
  if (water && !mill) {
    for (let i = 0; i < Math.min(6, 1 + stage); i++)
      items.push(
        <mesh key={'pond' + i} rotation={[-Math.PI / 2, 0, 0]} position={[-w / 2 + 4 + (i % 3) * 8, 0.05, -d / 2 + 5 + Math.floor(i / 3) * 8]} material={mat('#3f7f99', { rough: 0.25 })}>
          <planeGeometry args={[6.5, 6]} />
        </mesh>,
      );
  } else {
    for (let i = 0; i < rows; i++)
      items.push(<Box key={'row' + i} p={[-w / 4, 0.25, -d / 2 + 1.5 + i * 1.6]} s={[w / 2 - 1, 0.5, 0.8]} c={mill ? (i % 2 ? '#a8c86a' : '#93b85a') : crop[i % 2]} cast={false} />);
  }
  // Hut, store, silos, tractor, barn: one more thing with every stage.
  items.push(
    <group key="hut" position={[w / 2 - 4, 0, d / 2 - 4]}>
      <Box p={[0, 1.2, 0]} s={[3, 2.4, 3]} c="#c98c4f" />
      <mesh position={[0, 3, 0]} material={mat('#d9a521')} castShadow>
        <coneGeometry args={[2.4, 1.6, 8]} />
      </mesh>
    </group>,
  );
  if (stage >= 1)
    items.push(
      <group key="store" position={[w / 2 - 5, 0, -d / 2 + 4]}>
        <Box p={[0, 1.6, 0]} s={[mill ? 7 : 5, 3.2, 4]} c={mill ? '#e9e2d4' : '#9fb0b8'} opts={mill ? undefined : { metal: 0.3 }} />
        <Roof w={mill ? 7 : 5} d={4} y={3.2} style={style} />
      </group>,
    );
  const silos = stage >= 2 ? Math.min(4, stage - 1 + (mill ? 1 : 0)) : 0;
  for (let i = 0; i < silos; i++)
    items.push(
      <group key={'silo' + i} position={[w / 2 - 10 - i * 3, 0, -d / 2 + 4]}>
        <mesh position={[0, 3, 0]} material={mat('#dcd6ca', { metal: 0.4 })} castShadow>
          <cylinderGeometry args={[1.2, 1.2, 6, 12]} />
        </mesh>
        <mesh position={[0, 6.6, 0]} material={mat('#c9c2b2', { metal: 0.4 })} castShadow>
          <coneGeometry args={[1.3, 1.2, 12]} />
        </mesh>
      </group>,
    );
  if (stage >= 3)
    items.push(
      <group key="tractor" position={[2, 0, d / 2 - 4]}>
        <Box p={[0, 1.1, 0]} s={[2.6, 1.2, 1.4]} c="#d23c22" />
        <Box p={[-0.5, 2, 0]} s={[1, 1, 1.2]} c="#2f4f63" />
        {[-1, 1].map((x, i) => (
          <mesh key={x} position={[x, i ? 0.5 : 0.8, 0.8]} rotation={[Math.PI / 2, 0, 0]} material={mat('#1b1b1b')}>
            <cylinderGeometry args={[i ? 0.5 : 0.8, i ? 0.5 : 0.8, 0.4, 10]} />
          </mesh>
        ))}
      </group>,
    );
  if (stage >= 4)
    items.push(
      <group key="barn" position={[w / 2 - 6, 0, 1]}>
        <Box p={[0, 2.6, 0]} s={[8, 5.2, 6]} c={mill ? '#f4f1ea' : '#a33a2a'} />
        <Roof w={8} d={6} y={5.2} style={style} />
        <Sign text={b.name.toUpperCase()} y={4.2} z={3.06} w={6} bg={brand.c} fg={brand.ink} />
        {lit && !power && <Smoke x={3} y={6} />}
      </group>,
      <group key="truck" position={[-w / 2 + 4, 0, d / 2 - 2]}>
        <Truck color={brand.c} load="#e9e2d4" />
      </group>,
    );
  // Gate sign at the road.
  items.push(
    <group key="gate" position={[0, 0, d / 2 - 0.6]}>
      {[-1.8, 1.8].map((x) => (
        <Box key={x} p={[x, 1.2, 0]} s={[0.14, 2.4, 0.14]} c="#6b4a2b" />
      ))}
      <Sign text={b.name.toUpperCase()} y={2.3} z={0.08} w={3.8} bg="#f4e3c6" fg="#3a2414" />
    </group>,
  );
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={mat(earthen(style) ? '#c9a46e' : '#9c8a5c')} receiveShadow>
        <planeGeometry args={[w, d]} />
      </mesh>
      {items}
    </group>
  );
}
