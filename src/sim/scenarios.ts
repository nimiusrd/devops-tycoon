/**
 * 難易度と直交する開始シナリオ（SPEC 第23章 / RI-103）。
 *
 * 組織の初期パラメータ差分とスプリント係数をデータとして持つ。
 * 実ランの組織成熟度の正本は難易度（`src/data/difficulties.ts`）で、
 * シナリオは導入済みツールの差分だけを加算する。
 */
import { getDifficulty } from '../data/difficulties';
import { clamp } from './clamp';
import type { DifficultyId } from './run/types';
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

/**
 * AI 割当 1 件あたりの依存度上昇を難易度とシナリオから合成する。
 *
 * Easy の 1.1（#359）は default シナリオ限定。ツール開始（Copilot 等）は
 * シナリオ単価があればそれを使い、未指定ならグローバル既定 2.2 に戻す。
 * 両方あるときは低い方を採用し、Nightmare の 0.8（RI-74）を上書きしない。
 */
export function resolveAiDependencyPerTask(
  difficulty: DifficultyId,
  scenarioId?: ScenarioId | null,
): number | undefined {
  const scenario = resolveScenarioId(scenarioId);
  const scenarioRate = getScenario(scenario).sprint.aiDependencyPerTask;
  const difficultyRate =
    difficulty === 'easy' && scenario !== DEFAULT_SCENARIO
      ? undefined
      : getDifficulty(difficulty).aiDependencyPerTask;
  if (scenarioRate !== undefined && difficultyRate !== undefined) {
    return Math.min(scenarioRate, difficultyRate);
  }
  return scenarioRate ?? difficultyRate;
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
