/**
 * メタ解放コスト・points 配分の許容レンジ（RI-18）。
 *
 * `src/data/unlocks.ts` のコスト帯と `applyRunReward` の報酬量を
 * 代表 seed 群で検証し、極端な崩壊を検知する。
 */
import { UNLOCK_DEFS } from '../../../src/data/unlocks';

/** 解放 1 件あたりのコスト許容レンジ（暫定値 25〜50 を余裕込みで包む）。 */
export const UNLOCK_COST_RANGE = { min: 20, max: 60 } as const;

/** 勝利 1 ランの points 報酬許容レンジ（scoreMul=1・四半期補正込み）。 */
export const WIN_POINTS_RANGE = { min: 18, max: 35 } as const;

/** 敗北 1 ランの points 報酬許容レンジ（学習ボーナス込み）。 */
export const LOSS_POINTS_RANGE = { min: 4, max: 12 } as const;

/** 全試行の points 報酬許容レンジ（勝敗混在）。 */
export const ALL_POINTS_RANGE = { min: 4, max: 35 } as const;

/** 最安解放のコスト。 */
export const CHEAPEST_UNLOCK_COST = Math.min(...UNLOCK_DEFS.map((u) => u.cost));

/** 最高解放のコスト。 */
export const MOST_EXPENSIVE_UNLOCK_COST = Math.max(...UNLOCK_DEFS.map((u) => u.cost));

/** 全解放の合計コスト。 */
export const TOTAL_UNLOCK_COST = UNLOCK_DEFS.reduce((sum, u) => sum + u.cost, 0);

/** 勝利のみで最安解放を購入するのに必要な最小勝利回数の目安上限。 */
export const MAX_WINS_FOR_CHEAPEST_UNLOCK = Math.ceil(CHEAPEST_UNLOCK_COST / WIN_POINTS_RANGE.min);

/** 勝利のみで最高解放を購入するのに必要な最小勝利回数の目安上限。 */
export const MAX_WINS_FOR_MOST_EXPENSIVE_UNLOCK = Math.ceil(
  MOST_EXPENSIVE_UNLOCK_COST / WIN_POINTS_RANGE.min,
);
