/** 直近スプリントの昇格記録だけから作る一言（RI-285）。ロスターは参照しない。 */
import { rankLabel } from '../sim/member';
import type { GrowthOutcome } from '../sim/member/types';

export const PROMOTION_VOICES_PAGE_SIZE = 3;

export function promotionVoicesView(growth?: GrowthOutcome | null) {
  return (growth?.promotions ?? []).map((promotion) => ({
    id: promotion.id,
    name: promotion.name,
    rank: rankLabel(promotion.to),
    quote: `${rankLabel(promotion.to)}に昇格しました。`,
  }));
}
