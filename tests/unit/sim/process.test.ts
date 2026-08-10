import { describe, expect, it } from 'vitest';
import {
  aiDeliveryValueMul,
  codingTicks,
  incidentProbability,
  reviewPerTick,
  reworkProbability,
  taskValue,
} from '../../../src/sim/model';
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

describe('reworkProbability（第22.5 の代表的不変条件）', () => {
  it('AI依存度が上がると Rework 傾向も上がる（他条件固定で単調増加）', () => {
    const t = task();
    const low = reworkProbability(org({ aiDependency: 10 }), t);
    const mid = reworkProbability(org({ aiDependency: 50 }), t);
    const high = reworkProbability(org({ aiDependency: 90 }), t);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  it('品質が高いほど Rework は下がる', () => {
    const t = task();
    const lowQuality = reworkProbability(org({ quality: 20 }), t);
    const highQuality = reworkProbability(org({ quality: 90 }), t);
    expect(highQuality).toBeLessThan(lowQuality);
  });

  it('手戻りを重ねたタスクは通りやすくなる（収束保証）', () => {
    // 下限クランプに当たらない領域（高依存・低品質）で減衰を確認する。
    const hot = org({ aiDependency: 90, quality: 20, aiLiteracy: 10 });
    const fresh = reworkProbability(hot, task({ reworkAttempts: 0 }));
    const retried = reworkProbability(hot, task({ reworkAttempts: 2 }));
    expect(retried).toBeLessThan(fresh);
  });

  it('確率は [0.02, 0.75] に収まる', () => {
    const min = reworkProbability(org({ aiDependency: 0, quality: 100, aiLiteracy: 100 }), task());
    const max = reworkProbability(
      org({ aiDependency: 100, quality: 0, aiLiteracy: 0 }),
      task({ aiAssisted: true }),
    );
    expect(min).toBeGreaterThanOrEqual(0.02);
    expect(max).toBeLessThanOrEqual(0.75);
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
