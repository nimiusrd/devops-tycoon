/**
 * 編成（Setup）画面（SPEC 第3章 基本ループ / 第4.4）。
 *
 * 第1スプリント前、およびショップ/休息後・次四半期開始時の編成ウィンドウ。
 * いきなり盤面を走らせず、メンバー配置・AI 配布を確定してからスプリントを開始する。
 * 既存の編成グリッド（FormationGrid）を流用する。
 */
import { getBoss } from '../data/bosses';
import type { LaneAssignment } from '../sim/member/types';
import type { RunState } from '../sim/run/types';
import { FormationGrid } from './FormationScreen';

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
  const nextIndex = state.sprintIndexInQuarter + 1;
  return (
    <div className="run-setup" data-testid="setup" data-readonly={readOnly ? 'true' : undefined}>
      <div className="map-banner">
        <span className="pill">第{state.quarterNumber}四半期</span>
        <span className="pill">
          次: スプリント {nextIndex} / {total}
        </span>
        <b className="boss-name">★ {boss?.name ?? 'ボス'}</b>
        <span className="boss-desc">{boss?.description}</span>
      </div>
      <div className="formation-panel">
        <div className="formation-head">
          <div>
            <p className="result-eyebrow">SETUP</p>
            <h2 className="draft-title">編成 — スプリント開始前に配置とAIを決める</h2>
            <p className="formation-setup-hint">
              AI
              は配った相手の習熟で効き方が変わる。広げすぎると依存と手戻りが積み上がるので、誰に配るかこのタイミングで見直そう。
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
      </div>
    </div>
  );
}
