/**
 * 部署ビューのチームミニパイプライン（Coding▸Review▸Done）。
 * mockups/dept-screen.html の 380×220 チーム SVG を簡略化。
 */
import type { DeptTeamPlan } from '../render/deptBoardScene';

function MiniDesk({ x, y, tone = 'wood' }: { x: number; y: number; tone?: 'wood' | 'dark' }) {
  const top = tone === 'dark' ? '#5a4a86' : '#caa06a';
  const left = tone === 'dark' ? '#3a2f66' : '#9a7440';
  const right = tone === 'dark' ? '#2b2050' : '#75561f';
  return (
    <g transform={`translate(${x - 30}, ${y - 15})`}>
      <polygon points="0,15 30,0 60,15 30,30" fill={top} />
      <polygon points="0,15 30,30 30,38 0,23" fill={left} />
      <polygon points="30,30 60,15 60,23 30,38" fill={right} />
    </g>
  );
}

function DoneShelf({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x - 24}, ${y - 12})`}>
      <polygon points="0,12 24,0 48,12 24,24" fill="#caa46a" />
      <polygon points="0,12 24,24 24,36 0,24" fill="#9a7440" />
      <polygon points="24,24 48,12 48,24 24,36" fill="#75561f" />
      <text x="10" y="18" fontSize="11">
        📦
      </text>
    </g>
  );
}

function pileDots(cx: number, cy: number, count: number, hot: boolean) {
  const cap = Math.min(count, 12);
  const dots: { x: number; y: number; r: number }[] = [];
  const perRow = 4;
  for (let i = 0; i < cap; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    dots.push({
      x: cx + (col - 1.5) * 10,
      y: cy - row * 9,
      r: count > 8 ? 5 : 6,
    });
  }
  const fill = hot ? '#ff7a2f' : '#cdbff0';
  return dots.map((d, i) => (
    <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={fill} opacity={0.92} />
  ));
}

function stationWorker(x: number, y: number, mood: DeptTeamPlan['mood']) {
  const emoji =
    mood === 'panic' ? '💢' : mood === 'tired' ? '💦' : mood === 'sad' ? '😞' : undefined;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <ellipse cx={0} cy={14} rx={10} ry={12} fill="#7a6cc0" />
      <circle cx={0} cy={0} r={8} fill="#ffe0c4" />
      <circle cx={-3} cy={1} r={1.6} fill="#33285c" />
      <circle cx={3} cy={1} r={1.6} fill="#33285c" />
      {emoji && (
        <text x={6} y={-6} fontSize="9">
          {emoji}
        </text>
      )}
    </g>
  );
}

export function DeptTeamMini({ plan, deptColor }: { plan: DeptTeamPlan; deptColor: string }) {
  const { team, lanes, mood } = plan;
  const floor =
    team.health === 'reviewHell' ? '#4a2b45' : team.health === 'congested' ? '#3f3470' : '#3a2f68';

  return (
    <svg className="dept-team-mini-svg" viewBox="0 0 380 240" aria-hidden="true">
      <ellipse cx={190} cy={178} rx={128} ry={22} fill="#0b0712" opacity={0.3} />
      <polygon
        points="42,150 190,76 338,150 190,224"
        fill={floor}
        stroke={deptColor}
        strokeWidth="1.4"
      />
      <polygon points="42,150 190,224 190,236 42,162" fill="#30192e" />
      <polygon points="190,224 338,150 338,162 190,236" fill="#221320" />

      <path
        d="M104,120 L150,138"
        fill="none"
        stroke={lanes[1].hot ? '#ff9a93' : '#b388ff'}
        strokeWidth="2.5"
        opacity="0.9"
      />
      <path d="M236,140 L286,120" fill="none" stroke="#ffd45c" strokeWidth="2.5" opacity="0.85" />

      {lanes.map((lane) => {
        if (lane.lane === 'done') {
          return (
            <g key={lane.lane}>
              <DoneShelf x={lane.x} y={lane.y} />
              {lane.count > 0 && pileDots(lane.x, lane.y - 18, lane.count, false)}
            </g>
          );
        }
        return (
          <g key={lane.lane}>
            <MiniDesk
              x={lane.x}
              y={lane.y}
              tone={lane.lane === 'review' && lane.hot ? 'dark' : 'wood'}
            />
            {lane.count > 0 && pileDots(lane.x, lane.y - 22, lane.count, lane.hot)}
            {lane.lane === 'coding' && stationWorker(64, 86, mood)}
            {lane.lane === 'review' && stationWorker(176, 78, lane.hot ? 'panic' : mood)}
          </g>
        );
      })}

      {team.incidents > 0 && (
        <text x={190} y={98} fontSize="16" textAnchor="middle">
          🔥
        </text>
      )}
    </svg>
  );
}

export function DeptTeamBanner({ plan }: { plan: DeptTeamPlan }) {
  const { banner } = plan;
  return (
    <div className={`dept-team-banner tone-${banner.tone}`}>
      <strong>{banner.title}</strong>
      <small>{banner.subtitle}</small>
      <span className="dept-team-tag">{banner.tag}</span>
      {plan.chained && (
        <span className="dept-team-chain" data-testid="chain-fire">
          ⚠ 上流から延焼
        </span>
      )}
    </div>
  );
}
