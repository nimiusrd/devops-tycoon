/**
 * ラン途中セーブ用の永続スナップショット型（RI-58）。
 * sim 層に置き、state 永続化と engine の双方から参照する。
 */
import type { OrgState, SprintConfig } from '../types';
import type { OrgAdjustState, TeamRunState } from '../orgscale/types';
import type { RosterState } from '../member/types';
import type { GoalAdjustmentId, RunPhase, RunState } from './types';

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

const REPLAY_FRAME_PHASES = new Set<RunPhase>(['setup', 'result', 'quarterReview', 'won', 'lost']);

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
