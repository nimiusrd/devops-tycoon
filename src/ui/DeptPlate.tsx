/**
 * 部署ビューの単一部門等角プレート（床・側面・部門 glow）。
 * レイアウトは旧モック dept-screen（git 履歴の mockups/）由来。
 */
import type { DeptPlatePlan } from '../render/deptBoardScene';

export function DeptPlate({ plate }: { plate: DeptPlatePlan }) {
  return (
    <svg
      className="dept-plate"
      viewBox="0 0 1404 573"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="dept-plateTop" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#3a2350" />
          <stop offset="1" stopColor="#241338" />
        </linearGradient>
        <linearGradient id="dept-edgeL" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a1636" />
          <stop offset="1" stopColor="#180c22" />
        </linearGradient>
        <linearGradient id="dept-edgeR" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#20102c" />
          <stop offset="1" stopColor="#120819" />
        </linearGradient>
        <radialGradient id="dept-okglow" cx="0.5" cy="0.42" r="0.7">
          <stop offset="0" stopColor="#57e08f" stopOpacity=".12" />
          <stop offset="1" stopColor="#57e08f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="dept-hellglow" cx="0.5" cy="0.42" r="0.7">
          <stop offset="0" stopColor="#ff3b30" stopOpacity=".18" />
          <stop offset="1" stopColor="#ff3b30" stopOpacity="0" />
        </radialGradient>
        <clipPath id="dept-floorclip">
          <path d="M702 104 L1262 384 L702 664 L142 384 Z" />
        </clipPath>
      </defs>

      <polygon points="142.0,384.0 702.0,664.0 702.0,694.0 142.0,414.0" fill="url(#dept-edgeL)" />
      <polygon points="702.0,664.0 1262.0,384.0 1262.0,414.0 702.0,694.0" fill="url(#dept-edgeR)" />
      <path d="M702 104 L1262 384 L702 664 L142 384 Z" fill="url(#dept-plateTop)" />

      <g clipPath="url(#dept-floorclip)">
        <rect x={0} y={0} width={1404} height={573} fill={plate.color} opacity={0.12} />
        {plate.tone === 'hell' && (
          <rect x={0} y={0} width={1404} height={573} fill="#ff5a45" opacity={0.1} />
        )}
        {plate.glow && (
          <ellipse
            cx={plate.glow.x}
            cy={plate.glow.y}
            rx={plate.glow.rx}
            ry={plate.glow.ry}
            fill={plate.glow.kind === 'hell' ? 'url(#dept-hellglow)' : 'url(#dept-okglow)'}
          />
        )}
      </g>

      <path
        d="M702 104 L1262 384 M622 144 L1182 424 M542 184 L1102 464 M462 224 L1022 504 M382 264 L942 544 M302 304 L862 584 M222 344 L782 624 M142 384 L702 664 M702 104 L142 384 M782 144 L222 424 M862 184 L302 464 M942 224 L382 504 M1022 264 L462 544 M1102 304 L542 584 M1182 344 L622 624 M1262 384 L702 664"
        fill="none"
        stroke="#ffffff12"
        strokeWidth="1.3"
      />
    </svg>
  );
}
