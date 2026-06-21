/**
 * 休息ノード画面（SPEC 第4.4 の ☾ノード）。
 *
 * シニアHP+個体スタミナ回復 / 技術的負債返済 / カード強化 / 採用 のいずれかを選ぶ。
 */
import { canRecruit, RECRUIT_COST } from '../sim/member';
import type { RunState } from '../sim/run/types';

export interface RestScreenProps {
  state: RunState;
  onChoose: (option: 'heal' | 'repay' | 'upgrade' | 'recruit') => void;
}

export function RestScreen({ state, onChoose }: RestScreenProps) {
  const canUpgrade = state.deck.length > 0;
  const rosterHasRoom = canRecruit(state.roster);
  const canAfford = state.budget >= RECRUIT_COST;
  const canHire = rosterHasRoom && canAfford;
  return (
    <div className="result-overlay" data-testid="rest" role="dialog" aria-label="Rest">
      <div className="rest-panel">
        <p className="result-eyebrow">REST</p>
        <h2 className="draft-title">小休止。組織を整える。</h2>
        <div className="rest-options">
          <button
            type="button"
            className="rest-option"
            data-testid="rest-heal"
            onClick={() => onChoose('heal')}
          >
            <span className="rest-icon">🛌</span>
            <span className="rest-name">チームを休ませる</span>
            <span className="rest-desc">
              シニア体力とメンバーのスタミナを回復し、士気も少し上がる
            </span>
          </button>
          <button
            type="button"
            className="rest-option"
            data-testid="rest-repay"
            onClick={() => onChoose('repay')}
          >
            <span className="rest-icon">🧹</span>
            <span className="rest-name">技術的負債を返済</span>
            <span className="rest-desc">Tech Debt を一部返済する</span>
          </button>
          <button
            type="button"
            className="rest-option"
            data-testid="rest-upgrade"
            disabled={!canUpgrade}
            onClick={() => onChoose('upgrade')}
          >
            <span className="rest-icon">🔧</span>
            <span className="rest-name">施策を強化</span>
            <span className="rest-desc">
              {canUpgrade ? 'デッキのカードを1段強化する' : 'デッキが空です'}
            </span>
          </button>
          <button
            type="button"
            className="rest-option"
            data-testid="rest-recruit"
            disabled={!canHire}
            onClick={() => onChoose('recruit')}
          >
            <span className="rest-icon">🙋</span>
            <span className="rest-name">メンバーを採用（💰{RECRUIT_COST}）</span>
            <span className="rest-desc">
              {!rosterHasRoom
                ? 'ロスターが満員です'
                : !canAfford
                  ? `予算が足りません（💰${RECRUIT_COST} 必要）`
                  : '未来の主力候補を1人迎える（ベンチに加わる）'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
