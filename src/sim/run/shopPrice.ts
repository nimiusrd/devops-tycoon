import { RUN_BALANCE } from '../../data/balance/run';

/** 店頭価格の丸めと最低価格。ショップ生成と取得前の説明で共有する。 */
export function discountedShopPrice(basePrice: number, discount: number): number {
  return Math.max(RUN_BALANCE.shopMinimumPrice.value, Math.round(basePrice * (1 - discount)));
}
