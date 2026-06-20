/**
 * 組織状態（OrgState）の生成（SPEC 第5章 / 第4.2）。
 */
import { getScenario } from './scenarios';
import type { OrgState, ScenarioId } from './types';

/** AI 未導入時の AI依存度の初期値（わずかに残る程度）。 */
const AI_DEPENDENCY_WHEN_DISABLED = 3;

/**
 * シナリオと AI 導入フラグから初期 `OrgState` を作る。
 * AI 導入時のみ AI依存度がシナリオ規定値から始まり、スプリント中に推移する。
 */
export function createOrgState(scenario: ScenarioId, aiEnabled: boolean): OrgState {
  const { org } = getScenario(scenario);
  return {
    aiEnabled,
    aiDependency: aiEnabled ? org.aiDependencyBase : AI_DEPENDENCY_WHEN_DISABLED,
    aiLiteracy: org.aiLiteracy,
    testCoverage: org.testCoverage,
    documentation: org.documentation,
    quality: org.quality,
    morale: org.morale,
    seniorHp: org.seniorHp,
    techDebt: 0,
    deliveryScore: 0,
  };
}
