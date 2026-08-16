import { defineBalanceEntry } from './define';

/** 工程モデルの代表値。RI-108 で詳細な値を段階的に移行する。 */
export const PROCESS_BALANCE = {
  codingBaseTicks: defineBalanceEntry({
    id: 'process.coding.baseTicks',
    value: 7,
    unit: 'ticks',
    allowedRange: { min: 1, max: 30 },
    label: 'Coding 基礎所要 tick',
    description: '標準規模かつ AI 支援なしのタスクを実装する基礎所要 tick。',
    tags: ['process', 'coding'],
    derived: false,
  }),
  aiCodingSpeedup: defineBalanceEntry({
    id: 'process.coding.aiSpeedup',
    value: 2.6,
    unit: 'multiplier',
    allowedRange: { min: 1, max: 5 },
    label: 'AI Coding 高速化倍率',
    description: 'AI 支援タスクの Coding 所要 tick を短縮する倍率。',
    tags: ['process', 'coding', 'ai'],
    derived: false,
  }),
  aiAdoption: defineBalanceEntry({
    id: 'process.ai.adoption',
    value: 0.85,
    unit: 'probability',
    allowedRange: { min: 0, max: 1 },
    label: 'AI 導入時の既定採用率',
    description: 'AI 導入済みの組織で、各タスクが AI 支援を使う既定確率。',
    tags: ['process', 'ai'],
    derived: false,
  }),
} as const;
