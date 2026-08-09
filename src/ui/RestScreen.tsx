/**
 * 休息ノード画面（SPEC 第4.4 の ☾ノード）。
 *
 * シニアHP+個体スタミナ回復 / 技術的負債返済 / カード強化 / 採用 のいずれかを選ぶ。
 */
import { useState } from 'react';
import { getCard } from '../data/cards';
import { canRecruit, RECRUIT_COST } from '../sim/member';
import { foldPassives } from '../sim/run/effects';
import type { RunState } from '../sim/run/types';
import { formatRestOptionTags } from '../render/eventOutcomeView';
import { CardView } from './CardView';
import { EffectTagList } from './EffectTagList';

export interface RestScreenProps {
  state: RunState;
  onChoose: (option: 'heal' | 'repay' | 'upgrade' | 'recruit', deckIndex?: number) => void;
}

export function RestScreen({ state, onChoose }: RestScreenProps) {
  const [choosingUpgrade, setChoosingUpgrade] = useState(false);
  const canUpgrade = state.deck.length > 0;
  const rosterHasRoom = canRecruit(state.roster);
  const canAfford = state.budget >= RECRUIT_COST;
  const canHire = rosterHasRoom && canAfford;
  const restHealBonus = foldPassives(state.relics).restHealBonus;
  const healTags = formatRestOptionTags('heal', { restHealBonus });
  if (choosingUpgrade) {
    return (
      <div className="result-overlay" data-testid="rest" role="dialog" aria-label="Rest">
        <div className="rest-panel">
          <p className="result-eyebrow">REST / UPGRADE</p>
          <h2 className="draft-title">強化する施策を選ぶ</h2>
          <p className="rest-desc">
            選んだカードを1段強化します。強化後の効果量はカード上のタグに反映されます。
          </p>
          <div className="rest-upgrade-grid" data-testid="rest-upgrade-cards">
            {state.deck.map((card, index) => {
              const def = getCard(card.defId);
              if (!def) return null;
              return (
                <button
                  type="button"
                  key={`${card.defId}-${index}`}
                  className="rest-upgrade-card"
                  data-testid={`rest-upgrade-card-${card.defId}-${index}`}
                  onClick={() => onChoose('upgrade', index)}
                >
                  <CardView def={def} level={card.level} />
                  <span className="rest-upgrade-next">次: Lv.{card.level + 1}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            data-testid="rest-upgrade-cancel"
            onClick={() => setChoosingUpgrade(false)}
          >
            ← 休息メニューへ戻る
          </button>
        </div>
      </div>
    );
  }
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
            <div className="rest-body">
              <span className="rest-name">チームを休ませる</span>
              <EffectTagList tags={healTags} testId="rest-tags-heal" />
              <span className="rest-desc">
                シニア体力とメンバーのスタミナを回復し、士気も少し上がる
              </span>
            </div>
          </button>
          <button
            type="button"
            className="rest-option"
            data-testid="rest-repay"
            onClick={() => onChoose('repay')}
          >
            <span className="rest-icon">🧹</span>
            <div className="rest-body">
              <span className="rest-name">技術的負債を返済</span>
              <EffectTagList tags={formatRestOptionTags('repay')} testId="rest-tags-repay" />
              <span className="rest-desc">
                Tech Debt を一部返済し、次スプリントの手戻りを抑える
              </span>
            </div>
          </button>
          <button
            type="button"
            className="rest-option"
            data-testid="rest-upgrade"
            disabled={!canUpgrade}
            onClick={() => setChoosingUpgrade(true)}
          >
            <span className="rest-icon">🔧</span>
            <div className="rest-body">
              <span className="rest-name">施策を強化</span>
              <EffectTagList tags={formatRestOptionTags('upgrade')} testId="rest-tags-upgrade" />
              <span className="rest-desc">
                {canUpgrade
                  ? '選択したカードを1段強化し、次スプリントの集中力上限を増やす'
                  : 'デッキが空です'}
              </span>
            </div>
          </button>
          <button
            type="button"
            className="rest-option"
            data-testid="rest-recruit"
            disabled={!canHire}
            onClick={() => onChoose('recruit')}
          >
            <span className="rest-icon">🙋</span>
            <div className="rest-body">
              <span className="rest-name">メンバーを採用（💰{RECRUIT_COST}）</span>
              <EffectTagList tags={formatRestOptionTags('recruit')} testId="rest-tags-recruit" />
              <span className="rest-desc">
                {!rosterHasRoom
                  ? 'ロスターが満員です'
                  : !canAfford
                    ? `予算が足りません（💰${RECRUIT_COST} 必要）`
                    : '未来の主力候補を1人迎える（ベンチに加わる）'}
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
