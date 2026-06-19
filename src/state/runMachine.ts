/**
 * Phase 0 の状態機械プレースホルダー。
 *
 * 本格的なフェーズ遷移は Phase 1 以降で XState に接続する想定だが、
 * UI と sim から参照する境界を先に固定しておく。
 */
export type RunPhase = 'foundation';

export type RunMachineSnapshot = {
  phase: RunPhase;
};

export const initialRunMachineSnapshot: RunMachineSnapshot = {
  phase: 'foundation',
};
