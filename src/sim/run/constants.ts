/**
 * ラン進行の互換alias。
 *
 * 実行値の正本は `src/data/balance/run.ts` に置き、既存の import を壊さないために
 * この薄いモジュールから値だけを再公開する。
 */
import { RUN_BALANCE } from '../../data/balance/run';

/** 1 四半期あたりのスプリント数（最終インデックスがボス）。 */
export const SPRINTS_PER_QUARTER: number = RUN_BALANCE.sprintsPerQuarter.value;

/**
 * 進化ポイント付与（`RunEngine.evoPointsFor`）。
 *
 * 入手速度自体は据え置き（F-4 ペーシングとの両立）。RI-86 / F-11 の希少性は
 * `src/data/evolution.ts` のノードコスト引き上げで作る。
 */
export const EVO_POINTS_BASE = RUN_BALANCE.evolutionPointsBase.value;
/** 出荷量をこの値で割った整数をポイントへ加算する。 */
export const EVO_POINTS_DELIVERED_DIVISOR = RUN_BALANCE.evolutionPointsDeliveredDivisor.value;
/** 高負荷（elite）スプリントの追加ポイント。 */
export const EVO_POINTS_ELITE_BONUS = RUN_BALANCE.evolutionPointsEliteBonus.value;

/**
 * ドラフト引き直し（マリガン）の予算コスト（RI-81 / F-12）。
 * 安い common カード帯より少し安く、スキップより有利になりすぎない迷い水準。
 */
export const DRAFT_MULLIGAN_COST = RUN_BALANCE.draftMulliganCost.value;
