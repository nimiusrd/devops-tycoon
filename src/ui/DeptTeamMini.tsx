/**
 * 部署ビューのチームミニパイプライン（Coding▸Review▸Done）。
 * 旧モック dept-screen（git 履歴）の 380×220 チーム SVG を簡略化。
 */
import { useState } from 'react';
import type { DeptTeamPlan } from '../render/deptBoardScene';
import { getGameAssetUrl } from '../data/assets';
import { deptAssetForLane, gameAssetMoodStyle } from '../render/gameAssetView';
import { VISUAL_TOKENS } from '../render/visualTokens';

function MiniDesk({ x, y, tone = 'wood' }: { x: number; y: number; tone?: 'wood' | 'dark' }) {
  const desk = VISUAL_TOKENS.colors.actor.desk;
  const top = tone === 'dark' ? desk.darkTop : desk.woodTop;
  const left = tone === 'dark' ? desk.darkLeft : desk.woodLeft;
  const right = tone === 'dark' ? desk.darkRight : desk.woodRight;
  return (
    <g transform={`translate(${x - 30}, ${y - 15})`}>
      <polygon points="0,15 30,0 60,15 30,30" fill={top} />
      <polygon points="0,15 30,30 30,38 0,23" fill={left} />
      <polygon points="30,30 60,15 60,23 30,38" fill={right} />
    </g>
  );
}

function DoneShelf({ x, y }: { x: number; y: number }) {
  const desk = VISUAL_TOKENS.colors.actor.desk;
  return (
    <g transform={`translate(${x - 24}, ${y - 12})`}>
      <polygon points="0,12 24,0 48,12 24,24" fill={desk.woodTop} />
      <polygon points="0,12 24,24 24,36 0,24" fill={desk.woodLeft} />
      <polygon points="24,24 48,12 48,24 24,36" fill={desk.woodRight} />
      <text x="10" y="18" fontSize="11">
        📦
      </text>
    </g>
  );
}

function pileDots(cx: number, cy: number, count: number, hot: boolean) {
  const { cap, perRow, dx, dy, largeThreshold, largeRadius, radius } =
    VISUAL_TOKENS.dimensions.department.teamMini.pile;
  const visible = Math.min(count, cap);
  const dots: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < visible; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    dots.push({
      x: cx + (col - (perRow - 1) / 2) * dx,
      y: cy - row * dy,
      r: count > largeThreshold ? largeRadius : radius,
    });
  }
  const fill = hot ? VISUAL_TOKENS.colors.fire : VISUAL_TOKENS.colors.flow.normal;
  return dots.map((d, i) => (
    <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={fill} opacity={0.92} />
  ));
}

function DeptWorker({
  x,
  y,
  mood,
  lane,
}: {
  x: number;
  y: number;
  mood: DeptTeamPlan['mood'];
  lane: 'coding' | 'review';
}) {
  const assetId = deptAssetForLane(lane);
  const moodStyle = gameAssetMoodStyle(mood);
  const [assetState, setAssetState] = useState<'loading' | 'ready' | 'error'>('loading');
  return (
    <g transform={`translate(${x}, ${y})`}>
      {assetId && (
        <image
          className={`dept-game-asset mood-${moodStyle.className}`}
          data-asset-id={assetId}
          href={getGameAssetUrl(assetId)}
          x="-16"
          y="-18"
          width="32"
          height="42"
          preserveAspectRatio="xMidYMid meet"
          opacity={assetState === 'ready' ? moodStyle.alpha : 0}
          onLoad={() => setAssetState('ready')}
          onError={() => setAssetState('error')}
        />
      )}
      {assetState !== 'ready' && (
        <>
          <ellipse cx={0} cy={14} rx={10} ry={12} fill={VISUAL_TOKENS.colors.actor.body.backlog} />
          <circle cx={0} cy={0} r={8} fill={VISUAL_TOKENS.colors.actor.skin} />
          <circle cx={-3} cy={1} r={1.6} fill={VISUAL_TOKENS.colors.ink} />
          <circle cx={3} cy={1} r={1.6} fill={VISUAL_TOKENS.colors.ink} />
        </>
      )}
      {moodStyle.marker && (
        <text x={6} y={-6} fontSize="9" className="dept-game-asset-marker">
          {moodStyle.marker}
        </text>
      )}
    </g>
  );
}

export function DeptTeamMini({ plan, deptColor }: { plan: DeptTeamPlan; deptColor: string }) {
  const { team, lanes, mood } = plan;
  const floor =
    team.health === 'reviewHell'
      ? VISUAL_TOKENS.colors.department.floorHell
      : team.health === 'congested'
        ? VISUAL_TOKENS.colors.department.floorWarn
        : VISUAL_TOKENS.colors.department.floorHealthy;

  return (
    <svg
      className="dept-team-mini-svg"
      viewBox={`0 0 ${VISUAL_TOKENS.dimensions.department.teamMini.svgW} ${VISUAL_TOKENS.dimensions.department.teamMini.svgH}`}
      aria-hidden="true"
    >
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
        stroke={
          lanes[1].hot
            ? VISUAL_TOKENS.colors.department.miniFlowHot
            : VISUAL_TOKENS.colors.department.miniFlowNormal
        }
        strokeWidth="2.5"
        opacity="0.9"
      />
      <path
        d="M236,140 L286,120"
        fill="none"
        stroke={VISUAL_TOKENS.colors.department.miniFlowDone}
        strokeWidth="2.5"
        opacity="0.85"
      />

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
            {lane.lane === 'coding' && <DeptWorker x={64} y={86} mood={mood} lane="coding" />}
            {lane.lane === 'review' && (
              <DeptWorker x={176} y={78} mood={lane.hot ? 'panic' : mood} lane="review" />
            )}
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
