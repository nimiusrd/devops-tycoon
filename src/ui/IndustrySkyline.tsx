/**
 * 業界ランキングの等角 HQ スカイライン（RI-03）。
 */
import type { IndustryState } from '../sim/orgscale/types';
import {
  INDUSTRY_VIEW,
  planIndustryBoardScene,
  type IndustryBuildingPlan,
} from '../render/industryBoardScene';

function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function windowsFor(building: IndustryBuildingPlan) {
  const rows = Array.from({ length: building.windowRows }, (_, i) => i);
  const cols = building.width >= 54 ? [0, 1, 2] : [0, 1];
  const top = building.baseY - building.height + 18;
  return rows.flatMap((row) =>
    cols.map((col) => ({
      key: `${row}-${col}`,
      x: building.x - building.width / 2 + 10 + col * 14,
      y: top + row * 18,
    })),
  );
}

function IndustryBuilding({ building }: { building: IndustryBuildingPlan }) {
  const x0 = building.x - building.width / 2;
  const x1 = building.x + building.width / 2;
  const y0 = building.baseY - building.height;
  const y1 = building.baseY;
  const d = building.depth;
  const roof = `${x0},${y0} ${x0 + d},${y0 - d} ${x1 + d},${y0 - d} ${x1},${y0}`;
  const front = `${x0},${y0} ${x1},${y0} ${x1},${y1} ${x0},${y1}`;
  const side = `${x1},${y0} ${x1 + d},${y0 - d} ${x1 + d},${y1 - d} ${x1},${y1}`;

  return (
    <g
      className={`industry-building tone-${building.tone}`}
      data-testid={building.isSelf ? 'industry-hq-self' : `industry-hq-${building.rank}`}
      data-rank={building.rank}
    >
      <ellipse cx={building.x + 10} cy={building.baseY + 8} rx="42" ry="14" className="hq-shadow" />
      <polygon points={side} className="hq-side" />
      <polygon points={front} className="hq-front" />
      <polygon points={roof} className="hq-roof" />
      {windowsFor(building).map((win) => (
        <rect key={win.key} x={win.x} y={win.y} width="8" height="9" rx="2" className="hq-window" />
      ))}
      {building.hasCrown && (
        <text
          x={building.x + building.depth / 2}
          y={y0 - building.depth - 10}
          textAnchor="middle"
          className="hq-crown"
          data-testid="industry-hq-crown"
        >
          👑
        </text>
      )}
    </g>
  );
}

export function IndustrySkyline({ industry }: { industry: IndustryState }) {
  const scene = planIndustryBoardScene(industry);
  const buildings = [...scene.buildings].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div className="industry-skyline iso-industry" data-testid="industry-skyline" aria-hidden>
      <svg
        className="industry-skyline-svg"
        viewBox={`0 0 ${INDUSTRY_VIEW.w} ${INDUSTRY_VIEW.h}`}
        preserveAspectRatio="xMidYMax meet"
      >
        <defs>
          <linearGradient id="hq-front-rival" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#75d0ff" />
            <stop offset="100%" stopColor="#3364c8" />
          </linearGradient>
          <linearGradient id="hq-front-self" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#ffe27a" />
            <stop offset="100%" stopColor="#ff9d45" />
          </linearGradient>
          <linearGradient id="hq-front-leader" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#8df4c2" />
            <stop offset="100%" stopColor="#2aa578" />
          </linearGradient>
        </defs>
        <path className="industry-horizon" d="M34,304 C180,248 540,248 706,304" />
        {buildings.map((building) => (
          <IndustryBuilding key={building.id} building={building} />
        ))}
      </svg>

      {scene.buildings.map((building) => (
        <div
          key={building.id}
          className={`industry-hq-label tone-${building.tone}`}
          style={{
            left: pct(building.label.x, INDUSTRY_VIEW.w),
            top: pct(building.label.y, INDUSTRY_VIEW.h),
          }}
        >
          <strong>{building.label.title}</strong>
          <small>{building.label.subtitle}</small>
        </div>
      ))}
    </div>
  );
}
