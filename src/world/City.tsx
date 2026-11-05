import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SceneStyle } from '../data/world';
import type { Hood } from '../engine/map';
import type { Looks } from '../engine/types';
import { Brt, Car, Danfo, Keke, Okada, Person3D, Truck, mat } from './Actors';
import { Box, Flag, Roof, Sign, Windows, earthen } from './Buildings';
import { pairs, type CityRender } from './cityData';
import { flagTexture, signTexture } from './textures';
import { WALLS, seeded } from './Town';

// A district drawn from real map data: its real roads, water, railway and open land, with generated
// buildings along the streets and a sea of rooftops behind them. Everything repeated is merged into a
// handful of meshes or drawn as instances, so a whole district costs about as much as the old grid town.

type P2 = [number, number];
const PAV = 2.5;

const norm = (x: number, z: number): P2 => {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
};

/** A flat strip of half-width hw along a polyline, with mitred corners, added to shared position and index lists. */
function ribbon(pts: P2[], hw: number, y: number, pos: number[], idx: number[]) {
  const n = pts.length;
  if (n < 2) return;
  const base = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const d0 = i > 0 ? norm(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : null;
    const d1 = i < n - 1 ? norm(pts[i + 1][0] - p[0], pts[i + 1][1] - p[1]) : null;
    let m: P2 = d0 && d1 ? norm(d0[0] + d1[0], d0[1] + d1[1]) : (d0 ?? d1)!;
    let k = 1;
    if (d0 && d1) {
      const cos = m[0] * d1[0] + m[1] * d1[1];
      if (cos < 0.3) m = d1;
      else k = 1 / cos;
    }
    const nx = -m[1] * hw * k;
    const nz = m[0] * hw * k;
    pos.push(p[0] + nx, y, p[1] + nz, p[0] - nx, y, p[1] - nz);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + 2 * i;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
}

/** A filled circle, to round off road ends and fill junctions. */
function disc(x: number, z: number, r: number, y: number, pos: number[], idx: number[]) {
  const base = pos.length / 3;
  pos.push(x, y, z);
  const seg = 10;
  for (let i = 0; i <= seg; i++) pos.push(x + Math.cos((i / seg) * Math.PI * 2) * r, y, z + Math.sin((i / seg) * Math.PI * 2) * r);
  for (let i = 1; i <= seg; i++) idx.push(base, base + i + 1, base + i);
}

/** A polyline moved sideways by d (positive: to the right of travel, in this x-east, z-south world). */
function offsetLine(pts: P2[], d: number): P2[] {
  return pts.map((p, i) => {
    const d0 = i > 0 ? norm(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : null;
    const d1 = i < pts.length - 1 ? norm(pts[i + 1][0] - p[0], pts[i + 1][1] - p[1]) : null;
    const m = d0 && d1 ? norm(d0[0] + d1[0], d0[1] + d1[1]) : (d0 ?? d1)!;
    const cos = d0 && d1 ? Math.max(0.4, m[0] * d1[0] + m[1] * d1[1]) : 1;
    return [p[0] - (m[1] * d) / cos, p[1] + (m[0] * d) / cos];
  });
}

function geometry(pos: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const normals = new Float32Array(pos.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Flat polygons (water, parks…) merged into one geometry lying on the ground at height y. */
function flatPolys(polys: number[][], y: number): THREE.BufferGeometry | null {
  const parts = polys
    .map((flat) => pairs(flat))
    .filter((pts) => pts.length > 2)
    .map((pts) => {
      const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))));
      g.rotateX(-Math.PI / 2);
      g.translate(0, y, 0);
      return g;
    });
  if (!parts.length) return null;
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

const AREA_COLOURS: Record<string, string> = {
  industrial: '#b9b0a2',
  port: '#aaa8a2',
  commercial: '#d8c4b2',
  retail: '#dcbca8',
  cemetery: '#9fb48c',
  park: '#8fbf6a',
  stadium: '#9cc77a',
  golf_course: '#8fbf6a',
  military: '#c9b89a',
  apron: '#a7a7a7',
  railway: '#b8ab9c',
};

/** Ground, water and open land. Clicking the ground walks you there. */
export function CityGround({ city, h, style, onClick }: { city: CityRender; h: Hood; style: SceneStyle; onClick: (e: never) => void }) {
  const { water, islands, areas, runways } = useMemo(() => {
    const byKind = new Map<string, number[][]>();
    for (const a of city.areas) {
      if (!AREA_COLOURS[a.k]) continue;
      if (!byKind.has(a.k)) byKind.set(a.k, []);
      byKind.get(a.k)!.push(a.p);
    }
    const runPos: number[] = [];
    const runIdx: number[] = [];
    for (const r of city.runways) ribbon(pairs(r), 14, 0.01, runPos, runIdx);
    return {
      water: flatPolys(city.water, 0.004),
      islands: flatPolys(city.islands, 0.005),
      areas: [...byKind].map(([k, polys]) => ({ k, g: flatPolys(polys, 0.002 + Object.keys(AREA_COLOURS).indexOf(k) * 0.0001) })),
      runways: runPos.length ? geometry(runPos, runIdx) : null,
    };
  }, [city]);
  useLayoutEffect(
    () => () => {
      water?.dispose();
      islands?.dispose();
      runways?.dispose();
      areas.forEach((a) => a.g?.dispose());
    },
    [water, islands, runways, areas],
  );
  const soil = style === 'lagos-rich' ? '#b9c98e' : '#cdb68e';
  const cx = (h.bounds.minX + h.bounds.maxX) / 2;
  const cz = (h.bounds.minZ + h.bounds.maxZ) / 2;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.02, cz]} material={mat(soil)} receiveShadow onClick={onClick}>
        <planeGeometry args={[h.bounds.maxX - h.bounds.minX + 900, h.bounds.maxZ - h.bounds.minZ + 900]} />
      </mesh>
      {areas.map((a) => a.g && <mesh key={a.k} geometry={a.g} material={mat(AREA_COLOURS[a.k])} receiveShadow onClick={onClick} />)}
      {water && <mesh geometry={water} material={mat('#3f84a8', { rough: 0.25, metal: 0.15 })} />}
      {islands && <mesh geometry={islands} material={mat(soil)} receiveShadow onClick={onClick} />}
      {runways && <mesh geometry={runways} material={mat('#5d5d5a')} receiveShadow />}
    </group>
  );
}

const ROAD_Y: Record<string, number> = { local: 0.014, link: 0.016, minor: 0.018, major: 0.02 };

