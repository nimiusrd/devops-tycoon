import type { ScenarioId } from './types';

export interface ScenarioDefinition {
  id: ScenarioId;
  label: string;
  description: string;
}

export const scenarios: readonly ScenarioDefinition[] = [
  {
    id: 'default',
    label: 'Default Foundation',
    description: 'Phase 0 のテスト用シナリオ。後続フェーズで詳細な難易度に置き換える。',
  },
];
