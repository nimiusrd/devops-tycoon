/**
 * 編成（Setup）画面（run-loop-redesign §5.4）。
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
}

export function SetupScreen({ state, onAssign, onToggleAi, onBegin }: SetupScreenProps) {
  const boss = getBoss(state.bossId);
  const total = state.sprintsPerQuarter;
  const nextIndex = state.sprintIndexInQuarter + 1;
  return (
    <div className="run-setup" data-testid="setup">
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
          </div>
          <button
            type="button"
            className="primary-button"
            data-testid="begin-sprint"
            onClick={onBegin}
          >
            スプリント開始 ▶
          </button>
        </div>
        <FormationGrid state={state} onAssign={onAssign} onToggleAi={onToggleAi} />
      </div>
    </div>
  );
}
