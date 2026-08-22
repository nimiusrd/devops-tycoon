/**
 * ラン途中セーブの永続化（RI-58 / SPEC 第17・22章）。
 *
 * 保存形式は RunEngine のスナップショット直列化（案 A）。
 * seed＋入力ログ再生（案 B）は RI-61 のリプレイ用に切り出す。
 * フェーズ遷移時のみ保存し、スプリント tick 中は更新しない。
 */
import { isRunSavePhase, type RunPersistState, type RunSavePhase } from '../sim/run/persist';
import { canHydratePersistState, canHydrateReplayFrame } from '../sim/run/persistValidation';
import type { DifficultyId, GoalKpiProgress, RunKind, RunPhase, RunStatus } from '../sim/run/types';
import { companyOrgFromTeams } from '../sim/orgscale';
import { BALANCE_RULESET_FINGERPRINT, BALANCE_RULESET_VERSION } from '../data/balance';
import {
  availableAdjustments,
  diagnoseMissedReasons,
  evaluateQuarterOutcome,
  goalProgressStatus,
  MIN_ADJUSTED_QUARTER_DELIVERY_TARGET,
  QUARTER_DELIVERY_GOAL_MUL,
} from '../sim/run/quarterReview';
import { GAME_DB_NAME, openGameDb, RUN_RECORD_KEY, RUN_STORE_NAME } from './gameDb';
import { normalizeReplayKeyframes, type ReplayKeyframe } from './replay';
import { cloneTrendHistory } from '../sim/run/trendHistory';

export type { RunPersistState, RunPersistExtras, RunSavePhase } from '../sim/run/persist';
export { isRunSavePhase } from '../sim/run/persist';

/**
 * RI-68: Delivery 目標が四半期累計スケールになったため v1/v2 は非互換。
 * RI-75: タスク床／Delivery 目標倍率の再校正で進行中四半期の目標スケールが変わるため v3 も非互換。
 * RI-84: 安定化再校正で v4 の Delivery 目標を移行する。
 * RI-77: AI 出荷価値倍率後の目標再校正で v5 の Delivery 目標を現行倍率へ移行する。
 * RI-128: v6 は trendHistory 欠落を空配列へ補完する。
 * RI-117: v8 から保存時のバランスルールセットを記録する。v4〜v7 は
 * ルールセット情報を持たない旧セーブとして保持するが、再開は許可しない。
 */
export const RUN_SAVE_SCHEMA_VERSION = 8 as const;
const LEGACY_V7_RUN_SAVE_SCHEMA_VERSION = 7 as const;
const LEGACY_V6_RUN_SAVE_SCHEMA_VERSION = 6 as const;
const LEGACY_V5_RUN_SAVE_SCHEMA_VERSION = 5 as const;
const LEGACY_V4_RUN_SAVE_SCHEMA_VERSION = 4 as const;

/** v4 が保存していた Delivery 目標倍率。 */
const V4_QUARTER_DELIVERY_GOAL_MUL: Record<DifficultyId, number> = {
  easy: 2.15,
  normal: 1.95,
  hard: 1.5,
  nightmare: 1.65,
};

/** v5 が保存していた Delivery 目標倍率（RI-77 再校正前）。 */
const V5_QUARTER_DELIVERY_GOAL_MUL: Record<DifficultyId, number> = {
  easy: 2.0,
  normal: 1.8,
  hard: 1.4,
  nightmare: 1.55,
};

/** セーブと一緒に保存する、結果へ影響するルールセット識別子。 */
export interface RunRulesetIdentity {
  readonly version: number;
  readonly fingerprint: string;
}

/** 現行バランスルールセット。セーブの互換判定と新規保存で共有する。 */
export const CURRENT_RUN_RULESET: RunRulesetIdentity = {
  version: BALANCE_RULESET_VERSION,
  fingerprint: BALANCE_RULESET_FINGERPRINT,
};

/** タイトル「続きから」表示用の要約。 */
export interface RunSaveSummary {
  seed: string;
  difficulty: DifficultyId;
  trials: string[];
  runKind: RunKind;
  dailyDate?: string;
  phase: RunSavePhase;
  quarterNumber: number;
  sprintIndexInQuarter: number;
  sprintsPlayed: number;
  status: RunStatus;
}

