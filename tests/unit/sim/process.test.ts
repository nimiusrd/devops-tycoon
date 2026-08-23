import { describe, expect, it } from 'vitest';
import {
  IDENTITY_CARD_EFFECTS,
  aiDeliveryValueMul,
  codingTicks,
  incidentProbability,
  reviewPerTick,
  reworkProbability,
  taskValue,
  coarseAiPremisePressure,
  workflowMaturity,
} from '../../../src/sim/model';
import { PROCESS_BALANCE } from '../../../src/data/balance';
import { createOrgState } from '../../../src/sim/org';
import type { OrgState, Task } from '../../../src/sim/types';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 0,
    kind: 'normal',
    highValue: false,
    aiAssisted: false,
    lane: 'review',
    progress: 0,
    reworkAttempts: 0,
    wasReworked: false,
    incident: false,
    debt: false,
    ...overrides,
  };
}

function org(overrides: Partial<OrgState> = {}): OrgState {
  return { ...createOrgState('default', true), ...overrides };
}

describe('reworkProbability（RI-134 のワークフロー分離）', () => {
  it('粗粒度の AI 前提圧力は採用率で workflow 不足と mismatch を混ぜる', () => {
    expect(coarseAiPremisePressure(0, 1)).toBe(0);
    expect(coarseAiPremisePressure(0, 0.85)).toBeGreaterThan(0);
    expect(coarseAiPremisePressure(1, 0.85)).toBeGreaterThan(coarseAiPremisePressure(0, 0.85));
  });

  it('ワークフロー成熟度の重みは合計 1 になる', () => {
    expect(
      PROCESS_BALANCE.reworkWorkflowLiteracyWeight.value +
        PROCESS_BALANCE.reworkWorkflowMasteryWeight.value +
        PROCESS_BALANCE.reworkWorkflowDocumentationWeight.value,
    ).toBeCloseTo(1);
  });

  it('AI前提度が上がると AI なしの工程ずれと未熟な AI ありのリスクが上がる', () => {
    const off = task();
    const on = task({ aiAssisted: true });
    const immature = org({ aiDependency: 10, aiLiteracy: 10, documentation: 10 });
    const immatureHigh = org({ aiDependency: 90, aiLiteracy: 10, documentation: 10 });
    expect(reworkProbability(immatureHigh, off)).toBeGreaterThan(reworkProbability(immature, off));
    expect(reworkProbability(immatureHigh, on)).toBeGreaterThan(reworkProbability(immature, on));
  });

  it('品質が高いほど AI の有無によらず Rework は下がる', () => {
    const low = org({ quality: 20 });
    const high = org({ quality: 90 });
    expect(reworkProbability(high, task())).toBeLessThan(reworkProbability(low, task()));
    expect(reworkProbability(high, task({ aiAssisted: true }))).toBeLessThan(
      reworkProbability(low, task({ aiAssisted: true })),
    );
  });

  it('正規化習熟が1を超えても重み付き合計だけを clamp する', () => {
    const mid = org({ aiLiteracy: 45, documentation: 50 });
    expect(workflowMaturity(mid, 1.2)).toBeGreaterThan(workflowMaturity(mid, 1));
    expect(workflowMaturity(mid, 1.2)).toBeLessThanOrEqual(1);
    expect(
      reworkProbability(mid, task({ aiAssisted: true }), IDENTITY_CARD_EFFECTS, 1.2),
    ).toBeLessThan(reworkProbability(mid, task({ aiAssisted: true }), IDENTITY_CARD_EFFECTS, 1));
  });

  it('ワークフロー成熟度は AI ありの Rework だけを下げる', () => {
    const poor = org({ aiLiteracy: 10, documentation: 10 });
    const rich = org({ aiLiteracy: 90, documentation: 90 });
    expect(workflowMaturity(rich, 0.9)).toBeGreaterThan(workflowMaturity(poor, 0.1));
    expect(
      reworkProbability(rich, task({ aiAssisted: true }), IDENTITY_CARD_EFFECTS, 0.9),
    ).toBeLessThan(reworkProbability(poor, task({ aiAssisted: true }), IDENTITY_CARD_EFFECTS, 0.1));
    expect(reworkProbability(rich, task(), IDENTITY_CARD_EFFECTS, 0.9)).toBe(
      reworkProbability(poor, task(), IDENTITY_CARD_EFFECTS, 0.1),
    );
  });

  it('高成熟では高前提度で AI ありが安全になり、低成熟では AI ありが危険になる', () => {
    const mature = org({
      aiDependency: 100,
      aiLiteracy: 100,
      documentation: 100,
      quality: 60,
      techDebt: 0,
    });
    const immature = org({
      aiDependency: 100,
      aiLiteracy: 0,
      documentation: 0,
      quality: 60,
      techDebt: 0,
    });
    expect(
      reworkProbability(mature, task({ aiAssisted: true }), IDENTITY_CARD_EFFECTS, 1),
    ).toBeLessThan(reworkProbability(mature, task(), IDENTITY_CARD_EFFECTS, 1));
    expect(
      reworkProbability(immature, task({ aiAssisted: true }), IDENTITY_CARD_EFFECTS, 0),
    ).toBeGreaterThan(reworkProbability(immature, task(), IDENTITY_CARD_EFFECTS, 0));
  });

  it('手戻りを重ねたタスクは通りやすくなる（収束保証）', () => {
    const hot = org({ aiDependency: 90, quality: 20, aiLiteracy: 10, documentation: 10 });
    const fresh = reworkProbability(hot, task({ reworkAttempts: 0 }));
    const retried = reworkProbability(hot, task({ reworkAttempts: 2 }));
    expect(retried).toBeLessThan(fresh);
  });

  it('確率は [0.02, 0.75] に収まる', () => {
    const min = reworkProbability(
      org({ aiDependency: 0, quality: 100, aiLiteracy: 100, documentation: 100, techDebt: 0 }),
      task(),
      IDENTITY_CARD_EFFECTS,
      1,
    );
    const max = reworkProbability(
      org({ aiDependency: 100, quality: 0, aiLiteracy: 0, documentation: 0, techDebt: 200 }),
      task({ aiAssisted: true }),
    );
    expect(min).toBeGreaterThanOrEqual(0.02);
    expect(max).toBeLessThanOrEqual(0.75);
  });
});

