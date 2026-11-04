import type { Looks } from '../engine/types';

export const SKIN = ['#a0673b', '#8d5524', '#6f4423', '#5a3825', '#3f2a1d'];
export const OUTFIT = ['#d23c22', '#2f63ad', '#1e8f5a', '#f2b705', '#7b3fa0', '#e0782a', '#0f7c84', '#b0306a'];
export const ACCENT = ['#fbf3e4', '#f2b705', '#1f1d1a', '#d23c22', '#a8d8ea', '#1e8f5a', '#ffffff', '#e0782a'];

export const HAIR_NAMES: Record<'m' | 'f', string[]> = {
  m: ['Low cut', 'Waves', 'Bald', 'Fila cap', 'Kufi cap'],
  f: ['Braids', 'Afro puff', 'Gele', 'Headscarf', 'Weave'],
};

/** A flat illustrated bust. Hair index means different styles for men and women. */
export function Portrait({ looks, gender, size = 64, title }: { looks: Looks; gender: 'm' | 'f'; size?: number; title?: string }) {
  const skin = SKIN[looks.skin % SKIN.length];
  const outfit = OUTFIT[looks.outfit % OUTFIT.length];
  const accent = ACCENT[looks.accent % ACCENT.length];
  const h = looks.hair % 5;
  const id = `p${looks.skin}${looks.hair}${looks.outfit}${looks.accent}${gender}`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <pattern id={`ank-${id}`} width="14" height="14" patternUnits="userSpaceOnUse">
          <rect width="14" height="14" fill={outfit} />
          <circle cx="7" cy="7" r="3.2" fill={accent} />
          <path d="M0 0 L3 3 M14 0 L11 3 M0 14 L3 11 M14 14 L11 11" stroke={accent} strokeWidth="1.5" />
        </pattern>
        <clipPath id={`c-${id}`}>
          <rect x="2" y="2" width="96" height="96" rx="22" />
        </clipPath>
      </defs>
      <g clipPath={`url(#c-${id})`}>
        <rect x="0" y="0" width="100" height="100" fill="#f1e4c8" />
        {/* back hair for long styles */}
        {gender === 'f' && h === 0 && <path d="M22 44 Q20 82 30 96 L70 96 Q80 82 78 44 Z" fill="#1a1410" />}
        {gender === 'f' && h === 4 && <path d="M20 42 Q16 80 26 98 L74 98 Q84 80 80 42 Z" fill="#2a1d15" />}
        {/* shoulders */}
        <path d="M10 100 Q14 74 50 72 Q86 74 90 100 Z" fill={`url(#ank-${id})`} stroke="#1f1d1a" strokeWidth="2.5" />
        <path d="M40 73 L50 84 L60 73" fill="none" stroke="#1f1d1a" strokeWidth="2" />
        {/* neck & head */}
        <rect x="42" y="58" width="16" height="16" rx="6" fill={skin} stroke="#1f1d1a" strokeWidth="2.5" />
        <ellipse cx="50" cy="44" rx="20" ry="23" fill={skin} stroke="#1f1d1a" strokeWidth="2.5" />
        <ellipse cx="30" cy="46" rx="3.5" ry="5" fill={skin} stroke="#1f1d1a" strokeWidth="2" />
        <ellipse cx="70" cy="46" rx="3.5" ry="5" fill={skin} stroke="#1f1d1a" strokeWidth="2" />
        {/* face */}
        <circle cx="42.5" cy="45" r="2.3" fill="#1f1d1a" />
        <circle cx="57.5" cy="45" r="2.3" fill="#1f1d1a" />
        <path d="M44 55 Q50 59.5 56 55" fill="none" stroke="#1f1d1a" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M48.5 47 Q47 51 50 52" fill="none" stroke="#1f1d1a" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
        {looks.glasses && (
          <g fill="none" stroke="#1f1d1a" strokeWidth="2">
            <circle cx="42.5" cy="45" r="6" />
            <circle cx="57.5" cy="45" r="6" />
            <path d="M48.5 45 L51.5 45" />
          </g>
        )}
        {/* hair & headwear */}
        {gender === 'm' && h === 0 && <path d="M30 40 Q32 20 50 20 Q68 20 70 40 Q62 30 50 30 Q38 30 30 40 Z" fill="#1a1410" />}
        {gender === 'm' && h === 1 && (
          <g>
            <path d="M29 40 Q30 18 50 18 Q70 18 71 40 Q62 28 50 28 Q38 28 29 40 Z" fill="#1a1410" />
            <path d="M36 25 Q50 21 64 25 M34 31 Q50 26 66 31" stroke="#4a3a2c" strokeWidth="1.5" fill="none" />
          </g>
        )}
        {gender === 'm' && h === 2 && <path d="M34 28 Q50 22 66 28" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="3" fill="none" />}
        {gender === 'm' && h === 3 && (
          <g>
            <path d="M28 34 Q30 12 56 14 Q74 16 72 34 Z" fill={accent} stroke="#1f1d1a" strokeWidth="2.5" />
            <path d="M56 14 Q72 18 76 30" fill="none" stroke="#1f1d1a" strokeWidth="2.5" />
          </g>
        )}
        {gender === 'm' && h === 4 && <path d="M30 34 Q31 18 50 18 Q69 18 70 34 Z" fill={accent} stroke="#1f1d1a" strokeWidth="2.5" />}
        {gender === 'f' && h === 0 && (
          <g>
            <path d="M28 42 Q28 18 50 18 Q72 18 72 42 Q64 26 50 26 Q36 26 28 42 Z" fill="#1a1410" />
            <path d="M30 46 L28 80 M70 46 L72 80 M34 40 L32 76 M66 40 L68 76" stroke="#3a2c22" strokeWidth="2" />
          </g>
        )}
        {gender === 'f' && h === 1 && (
          <g>
            <circle cx="50" cy="14" r="12" fill="#1a1410" />
            <path d="M30 40 Q32 22 50 22 Q68 22 70 40 Q62 30 50 30 Q38 30 30 40 Z" fill="#1a1410" />
            <rect x="42" y="22" width="16" height="4" rx="2" fill={accent} />
          </g>
        )}
        {gender === 'f' && h === 2 && (
          <g>
            <path d="M22 34 Q20 8 50 6 Q82 8 78 34 Q64 26 50 28 Q36 26 22 34 Z" fill={accent} stroke="#1f1d1a" strokeWidth="2.5" />
            <path d="M28 22 Q50 4 74 24 M34 30 Q52 14 70 30" stroke="#1f1d1a" strokeWidth="2" fill="none" />
            <path d="M72 14 Q90 10 84 30" fill={accent} stroke="#1f1d1a" strokeWidth="2.5" />
          </g>
        )}
        {gender === 'f' && h === 3 && (
          <path d="M26 46 Q24 16 50 16 Q76 16 74 46 Q78 70 66 76 L64 64 Q72 50 66 34 Q58 26 50 26 Q42 26 34 34 Q28 50 36 64 L34 76 Q22 70 26 46 Z" fill={accent} stroke="#1f1d1a" strokeWidth="2.5" />
        )}
        {gender === 'f' && h === 4 && <path d="M27 44 Q26 18 50 18 Q74 18 73 44 Q66 26 50 26 Q34 26 27 44 Z" fill="#2a1d15" />}
      </g>
      <rect x="2" y="2" width="96" height="96" rx="22" fill="none" stroke="#1f1d1a" strokeWidth="3" />
    </svg>
  );
}
