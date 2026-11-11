import { memo } from 'react';
import type { SceneStyle } from '../data/world';
import type { Plot } from '../engine/map';
import type { BuildId } from '../engine/property';
import { Block, Box, Sign } from './Buildings';
import { LandmarkModel } from './City';
import { Filler, VacantLot } from './Town';

/** How tall each new building stands, for its label. */
export const ESTATE_HEIGHT: Record<BuildId | 'site' | 'empty', number> = { bungalow: 5, shops: 5, duplex: 9, warehouse: 9, flats: 9, plaza: 11, hotel: 16, office: 23, site: 7, empty: 3 };

/**
 * What a player has put on a plot (or left of it): a clear plot, a building site with the contractor's
 * board, or the finished building. Built like the town's own, w along x and d along z, front at +z.
 */
export const EstateBuilding = memo(function EstateBuilding({ plot, on, style, wall, lit, power, board }: { plot: Plot; on: BuildId | 'site' | 'empty'; style: SceneStyle; wall: string; lit: boolean; power: boolean; /** The contractor's name, on a site. */ board?: string }) {
  const { w, d } = plot;
  const filler = (kind: 'house' | 'flats' | 'kiosks' | 'unfinished') => <Filler plot={plot} kind={kind} style={style} wall={wall} lit={lit} power={power} seed={plot.id} petrol={0} scarcity={false} />;
  const bw = Math.max(5, Math.min(w - 3, 12));
  const bd = Math.max(5, Math.min(d - 4, 9));
  const back = -d / 2 + bd / 2 + 1;
  switch (on) {
    case 'empty':
      return <VacantLot plot={plot} />;
    case 'site':
      return (
        <group>
          {filler('unfinished')}
          {/* The contractor's board at the gate, and sand and blocks waiting. */}
          <Box p={[-w / 2 + 1.6, 1.1, d / 2 - 0.6]} s={[0.12, 2.2, 0.12]} c="#6b4024" />
          <group position={[-w / 2 + 1.6, 0, d / 2 - 0.6]}>
            <Sign text={(board ?? 'BUILDING SITE').toUpperCase().slice(0, 26)} y={2.3} z={0.1} w={3.4} bg="#f2b705" fg="#1f1d1a" />
          </group>
          <mesh position={[w / 2 - 2.2, 0.5, d / 2 - 2]} castShadow>
            <coneGeometry args={[1.3, 1, 10]} />
            <meshStandardMaterial color="#d9c08a" />
          </mesh>
          <Box p={[w / 2 - 4.4, 0.4, d / 2 - 1.6]} s={[1.4, 0.8, 0.9]} c="#9a9a94" />
        </group>
      );
    case 'bungalow':
      return filler('house');
    case 'shops':
      return filler('kiosks');
    case 'flats':
      return filler('flats');
    case 'duplex':
      return (
        <group position={[0, 0, back]}>
          <Block w={Math.min(bw, 9)} h={6.6} d={bd} wall={wall} style={style} lit={lit} tank />
        </group>
      );
    case 'warehouse':
      return (
        <group position={[0, 0, back]}>
          <Block w={bw} h={6} d={bd} wall="#b9b4a8" style={style} lit={false} rusty sign="WAREHOUSE" doors={2} />
        </group>
      );
    case 'plaza':
      return <LandmarkModel kind="mall" w={w} d={d} style={style} lit={lit} name="Shopping Plaza" />;
    case 'hotel':
      return (
        <group position={[0, 0, back]}>
          <Block w={bw} h={13} d={bd} wall="#ead9b5" style={style} lit={lit} sign="HOTEL & SUITES" signBg="#7a1f2b" signFg="#fff4dc" tank />
        </group>
      );
    case 'office':
      return (
        <group position={[0, 0, back]}>
          <Block w={Math.min(bw, 10)} h={20} d={bd} wall="#a8cadb" style={style} lit={lit} sign="OFFICES TO LET" signBg="#1f1d1a" signFg="#f2b705" />
        </group>
      );
  }
});
