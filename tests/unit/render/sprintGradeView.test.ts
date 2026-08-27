import { describe, expect, it } from 'vitest';
import { planSprintGradeView } from '../../../src/render/sprintGradeView';
import type { SprintResult } from '../../../src/sim/types';

function makeResult(overrides: Partial<SprintResult> = {}): SprintResult {
  return {
    done: 10,
    delivered: 50,
    maxCombo: 5,
    aiAssistedPct: 30,
    reviewQueueMax: 4,
    rework: 1,
    incidents: 2,
    contained: 2,
    spread: 0,
    seniorHpDelta: -10,
    actionCounts: {},
    grade: 'B',
    title: '見かけ上の生産性王',
    diagnosis: 'テスト用',
    timeline: [],
    events: [],
    fireEvents: [],
    focusRemaining: 5,
    focusMax: 8,
    autoContainCount: 0,
    ...overrides,
  };
}

describe('sprintGradeView', () => {
  it('出荷が多くてもシニア瀕死と Incident 多数なら危機の読みを出す', () => {
    const view = planSprintGradeView(
      makeResult({
        delivered: 576,
        rework: 3,
        incidents: 10,
        contained: 9,
        spread: 1,
        seniorHpDelta: -98,
        grade: 'B',
        title: 'シニア過労メーカー',
      }),
    );

    expect(view.ratioPct).toBe(76);
    expect(view.caption).toBe('大きな危機を出しつつ出荷した（健全比 76%）');
    expect(view.rows).toEqual([
      { label: '出荷', value: '576pt' },
      { label: 'Rework', value: '−15pt（3件）' },
      { label: 'Incident', value: '−60pt（10件）' },
      { label: '延焼', value: '−10pt（1回）' },
      { label: 'シニアHP', value: '−54.6pt（-98）' },
      { label: '健全比', value: '76% → B' },
    ]);
    expect(view.tip).toContain('出荷点を母数');
    expect(view.tip).toContain('小さく見えます');
  });

  it('危機が少なく健全比が高いときは比率だけを示す', () => {
    const view = planSprintGradeView(
      makeResult({
        delivered: 100,
        rework: 0,
        incidents: 0,
        spread: 0,
        seniorHpDelta: -5,
        grade: 'S',
      }),
    );

    expect(view.caption).toBe('出荷に対する健全比 100%');
    expect(view.tip).toContain('ペナルティが少なく');
    expect(view.rows).toEqual([
      { label: '出荷', value: '100pt' },
      { label: '健全比', value: '100% → S' },
    ]);
  });

  it('健全比が B 境界未満なら重い読みにする', () => {
    const view = planSprintGradeView(
      makeResult({
        delivered: 100,
        rework: 4,
        incidents: 5,
        spread: 1,
        seniorHpDelta: -30,
        grade: 'C',
      }),
    );

    expect(view.ratioPct).toBeLessThan(62);
    expect(view.caption).toContain('出荷に対して手戻り・障害・消耗が重い');
  });
});
