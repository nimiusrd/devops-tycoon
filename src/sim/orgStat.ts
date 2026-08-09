/**
 * 組織指標（0〜100 に収める値）の増減ヘルパー。
 *
 * `actions.ts` と `assignTask.ts` で同一実装が重複していたため集約した。
 */

/**
 * 指標から `amount` を消費する。
 *
 * 0 で下げ止まるため、実際に減った量（`spent`）は要求量と一致しないことがある。
 * 消費の反動（士気低下の連鎖など）は要求量ではなく `spent` を基準にすること。
 */
export function spendStat(current: number, amount: number): { next: number; spent: number } {
  // sim 各所に散らばる clamp のコピーをこれ以上増やさないため、ここでは直接収める。
  const next = Math.min(100, Math.max(0, current - amount));
  return { next, spent: current - next };
}
