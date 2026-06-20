/**
 * 難易度プリセット（SPEC 第16章）。
 *
 * Phase 0 では識別子とラベルのみの雛形。難易度パラメータ（AI依存度の初期値、
 * 流入レート、インシデント率など）は Phase 1 以降でデータ駆動に拡張する。
 */
import type { ScenarioId } from './types';

export interface Scenario {
  id: ScenarioId;
  label: string;
}

export const DEFAULT_SCENARIO: ScenarioId = 'default';

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  default: { id: 'default', label: '標準' },
};
