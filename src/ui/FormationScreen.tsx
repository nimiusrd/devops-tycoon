/**
 * 編成画面（SPEC 第12章 / MVP4）。
 *
 * 個体メンバーを「どのレーンに置くか」「誰に AI を配るか」で編成する戦術 UI。
 * ステータス・トレイト・スタミナ・表情（疲れ顔 / ガッツポーズ等）を表示し、
 * 配置と AI 配布を切り替える。状態は読むだけ（第22.2）で、操作は window.game 経由。
 */
import { getTrait } from '../data/traits';
import { memberExpression, rankLabel, xpForLevel } from '../sim/member';
import type { LaneAssignment, Member, MemberExpression } from '../sim/member/types';
import type { RunState } from '../sim/run/types';

export interface FormationScreenProps {
  state: RunState;
  onAssign: (id: string, assignment: LaneAssignment) => void;
  onToggleAi: (id: string, on: boolean) => void;
  onClose: () => void;
}

/** 表情演出の絵文字（第12.2: 疲れ顔 / ガッツポーズ等）。 */
const EXPRESSION_EMOJI: Record<MemberExpression, string> = {
  leave: '😴',
  tired: '😩',
  normal: '🙂',
  great: '💪',
};

const EXPRESSION_LABEL: Record<MemberExpression, string> = {
  leave: '休職中',
  tired: 'お疲れ',
  normal: '平常',
  great: '絶好調',
};

const LANES: { id: LaneAssignment; label: string }[] = [
  { id: 'coding', label: 'コーディング' },
  { id: 'review', label: 'レビュー' },
  { id: 'bench', label: 'ベンチ' },
];

function MemberCard({
  m,
  locked,
  onAssign,
  onToggleAi,
}: {
  m: Member;
  locked: boolean;
  onAssign: (id: string, assignment: LaneAssignment) => void;
  onToggleAi: (id: string, on: boolean) => void;
}) {
  const expr = memberExpression(m);
  const staminaPct = m.staminaMax > 0 ? Math.round((m.stamina / m.staminaMax) * 100) : 0;
  const xpNeed = xpForLevel(m.level);
  return (
    <div
      className={`formation-member${m.onLeave ? ' on-leave' : ''}`}
      data-testid={`formation-member-${m.id}`}
    >
      <div className="fm-head">
        <span className="fm-face" title={EXPRESSION_LABEL[expr]} data-testid={`face-${m.id}`}>
          {EXPRESSION_EMOJI[expr]}
        </span>
        <div className="fm-id">
          <span className="fm-name">{m.name}</span>
          <span className="fm-rank">
            {rankLabel(m.rank)} ・ Lv{m.level}
          </span>
        </div>
      </div>

      <div className="fm-stats">
        <span title="実装力">🛠 {Math.round(m.stats.implementation)}</span>
        <span title="レビュー力">🔍 {Math.round(m.stats.review)}</span>
        <span title="AI習熟">🤖 {Math.round(m.stats.aiMastery)}</span>
      </div>

      <div className="fm-bar" title={`スタミナ ${m.stamina}/${m.staminaMax}`}>
        <span className="fm-bar-label">スタミナ</span>
        <div className="fm-bar-track">
          <div
            className={`fm-bar-fill${staminaPct < 25 ? ' low' : ''}`}
            style={{ width: `${staminaPct}%` }}
          />
        </div>
      </div>
      <div className="fm-xp" title={`次のレベルまで ${m.xp}/${xpNeed}`}>
        XP {m.xp}/{xpNeed}
      </div>

      {m.traits.length > 0 && (
        <div className="fm-traits">
          {m.traits.map((t) => (
            <span key={t} className="fm-trait" title={getTrait(t)?.description}>
              {getTrait(t)?.name}
            </span>
          ))}
        </div>
      )}

      {m.onLeave ? (
        <p className="fm-leave-note">休職中。スタミナが戻れば復帰します。</p>
      ) : (
        <>
          <div className="fm-lanes" role="group" aria-label="配置">
            {LANES.map((lane) => (
              <button
                key={lane.id}
                type="button"
                className={`fm-lane${m.assignment === lane.id ? ' active' : ''}`}
                data-testid={`assign-${m.id}-${lane.id}`}
                disabled={locked}
                onClick={() => onAssign(m.id, lane.id)}
              >
                {lane.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`fm-ai${m.aiAssigned ? ' on' : ''}`}
            data-testid={`ai-${m.id}`}
            disabled={locked || m.assignment !== 'coding'}
            title={m.assignment !== 'coding' ? 'AIはコーディング担当にのみ配れます' : undefined}
            onClick={() => onToggleAi(m.id, !m.aiAssigned)}
          >
            {m.aiAssigned ? '🤖 AI配布中' : 'AIを配る'}
          </button>
        </>
      )}
    </div>
  );
}

export function FormationScreen({ state, onAssign, onToggleAi, onClose }: FormationScreenProps) {
  const locked = state.phase === 'sprint';
  return (
    <div className="result-overlay" data-testid="formation" role="dialog" aria-label="Formation">
      <div className="formation-panel">
        <div className="formation-head">
          <div>
            <p className="result-eyebrow">FORMATION</p>
            <h2 className="draft-title">編成 — 誰をどこに置き、AIを誰に配るか</h2>
          </div>
          <button
            type="button"
            className="formation-close"
            data-testid="formation-close"
            onClick={onClose}
          >
            閉じる
          </button>
        </div>
        {locked && <p className="fm-locked-note">スプリント中は編成を変更できません。</p>}
        <div className="formation-grid">
          {state.roster.members.map((m) => (
            <MemberCard
              key={m.id}
              m={m}
              locked={locked}
              onAssign={onAssign}
              onToggleAi={onToggleAi}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
