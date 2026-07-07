/**
 * 全社マップの浮遊等角プレート（床・側面・部門ストライプ・グリッド）。
 * mockups/org-screen.html L220-248 / boardScene の OfficeRoom パターン準拠。
 */
import type { OrgZonePlan } from '../render/orgBoardScene';

export interface OrgPlateProps {
  zones: readonly OrgZonePlan[];
}

export function OrgPlate({ zones }: OrgPlateProps) {
  return (
    <svg className="org-plate" viewBox="0 0 1404 573" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="org-plateTop" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#3b2f66" />
          <stop offset="1" stopColor="#261c49" />
        </linearGradient>
        <linearGradient id="org-edgeL" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#241a44" />
          <stop offset="1" stopColor="#160f2e" />
        </linearGradient>
        <linearGradient id="org-edgeR" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c1438" />
          <stop offset="1" stopColor="#100a24" />
        </linearGradient>
        <radialGradient id="org-okglow" cx="0.5" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#57e08f" stopOpacity=".12" />
          <stop offset="1" stopColor="#57e08f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="org-hellglow" cx="0.5" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#ff3b30" stopOpacity=".20" />
          <stop offset="1" stopColor="#ff3b30" stopOpacity="0" />
        </radialGradient>
        <clipPath id="org-floorclip">
          <path d="M702 108 L1262 388 L702 668 L142 388 Z" />
        </clipPath>
      </defs>

      <polygon points="142.0,388.0 702.0,668.0 702.0,698.0 142.0,418.0" fill="url(#org-edgeL)" />
      <polygon points="702.0,668.0 1262.0,388.0 1262.0,418.0 702.0,698.0" fill="url(#org-edgeR)" />
      <path d="M702 108 L1262 388 L702 668 L142 388 Z" fill="url(#org-plateTop)" />

      <g clipPath="url(#org-floorclip)">
        {zones.map((z) => (
          <rect
            key={z.deptId}
            x={z.x}
            y={0}
            width={z.width}
            height={573}
            fill={z.color}
            opacity={z.tone === 'hell' ? 0.14 : 0.11}
          />
        ))}
        {zones
          .filter((z) => z.tone === 'hell')
          .map((z) => (
            <rect
              key={`shade-${z.deptId}`}
              x={z.x}
              y={0}
              width={z.width}
              height={573}
              fill="#160a24"
              opacity={0.3}
            />
          ))}
        {zones.map(
          (z) =>
            z.glow && (
              <ellipse
                key={`glow-${z.deptId}`}
                cx={z.glow.x}
                cy={z.glow.y}
                rx={z.glow.rx}
                ry={z.glow.ry}
                fill={z.glow.kind === 'hell' ? 'url(#org-hellglow)' : 'url(#org-okglow)'}
              />
            ),
        )}
      </g>

      <path
        d="M702 108 L1262 388 M622 148 L1182 428 M542 188 L1102 468 M462 228 L1022 508 M382 268 L942 548 M302 308 L862 588 M222 348 L782 628 M142 388 L702 668 M702 108 L142 388 M782 148 L222 428 M862 198 L302 468 M942 228 L382 508 M1022 268 L462 548 M1102 308 L542 588 M1182 348 L622 628 M1262 388 L702 668"
        fill="none"
        stroke="#ffffff14"
        strokeWidth="1.3"
      />

      <g clipPath="url(#org-floorclip)">
        <line
          x1="582"
          y1="0"
          x2="582"
          y2="573"
          stroke="#ffffff22"
          strokeWidth="1.5"
          strokeDasharray="3 7"
        />
        <line
          x1="822"
          y1="0"
          x2="822"
          y2="573"
          stroke="#ff5f5733"
          strokeWidth="1.5"
          strokeDasharray="3 7"
        />
      </g>
    </svg>
  );
}