/** ルールセット不一致または情報欠落で再開できないセーブの理由。 */
export interface RunSaveCompatibilityIssue {
  readonly kind: 'ruleset-unknown' | 'ruleset-mismatch';
  readonly summary: RunSaveSummary;
  readonly savedRuleset: RunRulesetIdentity | null;
  readonly currentRuleset: RunRulesetIdentity;
}

/** IndexedDB に載せるレコード。 */
export interface RunSave {
  schemaVersion: typeof RUN_SAVE_SCHEMA_VERSION;
  savedAt: number;
  /** 旧セーブを表示用に保持する場合は null。新規セーブでは必ず設定する。 */
  ruleset: RunRulesetIdentity | null;
  summary: RunSaveSummary;
  state: RunPersistState;
  /**
   * 再開後も完走リプレイが前半を保持できるよう、収集済みキーフレームを同梱する（RI-61）。
   * 旧セーブでは欠落しうる（その場合は空配列）。
   */
  replayKeyframes: ReplayKeyframe[];
}

export type RunSaveFileImportReason =
  | 'invalid-json'
  | 'unsupported-schema'
  | 'invalid-data'
  | 'ruleset-unknown'
  | 'ruleset-mismatch'
  | 'stale'
  | 'storage';

export interface RunSaveFileImportSuccess {
  readonly ok: true;
  readonly save: RunSave;
  readonly message: string;
}

export interface RunSaveFileImportFailure {
  readonly ok: false;
  readonly reason: RunSaveFileImportReason;
  readonly message: string;
  readonly issue?: RunSaveCompatibilityIssue;
}

export type RunSaveFileImportResult = RunSaveFileImportSuccess | RunSaveFileImportFailure;

export interface RunStorage {
  load(): Promise<RunSave | null>;
  save(save: RunSave): Promise<void>;
  clear(): Promise<void>;
}

export interface RunPersistenceBootstrap {
  save: RunSave | null;
  issue: RunSaveCompatibilityIssue | null;
  storage: RunStorage;
}

const INVALID_RULESET = Symbol('invalid-ruleset');

