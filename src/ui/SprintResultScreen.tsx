/**
 * スプリントリザルト画面（SPEC 第4.6）。
 *
 * Done / Delivered / Max Combo / AI Assisted / Review Queue Max / Rework /
 * Incidents / Senior HP / 介入 と、評価・診断・称号を表示する。
 */
import { getAction } from '../data/actions';
import { planBaselineComparison } from '../render/sprintBaselineComparison';
import { planInterventionAnalysis } from '../render/sprintInterventionAnalysis';
import { rankLabel } from '../sim/member';
import type { GrowthOutcome } from '../sim/run/types';
import type { ActionId, SprintResult } from '../sim/types';
import { SprintTimelineChart } from './SprintTimelineChart';

interface Row {
  label: string;
  value: string;
}

/** 介入内訳（例: 割り込みレビュー×3 / 緊急対応×1）。未介入なら「なし」（第4.6）。 */
function interventionSummary(result: SprintResult): string {
  const parts = (Object.entries(result.actionCounts) as [ActionId, number][])
    .filter(([, count]) => count > 0)
    .map(([id, count]) => `${getAction(id)?.label ?? id}×${count}`);
  return parts.length > 0 ? parts.join(' / ') : 'なし';
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
    { label: '介入', value: interventionSummary(result) },
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
  const analysis = planInterventionAnalysis(result);
  const baselineComparison = planBaselineComparison(result);

  return (
    <div
      className="result-overlay"
      data-testid="sprint-result"
      role="dialog"
      aria-label="Sprint Result"
    >
      <div className="result-card sprint-result-card">
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
        <SprintTimelineChart timeline={result.timeline} events={result.events} />
        {analysis.showSection && (
          <div className="result-intervention-analysis" data-testid="result-intervention-analysis">
            <p className="result-section-label">介入分析</p>
            <dl className="result-rows result-analysis-rows">
              {analysis.rows.map((row) => (
                <div className="result-row" key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className="result-analysis-tip" data-testid="result-intervention-tip">
              💡 {analysis.tip}
            </p>
          </div>
        )}
        {baselineComparison.showSection && (
          <div className="result-baseline-comparison" data-testid="result-baseline-comparison">
            <p className="result-section-label">介入の成果</p>
            <p className="result-baseline-caption">介入なしの見込み → 実績</p>
            <dl className="result-rows result-baseline-rows">
              {baselineComparison.rows.map((row) => (
                <div
                  className="result-row result-baseline-row"
                  data-testid={`result-baseline-row-${row.key}`}
                  key={row.key}
                >
                  <dt>{row.label}</dt>
                  <dd>
                    <span className="result-baseline-values">
                      {row.baseline} → {row.actual}
                    </span>
                    <strong className={`result-baseline-delta baseline-delta-${row.tone}`}>
                      {row.delta}
                    </strong>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="result-baseline-disclaimer" data-testid="result-baseline-disclaimer">
              {baselineComparison.disclaimer}
            </p>
          </div>
        )}
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
