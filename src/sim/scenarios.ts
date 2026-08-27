/**
 * 難易度と直交する開始シナリオ（SPEC 第23章 / RI-103）。
 *
 * 組織の初期パラメータ差分とスプリント係数をデータとして持つ。
 * 実ランの組織成熟度の正本は難易度（`src/data/difficulties.ts`）で、
 * シナリオは導入済みツールの差分だけを加算する。
 */
import { clamp } from './clamp';
import { AI_DEP_PER_TASK } from './model/process';
import type { CardEffects, ScenarioId, SprintConfig } from './types';

/** シナリオが持つ組織の初期パラメータ（0..100）。 */
export interface ScenarioOrg {
  /** AI 導入時の AI依存度の初期値。 */
  aiDependencyBase: number;
  aiLiteracy: number;
  testCoverage: number;
  documentation: number;
  quality: number;
  /** セキュリティ水準の初期値（RI-87）。 */
  securityLevel: number;
  morale: number;
  seniorHp: number;
}

export interface Scenario {
  id: ScenarioId;
  label: string;
  description: string;
  org: ScenarioOrg;
  sprint: SprintConfig;
  /** 難易度 org へ加算する差分（RI-103）。 */
  orgDelta?: Partial<ScenarioOrg>;
  /** 難易度の直後に畳み込む係数（RI-103）。カードより弱い。 */
  globalEffects?: Partial<CardEffects>;
  /**
   * AI 割当タスク 1 件あたりの依存度上昇。未指定時は難易度／グローバル既定。
   * 難易度側がより低い値なら難易度を優先する（Nightmare RI-74）。
   */
  aiDependencyPerTask?: number;
}

export const DEFAULT_SCENARIO: ScenarioId = 'default';

const DEFAULT_ORG: ScenarioOrg = {
  aiDependencyBase: 35,
  aiLiteracy: 45,
  testCoverage: 55,
  documentation: 50,
  quality: 60,
  securityLevel: 60,
  morale: 70,
  seniorHp: 100,
};

const DEFAULT_SPRINT: SprintConfig = {
  // RI-62: ベース構成は維持。実時間帯は UI テンポ（MS_PER_TICK_1X）で充足する。
  taskCount: 28,
  codingSlots: 6,
  maxTicks: 1500,
  focusMax: 12,
};

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  default: {
    id: 'default',
    label: '標準',
    description: '特定の AI ツールを前提にしない、通常の開始条件。',
    org: DEFAULT_ORG,
    sprint: DEFAULT_SPRINT,
  },
  copilot: {
    id: 'copilot',
    label: 'Copilot',
    description: 'コーディング補助が行き渡り、定型は速いが依存度と検証の薄さが残る。',
    org: DEFAULT_ORG,
    sprint: DEFAULT_SPRINT,
    orgDelta: { aiDependencyBase: 8, securityLevel: -5 },
    globalEffects: { codingSpeedMul: 1.06, routineSpeedMul: 1.12 },
    /**
     * Easy の通常床 58 タスク × 採用率およそ 43% で AI 割当が約 25 件。
     * 既定 2.2 だと開始 33 から Sprint 1 で 33+25×2.2=88 まで跳ねて Review Hell と重なる（#387）。
     * 初期依存は orgDelta +8 で既に織り込み済みなので、追加ランプだけ抑える。
     * 1.4 なら同一 seed で 33+25×1.4=68。速度ボーナスは残し、レビュー圧は Copilot の代償として残す。
     */
    aiDependencyPerTask: 1.4,
  },
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    description: '高度な補助で品質は安定するが、レビュー負荷が増える。',
    org: DEFAULT_ORG,
    sprint: DEFAULT_SPRINT,
    orgDelta: { aiLiteracy: 8, quality: 5, securityLevel: -3 },
    globalEffects: { codingSpeedMul: 1.08, reviewEfficiencyMul: 0.94, reworkRateAdd: -0.02 },
  },
  devin: {
    id: 'devin',
    label: 'Devin',
    description: '自律実装で並列は進むが、ドキュメント不足と手戻りが増えやすい。',
    org: DEFAULT_ORG,
    sprint: DEFAULT_SPRINT,
    orgDelta: { aiDependencyBase: 10, documentation: -8, securityLevel: -6 },
    globalEffects: { codingSpeedMul: 1.1, reworkRateAdd: 0.03 },
  },
};

/** タイトルで選べるシナリオの表示順（定義オブジェクトの順序を正本とする）。 */
export const SCENARIO_ORDER: readonly ScenarioId[] = Object.keys(SCENARIOS) as ScenarioId[];

/** シナリオ定義を取得する（未知の id は標準にフォールバック）。 */
export function getScenario(id: ScenarioId): Scenario {
  return SCENARIOS[id] ?? SCENARIOS[DEFAULT_SCENARIO];
}

/** 未知・欠落を標準へ正規化する（RI-103）。 */
export function resolveScenarioId(id: ScenarioId | undefined | null): ScenarioId {
  if (!id) return DEFAULT_SCENARIO;
  return SCENARIOS[id] ? id : DEFAULT_SCENARIO;
}

const ORG_KEYS: readonly (keyof ScenarioOrg)[] = [
  'aiDependencyBase',
  'aiLiteracy',
  'testCoverage',
  'documentation',
  'quality',
  'securityLevel',
  'morale',
  'seniorHp',
];

/**
 * 難易度とシナリオから AI 依存度のタスク単価を決める。
 * どちらも未指定ならグローバル既定を使うため `undefined` を返す。
 * 両方あるときは低い方を採り、Nightmare の S1 即死回避（RI-74）を崩さない。
 */
export function resolveAiDependencyPerTask(
  difficultyPerTask: number | undefined,
  scenarioPerTask: number | undefined,
): number | undefined {
  if (difficultyPerTask === undefined && scenarioPerTask === undefined) return undefined;
  return Math.min(difficultyPerTask ?? AI_DEP_PER_TASK, scenarioPerTask ?? AI_DEP_PER_TASK);
}

/** 難易度の組織初期値へシナリオ差分を加算し 0..100 に収める（RI-103）。 */
export function applyScenarioOrg(base: ScenarioOrg, scenario: Scenario): ScenarioOrg {
  const delta = scenario.orgDelta;
  if (!delta) return { ...base };
  const next = { ...base };
  for (const key of ORG_KEYS) {
    const add = delta[key];
    if (add === undefined) continue;
    next[key] = clamp(base[key] + add, 0, 100);
  }
  return next;
}
