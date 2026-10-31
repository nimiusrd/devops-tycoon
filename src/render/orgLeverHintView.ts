/**
 * Q1 の予算案内（#943）。
 *
 * ショップはスプリント間イベントの抽選でのみ開く。最安の組織レバー以上の予算があり、
 * その抽選がまだ当たっていないときだけ、全社マップの入口を案内する。
 * 判定はレバー定義とショップへ進むイベント定義を正本にし、予算条件を緩めない。
 */
import { EVENT_DEFS } from '../data/events';
import { LEVER_DEFS } from '../data/levers';
import type { RunState } from '../sim/run/types';

/** 組織レバー定義の最安。これ未満ではレバーを発動できない。 */
export const MIN_ORG_LEVER_BUDGET = Math.min(...LEVER_DEFS.map((lever) => lever.cost));

const SHOP_OFFER_EVENT_IDS = new Set(
  EVENT_DEFS.filter((event) => event.choices.some((choice) => choice.leadsTo === 'shop')).map(
    (event) => event.id,
  ),
);

export const ORG_LEVER_BUTTON_LABEL = '組織レバー';
export const ORG_LEVER_HINT_MESSAGE = '予算は組織レバーで使えます';

/** いまショップ抽選が当たっているか（提示中のビート、またはショップ画面）。 */
export function isShopOfferPresent(state: Pick<RunState, 'phase' | 'beat' | 'shop'>): boolean {
  if (state.phase === 'shop' || state.shop != null) return true;
  const eventId = state.beat?.eventId;
  return eventId != null && SHOP_OFFER_EVENT_IDS.has(eventId);
}

export interface OrgLeverHintDecisionInput {
  quarterNumber: number;
  budget: number;
  /** このランでショップ抽選が既に当たった（提示中を含む）。 */
  shopArrived: boolean;
  /** 組織レバーのボタンを既に開いた。 */
  dismissed: boolean;
  readOnly: boolean;
}

/**
 * 案内を出すか。
 * Q1、予算が最安レバー以上、ショップ未到来、未開封、操作できるときだけ true。
 */
export function shouldShowOrgLeverHint(input: OrgLeverHintDecisionInput): boolean {
  if (input.readOnly || input.dismissed || input.shopArrived) return false;
  if (input.quarterNumber !== 1) return false;
  return input.budget >= MIN_ORG_LEVER_BUDGET;
}
