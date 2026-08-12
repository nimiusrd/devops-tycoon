/**
 * 全社マップのチーム島アクター（ミニ机 + アバター + AI ボット）。
 * 旧モック org-screen（git 履歴）の team SVG / OfficeActors.tsx 縮小版。
 * アバター数は `Team.engineers`、AI ボットは `Team.aiAssignedCount` を映す（RI-27）。
 */
import { useState } from 'react';
import {
  islandAiBotCount,
  islandWorkerCount,
  type OrgIslandMood,
  type OrgIslandPlan,
} from '../render/orgBoardScene';
import { getGameAssetUrl } from '../data/assets';
import { gameAssetMoodStyle, orgAssetForSlot } from '../render/gameAssetView';
import { VISUAL_TOKENS } from '../render/visualTokens';

function IslandEyes({ mood }: { mood: OrgIslandMood }) {
  const ink = VISUAL_TOKENS.colors.ink;
  if (mood === 'panic') {
    return (
      <>
        <circle cx="-4" cy="1" r="1.9" fill={ink} />
        <circle cx="4" cy="1" r="1.9" fill={ink} />
        <circle cx="0" cy="6" r="2.2" fill="#3a0f14" />
      </>
    );
  }
  if (mood === 'tired') {
    return (
      <>
        <line x1="-6" y1="1" x2="-2" y2="1" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
        <line x1="2" y1="1" x2="6" y2="1" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
        <line
          x1="-4"
          y1="6"
          x2="4"
          y2="6"
          stroke="#8a4a3a"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </>
    );
  }
  if (mood === 'sad') {
    return (
      <>
        <circle cx="-4" cy="1" r="1.7" fill={ink} />
        <circle cx="4" cy="1" r="1.7" fill={ink} />
        <path
          d="M-4 5 q4 3 8 0"
          stroke="#9a5a4a"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
      </>
    );
  }
  return (
    <>
      <circle cx="-4" cy="1" r="1.7" fill={ink} />
      <circle cx="4" cy="1" r="1.7" fill={ink} />
      <path
        d="M-4 4 q4 4 8 0"
        stroke="#9a5a4a"
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
      />
    </>
  );
}

function Worker({
  x,
  y,
  scale,
  body,
  hair,
  mood,
  assetId,
}: {
  x: number;
  y: number;
  scale: number;
  body: string;
  hair: string;
  mood: OrgIslandMood;
  assetId: ReturnType<typeof orgAssetForSlot>;
}) {
  const moodStyle = gameAssetMoodStyle(mood);
  const [assetState, setAssetState] = useState<'loading' | 'ready' | 'error'>('loading');
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      <image
        className={`org-game-asset mood-${moodStyle.className}`}
        data-asset-id={assetId}
        href={getGameAssetUrl(assetId)}
        x="-16"
        y="-17"
        width="32"
        height="40"
        preserveAspectRatio="xMidYMid meet"
        opacity={assetState === 'ready' ? moodStyle.alpha : 0}
        onLoad={() => setAssetState('ready')}
        onError={() => setAssetState('error')}
      />
      {assetState !== 'ready' && (
        <>
          <path d="M-13 27 q0 -17 13 -17 q13 0 13 17 z" fill={body} />
          <circle cx="0" cy="0" r="10.5" fill={VISUAL_TOKENS.colors.actor.skin} />
          <path d="M-11 -2 q1 -12 11 -12 q10 0 11 11 q-5 -5 -11 -5 q-6 0 -11 6z" fill={hair} />
          <IslandEyes mood={mood} />
        </>
      )}
      {moodStyle.marker && assetState === 'ready' && (
        <text x="8" y="-8" fontSize="9" className="org-game-asset-marker">
          {moodStyle.marker}
        </text>
      )}
    </g>
  );
}

function AiBot({ x, y, scale }: { x: number; y: number; scale: number }) {
  const bot = VISUAL_TOKENS.colors.aiBot;
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      <line x1="0" y1="-12" x2="0" y2="-18" stroke={bot.antenna} strokeWidth="2" />
      <circle cx="0" cy="-18" r="2.6" fill={bot.indicator} />
      <rect
        x="-13"
        y="-12"
        width="26"
        height="20"
        rx="7"
        fill={bot.body}
        stroke={bot.bodyStroke}
        strokeWidth="1.6"
      />
      <rect x="-9" y="-8" width="18" height="13" rx="4" fill={bot.screen} />
      <path
        d="M-6 -1 q2 -3 4 0"
        stroke={bot.eye}
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M2 -1 q2 -3 4 0"
        stroke={bot.eye}
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
    </g>
  );
}

const WORKER_PALETTE = [
  { body: '#4fb3a0', hair: '#5a3a2a' },
  { body: '#c0728a', hair: '#3a2a40' },
  { body: '#58c8e0', hair: '#5a3a2a' },
  { body: '#7a6cc0', hair: '#3a2a40' },
  { body: '#ffb24d', hair: '#3a2a40' },
  { body: '#9a6bff', hair: '#5a3a2a' },
];

