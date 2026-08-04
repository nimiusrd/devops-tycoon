/**
 * スプリント後のカードドラフト（SPEC 第7.1）。
 *
 * 提示された 3 枚から 1 枚を選んでデッキに加え、次スプリントを開始する。
 * 同じデッキでも捌き方で結果が変わり、ドラフトでデッキが育っていく（第7章）。
 * RI-81: 予算コストで引き直すマリガンを提供する（F-12）。
 */
import { getCard } from '../data/cards';
import { DRAFT_MULLIGAN_COST } from '../sim/run/constants';
import type { WhatIfPreview as WhatIfPreviewData } from '../sim/run/types';
import { CardView } from './CardView';
import { WhatIfPreview } from './WhatIfPreview';

export interface DraftScreenProps {
  /** 提示カードの定義 ID（3 枚）。 */
  options: string[];
  /** 次スプリントが何回目か（表示用、1 起点）。 */
  sprintNumber: number;
  /** 現在の予算（マリガン可否表示用）。 */
  budget: number;
  /** 今ドラフトでマリガン済みか。 */
  mulliganUsed: boolean;
  previews: Record<string, WhatIfPreviewData>;
  /** スキップ（カードを採らない）場合のベースライン試算。 */
  skipPreview?: WhatIfPreviewData;
  /** what-if Worker 試算中（RI-13）。 */
  whatIfComputing?: boolean;
  onPick: (defId: string) => void;
  onSkip: () => void;
  onMulligan: () => void;
}

export function DraftScreen({
  options,
  sprintNumber,
  budget,
  mulliganUsed,
  previews,
  skipPreview,
  whatIfComputing = false,
  onPick,
  onSkip,
  onMulligan,
}: DraftScreenProps) {
  const canMulligan = !mulliganUsed && budget >= DRAFT_MULLIGAN_COST;

  return (
    <div className="result-overlay" data-testid="draft" role="dialog" aria-label="Card Draft">
      <div className="draft-card-panel">
        <p className="result-eyebrow">CARD DRAFT</p>
        <h2 className="draft-title">スプリント{sprintNumber} に向けて、施策を1枚選ぶ</h2>
        <div className="draft-options">
          {options.map((id) => {
            const def = getCard(id);
            if (!def) return null;
            return (
              <CardView
                key={id}
                def={def}
                onPick={() => onPick(id)}
                whatIfPreview={previews[id]}
                whatIfComputing={whatIfComputing}
              />
            );
          })}
        </div>
        {(skipPreview || whatIfComputing) && (
          <WhatIfPreview
            preview={skipPreview}
            computing={whatIfComputing && !skipPreview}
            label="スキップ時の予測"
            testId="what-if-draft-skip"
          />
        )}
        <div className="draft-actions">
          <button
            type="button"
            className="btn"
            onClick={onMulligan}
            disabled={!canMulligan}
            data-testid="draft-mulligan"
            title={
              mulliganUsed
                ? 'このドラフトではすでに引き直しています'
                : budget < DRAFT_MULLIGAN_COST
                  ? `予算が足りません（必要 ${DRAFT_MULLIGAN_COST}）`
                  : `予算 ${DRAFT_MULLIGAN_COST} で候補を引き直す`
            }
          >
            引き直し（💰{DRAFT_MULLIGAN_COST}）
          </button>
          <button type="button" className="btn" onClick={onSkip} data-testid="draft-skip">
            スキップして進む
          </button>
        </div>
      </div>
    </div>
  );
}
