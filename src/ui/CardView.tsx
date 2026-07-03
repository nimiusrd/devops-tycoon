/**
 * カード表示（SPEC 第7.2 / 第18 のカードUI）。
 *
 * カード定義を受け取り、レアリティ・コスト・効果・強化レベルを描く純表示。
 * ドラフト（DraftScreen）とデッキ表示（DeckBar）で共用する。
 */
import { RARITY_LABEL } from '../data/cards';
import { formatCardTagsAtLevel, formatCardTooltip } from '../render/eventOutcomeView';
import type { CardDef } from '../sim/types';
import { EffectTagList } from './EffectTagList';

export interface CardViewProps {
  def: CardDef;
  /** 強化レベル（>1 で ★ 表示）。 */
  level?: number;
  /** ドラフト選択ボタンにする場合のハンドラ。 */
  onPick?: () => void;
  /** コンパクト表示（デッキバー用）。 */
  compact?: boolean;
}

export function CardView({ def, level = 1, onPick, compact = false }: CardViewProps) {
  const stars = level > 1 ? '★'.repeat(level - 1) : '';
  const className = `card card-${def.rarity}${compact ? ' card-compact' : ''}`;
  const inner = (
    <>
      <div className="card-head">
        <span className={`card-rarity rarity-${def.rarity}`}>{RARITY_LABEL[def.rarity]}</span>
        <span className="card-cost">{def.cost}</span>
      </div>
      <div className="card-name">
        {def.name}
        {stars && <span className="card-stars">{stars}</span>}
      </div>
      {!compact && (
        <>
          <EffectTagList
            tags={formatCardTagsAtLevel(def, level)}
            testId={`card-effect-tags-${def.id}`}
          />
          <ul className="card-effects">
            {def.description.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );

  if (onPick) {
    return (
      <button
        type="button"
        className={className}
        onClick={onPick}
        data-testid={`draft-card-${def.id}`}
      >
        {inner}
      </button>
    );
  }
  return (
    <div
      className={className}
      data-testid={`deck-card-${def.id}`}
      title={formatCardTooltip(def, level)}
    >
      {inner}
    </div>
  );
}