function parseRunRuleset(value: unknown): RunRulesetIdentity | null | typeof INVALID_RULESET {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return INVALID_RULESET;
  const version = value.version;
  const fingerprint = value.fingerprint;
  if (
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    typeof fingerprint !== 'string' ||
    fingerprint.length === 0
  ) {
    return INVALID_RULESET;
  }
  return {
    version,
    fingerprint,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDifficulty(value: unknown): value is DifficultyId {
  return value === 'easy' || value === 'normal' || value === 'hard' || value === 'nightmare';
}

function isRunKind(value: unknown): value is RunKind {
  return value === 'normal' || value === 'daily';
}

function isRunStatus(value: unknown): value is RunStatus {
  return value === 'playing' || value === 'won' || value === 'lost';
}

/** 旧スキーマの途中セーブを現行の難易度別 Delivery 倍率へ移行する。 */
function migrateDeliveryGoal(
  state: Record<string, unknown>,
  difficulty: DifficultyId,
  legacyScale: number,
): RunPersistState | null {
  if (!isRecord(state.quarterGoal)) return null;
  const deliveryTarget = state.quarterGoal.deliveryTarget;
  if (typeof deliveryTarget !== 'number' || !Number.isFinite(deliveryTarget)) return null;
  const currentScale = QUARTER_DELIVERY_GOAL_MUL[difficulty];
  return {
    ...(state as unknown as RunPersistState),
    quarterGoal: {
      ...(state.quarterGoal as Record<string, unknown>),
      // 目標修正（cut_scope等）後の値も同じ倍率比で移行し、調整結果を保つ。
      deliveryTarget: Math.max(
        MIN_ADJUSTED_QUARTER_DELIVERY_TARGET,
        Math.round((deliveryTarget * currentScale) / legacyScale),
      ),
    } as RunPersistState['quarterGoal'],
  };
}

function isGoalKpiStatus(value: unknown): value is GoalKpiProgress['status'] {
  return value === 'exceeded' || value === 'met' || value === 'missed';
}

function isGoalKpiProgress(value: unknown): value is GoalKpiProgress {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.target === 'number' &&
    Number.isFinite(value.target) &&
    typeof value.actual === 'number' &&
    Number.isFinite(value.actual) &&
    isGoalKpiStatus(value.status)
  );
}

function progressTarget(
  goal: RunPersistState['quarterGoal'],
  id: string,
): { target: number; higherIsBetter: boolean } | null {
  switch (id) {
    case 'delivery':
      return { target: goal.deliveryTarget, higherIsBetter: true };
    case 'quality':
      return { target: goal.qualityTarget, higherIsBetter: true };
    case 'techDebt':
      return { target: goal.techDebtLimit, higherIsBetter: false };
    case 'morale':
      return { target: goal.moraleTarget, higherIsBetter: true };
    case 'incident':
      return { target: goal.incidentLimit, higherIsBetter: false };
    case 'aiAdoption':
      return goal.aiAdoptionTarget === undefined
        ? null
        : { target: goal.aiAdoptionTarget, higherIsBetter: true };
    default:
      return null;
  }
}

/** 保存済み実績から、現行目標に対する KPI 進捗を再判定する。 */
function migrateReviewProgress(
  state: RunPersistState,
  goal: RunPersistState['quarterGoal'],
): GoalKpiProgress[] | null {
  const savedProgress = state.quarterReview?.progress;
  if (!Array.isArray(savedProgress) || !savedProgress.every(isGoalKpiProgress)) return null;

  const requiredIds = new Set(['delivery', 'quality', 'techDebt', 'morale', 'incident']);
  if (goal.aiAdoptionTarget !== undefined) requiredIds.add('aiAdoption');
  const seen = new Set<string>();
  const progress: GoalKpiProgress[] = [];
  for (const item of savedProgress) {
    if (seen.has(item.id)) return null;
    seen.add(item.id);
    const target = progressTarget(goal, item.id);
    if (!target) return null;
    progress.push({
      ...item,
      target: target.target,
      status: goalProgressStatus(item.actual, target.target, target.higherIsBetter),
    });
  }
  if (seen.size !== requiredIds.size || [...requiredIds].some((id) => !seen.has(id))) return null;
  return progress;
}

/** 旧スキーマの四半期レビューを、保存済みの報酬前実績と現行目標から再構築する。 */
function rebuildMigratedQuarterReview(state: RunPersistState): RunPersistState | null {
  if (state.phase !== 'quarterReview') return state;
  if (!state.quarterReview || typeof state.quarterReview.bossCleared !== 'boolean') return null;

  // ボス突破後の state.org / teams には、レビュー判定後に付与されたレリック効果が
  // 反映されている。現行 org から再計算すると Quality 等の KPI が変わるため、
  // 保存済み progress の実績値を正として Delivery 目標だけを現行値へ再判定する。
  const progress = migrateReviewProgress(state, state.quarterGoal);
  if (!progress) return null;
  const companyOrg = companyOrgFromTeams(state.extras.teams ?? [], state.org);
  const reviewOrg = { ...companyOrg };
  for (const id of ['quality', 'techDebt', 'morale'] as const) {
    const actual = progress.find((item) => item.id === id)?.actual;
    if (actual !== undefined) reviewOrg[id === 'techDebt' ? 'techDebt' : id] = actual;
  }
  // seniorHp は KPI progress に含まれないため、ボス報酬前スナップショットが存在する
  // 旧セーブではそこから補完する。AI 依存度は全社集約値を維持する。
  if (state.extras.winEvalOrg) {
    reviewOrg.seniorHp = state.extras.winEvalOrg.seniorHp;
  }

  const outcome = evaluateQuarterOutcome({
    bossCleared: state.quarterReview.bossCleared,
    progress,
    trust: state.stakeholderTrust,
    org: reviewOrg,
    budget: state.budget,
    quarterNumber: state.quarterNumber,
  });
  let finalOutcome = outcome;
  const adjustments = availableAdjustments(
    outcome,
    state.stakeholderTrust,
    state.budget,
    reviewOrg,
    state.quarterTotals,
  );
  if (finalOutcome === 'missed_adjustable' && adjustments.length === 0) {
    finalOutcome = 'missed_crisis';
  }
  const missedReasons =
    finalOutcome === 'exceeded' || finalOutcome === 'met'
      ? []
      : diagnoseMissedReasons({
          progress,
          org: reviewOrg,
          totals: state.quarterTotals,
          bossCleared: state.quarterReview.bossCleared,
        });
  const quarterReview = {
    goal: state.quarterGoal,
    outcome: finalOutcome,
    trust: { ...state.stakeholderTrust },
    progress,
    missedReasons,
    availableAdjustments: finalOutcome === 'missed_adjustable' ? adjustments : [],
    bossCleared: state.quarterReview.bossCleared,
  };
  const reviewHistory = [...state.reviewHistory];
  if (reviewHistory.length > 0) {
    reviewHistory[reviewHistory.length - 1] = quarterReview.outcome;
  } else {
    reviewHistory.push(quarterReview.outcome);
  }
  return { ...state, quarterReview, reviewHistory };
}

/** 構造が壊れている／未対応スキーマのセーブは null（呼び出し側で clear）。 */
export function parseRunSave(raw: unknown): RunSave | null {
  if (!isRecord(raw)) return null;
  // v1/v2/v3 は破棄。v4（RI-84）・v5（RI-77 再校正前）は Delivery 目標を現行へ移行する。
  // v6 は trendHistory 欠落を空配列へ補完する（RI-128）。
  const schema = raw.schemaVersion;
  const isLegacyV7 = schema === LEGACY_V7_RUN_SAVE_SCHEMA_VERSION;
  const isLegacyV4 = schema === LEGACY_V4_RUN_SAVE_SCHEMA_VERSION;
  const isLegacyV5 = schema === LEGACY_V5_RUN_SAVE_SCHEMA_VERSION;
  const isLegacyV6 = schema === LEGACY_V6_RUN_SAVE_SCHEMA_VERSION;
  const isLegacySchema = isLegacyV4 || isLegacyV5 || isLegacyV6 || isLegacyV7;
  if (schema !== RUN_SAVE_SCHEMA_VERSION && !isLegacySchema) return null;
  if (typeof raw.savedAt !== 'number' || !Number.isFinite(raw.savedAt)) return null;
  if (!isRecord(raw.summary) || !isRecord(raw.state)) return null;

  // RI-117導入前のスキーマは、たとえテスト用に同名フィールドが混ざっていても
  // ルールセット不明として扱う。現行スキーマのフィールドが壊れている場合だけ
  // 構造破損として拒否する。
  const parsedRuleset = isLegacySchema ? null : parseRunRuleset(raw.ruleset);
  if (parsedRuleset === INVALID_RULESET) return null;

  const summary = raw.summary;
  const state = raw.state;
  if (typeof summary.seed !== 'string') return null;
  if (!isDifficulty(summary.difficulty)) return null;
  if (!Array.isArray(summary.trials) || !summary.trials.every((t) => typeof t === 'string')) {
    return null;
  }
  if (!isRunKind(summary.runKind)) return null;
  if (summary.dailyDate !== undefined && typeof summary.dailyDate !== 'string') return null;
  if (typeof summary.phase !== 'string' || !isRunSavePhase(summary.phase as RunPhase)) return null;
  if (typeof summary.quarterNumber !== 'number') return null;
  if (typeof summary.sprintIndexInQuarter !== 'number') return null;
  if (typeof summary.sprintsPlayed !== 'number') return null;
  if (!isRunStatus(summary.status) || summary.status !== 'playing') return null;

  if (typeof state.phase !== 'string' || !isRunSavePhase(state.phase as RunPhase)) return null;
  if (state.phase !== summary.phase) return null;
  if (!isRunStatus(state.status) || state.status !== 'playing') return null;
  if (typeof state.seed !== 'string' || state.seed !== summary.seed) return null;
  if (!isDifficulty(state.difficulty) || state.difficulty !== summary.difficulty) return null;
  if (!isRunKind(state.runKind) || state.runKind !== summary.runKind) return null;
  if (state.dailyDate !== undefined && typeof state.dailyDate !== 'string') return null;
  if (state.dailyDate !== summary.dailyDate) return null;
  if (!isRecord(state.extras)) return null;
  if (!Array.isArray(state.extras.allowedCards)) return null;
  if (!Array.isArray(state.extras.allowedRelics)) return null;
  if (!isRecord(state.extras.baseConfig)) return null;
  if (!isRecord(state.extras.orgAdjust)) return null;

  const legacyScale = isLegacyV4
    ? V4_QUARTER_DELIVERY_GOAL_MUL[summary.difficulty]
    : isLegacyV5
      ? V5_QUARTER_DELIVERY_GOAL_MUL[summary.difficulty]
      : null;
  const migratedState =
    legacyScale === null
      ? (state as unknown as RunPersistState)
      : migrateDeliveryGoal(state, summary.difficulty, legacyScale);
  const stateWithCurrentReview =
    legacyScale !== null && migratedState
      ? rebuildMigratedQuarterReview(migratedState)
      : migratedState;
  if (!stateWithCurrentReview) return null;

  // セーブ時は sprint を落とす契約。残っていても復元側で無視する。
  return {
    schemaVersion: RUN_SAVE_SCHEMA_VERSION,
    savedAt: raw.savedAt,
    ruleset: parsedRuleset,
    summary: {
      seed: summary.seed,
      difficulty: summary.difficulty,
      trials: [...summary.trials],
      runKind: summary.runKind,
      dailyDate: summary.dailyDate,
      phase: summary.phase as RunSavePhase,
      quarterNumber: summary.quarterNumber,
      sprintIndexInQuarter: summary.sprintIndexInQuarter,
      sprintsPlayed: summary.sprintsPlayed,
      status: 'playing',
    },
    state: {
      ...stateWithCurrentReview,
      trendHistory: cloneTrendHistory(stateWithCurrentReview.trendHistory),
    },
    replayKeyframes: normalizeReplayKeyframes(raw.replayKeyframes),
  };
}

function isSupportedRunSaveSchema(value: unknown): value is 4 | 5 | 6 | 7 | 8 {
  return value === 4 || value === 5 || value === 6 || value === 7 || value === 8;
}

function formatRunRuleset(ruleset: RunRulesetIdentity): string {
  return `v${ruleset.version} / ${ruleset.fingerprint}`;
}

/** 現行セーブをファイル共有用のJSONへ変換する。 */
export function serializeRunSave(save: RunSave): string {
  return `${JSON.stringify(save, null, 2)}\n`;
}

/** セーブファイルをJSON解析・正規化し、再開可否まで検証する。 */
export function parseRunSaveFile(raw: string): RunSaveFileImportResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: 'invalid-json',
      message: 'JSONを解析できないため、途中セーブを読み込めません。',
    };
  }

  if (!isRecord(value)) {
    return {
      ok: false,
      reason: 'invalid-data',
      message: '途中セーブのJSON構造が正しくありません。',
    };
  }
  if (!isSupportedRunSaveSchema(value.schemaVersion)) {
    return {
      ok: false,
      reason: 'unsupported-schema',
      message: `未対応の途中セーブスキーマです（schemaVersion: ${String(value.schemaVersion)}）。`,
    };
  }

  const save = parseRunSave(value);
  if (!save) {
    return {
      ok: false,
      reason: 'invalid-data',
      message: '途中セーブの必須データが欠落しているか、壊れています。',
    };
  }
  if (!canHydratePersistState(save.state)) {
    return {
      ok: false,
      reason: 'invalid-data',
      message: '途中セーブの状態全体を復元できないため、読み込めません。',
    };
  }
  if (!save.replayKeyframes.every(({ frame }) => canHydrateReplayFrame(frame))) {
    return {
      ok: false,
      reason: 'invalid-data',
      message: '途中セーブに含まれるリプレイを復元できないため、読み込めません。',
    };
  }

  const issue = getRunSaveCompatibilityIssue(save);
  if (issue) {
    return {
      ok: false,
      reason: issue.kind,
      message:
        issue.kind === 'ruleset-unknown'
          ? 'ルールセット情報がないため、この途中セーブは再開できません。'
          : `保存時と現在のルールセットが一致しないため、この途中セーブは再開できません（保存時: ${formatRunRuleset(issue.savedRuleset!)} / 現在: ${formatRunRuleset(issue.currentRuleset)}）。`,
      issue,
    };
  }

  return {
    ok: true,
    save,
    message: '途中セーブを読み込みました。「続きから」で再開できます。',
  };
}