describe('初期組織の AI 依存度', () => {
  it('AI 無効時は工程バランスの初期依存度を使い、AI 有効時はシナリオ値を保つ', () => {
    const disabled = createOrgState('default', false);
    const enabled = createOrgState('default', true);

    expect(disabled.aiDependency).toBe(PROCESS_BALANCE.aiDependencyWhenDisabled.value);
    expect(enabled.aiDependency).not.toBe(disabled.aiDependency);
  });
});

describe('incidentProbability', () => {
  it('テストカバレッジが低いほど障害率が上がる', () => {
    const t = task();
    const lowCoverage = incidentProbability(org({ testCoverage: 10 }), t);
    const highCoverage = incidentProbability(org({ testCoverage: 90 }), t);
    expect(lowCoverage).toBeGreaterThan(highCoverage);
  });
});

describe('codingTicks（AI による加速。第2章のコア）', () => {
  it('AI 利用タスクは非利用より Coding が速い', () => {
    expect(codingTicks(task({ aiAssisted: true }))).toBeLessThan(
      codingTicks(task({ aiAssisted: false })),
    );
  });

  it('複雑タスクは定型より時間がかかる', () => {
    expect(codingTicks(task({ kind: 'complex' }))).toBeGreaterThan(
      codingTicks(task({ kind: 'routine' })),
    );
  });
});

describe('reviewPerTick', () => {
  it('シニア体力が高いほどレビュー処理量が多い', () => {
    expect(reviewPerTick(org({ seniorHp: 100 }))).toBeGreaterThan(
      reviewPerTick(org({ seniorHp: 10 })),
    );
  });

  it('体力 0 でも完全には停止しない', () => {
    expect(reviewPerTick(org({ seniorHp: 0 }))).toBeGreaterThan(0);
  });
});

describe('taskValue', () => {
  it('高価値タスクは通常より大きいポイント', () => {
    expect(taskValue(task({ highValue: true }))).toBeGreaterThan(taskValue(task()));
  });
});

describe('aiDeliveryValueMul（RI-77）', () => {
  it('非 AI は 1、AI はリテラシーで上がる', () => {
    expect(aiDeliveryValueMul(org({ aiLiteracy: 45 }), task({ aiAssisted: false }))).toBe(1);
    expect(aiDeliveryValueMul(org({ aiLiteracy: 0 }), task({ aiAssisted: true }))).toBe(1);
    expect(aiDeliveryValueMul(org({ aiLiteracy: 100 }), task({ aiAssisted: true }))).toBeCloseTo(
      1.85,
    );
  });
});
