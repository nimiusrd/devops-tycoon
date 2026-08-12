/**
 * 部署ビューの単一部門等角プレート（床・側面・部門 glow）。
 * レイアウトは旧モック dept-screen（git 履歴の mockups/）由来。
 */
import type { DeptPlatePlan } from '../render/deptBoardScene';
import { DEPT_VIEW } from '../render/deptBoardScene';
import { VISUAL_TOKENS } from '../render/visualTokens';

const DEPT_PLATE = VISUAL_TOKENS.dimensions.department.plate;

function polygonPoints(points: readonly number[]): string {
  return points.join(' ');
}

function polygonPath(points: readonly number[]): string {
  const [firstX, firstY, ...rest] = points;
  const segments: string[] = [`M${firstX} ${firstY}`];
  for (let i = 0; i < rest.length; i += 2) {
    segments.push(`L${rest[i]} ${rest[i + 1]}`);
  }
  return `${segments.join(' ')} Z`;
}

const DEPT_FLOOR_PATH = polygonPath(DEPT_PLATE.floor);
const DEPT_GRID_PATH = (() => {
  const { floor, grid } = DEPT_PLATE;
  const [originX, originY, rightX, rightY, , , leftX, leftY] = floor;
  const { stepX, stepY, count } = grid;
  const lines: string[] = [];
  for (let i = 0; i <= count; i += 1) {
    lines.push(
      `M${originX - i * stepX} ${originY + i * stepY} L${rightX - i * stepX} ${rightY + i * stepY}`,
      `M${originX + i * stepX} ${originY + i * stepY} L${leftX + i * stepX} ${leftY + i * stepY}`,
    );
  }
  return lines.join(' ');
})();

export function DeptPlate({ plate }: { plate: DeptPlatePlan }) {
  return (
    <svg
      className="dept-plate"
      viewBox={`0 0 ${DEPT_VIEW.w} ${DEPT_VIEW.h}`}
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
          <path d={DEPT_FLOOR_PATH} />
        </clipPath>
      </defs>

      <polygon points={polygonPoints(DEPT_PLATE.edgeL)} fill="url(#dept-edgeL)" />
      <polygon points={polygonPoints(DEPT_PLATE.edgeR)} fill="url(#dept-edgeR)" />
      <path d={DEPT_FLOOR_PATH} fill="url(#dept-plateTop)" />

      <g clipPath="url(#dept-floorclip)">
        <rect
          x={0}
          y={0}
          width={DEPT_VIEW.w}
          height={DEPT_VIEW.h}
          fill={plate.color}
          opacity={0.12}
        />
        {plate.tone === 'hell' && (
          <rect
            x={0}
            y={0}
            width={DEPT_VIEW.w}
            height={DEPT_VIEW.h}
            fill={VISUAL_TOKENS.colors.department.hellOverlay}
            opacity={0.1}
          />
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
        d={DEPT_GRID_PATH}
        fill="none"
        stroke={VISUAL_TOKENS.colors.department.gridLine}
        strokeOpacity=".07"
        strokeWidth="1.3"
      />
    </svg>
  );
}
