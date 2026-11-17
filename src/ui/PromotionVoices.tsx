import { useState } from 'react';
import { PROMOTION_VOICES_PAGE_SIZE, promotionVoicesView } from '../render/promotionVoicesView';
import type { GrowthOutcome } from '../sim/member/types';

/** 開閉・ページ移動は表示内で完結し、ゲームへの操作を持たない。 */
export function PromotionVoices({ growth }: { growth: GrowthOutcome }) {
  const [page, setPage] = useState(0);
  const voices = promotionVoicesView(growth);
  if (voices.length === 0) return null;
  const pageCount = Math.ceil(voices.length / PROMOTION_VOICES_PAGE_SIZE);
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * PROMOTION_VOICES_PAGE_SIZE;

  return (
    <details className="result-details promotion-voices" data-testid="promotion-voices">
      <summary>昇格した人の一言（{voices.length}人）</summary>
      <p className="promotion-voices-note">直近スプリントの昇格記録を振り返ります。</p>
      {voices.slice(start, start + PROMOTION_VOICES_PAGE_SIZE).map((voice) => (
        <figure
          className="promotion-voice"
          key={voice.id}
          data-testid="promotion-voice"
          data-member-id={voice.id}
        >
          <figcaption>
            {voice.name}（{voice.rank}）
          </figcaption>
          <blockquote>「{voice.quote}」</blockquote>
        </figure>
      ))}
      {pageCount > 1 && (
        <nav className="result-actions" aria-label="昇格した人の一言のページ">
          <button
            type="button"
            className="btn"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            前の{PROMOTION_VOICES_PAGE_SIZE}人
          </button>
          <span aria-live="polite">
            {currentPage + 1} / {pageCount}ページ
          </span>
          <button
            type="button"
            className="btn"
            disabled={currentPage === pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            次の{PROMOTION_VOICES_PAGE_SIZE}人
          </button>
        </nav>
      )}
    </details>
  );
}
