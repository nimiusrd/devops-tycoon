/** 四半期の判定と直近スプリントの記録を読むだけの、現場・顧客の声（RI-244）。 */
import { rankLabel } from '../sim/member';
import type { GrowthOutcome, Member, RosterState } from '../sim/member/types';
import { OUTCOME_LABELS } from '../sim/run/quarterReview';
import type { QuarterReview } from '../sim/run/types';

export interface QuarterReviewVoice {
  speaker: string;
  quote: string;
  basis: string;
}

export interface QuarterReviewVoicesView {
  member: QuarterReviewVoice | null;
  customer: QuarterReviewVoice;
}

interface Input {
  quarterReview: QuarterReview | null;
  roster?: Pick<RosterState, 'members'> | null;
  lastGrowth?: GrowthOutcome | null;
}

function memberGrowth(member: Member, growth: GrowthOutcome | null): string | null {
  if (!growth) return null;
  if (growth.wentOnLeave.some((entry) => entry.id === member.id)) {
    return '直近スプリントで休職に入りました。負荷を見直したいです。';
  }
  const promotion = growth.promotions.find((entry) => entry.id === member.id);
  if (promotion) return `直近スプリントで${rankLabel(promotion.to)}に昇格しました。`;
  if (growth.leveledUp.includes(member.id)) return '直近スプリントでレベルが上がりました。';
  return null;
}

export function quarterReviewVoicesView(input: Input): QuarterReviewVoicesView | null {
  const review = input.quarterReview;
  if (!review) return null;
  const growth = input.lastGrowth ?? null;
  const members = input.roster?.members ?? [];
  // 記録にある ID でも現在のロスターにいなければ発言者にしない。
  const member =
    members.find((m) => growth?.wentOnLeave.some((entry) => entry.id === m.id)) ??
    members.find((m) => growth?.promotions.some((entry) => entry.id === m.id)) ??
    members.find((m) => growth?.leveledUp.includes(m.id)) ??
    members[0];
  const delivery = review.progress.find((kpi) => kpi.id === 'delivery');
  const quality = review.progress.find((kpi) => kpi.id === 'quality');
  const deliveryMissed = delivery?.status === 'missed';
  const qualityMissed = quality?.status === 'missed';
  const result = `今回の判定は「${OUTCOME_LABELS[review.outcome]}」です。`;
  const concern =
    deliveryMissed && qualityMissed
      ? '出荷も品質も目標に届きませんでした。'
      : deliveryMissed
        ? '出荷が目標に届きませんでした。'
        : qualityMissed
          ? '品質が目標を下回りました。'
          : result;
  const growthQuote = member ? memberGrowth(member, growth) : null;
  const kpiBasis = [delivery, quality]
    .filter((kpi) => kpi !== undefined)
    .map((kpi) => `${kpi.id === 'delivery' ? '出荷' : '品質'} ${kpi.actual} / 目標 ${kpi.target}`);

  return {
    member: member
      ? {
          speaker: member.name,
          quote: `${growthQuote ?? '今回のレビュー結果を確認しました。'} ${concern}`,
          basis: growthQuote
            ? '直近スプリントの成長・休職記録と今回のレビュー判定'
            : '今回のレビュー判定（このメンバーの直近スプリントの成長・休職記録なし）',
        }
      : null,
    customer: {
      speaker: '顧客の声（抽象的な要約）',
      quote:
        deliveryMissed || qualityMissed
          ? `${concern} この結果を重く受け止めてほしいです。`
          : review.outcome === 'met' || review.outcome === 'exceeded'
            ? delivery && quality
              ? '出荷と品質の目標達成を評価します。'
              : `${result} 記録された達成判定を評価します。`
            : `${result} 出荷や品質だけでなく、全体の判定を確認したいです。`,
      basis: [...kpiBasis, `顧客信頼 ${review.trust.customers} / 100`, result].join(' ・ '),
    },
  };
}
