/**
 * ラン進行の共有定数。
 *
 * engine と quarterReview の双方から参照するため、循環 import を避ける薄いモジュールに置く。
 */

/** 1 四半期あたりのスプリント数（最終インデックスがボス）。 */
export const SPRINTS_PER_QUARTER = 6;

/**
 * ドラフト引き直し（マリガン）の予算コスト（RI-81 / F-12）。
 * 安い common カード帯より少し安く、スキップより有利になりすぎない迷い水準。
 */
export const DRAFT_MULLIGAN_COST = 8;
