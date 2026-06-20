/**
 * スプリントリザルト画面（SPEC 第4.6）。
 *
 * Done / Delivered / Max Combo / AI Assisted / Review Queue Max / Rework /
 * Incidents / Senior HP と、評価・診断・称号を表示する。
 */
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
  ];
}

export interface SprintResultScreenProps {
  result: SprintResult;
  aiEnabled: boolean;
  onRestart: () => void;
  /** 「次へ」: カードドラフトへ進む（第7章）。 */
  onContinue: () => void;
}

export function SprintResultScreen({
  result,
  aiEnabled,
  onRestart,
  onContinue,
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
        <div className="result-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onContinue}
            data-testid="result-continue"
          >
            カードドラフトへ →
          </button>
          <button type="button" className="btn" onClick={onRestart} data-testid="result-restart">
            もう一度（{aiEnabled ? 'AIあり' : 'AIなし'}）
          </button>
        </div>
      </div>
    </div>
  );
}
