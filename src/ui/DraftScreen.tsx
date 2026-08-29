/**
 * スプリント後のカードドラフト（SPEC 第7.1）。
 *
 * 提示された 3 枚から 1 枚を選んでデッキに加え、次スプリントを開始する。
 * 同じデッキでも捌き方で結果が変わり、ドラフトでデッキが育っていく（第7章）。
 * RI-81: 予算コストで引き直すマリガンを提供する（F-12）。
 */
import { useRef } from 'react';
import { DRAFT_MULLIGAN_COST } from '../sim/run/constants';
import { playCost } from '../sim/cards';
import type { WhatIfPreview as WhatIfPreviewData } from '../sim/run/types';
import { CardView } from './CardView';
import { useReplayContent } from './replayContent';
import { useDialogOverlayLock } from './useDialogOverlayLock';
import { WhatIfPreview } from './WhatIfPreview';

export interface DraftScreenProps {
  /** 提示カードの定義 ID（3 枚）。 */
  options: string[];
  /** 当四半期の次スプリント番号（表示用、1 起点。HUD と一致させる）。 */
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
  /** リプレイ閲覧など、操作を受け付けないとき。 */
  readOnly?: boolean;
  /** 読み取り専用時にダイアログ内へ出す戻る操作。 */
  onClose?: () => void;
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
  readOnly = false,
  onClose,
}: DraftScreenProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useDialogOverlayLock(overlayRef);
  const canMulligan = !mulliganUsed && budget > DRAFT_MULLIGAN_COST;
  const { resolveCard } = useReplayContent();
  const readOnlyTitle = 'リプレイ閲覧中は操作できません';

  return (
    <div
      ref={overlayRef}
      className="result-overlay overlay-contained"
      data-testid="draft"
      data-readonly={readOnly ? 'true' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Card Draft"
      tabIndex={-1}
    >
      <div className="draft-card-panel">
        <div className="overlay-scroll" data-testid="overlay-scroll">
          <p className="result-eyebrow">CARD DRAFT</p>
          <h2 className="draft-title" data-testid="draft-sprint-no">
            {readOnly
              ? `スプリント${sprintNumber} に向けて、提示された施策を確認する`
              : `スプリント${sprintNumber} に向けて、施策を1枚選ぶ`}
          </h2>
          <div className="draft-options">
            {options.map((id) => {
              const def = resolveCard(id);
              return (
                <CardView
                  key={id}
                  def={def}
                  playCost={playCost(def.focusCost, 1)}
                  onPick={() => onPick(id)}
                  disabled={readOnly}
                  readOnly={readOnly}
                  title={readOnly ? readOnlyTitle : undefined}
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
        </div>
      </div>
      <div className="draft-actions overlay-actions">
        <button
          type="button"
          className="btn"
          onClick={onMulligan}
          disabled={readOnly || !canMulligan}
          data-testid="draft-mulligan"
          title={
            readOnly
              ? readOnlyTitle
              : mulliganUsed
                ? 'このドラフトではすでに引き直しています'
                : budget <= DRAFT_MULLIGAN_COST
                  ? `予算が足りません（必要 ${DRAFT_MULLIGAN_COST}）`
                  : `予算 ${DRAFT_MULLIGAN_COST} で候補を引き直す`
          }
        >
          引き直し（💰{DRAFT_MULLIGAN_COST}）
        </button>
        <button
          type="button"
          className="btn"
          onClick={onSkip}
          disabled={readOnly}
          title={readOnly ? readOnlyTitle : undefined}
          data-testid="draft-skip"
        >
          スキップして進む
        </button>
        {readOnly && onClose ? (
          <button type="button" className="btn" onClick={onClose} data-testid="draft-exit-replay">
            タイトルへ戻る
          </button>
        ) : null}
      </div>
    </div>
  );
}
