/**
 * 採用フェーズ画面（RI-26 の専用採用ビート）。
 *
 * 予算を払ってメンバーを1人迎えるか、見送るかを選ぶ。
 * 見送りは recruit-offer 見送りと同コスト（士気低下）を課す。
 */
import { useState } from 'react';
import { RECRUIT_SKIP_MORALE } from '../data/events';
import { getTrait } from '../data/traits';
import { canRecruit, rankLabel, RECRUIT_COST, type Member } from '../sim/member';
import { formatRestOptionTags } from '../render/eventOutcomeView';
import { recruitCandidateView } from '../render/recruitCandidateView';
import { spendRiskView, spendStatusText } from '../render/spendRiskView';
import type { RunState } from '../sim/run/types';
import { EffectTagList } from './EffectTagList';
import { SpendConfirm } from './SpendConfirm';

export interface RecruitScreenProps {
  state: RunState;
  onChoose: (option: 'hire' | 'skip') => void;
}

export function RecruitScreen({ state, onChoose }: RecruitScreenProps) {
  const [confirmingHire, setConfirmingHire] = useState(false);
  const [comparisonId, setComparisonId] = useState(state.roster.members[0]?.id ?? '');
  const candidate = recruitCandidateView(state);
  const comparison = state.roster.members.find((member) => member.id === comparisonId);
  const rosterHasRoom = canRecruit(state.roster);
  const hireRisk = spendRiskView({
    budget: state.budget,
    cost: RECRUIT_COST,
    rosterFull: !rosterHasRoom,
  });
  const canHire = hireRisk.blocked === null;
  const hireReady = '未来の主力候補を1人迎える（ベンチに加わる）';
  const requestHire = () => {
    if (!canHire) return;
    if (hireRisk.requiresConfirm) {
      setConfirmingHire(true);
      return;
    }
    onChoose('hire');
  };
  return (
    <div className="result-overlay" data-testid="recruit" role="dialog" aria-label="Recruit">
      <div className="rest-panel">
        <p className="result-eyebrow">RECRUIT</p>
        <h2 className="draft-title">採用面接。誰を迎えるか。</h2>
        {confirmingHire ? (
          <SpendConfirm
            subject={`${candidate?.member.name ?? 'メンバー'}の採用`}
            balanceAfter={hireRisk.balanceAfter}
            returnTestId="recruit-hire"
            onConfirm={() => onChoose('hire')}
            onCancel={() => setConfirmingHire(false)}
          />
        ) : null}
        {candidate ? (
          <section className="recruit-preview" aria-label="採用候補と在籍メンバーの比較">
            <div className="formation-member" data-testid="recruit-candidate">
              <h3 className="recruit-heading">今回の候補</h3>
              <RecruitMemberSummary member={candidate.member} />
              {candidate.sample && (
                <div className="recruit-sample" data-testid="recruit-work-sample">
                  <h4 className="recruit-heading">仕事の例</h4>
                  <p>{candidate.sample.example}</p>
                  <p>{candidate.sample.placement}</p>
                </div>
              )}
              <p className="recruit-note">
                能力と特性をもとにした例です。成果を保証するものではありません。採用後はベンチに加わります。
              </p>
            </div>
            {state.roster.members.length > 0 && (
              <details className="recruit-comparison">
                <summary>在籍メンバーと比較する</summary>
                <label className="recruit-compare-label">
                  比較するメンバー
                  <select
                    value={comparisonId}
                    onChange={(event) => setComparisonId(event.target.value)}
                    data-testid="recruit-compare-select"
                  >
                    {state.roster.members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
                {comparison && (
                  <div className="formation-member" data-testid="recruit-comparison-member">
                    <RecruitMemberSummary member={comparison} />
                  </div>
                )}
                <p className="recruit-note">
                  基礎能力の比較です。実際の寄与はランク・特性・配置でも変わります。
                </p>
              </details>
            )}
          </section>
        ) : (
          <p className="event-prompt">ロスターが満員のため、候補を迎える空き枠がありません。</p>
        )}
        <div className="rest-options">
          <button
            type="button"
            className={`rest-option${hireRisk.endsRun ? ' is-spend-risk' : ''}`}
            data-testid="recruit-hire"
            disabled={!canHire}
            onClick={requestHire}
          >
            <span className="rest-icon">🙋</span>
            <div className="rest-body">
              <span className="rest-name">メンバーを採用（💰{RECRUIT_COST}）</span>
              <EffectTagList tags={formatRestOptionTags('recruit')} testId="recruit-tags-hire" />
              <span className="rest-desc">
                {spendStatusText(
                  hireRisk,
                  hireReady,
                  hireRisk.blocked === 'rosterFull' ? 'ロスターが満員です' : undefined,
                )}
              </span>
            </div>
          </button>
          <button
            type="button"
            className="rest-option"
            data-testid="recruit-skip"
            disabled={confirmingHire}
            onClick={() => onChoose('skip')}
          >
            <span className="rest-icon">🚪</span>
            <div className="rest-body">
              <span className="rest-name">見送る</span>
              <EffectTagList
                tags={[{ label: `士気 ${RECRUIT_SKIP_MORALE}`, tone: 'negative' }]}
                testId="recruit-tags-skip"
              />
              <span className="rest-desc">採用せず編成へ戻る（現場の期待を少し下げる）</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function RecruitMemberSummary({ member }: { member: Member }) {
  return (
    <>
      <div className="fm-id">
        <span className="fm-name">{member.name}</span>
        <span className="fm-rank">
          {rankLabel(member.rank)} ・ Lv{member.level}
        </span>
      </div>
      <dl className="recruit-stats">
        <div>
          <dt>実装力</dt>
          <dd>{Math.round(member.stats.implementation)}</dd>
        </div>
        <div>
          <dt>レビュー力</dt>
          <dd>{Math.round(member.stats.review)}</dd>
        </div>
        <div>
          <dt>AI習熟</dt>
          <dd>{Math.round(member.stats.aiMastery)}</dd>
        </div>
        <div>
          <dt>スタミナ</dt>
          <dd>
            {member.stamina}/{member.staminaMax}
          </dd>
        </div>
      </dl>
      <ul className="recruit-traits">
        {member.traits.map((id) => (
          <li key={id}>
            <strong>{getTrait(id)?.name}</strong>：{getTrait(id)?.description}
          </li>
        ))}
        {member.traits.length === 0 && <li>特性なし</li>}
      </ul>
    </>
  );
}
