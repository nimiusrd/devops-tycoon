/**
 * ラン途中セーブ用の永続スナップショット型（RI-58）。
 * sim 層に置き、state 永続化と engine の双方から参照する。
 */
import type { CardEffects, OrgState, ScenarioId, SprintConfig, SprintState } from '../types';
import type { OrgAdjustState, TeamRunState } from '../orgscale/types';
import type { RosterState } from '../member/types';
import type { GoalAdjustmentId, RunPhase, RunState } from './types';
import type { SprintBaselineInput } from './sprintBaseline';

/** セーブ可能な離散フェーズ（sprint / title / won / lost は除外）。 */
export type RunSavePhase = Exclude<RunPhase, 'title' | 'sprint' | 'won' | 'lost'>;

const SAVEABLE_PHASES = new Set<RunPhase>([
  'setup',
  'result',
  'draft',
  'evolution',
  'beat',
  'shop',
  'rest',
  'recruit',
  'quarterReview',
]);

export function isRunSavePhase(phase: RunPhase): phase is RunSavePhase {
  return SAVEABLE_PHASES.has(phase);
}

/** リプレイキーフレームとして残すフェーズ（RI-61。容量抑制）。 */
export type ReplayFramePhase = RunSavePhase | 'won' | 'lost';

const REPLAY_FRAME_PHASES = new Set<RunPhase>([
  'setup',
  'result',
  'draft',
  'quarterReview',
  'won',
  'lost',
]);

export function isReplayFramePhase(phase: RunPhase): phase is ReplayFramePhase {
  return REPLAY_FRAME_PHASES.has(phase);
}

/** snapshot() に載らない内部状態（復元に必須）。 */
export interface RunPersistExtras {
  baseConfig: SprintConfig;
  orgAdjust: OrgAdjustState;
  nextBudgetCap: number | null;
  /**
   * @deprecated RI-83: `goalCarryoverQuarter` / `goalCarryoverId` を優先。
   * 旧セーブ互換のため残す（pause_ai_rollout として解釈）。
   */
  pauseAiDebuffQuarter: number | null;
  /** 目標修正キャリーオーバーが有効な四半期（RI-83。旧セーブでは欠落しうる）。 */
  goalCarryoverQuarter?: number | null;
  /** 目標修正キャリーオーバーの ID（RI-83。旧セーブでは欠落しうる）。 */
  goalCarryoverId?: GoalAdjustmentId | null;
  winEvalOrg: OrgState | null;
  /** ラン開始時に固定した解放プール。 */
  allowedCards: string[];
  allowedRelics: string[];
  /**
   * ラン開始時に固定した研修方針（優先施策 ID）。
   * 旧セーブでは欠落しうる（復元時は空配列扱い。RI-34⁗）。
   */
  preferredCardIds?: string[];
  /**
   * ラン開始時に固定したツール別シナリオ（RI-103）。
   * 旧セーブでは欠落しうる（復元時は default）。
   */
  scenario?: ScenarioId;
  /** 全チームの永続状態（RI-64。旧セーブでは欠落しうる）。 */
  teams?: TeamRunState[];
  activeTeamId?: string;
  homeTeamId?: string;
  teamLockUntilSprint?: number;
  /** 訪問済みチームのロスター（RI-64）。 */
  teamRosters?: Record<string, RosterState>;
  /**
   * 粗粒度炎上の四半期内累積（RI-64）。
   * 旧セーブでは欠落しうる（復元時は 0）。
   */
  coarseIncidentCarry?: number;
  /**
   * 粗粒度炎上の顧客信頼 raw 累積（RI-87）。
   * ステップ丸めで 0.5 未満が消えないよう四半期内で繰り越す。旧セーブでは欠落しうる。
   */
  coarseSecurityTrustRaw?: number;
  /**
   * 粗粒度炎上の顧客信頼 raw に含まれる発火件数（RI-108）。
   * 最小件数に達するまで raw の適用を保留するため、四半期内で繰り越す。
   */
  coarseSecurityTrustCount?: number;
  /**
   * 顧客信頼へ実際に反映済みの累積デルタ（RI-108）。
   * 再開時に raw 閾値の調整値が変わっても、未適用の低下だけを反映する。
   */
  coarseSecurityTrustAppliedDelta?: number;
  /**
   * RI-108 の旧実装が保存していた適用済み raw。後方互換の復元時だけ使用する。
   * @deprecated `coarseSecurityTrustAppliedDelta` を使用する。
   */
  coarseSecurityTrustAppliedRaw?: number;
  /** 今ドラフトでのマリガン使用済み（RI-81。旧セーブでは欠落しうる）。 */
  draftMulliganUsed?: boolean;
}

/**
 * エンジン復元用本体。
 * sprint / whatIf / orgScale / industry / teams は永続せず、
 * teams は extras、orgScale/industry は復元時に再生成または null とする。
 */
export type RunPersistState = Omit<
  RunState,
  | 'whatIf'
  | 'whatIfStatus'
  | 'orgScale'
  | 'industry'
  | 'phase'
  | 'sprint'
  | 'sprintTick'
  | 'teams'
  | 'activeTeamId'
  | 'homeTeamId'
  | 'teamLockUntilSprint'
> & {
  phase: RunSavePhase;
  sprint: null;
  sprintTick: 0;
  whatIf: null;
  whatIfStatus: 'idle';
  orgScale: null;
  industry: null;
  extras: RunPersistExtras;
};

/**
 * リプレイ閲覧用フレーム（RI-61）。
 * 途中セーブと同じ形だが、終端フェーズ won/lost も許容する。
 */
export type RunReplayFrame = Omit<RunPersistState, 'phase'> & {
  phase: ReplayFramePhase;
};

/**
 * 反実仮想用の永続スライス。セーブ不可の sprint フェーズも許容する（RI-101）。
 * プレイヤーセーブ契約（`exportPersistState`）とは別物。
 */
export type CounterfactualPersist = Omit<RunReplayFrame, 'phase'> & {
  phase: RunPhase;
};

/** 同一乱数状態から分岐するために必要な中間スプリント状態（RI-101）。 */
export interface CounterfactualFrame {
  persist: CounterfactualPersist;
  sprint: SprintState | null;
  sprintTick: number;
  accumulatorMs: number;
  sprintRngState: number;
  sprintBaselineInput: SprintBaselineInput | null;
  sprintPassiveEffects: CardEffects;
  chargedInfraCost: number;
  chargedInfraDependency: number;
  chargedInfraRate: number;
  /**
   * 解放プール。`null` は無制限。空配列は1枚も使えない。
   * persist extras の空配列とは区別する（プレイヤーセーブ契約は変えない）。
   */
  allowedCards: string[] | null;
  allowedRelics: string[] | null;
}
