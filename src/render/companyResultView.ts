import { winView } from '../sim/outcome';
import type { RunState } from '../sim/run/types';
import { clampSeniorHpDisplay } from './seniorHpDisplay';
import { LOSE_LABEL } from './runOutcomeLabels';

/** 決着時に固定する画像の表示値。旧記録を現行の定義で再評価しない。 */
export interface CompanyResult {
  outcome: string;
  won: boolean;
  delivered: number;
  cost: { label: string; remaining: number };
  cards: { name: string; level: number }[];
}

type ResultState = Pick<RunState, 'status' | 'winType' | 'loseReason' | 'totals' | 'org' | 'deck'>;

export function buildCompanyResult(
  state: ResultState,
  cardName: (id: string) => string,
  legacy = false,
): CompanyResult {
  const won = state.status === 'won';
  // 記録に表示名がない旧結果は、現行定義へ補完せず記録されたIDを示す。
  const outcome = legacy
    ? `${won ? '勝利' : '敗北'}（記録: ${state.winType ?? state.loseReason ?? '種別なし'}）`
    : won
      ? state.winType
        ? winView(state.winType).label
        : '勝利'
      : state.loseReason
        ? LOSE_LABEL[state.loseReason].label
        : '敗北';
  const senior = state.org.seniorHp <= state.org.morale;
  return {
    outcome,
    won,
    delivered: state.totals.delivered,
    cost: {
      label: senior ? 'シニア体力' : '士気',
      remaining: senior
        ? clampSeniorHpDisplay(state.org.seniorHp)
        : Math.min(100, Math.max(0, Math.round(state.org.morale))),
    },
    cards: state.deck
      .map((card, index) => ({ card, index }))
      .sort((a, b) => b.card.level - a.card.level || a.index - b.index)
      .slice(0, 3)
      .map(({ card }) => ({ name: cardName(card.defId), level: card.level })),
  };
}

export function isCompanyResult(value: unknown): value is CompanyResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as CompanyResult;
  return (
    typeof v.outcome === 'string' &&
    typeof v.won === 'boolean' &&
    Number.isFinite(v.delivered) &&
    !!v.cost &&
    typeof v.cost.label === 'string' &&
    Number.isFinite(v.cost.remaining) &&
    Array.isArray(v.cards) &&
    v.cards.length <= 3 &&
    v.cards.every((c) => !!c && typeof c.name === 'string' && Number.isFinite(c.level))
  );
}
