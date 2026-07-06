/**
 * 全社マップの共通基盤ハブ（サーバーラック + AI ボット）。
 * mockups/org-screen.html L271 準拠。
 */
import type { OrgHubPlan } from '../render/orgBoardScene';

export function OrgHubSvg() {
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
              fill={i === 0 ? '#57e08f' : i === 1 ? '#7bdcff' : '#ffd45c'}
            />
          ))}
        </g>
      ))}
      <g transform="translate(95,70) scale(1.15)">
        <line x1="0" y1="-12" x2="0" y2="-18" stroke="#b39dff" strokeWidth="2" />
        <circle cx="0" cy="-18" r="2.6" fill="#ffd45c" />
        <rect
          x="-13"
          y="-12"
          width="26"
          height="20"
          rx="7"
          fill="#eef0ff"
          stroke="#b9c4ff"
          strokeWidth="1.6"
        />
        <rect x="-9" y="-8" width="18" height="13" rx="4" fill="#1b2350" />
        <path
          d="M-6 -1 q2 -3 4 0"
          stroke="#7bdcff"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M2 -1 q2 -3 4 0"
          stroke="#7bdcff"
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

export function OrgHubLabel({
  hub,
  pctX,
  pctY,
}: {
  hub: OrgHubPlan;
  pctX: (v: number) => string;
  pctY: (v: number) => string;
}) {
  return (
    <div
      className={`org-hub-badge tone-${hub.tone}`}
      data-testid="org-infra-hub"
      style={{ left: pctX(hub.labelX), top: pctY(hub.labelY) }}
      title="共通基盤ハブ（全チームへ波及）"
    >
      <span aria-hidden>🛠</span>
      <span>Platform / 共通基盤</span>
      <span className="org-hub-meta">
        CI {hub.ci} / Docs {hub.docs} / AI {hub.aiGuideline}
      </span>
    </div>
  );
}
