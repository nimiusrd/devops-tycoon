/**
 * 採用フェーズ画面（RI-26 の専用採用ビート）。
 *
 * 予算を払ってメンバーを1人迎えるか、見送るかを選ぶ。
 * 見送りは recruit-offer 見送りと同コスト（士気低下）を課す。
 */
import { useState } from 'react';
import { RECRUIT_SKIP_MORALE } from '../data/events';
import { canRecruit, RECRUIT_COST } from '../sim/member';
import { formatRestOptionTags } from '../render/eventOutcomeView';
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
            subject="メンバーの採用"
            balanceAfter={hireRisk.balanceAfter}
            onConfirm={() => onChoose('hire')}
            onCancel={() => setConfirmingHire(false)}
          />
        ) : null}
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