/** セーブが現行ルールセットで再開可能かを判定する。 */
export function getRunSaveCompatibilityIssue(
  save: Pick<RunSave, 'summary' | 'ruleset'>,
): RunSaveCompatibilityIssue | null {
  const currentRuleset = { ...CURRENT_RUN_RULESET };
  if (save.ruleset === null || save.ruleset === undefined) {
    return {
      kind: 'ruleset-unknown',
      summary: structuredClone(save.summary),
      savedRuleset: null,
      currentRuleset,
    };
  }
  if (
    save.ruleset.version !== currentRuleset.version ||
    save.ruleset.fingerprint !== currentRuleset.fingerprint
  ) {
    return {
      kind: 'ruleset-mismatch',
      summary: structuredClone(save.summary),
      savedRuleset: { ...save.ruleset },
      currentRuleset,
    };
  }
  return null;
}

/** PersistState から IndexedDB レコードを組み立てる。 */
export function toRunSave(
  state: RunPersistState,
  savedAt: number = Date.now(),
  replayKeyframes: readonly ReplayKeyframe[] = [],
): RunSave {
  return {
    schemaVersion: RUN_SAVE_SCHEMA_VERSION,
    savedAt,
    ruleset: { ...CURRENT_RUN_RULESET },
    summary: {
      seed: state.seed,
      difficulty: state.difficulty,
      trials: [...state.trials],
      runKind: state.runKind,
      dailyDate: state.dailyDate,
      phase: state.phase,
      quarterNumber: state.quarterNumber,
      sprintIndexInQuarter: state.sprintIndexInQuarter,
      sprintsPlayed: state.sprintsPlayed,
      status: state.status,
    },
    state: structuredClone(state),
    replayKeyframes: structuredClone(replayKeyframes) as ReplayKeyframe[],
  };
}