/** アバター配置（人数に応じて横にずらす）。 */
const WORKER_SLOTS: readonly { x: number; y: number; scale: number }[] = [
  { x: 48, y: 64, scale: 1 },
  { x: 72, y: 60, scale: 0.95 },
  { x: 96, y: 64, scale: 0.9 },
  { x: 60, y: 52, scale: 0.85 },
];

/** AI ボット配置（配布人数に応じてずらす）。 */
const AI_BOT_SLOTS: readonly { x: number; y: number; scale: number }[] = [
  { x: 104, y: 70, scale: 0.9 },
  { x: 118, y: 58, scale: 0.8 },
  { x: 90, y: 52, scale: 0.75 },
];

function deskTone(health: OrgIslandPlan['team']['health']): string {
  if (health === 'reviewHell') return VISUAL_TOKENS.colors.department.floorHell;
  return VISUAL_TOKENS.colors.department.floorWarn;
}

export function OrgTeamActor({ island }: { island: OrgIslandPlan }) {
  const { team, mood } = island;
  const desk = deskTone(team.health);
  const deskSide = team.health === 'reviewHell' ? '#30192e' : '#2b2050';
  const deskDark = team.health === 'reviewHell' ? '#221320' : '#1f1742';
  const screenColor = team.health === 'reviewHell' ? '#ff6a4a' : '#3fb6ff';
  const deskColors = VISUAL_TOKENS.colors.actor.desk;
  const workers = islandWorkerCount(team.engineers);
  const aiBots = islandAiBotCount(team.aiAssignedCount);
  const showFire = team.incidents > 0;
  const showAiPile = team.aiDependency >= 80;

  return (
    <svg
      className={`org-team-actor health-${team.health}${team.isPlayer ? ' is-player' : ''}`}
      width="150"
      height="125"
      viewBox="0 0 150 125"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`aip-${team.id}`} cx="0.35" cy="0.28" r="0.8">
          <stop offset="0" stopColor="#e6d6ff" />
          <stop offset="1" stopColor={VISUAL_TOKENS.colors.task.ai} />
        </radialGradient>
      </defs>
      <ellipse cx="70" cy="104" rx="46" ry="14" fill="#0b0712" opacity=".30" />
      <polygon
        points="44,92 70,79 96,92 70,105"
        fill={desk}
        stroke={team.health === 'reviewHell' ? '#73436b' : '#564897'}
        strokeWidth="1.2"
      />
      <polygon points="44,92 70,105 70,113 44,100" fill={deskSide} />
      <polygon points="70,105 96,92 96,100 70,113" fill={deskDark} />
      {WORKER_SLOTS.slice(0, workers).map((slot, i) => (
        <Worker
          key={i}
          x={slot.x}
          y={slot.y}
          scale={slot.scale}
          {...WORKER_PALETTE[i % WORKER_PALETTE.length]}
          mood={mood}
          assetId={orgAssetForSlot(i)}
        />
      ))}
      {AI_BOT_SLOTS.slice(0, aiBots).map((slot, i) => (
        <AiBot key={`ai-${i}`} x={slot.x} y={slot.y} scale={slot.scale} />
      ))}
      <polygon points="40,86 70,71 100,86 70,101" fill={deskColors.woodTop} />
      <polygon points="40,86 70,101 70,112 40,97" fill={deskColors.woodLeft} />
      <polygon points="70,101 100,86 100,97 70,112" fill={deskColors.woodRight} />
      <rect x="38" y="86" width="2.6" height="15" fill={deskColors.leg} />
      <rect x="98" y="86" width="2.6" height="15" fill={deskColors.leg} />
      <rect x="68" y="101" width="2.6" height="15" fill={deskColors.leg} />
      <polygon points="58,80 70,74 82,80 70,86" fill="#0e1430" />
      <polygon points="58,80 70,86 70,76 58,70" fill="#1b2350" />
      <polygon points="70,86 82,80 82,70 70,76" fill="#11183a" />
      <polygon points="61,79 70,75 70,82 61,86" fill={screenColor} opacity=".9" />
      {showAiPile && (
        <g opacity=".5" fill={VISUAL_TOKENS.colors.flow.normal}>
          <circle cx="44" cy="44" r="6" />
          <circle cx="52" cy="35" r="8" />
          <circle cx="62" cy="29" r="5" />
        </g>
      )}
      {showAiPile && (
        <>
          <circle cx="96" cy="84" r="6" fill={`url(#aip-${team.id})`} />
          <circle cx="108" cy="82" r="6" fill={`url(#aip-${team.id})`} />
          <circle cx="102" cy="74" r="6" fill={`url(#aip-${team.id})`} />
        </>
      )}
      {showFire && (
        <text x="100" y="56" fontSize="15">
          🔥
        </text>
      )}
    </svg>
  );
}

export function OrgIslandBadge({ island }: { island: OrgIslandPlan }) {
  const { badge } = island;
  return (
    <div className={`org-island-badge tone-${badge.tone}`}>
      <strong>{badge.title}</strong>
      <span className="org-island-meta">
        {badge.shipping} ／ {badge.ai} ／ {badge.headcount}
      </span>
      <span className="org-island-tag">{badge.tag}</span>
    </div>
  );
}