/** The streets: pavements, tar (or laterite on neglected side streets), lane markings, railings on bridges, and the railway. */
export function CityRoads({ city, tar, onClick }: { city: CityRender; tar: boolean; onClick: (e: never) => void }) {
  const layers = useMemo(() => {
    const buckets: Record<string, { pos: number[]; idx: number[] }> = {};
    const b = (k: string) => (buckets[k] ??= { pos: [], idx: [] });
    for (const r of city.roads) {
      const pts = pairs(r.p);
      const hw = r.w / 2;
      const wide = r.c === 'major' || r.c === 'minor';
      // Pavements on main roads; a dusty shoulder on side streets.
      const side = wide ? b('pavement') : b('shoulder');
      const sw = hw + (wide ? PAV : 1.2);
      ribbon(pts, sw, wide ? 0.008 : 0.006, side.pos, side.idx);
      for (const p of [pts[0], pts[pts.length - 1]]) disc(p[0], p[1], sw, wide ? 0.008 : 0.006, side.pos, side.idx);
      const surface = r.c === 'local' && !tar ? b('laterite') : b(r.c);
      const y = ROAD_Y[r.c] ?? 0.014;
      ribbon(pts, hw, y, surface.pos, surface.idx);
      for (const p of [pts[0], pts[pts.length - 1]]) disc(p[0], p[1], hw, y, surface.pos, surface.idx);
      if (r.c === 'major') {
        // A dashed centre line.
        const m = b('marking');
        for (let i = 1; i < pts.length; i++) {
          const [a, c] = [pts[i - 1], pts[i]];
          const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
          for (let s = 2; s + 3 < L; s += 7) {
            const t0 = s / L;
            const t1 = (s + 3) / L;
            ribbon(
              [
                [a[0] + (c[0] - a[0]) * t0, a[1] + (c[1] - a[1]) * t0],
                [a[0] + (c[0] - a[0]) * t1, a[1] + (c[1] - a[1]) * t1],
              ],
              0.14,
              0.026,
              m.pos,
              m.idx,
            );
          }
        }
      }
    }
    for (const line of city.rail) {
      const pts = pairs(line);
      const bed = b('ballast');
      ribbon(pts, 1.7, 0.011, bed.pos, bed.idx);
      const steel = b('rails');
      for (const d of [-0.72, 0.72]) ribbon(offsetLine(pts, d), 0.07, 0.06, steel.pos, steel.idx);
    }
    return Object.entries(buckets).map(([k, v]) => ({ k, g: geometry(v.pos, v.idx) }));
  }, [city, tar]);
  const railings = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (const r of city.roads) {
      if (!r.b) continue;
      const pts = pairs(r.p);
      for (const d of [-(r.w / 2 + 0.3), r.w / 2 + 0.3]) {
        const line = offsetLine(pts, d);
        for (let i = 1; i < line.length; i++) {
          const [a, c] = [line[i - 1], line[i]];
          const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
          if (L < 0.2) continue;
          const g = new THREE.BoxGeometry(L, 0.9, 0.25);
          g.rotateY(Math.atan2(-(c[1] - a[1]), c[0] - a[0]));
          g.translate((a[0] + c[0]) / 2, 0.45, (a[1] + c[1]) / 2);
          parts.push(g);
        }
      }
    }
    if (!parts.length) return null;
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return merged;
  }, [city]);
  useLayoutEffect(
    () => () => {
      layers.forEach((l) => l.g.dispose());
      railings?.dispose();
    },
    [layers, railings],
  );
  const colour: Record<string, string> = {
    pavement: '#b8b0a2',
    shoulder: '#bf9f78',
    laterite: '#b5845a',
    local: '#55524c',
    link: '#47443f',
    minor: '#4a4743',
    major: '#3b3936',
    marking: '#eee6d4',
    ballast: '#7f766b',
    rails: '#3a3a3a',
  };
  return (
    <group>
      {layers.map((l) => (
        <mesh key={l.k} geometry={l.g} material={mat(colour[l.k] ?? '#555')} receiveShadow onClick={l.k === 'marking' || l.k === 'rails' ? undefined : onClick} />
      ))}
      {railings && <mesh geometry={railings} material={mat('#c9c2b2')} castShadow receiveShadow />}
    </group>
  );
}

/** A gable roof one unit wide, deep and high, ridge along x, for instancing. */
function gableGeometry(): THREE.BufferGeometry {
  const v = [
    // Two slopes.
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
    // Gable ends.
    -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

const ROOF_COLOURS = ['#9a5f45', '#8c5a42', '#a86a4c', '#9fb0b8', '#7c8a90', '#9a5f45', '#6d6a64', '#b07a5a'];
const RICH_WALLS = ['#f4f1ea', '#dfe6ea', '#e9e2d4', '#cfdce4', '#bcd2de', '#f0ede6', '#d9d4cc', '#c4d6e0'];

interface Inst {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rot: number;
  wall: string;
  roof: string;
  flat: boolean;
}

/** Many boxes of one kind in one draw call. */
function Instances({ items, geo, place, colour, cast = true }: { items: Inst[]; geo: THREE.BufferGeometry; place: (it: Inst, m: THREE.Object3D) => void; colour: (it: Inst) => string; cast?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(0, 0, 0);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, 1, 1);
      place(it, o);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, c.set(colour(it)));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items, place, colour]);
  if (!items.length) return null;
  return (
    <instancedMesh ref={ref} args={[geo, undefined, items.length]} castShadow={cast} receiveShadow>
      <meshStandardMaterial flatShading roughness={0.85} />
    </instancedMesh>
  );
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const GABLE = gableGeometry();
const placeWalls = (it: Inst, o: THREE.Object3D) => {
  o.position.set(it.x, it.h / 2, it.z);
  o.rotation.y = it.rot;
  o.scale.set(it.w, it.h, it.d);
};
const placeGable = (it: Inst, o: THREE.Object3D) => {
  o.position.set(it.x, it.h, it.z);
  o.rotation.y = it.rot;
  o.scale.set(it.w + 0.5, Math.min(1.6, it.d * 0.22), it.d + 0.5);
};
const placeSlab = (it: Inst, o: THREE.Object3D) => {
  o.position.set(it.x, it.h + 0.2, it.z);
  o.rotation.y = it.rot;
  o.scale.set(it.w + 0.3, 0.4, it.d + 0.3);
};
const wallOf = (it: Inst) => it.wall;
const roofOf = (it: Inst) => it.roof;

