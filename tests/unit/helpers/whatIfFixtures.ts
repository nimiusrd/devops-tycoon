/**
 * what-if 試算の共通入力フィクスチャ（テスト用）。
 *
 * whatIf / whatIfClient のテストで同一定義が重複していたため集約した。
 * `directWhatIfInput` は overrides ごとに配列・オブジェクトを複製して返すので、
 * 呼び出し側で入力を書き換えても他のケースに漏れない。
 */
import type { RosterState } from '../../../src/sim/member/types';
import type { WhatIfComputeInput } from '../../../src/sim/run/whatIfState';

export const directRoster: RosterState = {
  members: [
    {
      id: 'm1',
      name: 'Direct Coder',
      rank: 'senior',
      level: 2,
      xp: 0,
      stats: { implementation: 60, review: 80, aiMastery: 40 },
      stamina: 10,
      staminaMax: 10,
      traits: [],
      assignment: 'coding',
      aiAssigned: true,
      onLeave: false,
    },
    {
      id: 'm2',
      name: 'Direct Reviewer',
      rank: 'middle',
      level: 1,
      xp: 0,
      stats: { implementation: 35, review: 70, aiMastery: 20 },
      stamina: 9,
      staminaMax: 9,
      traits: [],
      assignment: 'review',
      aiAssigned: false,
      onLeave: false,
    },
  ],
  nextId: 2,
};

export function emptyRunTotals() {
  return {
    delivered: 0,
    done: 0,
    rework: 0,
    incidents: 0,
    contained: 0,
    spread: 0,
    aiAssisted: 0,
    completed: 0,
    reviewQueuePeak: 0,
    maxCombo: 0,
    consecutiveIncidentSprints: 0,
  };
}

export function directWhatIfInput(overrides: Partial<WhatIfComputeInput> = {}): WhatIfComputeInput {
  const base: WhatIfComputeInput = {
    phase: 'draft',
    seed: 'what-if-direct',
    quarterNumber: 2,
    sprintIndexInQuarter: 1,
    sprintsPerQuarter: 4,
    pendingSprintKind: 'elite',
    pendingSprintModifiers: {
      reviewLoadAdd: 2,
      reworkRateAdd: 0.15,
      taskCountMul: 1.5,
      focusMaxAdd: -1,
    },
    deck: [
      { defId: 'docs', level: 1 },
      { defId: 'auto-test', level: 2 },
    ],
    draft: ['copilot', 'auto-test'],
    roster: structuredClone(directRoster),
    org: {
      aiEnabled: true,
      aiDependency: 22,
      aiLiteracy: 30,
      testCoverage: 45,
      documentation: 35,
      quality: 50,
      securityLevel: 60,
      morale: 55,
      seniorHp: 40,
      techDebt: 6,
      deliveryScore: 0,
    },
    budget: 30,
    totals: emptyRunTotals(),
    relics: [],
    evolution: { points: 0, unlocked: {} },
    difficulty: 'normal',
    trials: [],
    bossId: 'legacy-monolith',
    pauseAiDebuffQuarter: null,
    baseConfig: {
      taskCount: 4,
      codingSlots: 1,
      focusMax: 3,
      maxTicks: 1_000,
    },
    teamReviewQueue: 4,
    teamIncidents: 2,
  };
  return {
    ...base,
    ...overrides,
    pendingSprintModifiers: overrides.pendingSprintModifiers ?? { ...base.pendingSprintModifiers },
    deck: overrides.deck ?? base.deck.map((card) => ({ ...card })),
    draft: overrides.draft === undefined ? [...base.draft!] : overrides.draft,
    roster: overrides.roster ?? structuredClone(base.roster),
    org: overrides.org ?? { ...base.org },
    totals: overrides.totals ?? { ...base.totals },
    relics: overrides.relics ?? [...base.relics],
    evolution: overrides.evolution ?? {
      points: base.evolution.points,
      unlocked: { ...base.evolution.unlocked },
    },
    trials: overrides.trials ?? [...base.trials],
    baseConfig: overrides.baseConfig ?? { ...base.baseConfig },
  };
}
