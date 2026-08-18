/**
 * 組織指標（0〜100 に収める値）の増減ヘルパー。
 *
 * `actions.ts` と `assignTask.ts` で同一実装が重複していたため集約した。
 */
import { clamp } from './clamp';
import { ACTION_BALANCE } from '../data/balance';

/** 介入・差配が共有する組織指標のclamp境界。 */
export const ORG_STAT_MIN = ACTION_BALANCE.organizationStatMinimum.value;
export const ORG_STAT_MAX = ACTION_BALANCE.organizationStatMaximum.value;

/**
 * 指標から `amount` を消費する。
 *
 * 0 で下げ止まるため、実際に減った量（`spent`）は要求量と一致しないことがある。
 * 消費の反動（士気低下の連鎖など）は要求量ではなく `spent` を基準にすること。
 */
export function spendStat(current: number, amount: number): { next: number; spent: number } {
  const next = clamp(current - amount, ORG_STAT_MIN, ORG_STAT_MAX);
  return { next, spent: current - next };
}