/** The ordinary buildings along the streets and the rooftops of the compounds behind them. */
export function CityBlocks({ city, style }: { city: CityRender; style: SceneStyle }) {
  const { gables, flats } = useMemo(() => {
    const walls = style === 'lagos-rich' ? RICH_WALLS : [...WALLS[style], '#e8dcc6', '#d9cbb0', '#cfc6b8'];
    const all: Inst[] = [];
    const b = city.blocks;
    for (let i = 0; i < b.length; i += 7) {
      const h = style === 'lagos-rich' ? b[i + 5] * 1.6 : b[i + 5];
      all.push({ x: b[i], z: b[i + 1], w: b[i + 2] - 0.6, d: b[i + 3] - 0.6, rot: b[i + 4], h, wall: walls[b[i + 6] % walls.length], roof: ROOF_COLOURS[b[i + 6]], flat: h > 6.5 || style === 'lagos-rich' });
    }
    const r = city.roofs;
    for (let i = 0; i < r.length; i += 6) {
      const flat = r[i + 3] > 5 || style === 'lagos-rich';
      all.push({ x: r[i], z: r[i + 1], w: r[i + 2], d: r[i + 2] * 0.85, rot: r[i + 4], h: style === 'lagos-rich' ? r[i + 3] * 1.4 : r[i + 3], wall: walls[(r[i + 5] + 3) % walls.length], roof: ROOF_COLOURS[r[i + 5]], flat });
    }
    return { gables: all.filter((x) => !x.flat), flats: all.filter((x) => x.flat) };
  }, [city, style]);
  const all = useMemo(() => [...gables, ...flats], [gables, flats]);
  return (
    <group>
      <Instances items={all} geo={BOX} place={placeWalls} colour={wallOf} />
      <Instances items={gables} geo={GABLE} place={placeGable} colour={roofOf} />
      <Instances items={flats} geo={BOX} place={placeSlab} colour={roofOf} />
    </group>
  );
}

const TRUNK = new THREE.CylinderGeometry(0.2, 0.28, 3, 5);
TRUNK.translate(0, 1.5, 0);
const CANOPY = new THREE.IcosahedronGeometry(2, 0);
CANOPY.translate(0, 4, 0);
const PALM = new THREE.ConeGeometry(2.4, 1.6, 6);
PALM.translate(0, 6.4, 0);

/** Trees in the parks and in the gaps between compounds. */
export function CityTrees({ city, h, style }: { city: CityRender; h: Hood; style: SceneStyle }) {
  const trees = useMemo(() => {
    const rnd = seeded(`trees:${h.real?.name}`);
    const out: Inst[] = [];
    const green = earthen(style) ? '#6f8a3a' : '#3f7f3a';
    for (const a of city.areas) {
      if (a.k !== 'park' && a.k !== 'cemetery' && a.k !== 'golf_course') continue;
      const pts = pairs(a.p);
      const xs = pts.map((p) => p[0]);
      const zs = pts.map((p) => p[1]);
      const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
      const n = Math.min(40, Math.floor(((x1 - x0) * (z1 - z0)) / 160));
      for (let i = 0; i < n; i++) {
        const p: P2 = [x0 + rnd() * (x1 - x0), z0 + rnd() * (z1 - z0)];
        if (!inside(p, pts)) continue;
        out.push({ x: p[0], z: p[1], w: 1, d: 1, h: 0.8 + rnd() * 0.5, rot: rnd() * 6, wall: '#6b4a2b', roof: green, flat: rnd() < 0.3 });
      }
    }
    const r = city.roofs;
    for (let i = 0; i < r.length; i += 6 * 9) out.push({ x: r[i] + 4.5, z: r[i + 1] - 3.5, w: 1, d: 1, h: 0.8 + rnd() * 0.4, rot: rnd() * 6, wall: '#6b4a2b', roof: rnd() < 0.5 ? green : '#4f8a3f', flat: rnd() < 0.5 });
    return out;
  }, [city, h, style]);
  const palms = useMemo(() => trees.filter((t) => t.flat), [trees]);
  const leafy = useMemo(() => trees.filter((t) => !t.flat), [trees]);
  const placeTrunk = useMemo(() => (it: Inst, o: THREE.Object3D) => {
    o.position.set(it.x, 0, it.z);
    o.scale.set(1, it.flat ? 2.1 : it.h, 1);
  }, []);
  const placeTop = useMemo(() => (it: Inst, o: THREE.Object3D) => {
    o.position.set(it.x, 0, it.z);
    o.rotation.y = it.rot;
    o.scale.setScalar(it.h);
  }, []);
  return (
    <group>
      <Instances items={trees} geo={TRUNK} place={placeTrunk} colour={wallOf} />
      <Instances items={leafy} geo={CANOPY} place={placeTop} colour={roofOf} />
      <Instances items={palms} geo={PALM} place={placeTop} colour={roofOf} />
    </group>
  );
}

function inside(p: P2, poly: P2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i], poly[j]];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** Where the street lamps stand: along the main roads, on alternating pavements. */
export function cityLamps(city: CityRender): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const r of city.roads) {
    if (r.c !== 'major') continue;
    const pts = pairs(r.p);
    let carry = 10;
    let side = 1;
    for (let i = 1; i < pts.length; i++) {
      const [a, c] = [pts[i - 1], pts[i]];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const [dx, dz] = norm(c[0] - a[0], c[1] - a[1]);
      for (let s = carry; s < L; s += 32) {
        const off = side * (r.w / 2 + 0.9);
        out.push([a[0] + dx * s - dz * off, a[1] + dz * s + dx * off, Math.atan2(-dz * side, dx * side)]);
        side = -side;
        carry = s + 32 - L;
      }
      if (carry < 0) carry = 0;
    }
  }
  return out;
}

const POLE = new THREE.CylinderGeometry(0.09, 0.13, 7, 5);
POLE.translate(0, 3.5, 0);
const HEAD = new THREE.BoxGeometry(1.4, 0.18, 0.5);
HEAD.translate(0.6, 6.9, 0);

