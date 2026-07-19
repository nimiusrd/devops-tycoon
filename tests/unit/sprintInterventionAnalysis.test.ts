import { describe, expect, it } from 'vitest';
import { planInterventionAnalysis } from '../../src/render/sprintInterventionAnalysis';
import type { SprintResult } from '../../src/sim/types';

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

describe('sprintInterventionAnalysis（RI-54）', () => {
  it('介入なし・炎上なしのときはセクション非表示とデフォルト Tip', () => {
    const view = planInterventionAnalysis(makeResult());
    expect(view.showSection).toBe(false);
    expect(view.tip).toContain('介入なし');
  });

  it('捌いた PR 総数と集中力余りを集計する', () => {
    const view = planInterventionAnalysis(
      makeResult({
        actionCounts: { interruptReview: 2 },
        events: [
          {
            tick: 5,
            kind: 'intervention',
            combo: 2,
            effect: {
              actionId: 'interruptReview',
              focusCost: 3,
              gaugeGain: 0.34,
              reviewedCount: 4,
            },
          },
          {
            tick: 12,
            kind: 'intervention',
            combo: 3,
            effect: {
              actionId: 'pairReview',
              focusCost: 2,
              gaugeGain: 0.2,
              reviewedCount: 2,
            },
          },
        ],
        focusRemaining: 4,
        focusMax: 8,
      }),
    );
    expect(view.showSection).toBe(true);
    expect(view.rows[0]).toEqual({ label: '捌いた PR', value: '6 件' });
    expect(view.rows[3]).toEqual({ label: '集中力余り', value: '⚡4 / 8' });
  });

  it('緊急対応の回数をコンボ守りとして数える', () => {
    const view = planInterventionAnalysis(
      makeResult({
        actionCounts: { firefight: 2 },
        events: [
          {
            tick: 3,
            kind: 'intervention',
            combo: 4,
            effect: { actionId: 'firefight', focusCost: 1, gaugeGain: 0.5 },
          },
          {
            tick: 8,
            kind: 'intervention',
            combo: 2,
            effect: { actionId: 'firefight', focusCost: 1, gaugeGain: 0.5 },
          },
        ],
      }),
    );
    expect(view.rows[1]).toEqual({ label: 'コンボを守った', value: '2 回' });
    expect(view.tip).toContain('緊急対応でコンボを 2 回守った');
  });

  it('コンボ 0 の緊急対応はコンボ守りに数えない', () => {
    const view = planInterventionAnalysis(
      makeResult({
        focusRemaining: 1,
        focusMax: 8,
        actionCounts: { firefight: 2 },
        events: [
          {
            tick: 3,
            kind: 'intervention',
            combo: 0,
            effect: { actionId: 'firefight', focusCost: 1, gaugeGain: 0.5 },
          },
          {
            tick: 8,
            kind: 'intervention',
            combo: 3,
            effect: { actionId: 'firefight', focusCost: 1, gaugeGain: 0.5 },
          },
        ],
      }),
    );
    expect(view.rows[1]).toEqual({ label: 'コンボを守った', value: '1 回' });
    expect(view.tip).not.toContain('緊急対応でコンボを 2 回守った');
  });

  it('自動鎮火 Tip は延焼より優先する', () => {
    const view = planInterventionAnalysis(
      makeResult({
        autoContainCount: 2,
        spread: 1,
        actionCounts: { firefight: 0 },
      }),
    );
    expect(view.showSection).toBe(true);
    expect(view.rows[2]).toEqual({ label: '自動鎮火 / 延焼', value: '2 / 1' });
    expect(view.tip).toContain('自動鎮火 2 件');
    expect(view.tip).not.toContain('延焼 1 件');
  });

  it('集中力余り Tip は渋滞ピークと組み合わせる', () => {
    const view = planInterventionAnalysis(
      makeResult({
        focusRemaining: 5,
        focusMax: 8,
        reviewQueueMax: 9,
        actionCounts: { overtime: 1 },
        events: [
          {
            tick: 1,
            kind: 'intervention',
            combo: 0,
            effect: { actionId: 'overtime', focusCost: 2, gaugeGain: 0.1 },
          },
        ],
      }),
    );
    expect(view.tip).toContain('集中力を ⚡5 残して終了');
    expect(view.tip).toContain('Review待ちが最大 9 PR');
  });

  it('Review 渋滞で割り込み未使用の Tip', () => {
    const view = planInterventionAnalysis(
      makeResult({
        reviewQueueMax: 10,
        focusRemaining: 1,
        focusMax: 8,
        actionCounts: { firefight: 1 },
        events: [
          {
            tick: 2,
            kind: 'intervention',
            combo: 1,
            effect: { actionId: 'firefight', focusCost: 1, gaugeGain: 0.5 },
          },
        ],
      }),
    );
    expect(view.tip).toContain('Review待ちが最大 10 PR');
    expect(view.tip).toContain('割り込みレビュー');
  });
});
