import { defineBalanceEntry } from './define';
import type { DifficultyId } from '../../sim/run/types';

/**
 * メタ進行・デイリー条件の共通ルール。
 *
 * 優先カード上限、ラン報酬係数、コンボ実績閾値など数値の調整値を正本にする。
 * デイリー難易度・試練と初期解放難易度は ID 列のため BalanceEntry にはせず、
 * 同じファイルの named export として持ち、指紋は CONTENT_CATALOG 経由で残す。
 *
 * 対象外:
 * - 永続化スキーマ履歴（TUTORIAL_CONTENT_VERSION、LEGACY_*、storage key、日付キー形式）
 * - 表示専用値（WIN_TITLE_DEFS、ACHIEVEMENT_LABEL）
 * - 既存コンテンツ正本（アンロック cost/requires、試練 scoreMul、実績 ID）
 * - 公平性プロトコル（デイリー再走の rewardClaimed、研修方針無視）
 */
export const META_BALANCE = {
  preferredMaxCards: defineBalanceEntry({
    id: 'meta.preferred.maxCards',
    value: 2,
    unit: 'count',
    allowedRange: { min: 0, max: 10 },
    label: '研修方針の優先施策上限',
    description: '研修方針で選べる優先カードの最大枚数。',
    tags: ['meta', 'preferred', 'training-policy'],
    derived: false,
    integer: true,
  }),
  rewardWinBase: defineBalanceEntry({
    id: 'meta.reward.winBase',
    value: 20,
    unit: 'points',
    allowedRange: { min: 0, max: 100 },
    label: '勝利時メタ進行ポイント基礎',
    description: 'ラン勝利時のメタ進行ポイント基礎値。試練倍率を掛けた後に丸める。',
    tags: ['meta', 'reward'],
    derived: false,
    integer: true,
  }),
  rewardLossBase: defineBalanceEntry({
    id: 'meta.reward.lossBase',
    value: 5,
    unit: 'points',
    allowedRange: { min: 0, max: 100 },
    label: '敗北時メタ進行ポイント基礎',
    description: 'ラン敗北時のメタ進行ポイント基礎値。試練倍率を掛けた後に丸める。',
    tags: ['meta', 'reward'],
    derived: false,
    integer: true,
  }),
  rewardScoreMulFloor: defineBalanceEntry({
    id: 'meta.reward.scoreMulFloor',
    value: 1,
    unit: 'multiplier',
    allowedRange: { min: 1, max: 10 },
    label: 'ラン報酬の試練倍率下限',
    description: 'メタ進行ポイント計算で使う試練スコア倍率の下限。',
    tags: ['meta', 'reward', 'trial'],
    derived: false,
  }),
  rewardLearningBase: defineBalanceEntry({
    id: 'meta.reward.learningBase',
    value: 2,
    unit: 'points',
    allowedRange: { min: 0, max: 20 },
    label: '学習ボーナス起点',
    description: '敗北かつ修正可能な未達レビューがあるときの学習ボーナス起点。',
    tags: ['meta', 'reward', 'learning'],
    derived: false,
    integer: true,
  }),
  rewardLearningPerReview: defineBalanceEntry({
    id: 'meta.reward.learningPerReview',
    value: 1,
    unit: 'points',
    allowedRange: { min: 0, max: 10 },
    label: '学習ボーナスのレビュー加算',
    description: '修正可能な未達レビュー 1 件あたり学習ボーナスへ加える値。',
    tags: ['meta', 'reward', 'learning'],
    derived: false,
    integer: true,
  }),
  rewardLearningCap: defineBalanceEntry({
    id: 'meta.reward.learningCap',
    value: 5,
    unit: 'points',
    allowedRange: { min: 0, max: 20 },
    label: '学習ボーナス上限',
    description: '敗北時学習ボーナスの上限。起点以上になる。',
    tags: ['meta', 'reward', 'learning'],
    derived: false,
    integer: true,
  }),
  rewardReviewExceeded: defineBalanceEntry({
    id: 'meta.reward.reviewExceeded',
    value: 3,
    unit: 'points',
    allowedRange: { min: 0, max: 20 },
    label: '超過達成レビューボーナス',
    description: '勝利かつ超過達成レビューがあるときのメタ進行ポイント加算。',
    tags: ['meta', 'reward', 'review'],
    derived: false,
    integer: true,
  }),
  rewardReviewMet: defineBalanceEntry({
    id: 'meta.reward.reviewMet',
    value: 1,
    unit: 'points',
    allowedRange: { min: 0, max: 20 },
    label: '達成レビューボーナス',
    description: '勝利かつ達成レビューがあるときのメタ進行ポイント加算。超過達成より優先しない。',
    tags: ['meta', 'reward', 'review'],
    derived: false,
    integer: true,
  }),
  achievementComboMasterMinCombo: defineBalanceEntry({
    id: 'meta.achievement.comboMasterMinCombo',
    value: 20,
    unit: 'count',
    allowedRange: { min: 1, max: 100 },
    label: 'コンボマスター解除の最小コンボ',
    description: '勝利時に combo-master 実績を解除する最大コンボの下限。',
    tags: ['meta', 'achievement', 'combo'],
    derived: false,
    integer: true,
  }),
} as const;

/** デイリーランの固定難易度（全員同一条件）。指紋は CONTENT_CATALOG.daily。 */
export const DAILY_RUN_DIFFICULTY: DifficultyId = 'normal';
/** デイリーランの固定試練 ID 列（全員同一条件）。指紋は CONTENT_CATALOG.daily。 */
export const DAILY_RUN_TRIALS: readonly string[] = [];
/** 新規メタ進行で最初から解放する難易度。 */
export const INITIAL_UNLOCKED_DIFFICULTIES: readonly DifficultyId[] = ['easy', 'normal'];
