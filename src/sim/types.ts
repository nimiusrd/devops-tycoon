/**
 * シミュレーションのドメイン型（Phase 0 雛形）。
 *
 * 工程モデル（Task / Lane / OrgState 等）の本体は Phase 1 以降で拡張する。
 * Phase 0 では決定論を検証できる最小限の状態のみを定義する。
 */

/** 難易度・シナリオの識別子（SPEC 第16章）。Phase 1 以降で具体化する。 */
export type ScenarioId = string;

/** シミュレーション全体の状態。 */
export interface SimState {
  /** 解決済みの seed 文字列。 */
  seed: string;
  /** 適用中のシナリオ。 */
  scenario: ScenarioId;
  /** 経過した固定ステップ数。 */
  tick: number;
  /** 経過シミュレーション時間（ms）。 */
  elapsedMs: number;
  /** 直近に消費した乱数（決定論の可視化・検証用）。 */
  lastRandom: number;
}
