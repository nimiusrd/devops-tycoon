/**
 * Phase 0 のランストア境界。
 *
 * Zustand は package 依存として導入済み。実際の store 実装は、ラン状態が増える
 * Phase 1 以降でこのファイルから公開する。
 */
export interface RunStoreSnapshot {
  seed: string;
}

export const initialRunStoreSnapshot: RunStoreSnapshot = {
  seed: 'devops-tycoon-phase-0',
};
