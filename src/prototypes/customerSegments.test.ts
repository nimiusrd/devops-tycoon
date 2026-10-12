import { describe, expect, it } from 'vitest';
import {
  applyCustomerSegments as apply,
  chooseCustomerAction,
  compareCustomerSegments,
  createCustomerSegments as create,
  rosterHeadcount,
  summarizeCustomerSegments,
  viewCustomerSegments,
} from './customerSegments';
import comparison from '../../docs/prototypes/customer-segments-comparison.json';

describe('RI-229 顧客層', () => {
  it('新機能層と安定層の求める成果と、許容できない失敗を操作前に示す', () => {
    const first = create('RI-229', 'pioneer');
    expect(create('RI-229', 'pioneer')).toEqual(first);
    expect(rosterHeadcount('pioneer')).toBe(rosterHeadcount('keeper'));
    const before = structuredClone(first);
    const blank = viewCustomerSegments(first);
    for (let i = 0; i < 8; i++) expect(viewCustomerSegments(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      tick: 0,
      mix: 'pioneer',
      pioneers: 3,
      keepers: 1,
      pioneerWants: 'feature-completion',
      pioneerRejects: 'no-feature-work',
      keeperWants: 'ops-cover',
      keeperRejects: 'incident',
      pioneerPerFeature: 10,
      pioneerIfNoFeature: -3,
      keeperPerSafe: 2,
      keeperPerIncident: -4,
    });
    expect(blank.product.ready).toEqual([]);
    expect(viewCustomerSegments(create('RI-229', 'keeper'))).toMatchObject({
      pioneers: 1,
      keepers: 3,
    });
  });

  it('未完了の進捗は新機能層を満足させず、機能を置かない期間だけ失敗になる', () => {
    const fresh = create('RI-229', 'pioneer');
    expect(apply(fresh, { type: 'spend', spend: { api: 3, screen: 0, billing: 0, ops: 0 } })).toBe(
      fresh,
    );
    const partial = apply(fresh, {
      type: 'spend',
      spend: { api: 4, screen: 0, billing: 0, ops: 0 },
    });
    expect(partial.pioneerScore).toBe(0);
    expect(partial.keeperScore).toBe(-4);
    const idle = apply(fresh, { type: 'spend', spend: { api: 0, screen: 0, billing: 0, ops: 4 } });
    expect(idle.pioneerScore).toBe(-9);
    expect(idle.keeperScore).toBe(2);
    expect(idle.product.features.every((feature) => !feature.complete)).toBe(true);
    const done = apply(partial, {
      type: 'spend',
      spend: { api: 1, screen: 0, billing: 0, ops: 3 },
    });
    expect(done.pioneerScore).toBe(30);
    const repeated = apply(done, {
      type: 'spend',
      spend: { api: 3, screen: 1, billing: 0, ops: 0 },
    });
    expect(repeated.pioneerScore).toBe(30);
    expect(repeated.product.completedValue).toBe(8);
    const wasted = apply(done, {
      type: 'spend',
      spend: { api: 4, screen: 0, billing: 0, ops: 0 },
    });
    expect(wasted.pioneerScore).toBe(30);
    expect(wasted.product.shippedWork).toBe(done.product.shippedWork);
    expect(apply(repeated, { type: 'view' })).toBe(repeated);
  });

  it('同じ出荷でも新機能層は集中、安定層は運用枠が上回る', () => {
    const rows = compareCustomerSegments(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (mix: string, strategy: string) =>
      rows.find((row) => row.mix === mix && row.strategy === strategy)!.result.score;
    expect([
      score('pioneer', 'focus'),
      score('pioneer', 'ops'),
      score('pioneer', 'spread'),
    ]).toEqual([48, 36, 18]);
    expect([score('keeper', 'ops'), score('keeper', 'focus'), score('keeper', 'spread')]).toEqual([
      28, -16, -26,
    ]);
    const pioneer = rows.find((row) => row.mix === 'pioneer' && row.strategy === 'focus')!;
    const keeper = rows.find((row) => row.mix === 'keeper' && row.strategy === 'focus')!;
    expect(pioneer.inputs).toEqual(keeper.inputs);
    expect(pioneer.result.shippedWork).toBe(keeper.result.shippedWork);
    expect(pioneer.result.completed).toEqual(keeper.result.completed);
    expect(pioneer.result.score).not.toBe(keeper.result.score);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareCustomerSegments(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseCustomerAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeCustomerSegments(live)).toEqual(row.result);
    }
  });
});
