/**
 * スプリントリザルト画面（SPEC 第4.6）。
 *
 * Done / Delivered / Max Combo / AI Assisted / Review Queue Max / Rework /
 * Incidents / Senior HP / Interventions と、評価・診断・称号を表示する。
 */
import { rankLabel } from '../sim/member';
import type { GrowthOutcome } from '../sim/run/types';
import type { SprintResult } from '../sim/types';

interface Row {
  label: string;
  value: string;
}

function buildRows(result: SprintResult): Row[] {
  return [
    { label: 'Done', value: `${result.done} tasks` },
    { label: 'Delivered', value: `${result.delivered} pt` },
    { label: 'Max Combo', value: `x${result.maxCombo}` },
    { label: 'AI Assisted', value: `${result.aiAssistedPct}%` },
    { label: 'Review Queue Max', value: `${result.reviewQueueMax} PR` },
    { label: 'Rework', value: `${result.rework} tasks` },
    {
      label: 'Incidents',
      value: `${result.incidents} (鎮火 ${result.contained} / 延焼 ${result.spread})`,
    },
    { label: 'Senior HP', value: `${result.seniorHpDelta}` },
    {
      label: 'Interventions',
      value: `${result.interventionsUsed} 回 / 集中力 ${result.focusSpent}`,
    },
  ];
}

export interface SprintResultScreenProps {
  result: SprintResult;
  /** 直近スプリントの個体成長（昇格・休職など。第12章）。省略時は表示しない。 */
  growth?: GrowthOutcome | null;
  /** 「次へ」: カードドラフトへ進む（第7章）。 */
  onContinue: () => void;
  /** 二次アクション（ランを中断してタイトルへ等）。省略時は表示しない。 */
  onAbandon?: () => void;
  continueLabel?: string;
  abandonLabel?: string;
}

/** 成長セクションに出す要素があるか（昇格・休職・レベルアップ）。 */
function hasGrowthNews(growth: GrowthOutcome): boolean {
  return (
    growth.promotions.length > 0 || growth.wentOnLeave.length > 0 || growth.leveledUp.length > 0
  );
}

export function SprintResultScreen({
  result,
  growth,
  onContinue,
  onAbandon,
  continueLabel = 'カードドラフトへ →',
  abandonLabel = 'タイトルへ',
}: SprintResultScreenProps) {
  return (
    <div
      className="result-overlay"
      data-testid="sprint-result"
      role="dialog"
      aria-label="Sprint Result"
    >
      <div className="result-card">
        <p className="result-eyebrow">SPRINT RESULT</p>
        <div className={`result-grade grade-${result.grade}`} data-testid="result-grade">
          {result.grade}
        </div>
        <dl className="result-rows">
          {buildRows(result).map((row) => (
            <div className="result-row" key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="result-diagnosis">
          <p className="result-section-label">診断</p>
          <p>{result.diagnosis}</p>
        </div>
        <div className="result-title">
          <p className="result-section-label">称号</p>
          <p className="result-title-value" data-testid="result-title">
            「{result.title}」
          </p>
        </div>
        {growth && hasGrowthNews(growth) && (
          <div className="result-growth" data-testid="result-growth">
            <p className="result-section-label">チームの動き</p>
            <ul className="growth-list">
              {growth.promotions.map((p) => (
                <li key={`p-${p.id}`} className="growth-promote">
                  🎉 {p.name} が{rankLabel(p.to)}に昇格
                </li>
              ))}
              {growth.wentOnLeave.map((w) => (
                <li key={`l-${w.id}`} className="growth-leave">
                  😴 {w.name} が休職に入った
                </li>
              ))}
              {growth.leveledUp.length > 0 && growth.promotions.length === 0 && (
                <li className="growth-level">💪 {growth.leveledUp.length}人がレベルアップ</li>
              )}
            </ul>
          </div>
        )}
        <div className="result-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onContinue}
            data-testid="result-continue"
          >
            {continueLabel}
          </button>
          {onAbandon && (
            <button type="button" className="btn" onClick={onAbandon} data-testid="result-restart">
              {abandonLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
