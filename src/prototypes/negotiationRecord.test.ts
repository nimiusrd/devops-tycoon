import { describe, expect, it } from 'vitest';
import {
  applyNegotiationRecord as apply,
  chooseNegotiationAction,
  compareNegotiationRecords,
  createNegotiationRecord as create,
  summarizeNegotiationRecord,
  viewNegotiationRecord,
} from './negotiationRecord';
import comparison from '../../docs/prototypes/negotiation-record-comparison.json';

describe('RI-243 実績を使った交渉', () => {
  it('現在の負債の低さや高さを、四半期内の返済記録として扱わない', () => {
    const loose = create('RI-243', 'loose');
    expect(create('RI-243', 'loose')).toEqual(loose);
    const before = structuredClone(loose);
    const blank = viewNegotiationRecord(loose);
    for (let i = 0; i < 8; i++) expect(viewNegotiationRecord(loose)).toEqual(blank);
    expect(loose).toEqual(before);
    expect(apply(loose, { type: 'view' })).toBe(loose);
    expect(blank).toMatchObject({
      debt: 6,
      recorded: 0,
      qualified: false,
      reason: 'no-quarter-record',
      offer: null,
      nextTarget: 8,
    });
    expect(blank.forecasts.map((item) => [item.strategy, item.score])).toEqual([
      ['ship', 8],
      ['bargain', 3],
    ]);
    expect(apply(loose, { type: 'negotiate' })).toBe(loose);
    const healthy = create('RI-243', 'healthy');
    expect(viewNegotiationRecord(healthy)).toMatchObject({
      debt: 0,
      recorded: 0,
      qualified: false,
      reason: 'current-value-is-not-a-record',
      offer: null,
    });
    expect(apply(healthy, { type: 'repay' })).toBe(healthy);
    expect(apply(healthy, { type: 'negotiate' })).toBe(healthy);
    const noted = apply(healthy, { type: 'note' });
    expect(noted.skippedRepay).toBe(true);
    expect(noted.delivery).toBe(0);
    expect(noted.tick).toBe(0);
    expect(apply(noted, { type: 'note' })).toBe(noted);
    expect(apply(loose, { type: 'note' })).toBe(loose);
  });

  it('記録があるときだけ緩和を提示し、見送っても敗北にしない', () => {
    const worked = apply(apply(create('RI-243', 'tight'), { type: 'repay' }), { type: 'ship' });
    expect(worked.entries).toEqual([{ tick: 0, kind: 'repay', amount: 3 }]);
    expect(worked.delivery).toBe(5);
    expect(viewNegotiationRecord(worked)).toMatchObject({
      qualified: true,
      reason: null,
      offer: { relief: 4, trust: 2, nextTarget: 10 },
    });
    const declined = apply(worked, { type: 'pass' });
    expect(declined.negotiated).toBe(false);
    expect(declined.trust).toBe(0);
    expect(declined.nextTarget).toBe(14);
    expect(declined.closed).toBe(true);
    expect(summarizeNegotiationRecord(declined).lost).toBe(false);
    expect(apply(declined, { type: 'negotiate' })).toBe(declined);
    const taken = apply(worked, { type: 'negotiate' });
    expect(taken).toMatchObject({ negotiated: true, trust: 2, nextTarget: 10, delivery: 5 });
    expect(summarizeNegotiationRecord(taken).score).toBe(-3);
    expect(apply(taken, { type: 'negotiate' })).toBe(taken);
    const fresh = create('RI-243', 'loose');
    expect(apply(fresh, { type: 'pass' })).toBe(fresh);
    expect(apply(fresh, { type: 'ship' }).tick).toBe(1);
  });

  it('次期目標が重いときだけ、出荷を譲った交渉が上回る', () => {
    const rows = compareNegotiationRecords(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('loose', 'ship').result).toMatchObject({
      score: 8,
      delivery: 8,
      nextTarget: 8,
      trust: 0,
      recorded: 0,
      path: [4, 8, 8],
      negotiated: false,
    });
    expect(row('loose', 'bargain').result).toMatchObject({
      score: 3,
      delivery: 5,
      nextTarget: 4,
      trust: 2,
      recorded: 3,
      path: [1, 5, 3],
      actions: ['repay', 'ship', 'negotiate'],
    });
    expect(row('tight', 'ship').result).toMatchObject({
      score: -10,
      delivery: 8,
      nextTarget: 14,
      path: [-14, -10, -10],
    });
    expect(row('tight', 'bargain').result).toMatchObject({
      score: -3,
      delivery: 5,
      nextTarget: 10,
      trust: 2,
      path: [-17, -13, -3],
    });
    expect(row('loose', 'ship').result.score).toBeGreaterThan(row('loose', 'bargain').result.score);
    expect(row('tight', 'bargain').result.score).toBeGreaterThan(row('tight', 'ship').result.score);
    expect(row('healthy', 'ship').result.score).toBe(-10);
    expect(row('healthy', 'bargain').result).toMatchObject({
      score: -10,
      recorded: 0,
      negotiated: false,
      skippedRepay: true,
      skippedOffer: true,
    });
    expect(row('healthy', 'bargain').result.score).toBe(row('healthy', 'ship').result.score);
    for (const item of rows) expect(item.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareNegotiationRecords(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseNegotiationAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeNegotiationRecord(live)).toEqual(row.result);
    }
  });
});
