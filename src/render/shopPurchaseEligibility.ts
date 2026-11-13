/**
 * ショップ商品の購入可否（ShopScreen と同じ spendRiskView 判定）。
 */
import { canRecruit } from '../sim/member';
import type { RunState, ShopOffer } from '../sim/run/types';
import { spendRiskView } from './spendRiskView';

export type ShopPurchaseState = Pick<RunState, 'budget' | 'roster' | 'relics'>;

/** ショップ UI と同じ条件で、1 点でも購入可能なら true。 */
export function hasPurchasableShopItem(state: ShopPurchaseState, shop: ShopOffer): boolean {
  const rosterFull = !canRecruit(state.roster);
  for (const card of shop.cards) {
    if (
      spendRiskView({ budget: state.budget, cost: card.cost, bought: card.bought }).blocked === null
    ) {
      return true;
    }
  }
  if (shop.relic) {
    const relic = shop.relic;
    if (
      spendRiskView({ budget: state.budget, cost: relic.cost, bought: relic.bought }).blocked ===
      null
    ) {
      return true;
    }
  }
  if (shop.recruit) {
    const recruit = shop.recruit;
    if (
      spendRiskView({
        budget: state.budget,
        cost: recruit.cost,
        bought: recruit.bought,
        rosterFull,
      }).blocked === null
    ) {
      return true;
    }
  }
  return false;
}
