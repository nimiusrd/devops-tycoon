/**
 * shop-offer ビートの文言（#1018）。
 * 購入可否はショップ画面と同じ hasPurchasableShopItem を正本にする。
 */
import type { EventDef } from '../data/events';
import type { RunState } from '../sim/run/types';
import { hasPurchasableShopItem } from './shopPurchaseEligibility';

export const SHOP_OFFER_SURPLUS_PROMPT = '四半期予算に余裕がある。ツール・採用で補強できる。';

const SHOP_OFFER_TIGHT_PROMPT =
  'ショップを開けば施策を仕入れられるが、今の予算では買える品がない。';

/** shop-offer 以外は定義の prompt をそのまま返す。 */
export function shopOfferBeatPrompt(event: EventDef, state: RunState): string {
  if (event.id !== 'shop-offer') return event.prompt;
  if (!state.shop) return event.prompt;
  return hasPurchasableShopItem(state, state.shop)
    ? SHOP_OFFER_SURPLUS_PROMPT
    : SHOP_OFFER_TIGHT_PROMPT;
}
