import { describe, expect, it } from 'vitest';
import {
  applyExecDemands as apply,
  chooseExecDemandAction,
  compareExecDemands,
  createExecDemands as create,
  summarizeExecDemands,
  viewExecDemands,
} from './execDemands';
import comparison from '../../docs/prototypes/exec-demands-comparison.json';

describe('RI-255 経営要求の矛盾', () => {
  it('要求の順・期限・交渉できる条件を先に示し、選択だけでは達成しない', () => {
    const first = create('RI-255', 'compatible');
    expect(create('RI-255', 'compatible')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewExecDemands(first);
    for (let i = 0; i < 8; i++) expect(viewExecDemands(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(apply(first, { type: 'work' })).toBe(first);
    expect(blank.demands.map((demand) => [demand.order, demand.id, demand.negotiable])).toEqual([
      [1, 'ai-usage', false],
      [2, 'review-queue', true],
    ]);
    expect(blank).toMatchObject({
      trustCost: 8,
      chargesExistingReview: false,
      negotiated: false,
      activeCap: 1,
      choices: ['follow', 'negotiate'],
    });
    expect(blank.demands[1]).toMatchObject({ deadline: 3, cap: 1, relaxedCap: 6 });
    expect(blank.forecasts.map((item) => [item.strategy, item.score, item.outcome])).toEqual([
      ['follow', 24, 'both'],
      ['negotiate', 16, 'both'],
    ]);
    const chosen = apply(first, { type: 'negotiate' });
    expect(chosen).toMatchObject({
      negotiated: true,
      trustSpent: 8,
      reviewCap: 6,
      statedCap: 1,
      aiAward: 0,
      existingReviewCharged: false,
    });
    expect(apply(chosen, { type: 'negotiate' })).toBe(chosen);
    expect(apply(chosen, { type: 'follow' })).toBe(chosen);
    expect(viewExecDemands(chosen).choices).toEqual([]);
    expect(
      viewExecDemands(create('RI-255', 'contradict')).forecasts.map((item) => item.score),
    ).toEqual([12, 16]);
  });

  it('要求が両立する盤面は追従、レビューが増える盤面は一回の交渉が上回る', () => {
    const rows = compareExecDemands(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('compatible', 'follow').result).toMatchObject({
      score: 24,
      aiAward: 12,
      reviewAward: 12,
      trustSpent: 0,
      nextPromise: 0,
      outcome: 'both',
      continued: true,
      lost: false,
    });
    expect(row('compatible', 'negotiate').result).toMatchObject({
      score: 16,
      trustSpent: 8,
      nextPromise: 0,
      outcome: 'both',
    });
    expect(row('contradict', 'follow').result).toMatchObject({
      score: 12,
      aiAward: 12,
      reviewAward: 0,
      trustSpent: 0,
      queue: 3,
      outcome: 'ai-only',
      continued: true,
    });
    expect(row('contradict', 'negotiate').result).toMatchObject({
      score: 16,
      aiAward: 12,
      reviewAward: 12,
      trustSpent: 8,
      nextPromise: 3,
      outcome: 'both',
      existingReviewCharged: false,
    });
    expect(row('compatible', 'follow').result.score).toBeGreaterThan(
      row('compatible', 'negotiate').result.score,
    );
    expect(row('contradict', 'negotiate').result.score).toBeGreaterThan(
      row('contradict', 'follow').result.score,
    );
    for (const item of rows) {
      expect(item.result.lost).toBe(false);
      expect(item.result.continued).toBe(true);
      expect(item.result.existingReviewCharged).toBe(false);
      expect(item.result.score).toBe(
        item.result.aiAward + item.result.reviewAward - item.result.trustSpent,
      );
      expect(item.result).not.toHaveProperty('title');
    }
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareExecDemands(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseExecDemandAction(previous, row.strategy)).toEqual(input);
        expect(input).not.toHaveProperty('title');
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeExecDemands(live)).toEqual(row.result);
      expect(live.trustSpent === 0 || live.trustSpent === live.trustCost).toBe(true);
    }
  });
});
