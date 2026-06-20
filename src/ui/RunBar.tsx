/**
 * ラン情報バー（パンくず的ヘッダ）。
 *
 * seed・難易度・スプリント数・予算・進化ポイント・所持レリック・組織タイプ診断を
 * 常時表示し、ラン全体の文脈を示す（第4.7 のパンくずの簡易版）。
 */
import { getDifficulty } from '../data/difficulties';
import { getRelic } from '../data/relics';
import { diagnosisView } from '../sim/diagnosis';
import type { RunState } from '../sim/run/types';

export interface RunBarProps {
  state: RunState;
}

export function RunBar({ state }: RunBarProps) {
  const diff = getDifficulty(state.difficulty);
  const diag = diagnosisView(state.diagnosis);
  return (
    <div className="subbar runbar" data-testid="runbar">
      <span className="pill" data-testid="seed">
        seed <b>{state.seed}</b>
      </span>
      <span className="pill" data-testid="difficulty">
        {diff.label.split(':')[0]}
      </span>
      <span className="pill" data-testid="sprint-no">
        スプリント <b>{state.sprintsPlayed}</b>
      </span>
      <span className="pill" data-testid="budget">
        💰<b>{state.budget}</b>
      </span>
      <span className="pill" data-testid="evo-points-bar">
        ⭐<b>{state.evolution.points}</b>
      </span>
      <div className="relic-bar" data-testid="relics">
        {state.relics.length === 0 ? (
          <span className="relic-empty">レリックなし</span>
        ) : (
          state.relics.map((id) => {
            const relic = getRelic(id);
            return (
              <span key={id} className="relic-chip" title={relic?.description}>
                🏛 {relic?.name}
              </span>
            );
          })
        )}
      </div>
      <span className={`pill diagnosis diag-${state.diagnosis}`}>{diag.label}</span>
    </div>
  );
}