/** Street lamps along the main roads, plus a few real lights near you so the street glows at night. */
export function CityLamps({ lamps, lightsOn, playerPos }: { lamps: [number, number, number][]; lightsOn: boolean; playerPos: React.MutableRefObject<THREE.Vector3> }) {
  const items = useMemo(() => lamps.map(([x, z, rot]) => ({ x, z, rot, w: 1, d: 1, h: 1, wall: '#4a4743', roof: '#fff1c2', flat: false })), [lamps]);
  const place = useMemo(() => (it: Inst, o: THREE.Object3D) => {
    o.position.set(it.x, 0, it.z);
    o.rotation.y = it.rot + Math.PI / 2;
  }, []);
  const headRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = headRef.current;
    if (!m) return;
    const o = new THREE.Object3D();
    items.forEach((it, i) => {
      o.position.set(0, 0, 0);
      o.rotation.set(0, 0, 0);
      place(it, o);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items, place]);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  useFrame(() => {
    const p = playerPos.current;
    const near = lamps
      .map((l) => ({ l, d: Math.abs(l[0] - p.x) + Math.abs(l[1] - p.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
    near.forEach(({ l }, i) => {
      const light = lights.current[i];
      if (!light) return;
      light.position.set(l[0], 5.6, l[1]);
      light.intensity = lightsOn ? 16 : 0;
    });
  });
  if (!items.length) return null;
  return (
    <group>
      <Instances items={items} geo={POLE} place={place} colour={wallOf} cast={false} />
      <instancedMesh ref={headRef} args={[HEAD, undefined, items.length]} material={lightsOn ? mat('#fff1c2', { emissive: '#ffcf6b' }) : mat('#5a5a5a')} />
      {Array.from({ length: 6 }, (_, i) => (
        <pointLight key={i} ref={(r) => void (lights.current[i] = r)} intensity={0} distance={20} decay={1.6} color="#ffd38a" />
      ))}
    </group>
  );
}

// ───────────── moving along real roads ─────────────

interface Lane {
  pts: P2[];
  /** Distance along the lane at each point. */
  at: number[];
  len: number;
}

function lane(pts: P2[]): Lane {
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, at, len: at[at.length - 1] };
}

/** Where on a lane, and which way it points, at distance s. `hint` remembers the last segment to save searching. */
function along(l: Lane, s: number, hint: { i: number }): { x: number; z: number; dx: number; dz: number } {
  let i = Math.min(hint.i, l.pts.length - 2);
  if (l.at[i] > s) i = 0;
  while (i < l.pts.length - 2 && l.at[i + 1] < s) i++;
  hint.i = i;
  const [a, b] = [l.pts[i], l.pts[i + 1]];
  const seg = l.at[i + 1] - l.at[i] || 1;
  const t = Math.max(0, Math.min(1, (s - l.at[i]) / seg));
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / seg, dz: (b[1] - a[1]) / seg };
}

/**
 * A vehicle driving along a road and back on the other side (they drive on the right), or a person pacing a
 * pavement. Out of sight when far from you.
 */
function RoadMover({ pts, offset, speed, start, playerPos, walker, children }: { pts: P2[]; offset: number; speed: number; start: number; playerPos: React.MutableRefObject<THREE.Vector3>; walker?: boolean; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const lanes = useMemo(() => [lane(offsetLine(pts, offset)), lane(offsetLine([...pts].reverse(), walker ? -offset : offset))], [pts, offset, walker]);
  const t = useRef(start);
  const hint = useRef([{ i: 0 }, { i: 0 }]);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    t.current += dt * speed;
    const cycle = lanes[0].len + lanes[1].len;
    const s = ((t.current % cycle) + cycle) % cycle;
    const back = s >= lanes[0].len ? 1 : 0;
    const q = along(lanes[back], back ? s - lanes[0].len : s, hint.current[back]);
    const far = Math.abs(q.x - playerPos.current.x) + Math.abs(q.z - playerPos.current.z) > 200;
    g.visible = !far;
    if (far) return;
    g.position.set(q.x, walker ? 0.16 : Math.abs(Math.sin(t.current * 3)) * 0.03, q.z);
    // Vehicles are built facing +x, people facing +z.
    g.rotation.y = walker ? Math.atan2(q.dx, q.dz) : Math.atan2(-q.dz, q.dx);
  });
  return <group ref={ref}>{children}</group>;
}

const CAR_COLOURS = ['#d6d6d6', '#2f63ad', '#b8352a', '#1f1d1a', '#e9e2d4', '#6d6a64'];

/** Danfos, BRT buses, cars, kekes, okadas and trucks on the district's busiest real roads. */
export function CityTraffic({ city, lagos, kekeColor, okada, playerPos }: { city: CityRender; lagos: boolean; kekeColor: string; okada: boolean; playerPos: React.MutableRefObject<THREE.Vector3> }) {
  const list = useMemo(() => {
    const rnd = seeded(`ctraffic:${city.roads.length}`);
    const rider: Looks = { skin: 2, hair: 0, outfit: 1, accent: 2, glasses: false };
    const roads = city.roads
      .filter((r) => r.c === 'major' || r.c === 'minor')
      .map((r) => ({ r, pts: pairs(r.p), len: lane(pairs(r.p)).len }))
      .filter((x) => x.len > 70)
      .sort((a, b) => b.len - a.len)
      .slice(0, 18);
    const out: { pts: P2[]; offset: number; speed: number; start: number; node: ReactNode }[] = [];
    for (const { r, pts, len } of roads) {
      const n = Math.max(2, Math.min(6, Math.round(len / 110)));
      for (let k = 0; k < n; k++) {
        const roll = rnd();
        const major = r.c === 'major';
        const node =
          roll < 0.32 ? (lagos ? <Danfo /> : <Keke color={kekeColor} />)
          : roll < 0.62 ? <Car color={CAR_COLOURS[Math.floor(rnd() * CAR_COLOURS.length)]} />
          : roll < 0.74 ? <Keke color={kekeColor} />
          : roll < 0.84 && okada ? <Okada rider={rider} />
          : roll < 0.92 && major && lagos ? <Brt />
          : major ? <Truck color={['#c2552d', '#2f63ad', '#1e8f5a'][Math.floor(rnd() * 3)]} />
          : <Car color={CAR_COLOURS[Math.floor(rnd() * CAR_COLOURS.length)]} />;
        out.push({ pts, offset: Math.min(r.w / 2 - 1, 1.6 + rnd() * (r.w / 4)), speed: 6 + rnd() * 6, start: rnd() * len * 2, node });
      }
    }
    return out;
  }, [city, lagos, kekeColor, okada]);
  return (
    <group>
      {list.map((v, i) => (
        <RoadMover key={i} pts={v.pts} offset={v.offset} speed={v.speed} start={v.start} playerPos={playerPos}>
          {v.node}
        </RoadMover>
      ))}
    </group>
  );
}

/** People walking the pavements of the streets around the bus stop. */
export function CityPedestrians({ city, h, playerPos, count = 26 }: { city: CityRender; h: Hood; playerPos: React.MutableRefObject<THREE.Vector3>; count?: number }) {
  const people = useMemo(() => {
    const rnd = seeded(`cped:${h.real?.name}`);
    const [sx, sz] = h.busStop;
    const near = city.roads
      .filter((r) => !r.x && r.c !== 'link')
      .map((r) => ({ r, pts: pairs(r.p) }))
      .filter(({ pts }) => pts.some((p) => Math.abs(p[0] - sx) + Math.abs(p[1] - sz) < 260));
    if (!near.length) return [];
    return Array.from({ length: count }, () => {
      const { r, pts } = near[Math.floor(rnd() * near.length)];
      return {
        pts,
        offset: (rnd() < 0.5 ? -1 : 1) * (r.w / 2 + 0.8 + rnd() * 1.2),
        speed: 1.1 + rnd() * 0.9,
        start: rnd() * 400,
        looks: { skin: Math.floor(rnd() * 5), hair: Math.floor(rnd() * 5), outfit: Math.floor(rnd() * 8), accent: Math.floor(rnd() * 8), glasses: rnd() > 0.85 },
        gender: (rnd() > 0.5 ? 'm' : 'f') as 'm' | 'f',
      };
    });
  }, [city, h, count]);
  return (
    <group>
      {people.map((p, i) => (
        <RoadMover key={i} pts={p.pts} offset={p.offset} speed={p.speed} start={p.start} playerPos={playerPos} walker>
          <Person3D looks={p.looks} gender={p.gender} pose="walk" speed={p.speed / 1.4} />
        </RoadMover>
      ))}
    </group>
  );
}

/** A danfo that pulls in at the bus stop on its real road, waits for passengers, then goes. */
export function CityStopDanfo({ h, lagos, kekeColor }: { h: Hood; lagos: boolean; kekeColor: string }) {
  const ref = useRef<THREE.Group>(null);
  const rot = h.busRot;
  // The shelter's open side faces the road: from the road towards the stop is (sin, cos) of its rotation.
  const [nx, nz] = [Math.sin(rot), Math.cos(rot)];
  const [tx, tz] = [Math.cos(rot), -Math.sin(rot)];
  const [rx, rz] = h.real?.road ?? [h.busStop[0], h.busStop[1] - 4];
  const kerb = Math.max(1.6, (h.real?.span ?? 15) / 2 - PAV - 1.4);
  const s = useRef({ x: -70, v: 10, wait: 0 });
  useFrame((_, dt) => {
    const st = s.current;
    const left = -st.x;
    if (st.wait > 0) {
      st.wait -= dt;
      st.v = 0;
    } else if (left > 0 && left < 16) {
      st.v = Math.max(1.2, left * 0.7);
      if (left < 0.15) st.wait = 5;
    } else st.v = Math.min(10, st.v + dt * 5);
    st.x += st.v * dt;
    if (st.x > 70) st.x = -70;
    if (ref.current) ref.current.position.set(rx + nx * kerb + tx * st.x, 0, rz + nz * kerb + tz * st.x);
  });
  return (
    <group ref={ref} rotation={[0, rot, 0]}>
      {lagos ? <Danfo /> : <Keke color={kekeColor} />}
    </group>
  );
}

/** Street names on green signs, shown as you come near. */
export function StreetNames({ city, playerPos }: { city: CityRender; playerPos: React.MutableRefObject<THREE.Vector3> }) {
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  useFrame(() => {
    const p = playerPos.current;
    city.labels.forEach((l, i) => {
      const s = refs.current[i];
      if (s) s.visible = Math.abs(l.x - p.x) + Math.abs(l.z - p.z) < 70;
    });
  });
  return (
    <group>
      {city.labels.map((l, i) => (
        <sprite key={l.n} ref={(r) => void (refs.current[i] = r)} position={[l.x, 3.2, l.z]} scale={[0.1, 0.025, 1]} visible={false}>
          <spriteMaterial map={signTexture(l.n.toUpperCase(), '#1e6b45', '#ffffff')} depthTest={false} transparent sizeAttenuation={false} />
        </sprite>
      ))}
    </group>
  );
}

// ───────────── landmarks ─────────────

/** How tall a landmark stands, for its label. */
export const LANDMARK_HEIGHT: Record<string, number> = { mosque: 16, church: 15, mall: 10, campus: 9, hospital: 10, government: 9, stadium: 9, airport: 16, terminal: 7, museum: 8, palace: 7, market: 6, station: 7, toll: 8, jetty: 6, industrial: 9, square: 6, school: 7, building: 7 };

/** A famous building in the district, sized to its plot (w along x, d along z, front at +z). */
export function LandmarkModel({ kind, w, d, style, lit, name }: { kind: string; w: number; d: number; style: SceneStyle; lit: boolean; name: string }) {
  const sign = name.length > 30 ? `${name.slice(0, 28)}…` : name;
  switch (kind) {
    case 'mosque': {
      const bw = Math.min(w, d) * 0.62;
      return (
        <group>
          <Box p={[0, 3, 0]} s={[bw, 6, bw]} c="#f4f1ea" />
          <Box p={[0, 6.2, 0]} s={[bw + 0.4, 0.4, bw + 0.4]} c="#1e8f5a" />
          <mesh position={[0, 6.4, 0]} material={mat('#2f9a6a')} castShadow>
            <sphereGeometry args={[bw * 0.36, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          <group position={[w / 2 - 1.6, 0, d / 2 - 1.6]}>
            <mesh position={[0, 7, 0]} material={mat('#f4f1ea')} castShadow>
              <cylinderGeometry args={[0.6, 0.8, 14, 8]} />
            </mesh>
            <mesh position={[0, 14.6, 0]} material={mat('#2f9a6a')}>
              <sphereGeometry args={[0.8, 8, 6]} />
            </mesh>
          </group>
          <Box p={[0, 1.3, bw / 2 + 0.05]} s={[2, 2.6, 0.1]} c="#1e8f5a" cast={false} />
        </group>
      );
    }
    case 'church':
      return (
        <group>
          <Box p={[0, 3, -1]} s={[w * 0.5, 6, d * 0.7]} c="#f4f1ea" />
          <group position={[0, 6, -1]}>
            <Roof w={w * 0.5} d={d * 0.7} y={0} style={style} />
          </group>
          <Box p={[0, 5.5, d * 0.35 - 0.5]} s={[3, 11, 3]} c="#e9e2d4" />
          <mesh position={[0, 12.5, d * 0.35 - 0.5]} material={mat('#9a5f45')} castShadow>
            <coneGeometry args={[2.2, 3.5, 4]} />
          </mesh>
          <Box p={[0, 15, d * 0.35 - 0.5]} s={[0.2, 1.6, 0.2]} c="#1f1d1a" />
          <Box p={[0, 14.9, d * 0.35 - 0.5]} s={[0.9, 0.2, 0.2]} c="#1f1d1a" />
        </group>
      );
    case 'mall':
      return (
        <group>
          <Box p={[0, 4.5, -0.5]} s={[w * 0.92, 9, d * 0.8]} c="#e9e2d4" />
          <Box p={[0, 3, d * 0.4 - 0.4]} s={[w * 0.8, 3.4, 0.2]} c="#7fb6d6" opts={{ rough: 0.2, metal: 0.3, ...(lit ? { emissive: '#4fa3c7' } : {}) }} cast={false} />
          <Sign text={sign.toUpperCase()} y={7.4} z={d * 0.4 - 0.3} w={Math.min(w * 0.8, 14)} bg="#1f1d1a" fg="#f2b705" />
        </group>
      );
    case 'campus':
      return (
        <group>
          {[-1, 0, 1].map((k) => (
            <group key={k} position={[k * w * 0.3, 0, -d * 0.15 + Math.abs(k) * 2]}>
              <Box p={[0, 3.5, 0]} s={[w * 0.26, 7, d * 0.45]} c={k ? '#f0d58c' : '#f4f1ea'} />
              <Windows w={w * 0.22} y={2} z={d * 0.225 + 0.04} n={3} rows={2} lit={lit} />
            </group>
          ))}
          <Box p={[-3.2, 2.2, d / 2 - 0.8]} s={[0.8, 4.4, 0.8]} c="#c9c2b2" />
          <Box p={[3.2, 2.2, d / 2 - 0.8]} s={[0.8, 4.4, 0.8]} c="#c9c2b2" />
          <Sign text={sign.toUpperCase()} y={4.6} z={d / 2 - 0.6} w={7} bg="#2f63ad" fg="#ffffff" />
          <Flag x={w / 2 - 1.5} y={8} z={d / 2 - 2} tex={flagTexture()} />
        </group>
      );
    case 'hospital':
      return (
        <group>
          <Box p={[0, 4.5, -0.5]} s={[w * 0.8, 9, d * 0.7]} c="#ffffff" />
          <Windows w={w * 0.7} y={2} z={d * 0.35 - 0.45} n={5} rows={3} lit={lit} />
          <Box p={[w * 0.3, 7.4, d * 0.35 - 0.4]} s={[0.5, 1.8, 0.1]} c="#d23c22" cast={false} />
          <Box p={[w * 0.3, 7.4, d * 0.35 - 0.4]} s={[1.8, 0.5, 0.1]} c="#d23c22" cast={false} />
          <Sign text={sign.toUpperCase()} y={1.3} z={d * 0.35 - 0.35} w={Math.min(w * 0.6, 9)} bg="#1e8f5a" fg="#ffffff" />
        </group>
      );
    case 'government':
    case 'museum':
      return (
        <group>
          <Box p={[0, 3.5, -0.5]} s={[w * 0.8, 7, d * 0.65]} c={kind === 'museum' ? '#e6d0a8' : '#f4f1ea'} />
          {Array.from({ length: 6 }, (_, i) => (
            <mesh key={i} position={[-w * 0.35 + (i * w * 0.7) / 5, 3, d * 0.33]} material={mat('#fffaf0')} castShadow>
              <cylinderGeometry args={[0.3, 0.34, 6, 8]} />
            </mesh>
          ))}
          <Box p={[0, 6.4, d * 0.2]} s={[w * 0.84, 0.8, d * 0.35]} c={kind === 'museum' ? '#c9a77c' : '#1e8f5a'} />
          <Sign text={sign.toUpperCase()} y={7.6} z={d * 0.37} w={Math.min(w * 0.7, 10)} bg="#1f1d1a" fg="#ffffff" />
          {kind === 'government' && <Flag x={-w * 0.45} y={9} z={d * 0.3} tex={flagTexture()} />}
        </group>
      );
    case 'stadium':
      return (
        <group>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} material={mat('#5f9a3a')}>
            <planeGeometry args={[w * 0.55, d * 0.5]} />
          </mesh>
          {[
            [0, -d * 0.36, w * 0.9, 3],
            [0, d * 0.36, w * 0.9, 3],
          ].map(([x, z, sw, sd], i) => (
            <Box key={i} p={[x, 3, z]} s={[sw, 6, sd]} c="#c9c2b2" />
          ))}
          {[-1, 1].map((k) => (
            <Box key={k} p={[k * w * 0.42, 3, 0]} s={[3, 6, d * 0.7]} c="#b8b0a2" />
          ))}
          {[-1, 1].map((k) => (
            <Box key={`l${k}`} p={[k * w * 0.42, 11, -d * 0.36]} s={[0.4, 10, 0.4]} c="#6d6a64" />
          ))}
          <Sign text={sign.toUpperCase()} y={4.5} z={d * 0.36 + 1.6} w={Math.min(w * 0.7, 12)} bg="#1e8f5a" fg="#ffffff" />
        </group>
      );
    case 'square':
      return (
        <group>
          <Box p={[0, 0.06, 0]} s={[w * 0.95, 0.12, d * 0.95]} c="#d9d1c2" cast={false} />
          <Box p={[0, 1.5, -d * 0.38]} s={[w * 0.7, 3, 2.4]} c="#b8b0a2" />
          <Box p={[0, 3.2, -d * 0.38]} s={[w * 0.74, 0.3, 2.8]} c="#1e8f5a" />
          {[-0.35, -0.12, 0.12, 0.35].map((k) => (
            <Flag key={k} x={k * w} y={7} z={d * 0.35} tex={flagTexture()} />
          ))}
        </group>
      );
    case 'station':
      return (
        <group>
          <Box p={[0, 0.5, 0]} s={[w * 0.95, 1, d * 0.5]} c="#c9c2b2" />
          {[-0.4, -0.13, 0.13, 0.4].map((k) => (
            <Box key={k} p={[k * w, 2.8, 0]} s={[0.3, 3.6, 0.3]} c="#3a3a3a" />
          ))}
          <Box p={[0, 4.7, 0]} s={[w, 0.3, d * 0.55]} c="#2f63ad" />
          <Sign text={sign.toUpperCase()} y={3.6} z={d * 0.28} w={Math.min(w * 0.6, 9)} bg="#1f1d1a" fg="#ffffff" />
        </group>
      );
    case 'toll':
      return (
        <group>
          <Box p={[0, 6, 0]} s={[w, 0.8, d * 0.5]} c="#e9e2d4" />
          {Array.from({ length: 5 }, (_, i) => (
            <group key={i} position={[-w * 0.4 + (i * w * 0.8) / 4, 0, 0]}>
              <Box p={[0, 3, 0]} s={[0.5, 6, 0.5]} c="#c9c2b2" />
              <Box p={[0, 1.2, 0]} s={[1.4, 2.4, 1.6]} c="#f2b705" />
            </group>
          ))}
          <Sign text={sign.toUpperCase()} y={6.9} z={d * 0.25 + 0.05} w={Math.min(w * 0.7, 12)} bg="#1f1d1a" fg="#f2b705" />
        </group>
      );
    case 'market':
    case 'terminal':
    case 'jetty':
    case 'airport':
    case 'palace':
      return <PlaceModel kind={kind === 'terminal' ? 'park' : kind} w={w} d={d} style={style} lit={lit} sign={sign} />;
    case 'industrial':
      return (
        <group>
          {[-1, 1].map((k) => (
            <group key={k} position={[k * w * 0.24, 0, -1]}>
              <Box p={[0, 3, 0]} s={[w * 0.42, 6, d * 0.7]} c="#c9c2b2" />
              <Roof w={w * 0.42} d={d * 0.7} y={6} style={style} />
            </group>
          ))}
          <Sign text={sign.toUpperCase()} y={2} z={d * 0.35 - 0.9} w={Math.min(w * 0.6, 8)} />
        </group>
      );
    default:
      return (
        <group>
          <Box p={[0, 3.5, 0]} s={[w * 0.8, 7, d * 0.7]} c="#e9e2d4" />
          <Windows w={w * 0.7} y={2} z={d * 0.35 + 0.04} n={4} rows={2} lit={lit} />
          <Sign text={sign.toUpperCase()} y={5.8} z={d * 0.35 + 0.06} w={Math.min(w * 0.7, 9)} />
        </group>
      );
  }
}

/** Big real places: a market of many stalls, a motor park, a ferry jetty, an airport terminal, a palace compound. */
export function PlaceModel({ kind, w, d, style, lit, sign }: { kind: string; w: number; d: number; style: SceneStyle; lit: boolean; sign: string }) {
  switch (kind) {
    case 'market': {
      const cols = Math.max(2, Math.floor(w / 5));
      const rows = Math.max(2, Math.floor(d / 5));
      const umbrellas = ['#d23c22', '#1e8f5a', '#2f63ad', '#f2b705'];
      return (
        <group>
          {Array.from({ length: cols * rows }, (_, i) => {
            const c = i % cols;
            const r = Math.floor(i / cols);
            const x = -w / 2 + (w / cols) * (c + 0.5);
            const z = -d / 2 + (d / rows) * (r + 0.5);
            const shed = (c + r) % 3 !== 0;
            return shed ? (
              <group key={i} position={[x, 0, z]}>
                <Box p={[0, 0.5, 0]} s={[3, 1, 2]} c="#c9a77c" />
                <Box p={[0, 2.5, 0]} s={[3.8, 0.12, 3]} c={(c + r) % 2 ? '#9a5f45' : '#9fb0b8'} opts={{ metal: 0.3 }} />
                {[-1.6, 1.6].map((px) => (
                  <Box key={px} p={[px, 1.25, 1.2]} s={[0.1, 2.5, 0.1]} c="#5a4a3a" cast={false} />
                ))}
              </group>
            ) : (
              <group key={i} position={[x, 0, z]}>
                <Box p={[0, 0.45, 0]} s={[2, 0.9, 1.4]} c="#d6b88a" />
                <mesh position={[0, 2.2, 0]} material={mat(umbrellas[i % 4])} castShadow>
                  <coneGeometry args={[1.6, 0.7, 8]} />
                </mesh>
              </group>
            );
          })}
          <Sign text={sign.toUpperCase()} y={3.6} z={d / 2 + 0.2} w={Math.min(w * 0.6, 10)} bg="#d23c22" fg="#fff7ea" />
          {[-w * 0.3, w * 0.3].map((x) => (
            <Box key={x} p={[x, 1.8, d / 2 + 0.2]} s={[0.2, 3.6, 0.2]} c="#3a3a3a" cast={false} />
          ))}
        </group>
      );
    }
    case 'park':
      return (
        <group>
          {[-0.42, 0, 0.42].flatMap((kx) =>
            [-0.3, 0.3].map((kz) => (
              <mesh key={`${kx}:${kz}`} position={[kx * w, 2.2, kz * d]} material={mat('#3a3a3a')}>
                <cylinderGeometry args={[0.15, 0.15, 4.4, 6]} />
              </mesh>
            )),
          )}
          <Box p={[0, 4.5, 0]} s={[w * 0.95, 0.3, d * 0.75]} c="#c2552d" />
          {Array.from({ length: Math.max(2, Math.floor(w / 6)) }, (_, i) => (
            <group key={i} position={[-w * 0.38 + i * 6, 0, (i % 2 ? -1 : 1) * d * 0.16]} rotation={[0, Math.PI / 2, 0]}>
              <Danfo />
            </group>
          ))}
          <Sign text={sign.toUpperCase()} y={5.3} z={d * 0.38 + 0.1} w={Math.min(w * 0.7, 12)} bg="#1f1d1a" fg="#f2b705" />
        </group>
      );
    case 'jetty':
      return (
        <group>
          <Box p={[0, 1.6, d / 2 - 2.5]} s={[Math.min(w, 9), 3.2, 4]} c="#e9e2d4" />
          <Box p={[0, 3.4, d / 2 - 2.2]} s={[Math.min(w, 9) + 1, 0.3, 5]} c="#2f63ad" />
          <Sign text={sign.toUpperCase()} y={2.6} z={d / 2 - 0.4} w={Math.min(w * 0.8, 9)} bg="#2f63ad" fg="#ffffff" />
          {/* The pier runs back towards the water, with a ferry tied up at the end. */}
          <Box p={[0, 0.4, -d / 2 - 6]} s={[3, 0.3, d + 12]} c="#8a6a4a" />
          {Array.from({ length: 6 }, (_, i) => (
            <Box key={i} p={[i % 2 ? 1.4 : -1.4, 0.2, d / 2 - 4 - i * ((d + 12) / 6)]} s={[0.25, 0.9, 0.25]} c="#5a4a3a" cast={false} />
          ))}
          <group position={[4.5, 0, -d / 2 - 9]}>
            <Box p={[0, 0.7, 0]} s={[3.6, 1, 9]} c="#f4f1ea" />
            <Box p={[0, 1.9, -0.5]} s={[3, 1.4, 5]} c="#2f63ad" />
            <Box p={[0, 2.8, -0.5]} s={[3.2, 0.2, 5.4]} c="#f4f1ea" />
          </group>
        </group>
      );
    case 'airport':
      return (
        <group>
          <Box p={[0, 4, -1]} s={[w * 0.9, 8, d * 0.6]} c="#e9e2d4" />
          <Box p={[0, 3.4, d * 0.3 - 0.95]} s={[w * 0.85, 4.4, 0.2]} c="#7fb6d6" opts={{ rough: 0.2, metal: 0.3, ...(lit ? { emissive: '#4fa3c7' } : {}) }} cast={false} />
          <Box p={[0, 8.4, -0.4]} s={[w * 0.95, 0.6, d * 0.72]} c="#c9c2b2" />
          <Sign text="DEPARTURES · ARRIVALS" y={6.6} z={d * 0.3 - 0.8} w={Math.min(w * 0.5, 10)} bg="#1f1d1a" fg="#f2b705" />
          <group position={[w * 0.42, 0, -d * 0.35]}>
            <mesh position={[0, 8, 0]} material={mat('#d9d4cc')} castShadow>
              <cylinderGeometry args={[0.9, 1.2, 16, 10]} />
            </mesh>
            <mesh position={[0, 16.8, 0]} material={mat('#33505f', { rough: 0.3, ...(lit ? { emissive: '#4fa3c7' } : {}) })}>
              <cylinderGeometry args={[2, 1.6, 1.8, 10]} />
            </mesh>
            <Box p={[0, 18, 0]} s={[4.2, 0.4, 4.2]} c="#e9e2d4" />
          </group>
          {/* A jet waiting at the gate behind the terminal. */}
          <group position={[-w * 0.15, 0, -d / 2 - 10]} rotation={[0, Math.PI / 2, 0]}>
            <mesh position={[0, 2.4, 0]} rotation={[0, 0, Math.PI / 2]} material={mat('#f4f1ea')} castShadow>
              <cylinderGeometry args={[1.3, 1.3, 18, 10]} />
            </mesh>
            <Box p={[0, 2, 0]} s={[4, 0.3, 17]} c="#e9e2d4" />
            <Box p={[-8, 4.2, 0]} s={[2.6, 3.6, 0.3]} c="#1e8f5a" />
            <Box p={[-8.2, 2.8, 0]} s={[2, 0.25, 6]} c="#e9e2d4" />
          </group>
        </group>
      );
    case 'palace':
      return (
        <group>
          {[
            [0, -d / 2 + 0.3, w, 0.5],
            [-w / 2 + 0.3, 0, 0.5, d],
            [w / 2 - 0.3, 0, 0.5, d],
            [-w * 0.3, d / 2 - 0.3, w * 0.4, 0.5],
            [w * 0.3, d / 2 - 0.3, w * 0.4, 0.5],
          ].map(([x, z, sw, sd], i) => (
            <Box key={i} p={[x, 1.3, z]} s={[sw, 2.6, sd]} c={earthen(style) ? '#b87a43' : '#f4f1ea'} />
          ))}
          <Box p={[0, 3, -d * 0.15]} s={[w * 0.6, 6, d * 0.45]} c={earthen(style) ? '#c4854a' : '#f4f1ea'} />
          <Box p={[0, 6.3, -d * 0.15]} s={[w * 0.64, 0.6, d * 0.5]} c="#b8352a" />
          <Box p={[0, 1.6, d / 2 - 0.3]} s={[w * 0.2, 3.2, 0.6]} c="#d9a521" />
          <Sign text={sign.toUpperCase()} y={3.8} z={d / 2} w={Math.min(w * 0.6, 10)} bg="#7b1f3a" fg="#f2b705" />
        </group>
      );
  }
  return null;
}

/** Everything static in a real district: ground, water, roads, buildings, trees, lamps and street names. */
export function CityScene({ city, h, style, tar, lightsOn, playerPos, onClick }: { city: CityRender; h: Hood; style: SceneStyle; tar: boolean; lightsOn: boolean; playerPos: React.MutableRefObject<THREE.Vector3>; onClick: (e: never) => void }) {
  const lamps = useMemo(() => cityLamps(city), [city]);
  return (
    <group>
      <CityGround city={city} h={h} style={style} onClick={onClick} />
      <CityRoads city={city} tar={tar} onClick={onClick} />
      <CityBlocks city={city} style={style} />
      <CityTrees city={city} h={h} style={style} />
      <CityLamps lamps={lamps} lightsOn={lightsOn} playerPos={playerPos} />
      <StreetNames city={city} playerPos={playerPos} />
    </group>
  );
}

/** Two rooftop billboards on tall buildings near the bus stop: where to put them and which way they face. `tallness` matches CityBlocks' stretch for rich districts. */
export function billboardSpots(city: CityRender, h: Hood, tallness = 1): { x: number; z: number; y: number; rot: number }[] {
  const [sx, sz] = h.busStop;
  const b = city.blocks;
  const tall: { x: number; z: number; y: number; rot: number; d: number }[] = [];
  for (let i = 0; i < b.length; i += 7) {
    if (b[i + 5] < 5 || b[i + 2] < 11) continue;
    const d = Math.hypot(b[i] - sx, b[i + 1] - sz);
    if (d < 200) tall.push({ x: b[i], z: b[i + 1], y: b[i + 5] * tallness, rot: b[i + 4], d });
  }
  tall.sort((p, q) => p.d - q.d);
  const out: { x: number; z: number; y: number; rot: number }[] = [];
  for (const t of tall) {
    if (out.some((o) => Math.hypot(o.x - t.x, o.z - t.z) < 40)) continue;
    out.push({ x: t.x, z: t.z, y: t.y, rot: t.rot });
    if (out.length === 2) break;
  }
  return out;
}
