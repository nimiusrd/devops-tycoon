import { describe, expect, it } from 'vitest';
import { rosterOf } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';
import {
  applyCustomerInterview as apply,
  chooseInterviewAction,
  compareCustomerInterviews,
  createCustomerInterview as create,
  summarizeCustomerInterview,
  viewCustomerInterview,
} from './customerInterview';
import comparison from '../../docs/prototypes/customer-interview-comparison.json';

describe('RI-231 顧客への聞き取り', () => {
  it('聞き取り前は需要が不明で、聞き取り後も未確認の候補が残る', () => {
    const first = create('RI-231', 'uncertain');
    expect(create('RI-231', 'uncertain')).toEqual(first);
    expect(first.capacity).toBe(PRODUCT_CAPACITY);
    expect(first.speaker).toEqual(rosterOf('keeper'));
    const before = structuredClone(first);
    const blank = viewCustomerInterview(first);
    for (let i = 0; i < 8; i++) expect(viewCustomerInterview(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toEqual({
      tick: 0,
      horizon: 3,
      capacity: 4,
      deadline: 3,
      rumor: 'api',
      speaker: { pioneers: 1, keepers: 3 },
      asked: false,
      likely: null,
      unconfirmed: null,
      unknowns: ['needed-feature'],
      valueIfRight: 12,
      latePenalty: 10,
    });
    expect(blank).not.toHaveProperty('needed');
    expect(blank).not.toHaveProperty('clueLikely');
    const asked = apply(first, { type: 'ask' });
    expect(viewCustomerInterview(asked)).toMatchObject({
      asked: true,
      likely: 'screen',
      unconfirmed: 'billing',
      unknowns: ['unconfirmed-feature'],
    });
    expect(viewCustomerInterview(asked)).not.toHaveProperty('needed');
    const misled = apply(create('RI-231', 'mislead'), { type: 'ask' });
    expect(misled.likely).toBe('screen');
    expect(misled.needed).toBe('billing');
    expect(misled.likely).not.toBe(misled.needed);
    expect(asked.listenCost).toBe(4);
    expect(apply(asked, { type: 'ask' })).toBe(asked);
  });

  it('聞き取りは期間を使い、正しい機能でも完成の報酬は一度だけ', () => {
    const urgent = create('RI-231', 'urgent');
    expect(urgent.speaker).toEqual(rosterOf('pioneer'));
    const rushed = apply(urgent, { type: 'build', feature: 'api' });
    expect(rushed.value).toBe(12);
    expect(rushed.late).toBe(0);
    expect(apply(rushed, { type: 'build', feature: 'api' }).value).toBe(12);
    const listened = apply(urgent, { type: 'ask' });
    const late = apply(listened, { type: 'build', feature: 'api' });
    expect(late.value).toBe(12);
    expect(late.late).toBe(10);
    expect(apply(listened, { type: 'build', feature: 'billing' }).value).toBe(0);
    expect(apply(urgent, { type: 'view' })).toBe(urgent);
  });

  it('短納期は即着手、要望が不確実な盤面は聞き取りが上回る', () => {
    const rows = compareCustomerInterviews(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('urgent', 'rush'), score('urgent', 'ask'), score('urgent', 'askMiss')]).toEqual([
      12, 2, 0,
    ]);
    expect([
      score('uncertain', 'ask'),
      score('uncertain', 'rush'),
      score('uncertain', 'askMiss'),
    ]).toEqual([12, 0, 0]);
    expect([
      score('mislead', 'askMiss'),
      score('mislead', 'ask'),
      score('mislead', 'rush'),
    ]).toEqual([12, 0, 0]);
    const asked = rows.find((row) => row.board === 'uncertain' && row.strategy === 'askMiss')!;
    expect(asked.result.delivered).toBe(false);
    expect(asked.result.listenCost).toBe(4);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareCustomerInterviews(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseInterviewAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeCustomerInterview(live)).toEqual(row.result);
    }
  });
});
