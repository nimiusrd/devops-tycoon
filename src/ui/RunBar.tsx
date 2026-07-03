/**
 * ラン情報バー（パンくず的ヘッダ）。
 *
 * seed・難易度・スプリント数・予算・進化ポイント・所持レリック・組織タイプ診断を
 * 常時表示し、ラン全体の文脈を示す（第4.7 のパンくずの簡易版）。
 */
import { getDifficulty } from '../data/difficulties';
import { getRelic } from '../data/relics';
import { formatRelicTooltip } from '../render/eventOutcomeView';
import { diagnosisView } from '../sim/diagnosis';
import { memberExpression, rosterSummary } from '../sim/member';
import type { MemberExpression } from '../sim/member/types';
import type { RunState } from '../sim/run/types';

export interface RunBarProps {
  state: RunState;
  /** 編成画面を開く（指定時のみ編成ボタンを表示）。 */
  onOpenFormation?: () => void;
  /** 全社マップへズームアウトする（指定時のみ全社ボタンを表示。第4.7）。 */
  onOpenOrg?: () => void;
}

/** 表情演出の絵文字（第12.2）。 */
const FACE: Record<MemberExpression, string> = {
  leave: '😴',
  tired: '😩',
  normal: '🙂',
  great: '💪',
};

export function RunBar({ state, onOpenFormation, onOpenOrg }: RunBarProps) {
  const diff = getDifficulty(state.difficulty);
  const diag = diagnosisView(state.diagnosis);
  const roster = rosterSummary(state.roster);
  return (
    <div className="subbar runbar" data-testid="runbar">
      <span className="pill" data-testid="seed">
        seed <b>{state.seed}</b>
      </span>
      <span className="pill" data-testid="difficulty">
        {diff.label.split(':')[0]}
      </span>
      <span className="pill" data-testid="sprint-no" title="当四半期のトラック進行（最終がボス）">
        スプリント{' '}
        <b>
          {Math.min(state.sprintIndexInQuarter, state.sprintsPerQuarter)}/{state.sprintsPerQuarter}
        </b>
        {state.sprintIndexInQuarter + 1 === state.sprintsPerQuarter && (
          <span className="boss-next"> ★次が山場</span>
        )}
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
              <span key={id} className="relic-chip" title={relic ? formatRelicTooltip(relic) : id}>
                🏛 {relic?.name}
              </span>
            );
          })
        )}
      </div>
      {onOpenFormation ? (
        <button
          type="button"
          className="pill roster-pill"
          data-testid="open-formation"
          onClick={onOpenFormation}
          title={`稼働 ${roster.active} / 休職 ${roster.onLeave}（コーダー${roster.coders}・レビュー${roster.reviewers}）`}
        >
          <span className="roster-faces" data-testid="roster-faces">
            {state.roster.members.map((m) => (
              <span key={m.id}>{FACE[memberExpression(m)]}</span>
            ))}
          </span>
          編成
        </button>
      ) : (
        <span className="pill" data-testid="roster-count">
          👥<b>{roster.active}</b>
          {roster.onLeave > 0 && <span className="roster-leave"> 😴{roster.onLeave}</span>}
        </span>
      )}
      <span className={`pill diagnosis diag-${state.diagnosis}`}>{diag.label}</span>
      {onOpenOrg && (
        <button
          type="button"
          className="pill org-pill"
          data-testid="open-org"
          onClick={onOpenOrg}
          title="全社マップへズームアウト（業界 ▸ 全社 ▸ 部署 ▸ 現場）"
        >
          🗺 全社
        </button>
      )}
    </div>
  );
}
