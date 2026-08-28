/**
 * 全社マップの共通基盤ハブ（サーバーラック + AI ボット）。
 * レイアウトは旧モック org-screen（git 履歴の mockups/）由来。
 */
import type { OrgHubPlan } from '../render/orgBoardScene';
import { VISUAL_TOKENS } from '../render/visualTokens';

export function OrgHubSvg() {
  const bot = VISUAL_TOKENS.colors.aiBot;
  return (
    <svg
      className="org-hub-actor"
      width="200"
      height="165"
      viewBox="0 0 190 160"
      aria-hidden="true"
    >
      <ellipse cx="95" cy="120" rx="78" ry="20" fill="#0b0712" opacity=".34" />
      <polygon
        points="30,104 95,72 160,104 95,136"
        fill="#2f3c47"
        stroke="#4a656f"
        strokeWidth="1.5"
      />
      <polygon points="30,104 95,136 95,148 30,116" fill="#212c34" />
      <polygon points="95,136 160,104 160,116 95,148" fill="#171e24" />
      {[55, 70, 85].map((x, i) => (
        <g key={`rack-${i}`}>
          <polygon points={`${x - 15},96 ${x},88.5 ${x + 15},96 ${x},103.5`} fill="#3a3f66" />
          <polygon points={`${x - 15},96 ${x},103.5 ${x},145.5 ${x - 15},138`} fill="#23263f" />
          <polygon points={`${x},103.5 ${x + 15},96 ${x + 15},138 ${x},145.5`} fill="#181a2c" />
          {[106, 109, 116, 119, 126, 129].map((cy, j) => (
            <circle
              key={j}
              cx={x - 6}
              cy={cy}
              r="1.6"
              fill={
                i === 0
                  ? VISUAL_TOKENS.colors.department.glowHealthy
                  : i === 1
                    ? bot.eye
                    : bot.indicator
              }
            />
          ))}
        </g>
      ))}
      <g transform="translate(95,70) scale(1.15)">
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
      <text x="40" y="118" fontSize="13">
        📚
      </text>
      <text x="138" y="120" fontSize="13">
        ✅
      </text>
    </svg>
  );
}

/** 盤面の外に置く共通基盤ハブ。DOM/Pixi とも同じ値と tone を残す（DS-05 / DS-06）。 */
export function OrgInfraHubPill({
  ci,
  docs,
  aiGuideline,
  tone,
}: {
  ci: number;
  docs: number;
  aiGuideline: number;
  tone: OrgHubPlan['tone'];
}) {
  const warn = tone === 'warn';
  return (
    <div
      className={`org-infra-hub tone-${tone}`}
      data-testid="org-infra-hub"
      data-tone={tone}
      title={warn ? '共通基盤ハブ（CI が低下しています）' : '共通基盤ハブ（全チームへ波及）'}
    >
      <span aria-hidden>🛰</span>
      <span className="org-infra-title">共通基盤</span>
      {warn ? <span className="org-infra-warn">注意</span> : null}
      <span className="org-infra-meta">
        CI {ci} / Docs {docs} / AI {aiGuideline}
      </span>
    </div>
  );
}
