/**
 * ステータス HUD（SPEC 第4.2 / mockups/main-screen 準拠）。
 *
 * 出荷ポイント・開発速度・レビュー耐性・品質・シニア体力・AI依存度・
 * 技術的負債・士気を表示し、炎上リスクをチップで示す。
 */
import { deriveStatus, type Grade } from '../render/status';
import type { SimState } from '../sim/types';

function GradeValue({ grade }: { grade: Grade }) {
  return <span className={`v grade grade-${grade}`}>{grade}</span>;
}

export interface HudProps {
  state: SimState;
}

export function Hud({ state }: HudProps) {
  const s = deriveStatus(state);
  return (
    <header className="hud" data-testid="hud">
      <div className="stat">
        <div className="k">出荷ポイント</div>
        <div className="v" data-testid="stat-delivery">
          {s.deliveryScore} <small>pt</small>
        </div>
      </div>
      <div className="stat">
        <div className="k">開発速度</div>
        <GradeValue grade={s.devSpeed} />
      </div>
      <div className="stat">
        <div className="k">レビュー耐性</div>
        <GradeValue grade={s.reviewCapacity} />
      </div>
      <div className="stat">
        <div className="k">品質</div>
        <GradeValue grade={s.quality} />
      </div>
      <div className="stat">
        <div className="k">シニア体力</div>
        <div className="v">
          {s.seniorHpPct}
          <small>%</small>
        </div>
        <div className="bar">
          <i className="fill-hp" style={{ width: `${s.seniorHpPct}%` }} />
        </div>
      </div>
      <div className="stat">
        <div className="k">AI依存度</div>
        <div className="v" data-testid="stat-ai-dependency">
          {s.aiDependencyPct}
          <small>%</small>
        </div>
        <div className="bar">
          <i className="fill-ai" style={{ width: `${s.aiDependencyPct}%` }} />
        </div>
      </div>
      <div className="stat">
        <div className="k">技術的負債</div>
        <div className="v">{s.techDebt}</div>
      </div>
      <div className="stat">
        <div className="k">士気</div>
        <div className="v">{s.morale}</div>
        <div className="bar">
          <i className="fill-mor" style={{ width: `${s.morale}%` }} />
        </div>
        <div className={`risk-chip risk-${s.risk}`} data-testid="risk">
          炎上 {s.risk}
        </div>
      </div>
    </header>
  );
}
