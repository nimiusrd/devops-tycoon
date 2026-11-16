import { describe, expect, it } from 'vitest';
import { rosterHeadcount } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';
import {
  applyCustomSharedOrder as apply,
  applyOrderSpend,
  baselineOrderRules,
  chooseOrderSpend,
  compareCustomSharedOrderFactorReversals,
  compareCustomSharedOrders,
  createCustomSharedOrder as create,
  summarizeCustomSharedOrder,
  viewCustomSharedOrder,
} from './customSharedOrder';
import comparison from '../../docs/prototypes/custom-shared-order-comparison.json';
import factors from '../../docs/prototypes/custom-shared-order-factor-comparison.json';

describe('RI-230 個別受注と共通機能', () => {
  it('対象人数、報酬、必要作業、初期の支払と保守余力を操作前に示す', () => {
    const first = create('RI-230', 'cash');
    expect(create('RI-230', 'cash')).toEqual(first);
    expect(first.capacity).toBe(PRODUCT_CAPACITY);
    expect(first.sharedReach).toBe(rosterHeadcount('pioneer'));
    const before = structuredClone(first);
    const blank = viewCustomSharedOrder(first);
    for (let i = 0; i < 8; i++) expect(viewCustomSharedOrder(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toEqual({
      tick: 0,
      horizon: 3,
      capacity: 4,
      custom: { remaining: 4, reward: 12, reach: 1, upkeep: 3, paid: false },
      shared: { remaining: 6, reward: 4, reach: 4, upkeep: 1, paid: false },
      earlyBill: 10,
      missPenalty: 8,
      slack: 1,
      upkeepWeight: 0,
    });
    expect(viewCustomSharedOrder(create('RI-230', 'upkeep'))).toMatchObject({
      earlyBill: 0,
      upkeepWeight: 4,
    });
  });

  it('同じ機能の報酬と到達は一度だけ、余った作業はもう一方へ移らない', () => {
    const fresh = create('RI-230', 'cash');
    expect(applyOrderSpend(fresh, { custom: 3, shared: 0 })).toBe(fresh);
    const custom = apply(fresh, { type: 'spend', spend: { custom: 4, shared: 0 } });
    expect(custom.cash).toBe(12);
    expect(custom.servedCustom).toBe(1);
    expect(custom.missedBill).toBe(false);
    const again = apply(custom, { type: 'spend', spend: { custom: 4, shared: 0 } });
    expect(again.cash).toBe(12);
    expect(again.servedCustom).toBe(1);
    const shared = apply(create('RI-230', 'upkeep'), {
      type: 'spend',
      spend: { custom: 0, shared: 4 },
    });
    const sharedDone = apply(shared, { type: 'spend', spend: { custom: 0, shared: 4 } });
    expect(sharedDone.cash).toBe(4);
    expect(sharedDone.servedShared).toBe(4);
    const sharedAgain = apply(sharedDone, { type: 'spend', spend: { custom: 0, shared: 4 } });
    expect(sharedAgain.cash).toBe(4);
    expect(sharedAgain.servedShared).toBe(4);
    expect(apply(sharedAgain, { type: 'view' })).toBe(sharedAgain);
  });

  it('資金が乏しい盤面は個別先行、保守余力が少ない盤面は共通先行が上回る', () => {
    const rows = compareCustomSharedOrders(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([
      score('cash', 'customFirst'),
      score('cash', 'customOnly'),
      score('cash', 'sharedFirst'),
    ]).toEqual([16, 12, 8]);
    expect([
      score('upkeep', 'sharedFirst'),
      score('upkeep', 'customFirst'),
      score('upkeep', 'customOnly'),
    ]).toEqual([4, -12, -12]);
    const early = rows.find((row) => row.board === 'cash' && row.strategy === 'customFirst')!;
    const late = rows.find((row) => row.board === 'cash' && row.strategy === 'sharedFirst')!;
    expect(early.result.cash).toBe(late.result.cash);
    expect(early.result.servedCustom).toBe(1);
    expect(early.result.servedShared).toBe(4);
    expect(late.result.miss).toBe(8);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareCustomSharedOrders(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseOrderSpend(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeCustomSharedOrder(live)).toEqual(row.result);
    }
  });
});

describe('RI-230 要因の反転', () => {
  const orderText = (order: readonly (readonly string[])[]) =>
    order.map((group) => group.join('=')).join('>');

  const scoresOf = (axis: keyof typeof factors.sweeps) =>
    factors.sweeps[axis].map((point) => [
      point.parameter,
      ...point.boards.flatMap((board) => [
        board.scores.customFirst,
        board.scores.sharedFirst,
        board.scores.customOnly,
        orderText(board.order),
      ]),
    ]);

  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareCustomSharedOrderFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-230',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    expect(data.conditions.baseline).toEqual(baselineOrderRules);
    expect(scoresOf('reward')).toEqual([
      [
        '0',
        -4,
        -4,
        -8,
        'customFirst=sharedFirst>customOnly',
        -24,
        -8,
        -24,
        'sharedFirst>customFirst=customOnly',
      ],
      [
        '9',
        5,
        5,
        1,
        'customFirst=sharedFirst>customOnly',
        -15,
        1,
        -15,
        'sharedFirst>customFirst=customOnly',
      ],
      [
        '10',
        14,
        6,
        10,
        'customFirst>customOnly>sharedFirst',
        -14,
        2,
        -14,
        'sharedFirst>customFirst=customOnly',
      ],
      [
        '12',
        16,
        8,
        12,
        'customFirst>customOnly>sharedFirst',
        -12,
        4,
        -12,
        'sharedFirst>customFirst=customOnly',
      ],
      [
        '16',
        20,
        12,
        16,
        'customFirst>customOnly>sharedFirst',
        -8,
        8,
        -8,
        'sharedFirst>customFirst=customOnly',
      ],
    ]);
    expect(scoresOf('upkeep')).toEqual([
      [
        '0',
        16,
        8,
        12,
        'customFirst>customOnly>sharedFirst',
        16,
        16,
        12,
        'customFirst=sharedFirst>customOnly',
      ],
      [
        '1',
        16,
        8,
        12,
        'customFirst>customOnly>sharedFirst',
        12,
        12,
        12,
        'customFirst=sharedFirst=customOnly',
      ],
      [
        '2',
        16,
        8,
        12,
        'customFirst>customOnly>sharedFirst',
        0,
        8,
        0,
        'sharedFirst>customFirst=customOnly',
      ],
      [
        '3',
        16,
        8,
        12,
        'customFirst>customOnly>sharedFirst',
        -12,
        4,
        -12,
        'sharedFirst>customFirst=customOnly',
      ],
      [
        '4',
        16,
        8,
        12,
        'customFirst>customOnly>sharedFirst',
        -24,
        0,
        -24,
        'sharedFirst>customFirst=customOnly',
      ],
    ]);
    expect(scoresOf('earlyBill')).toEqual([
      [
        '0',
        16,
        16,
        12,
        'customFirst=sharedFirst>customOnly',
        -12,
        4,
        -12,
        'sharedFirst>customFirst=customOnly',
      ],
      [
        '1',
        16,
        8,
        12,
        'customFirst>customOnly>sharedFirst',
        -12,
        4,
        -12,
        'sharedFirst>customFirst=customOnly',
      ],
      [
        '10',
        16,
        8,
        12,
        'customFirst>customOnly>sharedFirst',
        -12,
        4,
        -12,
        'sharedFirst>customFirst=customOnly',
      ],
      [
        '12',
        16,
        8,
        12,
        'customFirst>customOnly>sharedFirst',
        -12,
        4,
        -12,
        'sharedFirst>customFirst=customOnly',
      ],
      [
        '13',
        8,
        8,
        4,
        'customFirst=sharedFirst>customOnly',
        -12,
        4,
        -12,
        'sharedFirst>customFirst=customOnly',
      ],
      [
        '16',
        8,
        8,
        4,
        'customFirst=sharedFirst>customOnly',
        -12,
        4,
        -12,
        'sharedFirst>customFirst=customOnly',
      ],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.board,
        item.before.parameter,
        orderText(item.before.order),
        item.after.parameter,
        orderText(item.after.order),
      ]),
    ).toEqual([
      [
        'reward',
        'cash',
        '9',
        'customFirst=sharedFirst>customOnly',
        '10',
        'customFirst>customOnly>sharedFirst',
      ],
      [
        'upkeep',
        'upkeep',
        '0',
        'customFirst=sharedFirst>customOnly',
        '1',
        'customFirst=sharedFirst=customOnly',
      ],
      [
        'upkeep',
        'upkeep',
        '1',
        'customFirst=sharedFirst=customOnly',
        '2',
        'sharedFirst>customFirst=customOnly',
      ],
      [
        'earlyBill',
        'cash',
        '0',
        'customFirst=sharedFirst>customOnly',
        '1',
        'customFirst>customOnly>sharedFirst',
      ],
      [
        'earlyBill',
        'cash',
        '12',
        'customFirst>customOnly>sharedFirst',
        '13',
        'customFirst=sharedFirst>customOnly',
      ],
    ]);
    expect(data.reversals.some((item) => item.axis === 'reward' && item.board === 'upkeep')).toBe(
      false,
    );
    expect(data.reversals.some((item) => item.axis === 'upkeep' && item.board === 'cash')).toBe(
      false,
    );
    expect(
      data.reversals.some((item) => item.axis === 'earlyBill' && item.board === 'upkeep'),
    ).toBe(false);
  });

  it('基準行は初回の3戦略と一致し、動かした規則は一つである', () => {
    const data = compareCustomSharedOrderFactorReversals();
    const first = compareCustomSharedOrders(comparison.seed);
    const baselines = [
      data.sweeps.reward.find((item) => item.parameter === '12'),
      data.sweeps.upkeep.find((item) => item.parameter === '3'),
      data.sweeps.earlyBill.find((item) => item.parameter === '10'),
    ];
    for (const point of baselines) {
      if (!point) throw new Error('baseline');
      expect(point.sameAsFirstComparison).toBe(true);
      expect(point.rules).toEqual({ customReward: 12, customUpkeep: 3, earlyBill: 10 });
      for (const board of point.boards) {
        for (const run of board.runs) {
          const original = first.find(
            (row) => row.board === board.board && row.strategy === run.strategy,
          );
          if (!original) throw new Error(`${board.board}:${run.strategy}`);
          expect(run.inputs).toEqual(original.inputs);
          expect(run.result).toEqual(original.result);
        }
      }
    }
    expect(Object.keys(data.sweeps)).toEqual(['reward', 'upkeep', 'earlyBill']);
    for (const point of data.sweeps.reward) {
      expect(point.rules).toEqual({
        customReward: Number(point.parameter),
        customUpkeep: 3,
        earlyBill: 10,
      });
      expect(point.sameAsFirstComparison).toBe(point.parameter === '12');
    }
    for (const point of data.sweeps.upkeep) {
      expect(point.rules).toEqual({
        customReward: 12,
        customUpkeep: Number(point.parameter),
        earlyBill: 10,
      });
      expect(point.sameAsFirstComparison).toBe(point.parameter === '3');
    }
    for (const point of data.sweeps.earlyBill) {
      expect(point.rules).toEqual({
        customReward: 12,
        customUpkeep: 3,
        earlyBill: Number(point.parameter),
      });
      expect(point.sameAsFirstComparison).toBe(point.parameter === '10');
    }
    for (const board of ['cash', 'upkeep'] as const) {
      const initial = create(comparison.seed, board);
      expect(data.conditions.boards[board]).toEqual({
        horizon: initial.horizon,
        capacity: initial.capacity,
        customNeed: initial.customNeed,
        sharedNeed: initial.sharedNeed,
        customReward: initial.customReward,
        sharedReward: initial.sharedReward,
        customUpkeep: initial.customUpkeep,
        sharedUpkeep: initial.sharedUpkeep,
        customReach: initial.customReach,
        sharedReach: initial.sharedReach,
        bill: initial.bill,
        missPenalty: initial.missPenalty,
        slack: initial.slack,
        upkeepWeight: initial.upkeepWeight,
      });
    }
  });

  it('報酬は支払の成否だけを分け、保守と初期支払はもう一方の盤面を動かさない', () => {
    const data = compareCustomSharedOrderFactorReversals();
    for (const point of data.sweeps.reward) {
      const reward = Number(point.parameter);
      for (const board of point.boards) {
        const customFirst = board.runs.find((run) => run.strategy === 'customFirst');
        const sharedFirst = board.runs.find((run) => run.strategy === 'sharedFirst');
        const customOnly = board.runs.find((run) => run.strategy === 'customOnly');
        if (!customFirst || !sharedFirst || !customOnly) throw new Error(point.parameter);
        expect(customFirst.result.cash).toBe(reward + 4);
        expect(sharedFirst.result.cash).toBe(reward + 4);
        expect(customOnly.result.cash).toBe(reward);
        expect(customFirst.result.servedShared).toBe(4);
        expect(customOnly.result.servedShared).toBe(0);
        expect(board.runs.every((run) => run.result.lost === false)).toBe(true);
      }
      const cash = point.boards.find((board) => board.board === 'cash');
      const upkeep = point.boards.find((board) => board.board === 'upkeep');
      if (!cash || !upkeep) throw new Error(point.parameter);
      const missed = reward < 10;
      expect(cash.runs.find((run) => run.strategy === 'customFirst')?.result.miss).toBe(
        missed ? 8 : 0,
      );
      expect(cash.runs.find((run) => run.strategy === 'sharedFirst')?.result.miss).toBe(8);
      expect(upkeep.scores.sharedFirst - upkeep.scores.customFirst).toBe(16);
      expect(upkeep.runs.every((run) => run.result.miss === 0)).toBe(true);
    }
    for (const point of data.sweeps.upkeep) {
      const cash = point.boards.find((board) => board.board === 'cash');
      expect(cash?.scores).toEqual({ customFirst: 16, sharedFirst: 8, customOnly: 12 });
    }
    for (const point of data.sweeps.earlyBill) {
      const upkeep = point.boards.find((board) => board.board === 'upkeep');
      expect(upkeep?.scores).toEqual({ customFirst: -12, sharedFirst: 4, customOnly: -12 });
      expect(upkeep?.runs.every((run) => run.result.miss === 0)).toBe(true);
    }
  });

  it('閲覧の報酬と保守は初回のままで、不正な係数は基準へ戻る', () => {
    const rules = { customReward: 0, customUpkeep: 0, earlyBill: 0 };
    const shared = apply(
      create('RI-230', 'cash'),
      { type: 'spend', spend: { custom: 0, shared: 4 } },
      rules,
    );
    expect(shared.cash).toBe(0);
    expect(shared.missedBill).toBe(false);
    expect(shared.customReward).toBe(12);
    expect(shared.sharedReward).toBe(4);
    expect(shared.customUpkeep).toBe(3);
    expect(shared.sharedUpkeep).toBe(1);
    expect(shared.bill).toBe(10);
    expect(viewCustomSharedOrder(shared).custom).toMatchObject({
      reward: 12,
      upkeep: 3,
      paid: false,
    });
    expect(viewCustomSharedOrder(shared).shared.reward).toBe(4);
    const heavy = apply(
      create('RI-230', 'upkeep'),
      { type: 'spend', spend: { custom: 4, shared: 0 } },
      { customReward: 12, customUpkeep: 0, earlyBill: 99 },
    );
    expect(heavy.upkeep).toBe(0);
    expect(heavy.upkeepPenalty).toBe(0);
    expect(heavy.missedBill).toBe(false);
    expect(heavy.bill).toBe(0);
    expect(heavy.customUpkeep).toBe(3);
    const fallback = apply(
      create('RI-230', 'cash'),
      { type: 'spend', spend: { custom: 4, shared: 0 } },
      { customReward: -1, customUpkeep: 1.5, earlyBill: Number.NaN },
    );
    const baseline = apply(create('RI-230', 'cash'), {
      type: 'spend',
      spend: { custom: 4, shared: 0 },
    });
    expect(fallback.cash).toBe(baseline.cash);
    expect(fallback.missedBill).toBe(baseline.missedBill);
    expect(fallback.customReward).toBe(12);
    expect(fallback.customUpkeep).toBe(3);
  });

  it('要因比較の入力を再生すると差引が一致し、元状態は変わらない', () => {
    const data = compareCustomSharedOrderFactorReversals();
    const first = compareCustomSharedOrders(comparison.seed);
    for (const point of Object.values(data.sweeps).flat()) {
      for (const board of point.boards) {
        for (const run of board.runs) {
          const original = first.find(
            (row) => row.board === board.board && row.strategy === run.strategy,
          );
          expect(original?.inputs).toEqual(run.inputs);
          let state = create(data.conditions.seed, board.board);
          const snapshot = structuredClone(state);
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseOrderSpend(state, run.strategy)).toEqual(input);
            state = apply(state, input, point.rules);
            const restored = apply(JSON.parse(JSON.stringify(before)), input, point.rules);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
          }
          expect(snapshot.tick).toBe(0);
          expect(summarizeCustomSharedOrder(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(state.customReward).toBe(12);
          expect(state.sharedReward).toBe(4);
          expect(state.customUpkeep).toBe(3);
          expect(state.sharedUpkeep).toBe(1);
          expect(state.bill).toBe(board.board === 'cash' ? 10 : 0);
          expect(
            apply(state, { type: 'spend', spend: { custom: 4, shared: 0 } }, point.rules),
          ).toBe(state);
        }
      }
    }
  });
});
