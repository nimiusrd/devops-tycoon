/**
 * 難易度プリセット（SPEC 第16章）。
 *
 * Phase 1 では「標準」のみ。組織の初期パラメータとスプリント構成を
 * データとして持ち、Phase 3 以降で Easy/Hard/Nightmare を追加する。
 */
import type { ScenarioId, SprintConfig } from './types';

/** シナリオが持つ組織の初期パラメータ（0..100）。 */
export interface ScenarioOrg {
  /** AI 導入時の AI依存度の初期値。 */
  aiDependencyBase: number;
  aiLiteracy: number;
  testCoverage: number;
  documentation: number;
  quality: number;
  morale: number;
  seniorHp: number;
}

export interface Scenario {
  id: ScenarioId;
  label: string;
  org: ScenarioOrg;
  sprint: SprintConfig;
}

export const DEFAULT_SCENARIO: ScenarioId = 'default';

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  default: {
    id: 'default',
    label: '標準',
    org: {
      aiDependencyBase: 35,
      aiLiteracy: 45,
      testCoverage: 55,
      documentation: 50,
      quality: 60,
      morale: 70,
      seniorHp: 100,
    },
    sprint: {
      taskCount: 28,
      codingSlots: 6,
      maxTicks: 1500,
    },
  },
};

/** シナリオ定義を取得する（未知の id は標準にフォールバック）。 */
export function getScenario(id: ScenarioId): Scenario {
  return SCENARIOS[id] ?? SCENARIOS[DEFAULT_SCENARIO];
}
