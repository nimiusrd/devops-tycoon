/**
 * ラン進行の共有定数。
 *
 * engine と quarterReview の双方から参照するため、循環 import を避ける薄いモジュールに置く。
 */

/** 1 四半期あたりのスプリント数（最終インデックスがボス）。 */
export const SPRINTS_PER_QUARTER = 6;

/**
 * 進化ポイント付与（`RunEngine.evoPointsFor`）。
 *
 * 入手速度自体は据え置き（F-4 ペーシングとの両立）。RI-86 / F-11 の希少性は
 * `src/data/evolution.ts` のノードコスト引き上げで作る。
 * 変更時は `scripts/playtest-report.mjs` の読み取り元（本定数）を正とする。
 */
export const EVO_POINTS_BASE = 1;
/** 出荷量をこの値で割った整数をポイントへ加算する。 */
export const EVO_POINTS_DELIVERED_DIVISOR = 40;
/** 高負荷（elite）スプリントの追加ポイント。 */
export const EVO_POINTS_ELITE_BONUS = 1;

/**
 * ドラフト引き直し（マリガン）の予算コスト（RI-81 / F-12）。
 * 安い common カード帯より少し安く、スキップより有利になりすぎない迷い水準。
 */
export const DRAFT_MULLIGAN_COST = 8;
