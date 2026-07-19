/**
 * ラン途中セーブ用の永続スナップショット型（RI-58）。
 * sim 層に置き、state 永続化と engine の双方から参照する。
 */
import type { OrgState, SprintConfig } from '../types';
import type { OrgAdjustState } from '../orgscale/types';
import type { RunPhase, RunState } from './types';

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

/** snapshot() に載らない内部状態（復元に必須）。 */
export interface RunPersistExtras {
  baseConfig: SprintConfig;
  orgAdjust: OrgAdjustState;
  nextBudgetCap: number | null;
  pauseAiDebuffQuarter: number | null;
  winEvalOrg: OrgState | null;
  /** ラン開始時に固定した解放プール。 */
  allowedCards: string[];
  allowedRelics: string[];
}

/**
 * エンジン復元用本体。
 * sprint / whatIf / orgScale / industry は永続せず、復元時に再生成または null とする。
 */
export type RunPersistState = Omit<
  RunState,
  'whatIf' | 'whatIfStatus' | 'orgScale' | 'industry' | 'phase' | 'sprint' | 'sprintTick'
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
