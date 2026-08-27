/**
 * カード表示（SPEC 第7.2 / 第18 のカードUI）。
 *
 * カード定義を受け取り、レアリティ・コスト・効果・強化レベルを描く純表示。
 * ドラフト（DraftScreen）とデッキ/手札表示（DeckBar）で共用する。
 */
import { RARITY_LABEL } from '../data/cards';
import { formatCardTagsAtLevel, formatCardTooltip } from '../render/eventOutcomeView';
import type { CardDef } from '../sim/types';
import type { WhatIfPreview as WhatIfPreviewData } from '../sim/run/types';
import { EffectTagList } from './EffectTagList';
import { WhatIfPreview } from './WhatIfPreview';

export interface CardViewProps {
  def: CardDef;
  /** 強化レベル（>1 で ★ 表示）。 */
  level?: number;
  /** ドラフト選択ボタンにする場合のハンドラ。 */
  onPick?: () => void;
  /** 手札発動ボタンにする場合のハンドラ（RI-30）。 */
  onPlay?: () => void;
  /** 発動時の集中力コスト。手札では主表示、選択画面ではショップ価格と併記する。 */
  playCost?: number;
  /** 発動不可（集中力不足等）。 */
  disabled?: boolean;
  /** disabled のときプレイヤーへ示す理由。 */
  disabledReason?: string;
  /** コンパクト表示（デッキバー用）。 */
  compact?: boolean;
  /** このカードを採用した場合の次スプリント試算。 */
  whatIfPreview?: WhatIfPreviewData;
  /** what-if Worker 試算中（RI-13）。 */
  whatIfComputing?: boolean;
}

export function CardView({
  def,
  level = 1,
  onPick,
  onPlay,
  playCost: playCostValue,
  disabled = false,
  disabledReason,
  compact = false,
  whatIfPreview,
  whatIfComputing = false,
}: CardViewProps) {
  const stars = level > 1 ? '★'.repeat(level - 1) : '';
  const className = `card card-${def.rarity}${compact ? ' card-compact' : ''}${disabled ? ' card-disabled' : ''}${onPlay ? ' card-playable' : ''}`;
  const costLabel = onPlay && playCostValue !== undefined ? `⚡${playCostValue}` : String(def.cost);
  const inner = (
    <>
      <div className="card-head">
        <span className={`card-rarity rarity-${def.rarity}`}>{RARITY_LABEL[def.rarity]}</span>
        <span className="card-costs">
          <span className="card-cost">{costLabel}</span>
          {!onPlay && playCostValue !== undefined && (
            <span className="card-focus-cost">発動 ⚡{playCostValue}</span>
          )}
        </span>
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
          {(whatIfPreview || whatIfComputing) && (
            <WhatIfPreview
              preview={whatIfPreview}
              computing={whatIfComputing && !whatIfPreview}
              compact
              testId={`what-if-card-${def.id}`}
            />
          )}
        </>
      )}
    </>
  );

  if (onPlay) {
    return (
      <button
        type="button"
        className={className}
        onClick={onPlay}
        disabled={disabled}
        data-testid={`hand-card-${def.id}`}
        title={
          disabled && disabledReason
            ? disabledReason
            : `${formatCardTooltip(def, level)} / 発動 ⚡${playCostValue ?? '?'}`
        }
      >
        {inner}
      </button>
    );
  }

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
