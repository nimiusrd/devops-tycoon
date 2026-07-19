/**
 * ラン途中セーブ用の hydrate 状態（RI-58）。
 *
 * フェーズ境界スナップショットのみ。永続化・正規化は `src/state/runSave.ts`。
 */
import type { SprintConfig, OrgState, SprintResult, CardInstance } from '../types';
import type { GrowthOutcome, RosterState } from '../member/types';
import type { OrgAdjustState, RankingKind, ZoomState } from '../orgscale/types';
import type {
  BeatState,
  DiagnosisType,
  DifficultyId,
  EvolutionState,
  GoalAdjustmentId,
  LoseReason,
  QuarterGoal,
  QuarterOutcome,
  QuarterReview,
  RunKind,
  RunPhase,
  RunStatus,
  RunTotals,
  ShopOffer,
  SprintKind,
  SprintModifierDelta,
  StakeholderTrust,
  WinType,
} from './types';

/** セーブスキーマ版。非互換時は破棄する。 */
export const RUN_SAVE_SCHEMA_VERSION = 1;

/**
 * データ定義やエンジン契約が変わり決定論が壊れるときに上げる。
 * 不一致のセーブは読み捨てる。
 */
export const RUN_SAVE_ENGINE_VERSION = 1;

/** フェーズ境界セーブで許可する phase（sprint / title は除外）。 */
const SAVEABLE_PHASES: ReadonlySet<RunPhase> = new Set([
  'setup',
  'result',
  'draft',
  'evolution',
  'beat',
  'shop',
  'rest',
  'recruit',
  'quarterReview',
  'won',
  'lost',
]);

/** RunEngine の private 復元に必要なフィールド。 */
export interface RunSavePrivate {
  allowedCards: string[];
  allowedRelics: string[];
  baseConfig: SprintConfig;
  orgAdjust: OrgAdjustState;
  nextBudgetCap: number | null;
  pauseAiDebuffQuarter: number | null;
  winEvalOrg: OrgState | null;
}

/** GameHandle 側の復元フィールド。 */
export interface RunSaveGame {
  activeDailyDate: string | null;
  recorded: boolean;
}

/**
 * 永続化するラン状態（orgScale / industry / whatIf / sprint は含めない）。
 * hydrate 時に再計算・null 固定する。
 */
export interface RunSaveState {
  seed: string;
  difficulty: DifficultyId;
  trials: string[];
  runKind: RunKind;
  dailyDate?: string;
  phase: RunPhase;
  status: RunStatus;
  winType?: WinType;
  loseReason?: LoseReason;
  bossId: string;
  sprintsPerQuarter: number;
  sprintIndexInQuarter: number;
  beat: BeatState | null;
  pendingSprintKind: SprintKind;
  currentSprintKind: SprintKind;
  pendingSprintModifiers: SprintModifierDelta;
  org: OrgState;
  deck: CardInstance[];
  relics: string[];
  bossRelicReward?: string;
  evolution: EvolutionState;
  roster: RosterState;
  lastGrowth: GrowthOutcome | null;
  budget: number;
  currentSprintId: string | null;
  sprintTick: number;
  lastResult: SprintResult | null;
  draft: string[] | null;
  shop: ShopOffer | null;
  diagnosis: DiagnosisType;
  sprintsPlayed: number;
  totals: RunTotals;
  quarterTotals: RunTotals;
  usedHeavyActions: boolean;
  quarterNumber: number;
  quarterGoal: QuarterGoal;
  stakeholderTrust: StakeholderTrust;
  quarterReview: QuarterReview | null;
  goalAdjustmentsTaken: GoalAdjustmentId[];
  reviewHistory: QuarterOutcome[];
  zoom: ZoomState;
  rankingKind: RankingKind;
}

/** IndexedDB に保存するランセーブ本体。 */
export interface RunSaveBlob {
  schemaVersion: typeof RUN_SAVE_SCHEMA_VERSION;
  engineVersion: typeof RUN_SAVE_ENGINE_VERSION;
  savedAt: number;
  private: RunSavePrivate;
  state: RunSaveState;
  game: RunSaveGame;
}

export function isSaveablePhase(phase: RunPhase): boolean {
  return SAVEABLE_PHASES.has(phase);
}
