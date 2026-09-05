import { describe, expect, it } from 'vitest';
import { planSprintGradeView } from '../../../src/render/sprintGradeView';
import type { SprintResult } from '../../../src/sim/types';

function savedResult(overrides: Partial<SprintResult> = {}): SprintResult {
  return {
    done: 10,
    delivered: 100,
    maxCombo: 5,
    aiAssistedPct: 30,
    reviewQueueMax: 4,
    rework: 0,
    incidents: 0,
    contained: 0,
    spread: 0,
    seniorHpDelta: 0,
    actionCounts: {},
    grade: 'S',
    title: '健全な出荷',
    diagnosis: '保存済みの結果',
    timeline: [],
    events: [],
    fireEvents: [],
    focusRemaining: 5,
    focusMax: 8,
    autoContainCount: 0,
    ...overrides,
  };
}

describe('保存済みスプリント評価の省略値と境界', () => {
  it('旧記録の未出荷は健全比を推定せず、等級だけ残す', () => {
    const view = planSprintGradeView(savedResult({ done: 0, delivered: 0, grade: 'D' }));

    expect(view.ratioPct).toBeUndefined();
    expect(view.caption).toBe('未出荷のスプリントです');
    expect(view.rows).toEqual([
      { label: '出荷', value: '0pt' },
      { label: '評価', value: 'D' },
    ]);
    expect(view.tip).toContain('等級の母数がない状態');
  });

  it.each(['C', 'D'])('旧記録の評価 %s には低評価の読み方を添える', (grade) => {
    const view = planSprintGradeView(savedResult({ grade, rework: 8 }));

    expect(view.caption).toBe(`出荷に対して手戻り・障害・消耗が重い（評価 ${grade}）`);
    expect(view.tip).toBe('このリザルトには評価内訳の記録がありません。等級は保存当時の評価です。');
    expect(view.rows).toEqual([
      { label: '出荷', value: '100pt' },
      { label: '評価', value: grade },
    ]);
  });

  it('健全比だけが保存されている場合は減点を再構成せず記録欠落を説明する', () => {
    const view = planSprintGradeView(savedResult({ grade: 'B', gradeRatio: 0.7, rework: 6 }));

    expect(view.rows).toEqual([
      { label: '出荷', value: '100pt' },
      { label: '健全比', value: '70% → B' },
    ]);
    expect(view.tip).toBe(
      '減点内訳は記録されていないため、保存済みの健全比と等級を表示しています。',
    );
  });

  it('ボーナスに回数の記録がなければ安定介入の行を推定しない', () => {
    const view = planSprintGradeView(savedResult({ gradeRatio: 1.01, stabilizingBonus: 0.01 }));

    expect(view.rows).toEqual([
      { label: '出荷', value: '100pt' },
      { label: '健全比', value: '101% → S' },
    ]);
  });

  it('保存当時の整数パーセントのボーナスは小数ゼロを付けず表示する', () => {
    const view = planSprintGradeView(
      savedResult({
        gradeRatio: 1.01,
        stabilizingBonus: 0.01,
        stabilizingGrants: 2,
        gradePenalties: { rework: 0, incident: 0, spread: 0, hp: 0, total: 0 },
      }),
    );

    expect(view.rows).toEqual([
      { label: '出荷', value: '100pt' },
      { label: '安定介入', value: '+1%（2回）' },
      { label: '健全比', value: '101% → S' },
    ]);
    expect(view.tip).toContain('安定を付与した介入');
  });

  it.each([
    [54.6, '出荷に対する評価 B'],
    [55, '大きな危機を出しつつ出荷した（評価 B）'],
  ])('危機判定には表示用 HP 差分でなく記録済み損失 %s を使う', (seniorHpLoss, caption) => {
    const view = planSprintGradeView(savedResult({ grade: 'B', seniorHpDelta: -55, seniorHpLoss }));

    expect(view.caption).toBe(caption);
    expect(view.rows).toEqual([
      { label: '出荷', value: '100pt' },
      { label: '評価', value: 'B' },
    ]);
  });
});