/** IndexedDB に単一の最新ランセーブを保存する。 */
export class IndexedDbRunStorage implements RunStorage {
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly dbName: string = GAME_DB_NAME) {}

  async load(): Promise<RunSave | null> {
    await this.writes.catch(() => undefined);
    const db = await openGameDb(this.dbName);
    try {
      const stored = await db.get(RUN_STORE_NAME, RUN_RECORD_KEY);
      if (stored === undefined) return null;
      const parsed = parseRunSave(stored);
      if (!parsed) {
        await db.delete(RUN_STORE_NAME, RUN_RECORD_KEY);
        return null;
      }
      return parsed;
    } finally {
      db.close();
    }
  }

  save(save: RunSave): Promise<void> {
    const snapshot = structuredClone(save);
    const write = this.writes.then(async () => {
      const db = await openGameDb(this.dbName);
      try {
        await db.put(RUN_STORE_NAME, snapshot, RUN_RECORD_KEY);
      } finally {
        db.close();
      }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  clear(): Promise<void> {
    const write = this.writes.then(async () => {
      const db = await openGameDb(this.dbName);
      try {
        await db.delete(RUN_STORE_NAME, RUN_RECORD_KEY);
      } finally {
        db.close();
      }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }
}

/** メモリ上だけで動く RunStorage（テスト / IDB 不可時）。 */
export class MemoryRunStorage implements RunStorage {
  private saveState: RunSave | null = null;

  async load(): Promise<RunSave | null> {
    return this.saveState ? structuredClone(this.saveState) : null;
  }

  async save(save: RunSave): Promise<void> {
    this.saveState = structuredClone(save);
  }

  async clear(): Promise<void> {
    this.saveState = null;
  }
}

/**
 * ランセーブを読み込む。構造破損・未対応スキーマは破棄し、ルールセット非互換は issue として保持する。
 * IndexedDB が使えない場合は空の MemoryRunStorage で続行する。
 */
export async function initializeRunPersistence(
  storage: RunStorage = new IndexedDbRunStorage(),
): Promise<RunPersistenceBootstrap> {
  try {
    const save = await storage.load();
    const issue = save ? getRunSaveCompatibilityIssue(save) : null;
    return { save: issue ? null : save, issue, storage };
  } catch {
    return { save: null, issue: null, storage: new MemoryRunStorage() };
  }
}
