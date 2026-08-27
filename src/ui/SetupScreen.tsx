/**
 * 編成（Setup）画面（SPEC 第3章 基本ループ / 第4.4）。
 *
 * 第1スプリント前、各スプリント間、ショップ/休息後・次四半期開始時の編成ウィンドウ。
 * いきなり盤面を走らせず、メンバー配置・AI 配布を確定してからスプリントを開始する。
 * 高負荷（elite）予定はバナーで明示する（RI-77）。
 * 今四半期の OKR はコンパクト表示する（RI-129）。詳細な目標値は四半期レビューが正。
 * 既存の編成グリッド（FormationGrid）を流用する。
 */
import { getBoss } from '../data/bosses';
import { nextSprintIndexInQuarter } from '../render/sprintProgressView';
import type { LaneAssignment } from '../sim/member/types';
import type { RunState } from '../sim/run/types';
import { DeckBar } from './DeckBar';
import { FormationGrid } from './FormationScreen';
import { QuarterOkr } from './QuarterOkr';

export interface SetupScreenProps {
  state: RunState;
  onAssign: (id: string, assignment: LaneAssignment) => void;
  onToggleAi: (id: string, on: boolean) => void;
  onBegin: () => void;
  /** リプレイ閲覧など、操作を受け付けないとき。 */
  readOnly?: boolean;
}

export function SetupScreen({
  state,
  onAssign,
  onToggleAi,
  onBegin,
  readOnly = false,
}: SetupScreenProps) {
  const boss = getBoss(state.bossId);
  const total = state.sprintsPerQuarter;
  const nextIndex = nextSprintIndexInQuarter(state.sprintIndexInQuarter, total);
  // launchSprint と同様、最終枠はインデックスからボスを決める（pending は normal のまま）。
  const bossPending = state.pendingSprintKind === 'boss' || nextIndex >= total;
  const elitePending = !bossPending && state.pendingSprintKind === 'elite';
  return (
    <div className="run-setup" data-testid="setup" data-readonly={readOnly ? 'true' : undefined}>
      <div className="map-banner">
        <span className="pill">第{state.quarterNumber}四半期</span>
        <span className="pill">
          次: スプリント {nextIndex} / {total}
        </span>
        {elitePending ? (
          <span className="pill" data-testid="setup-elite-pending">
            高負荷案件
          </span>
        ) : null}
        {bossPending ? (
          <span className="pill" data-testid="setup-boss-pending">
            ボススプリント
          </span>
        ) : null}
        <b className="boss-name">★ {boss?.name ?? 'ボス'}</b>
        <span className="boss-desc">{boss?.description}</span>
      </div>
      <QuarterOkr variant="setup" bossId={state.bossId} goal={state.quarterGoal} />
      <div className="formation-panel">
        <div className="formation-head">
          <div>
            <p className="result-eyebrow">SETUP</p>
            <h2 className="draft-title">
              {bossPending
                ? '編成 — ボススプリントの前に配置とAIを決める'
                : elitePending
                  ? '編成 — 高負荷スプリントの前に配置とAIを決める'
                  : '編成 — スプリント開始前に配置とAIを決める'}
            </h2>
            <p className="formation-setup-hint">
              {bossPending
                ? '次はボス。四半期の締めくくりなので、AI 配布と配置をこのタイミングで見直そう。'
                : elitePending
                  ? '次は高負荷案件。出荷は大きいが渋滞・炎上リスクも高い。AI 配布と配置をこのタイミングで見直そう。'
                  : 'AI は配った相手の習熟で効き方が変わる。広げすぎると依存と手戻りが積み上がるので、誰に配るかこのタイミングで見直そう。'}
            </p>
          </div>
          <button
            type="button"
            className="primary-button"
            data-testid="begin-sprint"
            disabled={readOnly}
            onClick={onBegin}
          >
            スプリント開始 ▶
          </button>
        </div>
        <FormationGrid
          state={state}
          onAssign={onAssign}
          onToggleAi={onToggleAi}
          readOnly={readOnly}
        />
        {readOnly ? <DeckBar deck={state.deck} /> : null}
      </div>
    </div>
  );
}
