import { describe, expect, it } from 'vitest';
import {
  applyApprovalDelegation as apply,
  baselineApprovalRules,
  chooseApprovalAction,
  compareApprovalDelegations,
  compareApprovalFactorReversals,
  createApprovalDelegation as create,
  summarizeApprovalDelegation,
  viewApprovalDelegation,
  type ApprovalFactorRules,
} from './approvalDelegation';
import comparison from '../../docs/prototypes/approval-delegation-comparison.json';
import factors from '../../docs/prototypes/approval-delegation-factor-comparison.json';

describe('RI-225 権限委譲', () => {
  it('成熟度と、方針ごとの確認経路を操作前に示す', () => {
    const first = create('RI-225', 'mature');
    expect(create('RI-225', 'mature')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewApprovalDelegation(first);
    for (let i = 0; i < 8; i++) expect(viewApprovalDelegation(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({ maturity: 3, maturityLine: 2, policy: null, remaining: 4 });
    const low = blank.items.find((item) => item.id === 'l1')!;
    const important = blank.items.find((item) => item.id === 'i1')!;
    expect(low.routes).toEqual({ human: 'human', delegate: 'auto', rush: 'auto' });
    expect(important.routes).toEqual({ human: 'human', delegate: 'human', rush: 'blocked' });
    const junior = viewApprovalDelegation(create('RI-225', 'junior'));
    expect(junior.items.find((item) => item.id === 'l1')!.routes.delegate).toBe('human');
  });

  it('保存した成熟線が1なら、成熟1の低リスクも委譲できる', () => {
    const state = create('RI-225', 'junior');
    state.maturityLine = 1;
    const viewed = viewApprovalDelegation(state);
    expect(viewed.maturityLine).toBe(1);
    expect(viewed.items.find((item) => item.id === 'l1')!.routes.delegate).toBe('auto');
    let live = state;
    live = apply(live, { type: 'adopt', policy: 'delegate' });
    while (live.index < live.items.length) live = apply(live, { type: 'review' });
    expect(summarizeApprovalDelegation(live)).toMatchObject({
      reviewCost: 2,
      failure: 3,
      importantResidual: 0,
    });
  });

  it('重要変更は自動承認にならず、委譲だけでは報酬を足さない', () => {
    const fresh = create('RI-225', 'heavy');
    expect(apply(fresh, { type: 'review' })).toBe(fresh);
    expect(apply(fresh, { type: 'adopt', policy: 'delegate' })).not.toBe(fresh);
    let rushed = apply(fresh, { type: 'adopt', policy: 'rush' });
    while (rushed.index < rushed.items.length) rushed = apply(rushed, { type: 'review' });
    expect(rushed.items.every((item) => item.risk !== 'important' || item.reviewed)).toBe(true);
    expect(rushed.blocked).toBe(4);
    expect(summarizeApprovalDelegation(rushed).importantResidual).toBe(0);
    const delegated = compareApprovalDelegations('RI-225').find(
      (row) => row.board === 'junior' && row.strategy === 'delegate',
    )!;
    const human = compareApprovalDelegations('RI-225').find(
      (row) => row.board === 'junior' && row.strategy === 'human',
    )!;
    expect(delegated.result.score).toBeLessThan(human.result.score);
    expect(delegated.result.audit).toBe(1);
    expect(apply(rushed, { type: 'view' })).toBe(rushed);
  });

  it('低リスクが多い成熟チームだけ委譲が上回り、急ぎ承認はどの盤面でも上回らない', () => {
    const rows = compareApprovalDelegations(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([
      score('mature', 'delegate'),
      score('mature', 'human'),
      score('mature', 'rush'),
    ]).toEqual([20, 18, 12]);
    expect([
      score('junior', 'human'),
      score('junior', 'delegate'),
      score('junior', 'rush'),
    ]).toEqual([18, 17, 12]);
    expect([score('heavy', 'human'), score('heavy', 'delegate'), score('heavy', 'rush')]).toEqual([
      12, 11, 3,
    ]);
    for (const row of rows) {
      expect(row.result.importantResidual).toBe(0);
      expect(row.result.lost).toBe(false);
    }
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareApprovalDelegations(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseApprovalAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeApprovalDelegation(live)).toEqual(row.result);
    }
  });
});

function changedKeys(rules: ApprovalFactorRules): (keyof ApprovalFactorRules)[] {
  return (Object.keys(baselineApprovalRules) as (keyof ApprovalFactorRules)[]).filter(
    (key) => rules[key] !== baselineApprovalRules[key],
  );
}

describe('RI-225 要因の反転', () => {
  it('感度の規則は初回の閲覧と基準の規則を書き換えない', () => {
    const rules = { maturityLine: 4, residualFailure: 3, reviewCost: 0 };
    const swept = create('RI-225', 'mature', rules);
    expect(viewApprovalDelegation(swept).maturityLine).toBe(4);
    expect(viewApprovalDelegation(create('RI-225', 'mature'))).toMatchObject({
      maturity: 3,
      maturityLine: 2,
    });
    expect(baselineApprovalRules).toEqual({ maturityLine: 2, residualFailure: 1, reviewCost: 2 });
    const seen = viewApprovalDelegation(swept);
    seen.maturityLine = 9;
    expect(viewApprovalDelegation(create('RI-225', 'junior')).maturityLine).toBe(2);
    expect(compareApprovalDelegations(comparison.seed)).toEqual(comparison.results);
  });

  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareApprovalFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-225',
      audit: 1,
      rushFailure: 3,
      breach: 2,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    expect(data.conditions.decision).toEqual({
      delegate: '低リスクを委譲する',
      human: '人間が確認する',
      score: 'value - reviewCost - failure - audit - breach',
      preference: '委譲の差引が大きいとき委譲、人間確認が大きいとき人間、同じとき同点',
    });
    expect(data.conditions.boards).toEqual([
      {
        board: 'mature',
        maturity: 3,
        items: [
          { id: 'l1', risk: 'low', value: 6 },
          { id: 'l2', risk: 'low', value: 6 },
          { id: 'l3', risk: 'low', value: 6 },
          { id: 'i1', risk: 'important', value: 8 },
        ],
      },
      {
        board: 'junior',
        maturity: 1,
        items: [
          { id: 'l1', risk: 'low', value: 6 },
          { id: 'l2', risk: 'low', value: 6 },
          { id: 'l3', risk: 'low', value: 6 },
          { id: 'i1', risk: 'important', value: 8 },
        ],
      },
      {
        board: 'heavy',
        maturity: 3,
        items: [
          { id: 'i1', risk: 'important', value: 5 },
          { id: 'i2', risk: 'important', value: 5 },
          { id: 'i3', risk: 'important', value: 5 },
          { id: 'i4', risk: 'important', value: 5 },
        ],
      },
    ]);
    const scores = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((item) => [
        item.parameter,
        item.boards.map((board) => [
          board.board,
          board.delegate.result.score,
          board.human.result.score,
          board.preference,
        ]),
      ]);
    expect(scores('maturityLine')).toEqual([
      [
        '0',
        [
          ['mature', 20, 18, 'delegate'],
          ['junior', 20, 18, 'delegate'],
          ['heavy', 11, 12, 'human'],
        ],
      ],
      [
        '1',
        [
          ['mature', 20, 18, 'delegate'],
          ['junior', 20, 18, 'delegate'],
          ['heavy', 11, 12, 'human'],
        ],
      ],
      [
        '2',
        [
          ['mature', 20, 18, 'delegate'],
          ['junior', 17, 18, 'human'],
          ['heavy', 11, 12, 'human'],
        ],
      ],
      [
        '3',
        [
          ['mature', 20, 18, 'delegate'],
          ['junior', 17, 18, 'human'],
          ['heavy', 11, 12, 'human'],
        ],
      ],
      [
        '4',
        [
          ['mature', 17, 18, 'human'],
          ['junior', 17, 18, 'human'],
          ['heavy', 11, 12, 'human'],
        ],
      ],
    ]);
    expect(scores('residualFailure')).toEqual([
      [
        '0',
        [
          ['mature', 23, 18, 'delegate'],
          ['junior', 17, 18, 'human'],
          ['heavy', 11, 12, 'human'],
        ],
      ],
      [
        '1',
        [
          ['mature', 20, 18, 'delegate'],
          ['junior', 17, 18, 'human'],
          ['heavy', 11, 12, 'human'],
        ],
      ],
      [
        '2',
        [
          ['mature', 17, 18, 'human'],
          ['junior', 17, 18, 'human'],
          ['heavy', 11, 12, 'human'],
        ],
      ],
      [
        '3',
        [
          ['mature', 14, 18, 'human'],
          ['junior', 17, 18, 'human'],
          ['heavy', 11, 12, 'human'],
        ],
      ],
    ]);
    expect(scores('reviewCost')).toEqual([
      [
        '0',
        [
          ['mature', 22, 26, 'human'],
          ['junior', 25, 26, 'human'],
          ['heavy', 19, 20, 'human'],
        ],
      ],
      [
        '1',
        [
          ['mature', 21, 22, 'human'],
          ['junior', 21, 22, 'human'],
          ['heavy', 15, 16, 'human'],
        ],
      ],
      [
        '2',
        [
          ['mature', 20, 18, 'delegate'],
          ['junior', 17, 18, 'human'],
          ['heavy', 11, 12, 'human'],
        ],
      ],
      [
        '3',
        [
          ['mature', 19, 14, 'delegate'],
          ['junior', 13, 14, 'human'],
          ['heavy', 7, 8, 'human'],
        ],
      ],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.board,
        item.before.parameter,
        item.before.preference,
        item.before.delegate,
        item.before.human,
        item.after.parameter,
        item.after.preference,
        item.after.delegate,
        item.after.human,
      ]),
    ).toEqual([
      ['maturityLine', 'junior', '1', 'delegate', 20, 18, '2', 'human', 17, 18],
      ['maturityLine', 'mature', '3', 'delegate', 20, 18, '4', 'human', 17, 18],
      ['residualFailure', 'mature', '1', 'delegate', 20, 18, '2', 'human', 17, 18],
      ['reviewCost', 'mature', '1', 'human', 21, 22, '2', 'delegate', 20, 18],
    ]);
  });

  it('基準行は初回の委譲と人間確認と一致し、動かした規則は一つである', () => {
    const data = compareApprovalFactorReversals();
    const first = compareApprovalDelegations(comparison.seed);
    expect(first.filter((row) => row.strategy === 'rush')).toHaveLength(3);
    const baselines = [
      data.sweeps.maturityLine.find((item) => item.parameter === '2'),
      data.sweeps.residualFailure.find((item) => item.parameter === '1'),
      data.sweeps.reviewCost.find((item) => item.parameter === '2'),
    ];
    for (const point of baselines) {
      if (!point) throw new Error('baseline');
      expect(changedKeys(point.rules)).toEqual([]);
      for (const board of point.boards) {
        for (const strategy of ['delegate', 'human'] as const) {
          const prior = first.find((row) => row.board === board.board && row.strategy === strategy);
          if (!prior) throw new Error(`${board.board}:${strategy}`);
          expect(board[strategy].inputs).toEqual(prior.inputs);
          expect(board[strategy].result).toEqual(prior.result);
        }
      }
    }
    const only: Record<keyof typeof data.sweeps, keyof ApprovalFactorRules> = {
      maturityLine: 'maturityLine',
      residualFailure: 'residualFailure',
      reviewCost: 'reviewCost',
    };
    for (const [axis, key] of Object.entries(only) as [
      keyof typeof data.sweeps,
      keyof ApprovalFactorRules,
    ][]) {
      for (const item of data.sweeps[axis]) {
        expect(changedKeys(item.rules).every((name) => name === key)).toBe(true);
      }
    }
    for (const point of Object.values(data.sweeps).flat()) {
      for (const board of point.boards) {
        const maturity = board.board === 'junior' ? 1 : 3;
        const lows = board.board === 'heavy' ? 0 : 3;
        const importants = board.board === 'heavy' ? 4 : 1;
        const value = board.board === 'heavy' ? 20 : 26;
        const active = maturity >= point.rules.maturityLine && lows > 0;
        const humanReview = (lows + importants) * point.rules.reviewCost;
        expect(board.human.result).toEqual({
          value,
          reviewCost: humanReview,
          failure: 0,
          audit: 0,
          breach: 0,
          blocked: 0,
          score: value - humanReview,
          importantResidual: 0,
          lost: false,
        });
        const review = active ? importants * point.rules.reviewCost : humanReview;
        const failure = active ? lows * point.rules.residualFailure : 0;
        expect(board.delegate.result).toEqual({
          value,
          reviewCost: review,
          failure,
          audit: 1,
          breach: 0,
          blocked: 0,
          score: value - review - failure - 1,
          importantResidual: 0,
          lost: false,
        });
        expect(board.margin).toBe(board.delegate.result.score - board.human.result.score);
        expect(board.margin).not.toBe(0);
        expect(board.preference).toBe(board.margin > 0 ? 'delegate' : 'human');
        const priorHuman = first.find(
          (row) => row.board === board.board && row.strategy === 'human',
        );
        const priorDelegate = first.find(
          (row) => row.board === board.board && row.strategy === 'delegate',
        );
        expect(board.human.inputs).toEqual(priorHuman?.inputs);
        expect(board.delegate.inputs).toEqual(priorDelegate?.inputs);
      }
    }
  });

  it('要因比較の入力を再生すると差引が一致し、期末では同じ状態を返す', () => {
    const data = compareApprovalFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      for (const board of item.boards) {
        for (const strategy of ['delegate', 'human'] as const) {
          const run = board[strategy];
          let state = create(data.conditions.seed, board.board, item.rules);
          let saved = structuredClone(state);
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseApprovalAction(previous, strategy)).toEqual(input);
            state = apply(state, input, item.rules);
            saved = apply(JSON.parse(JSON.stringify(saved)), input, item.rules);
            expect(previous).toEqual(before);
            expect(saved).toEqual(state);
          }
          expect(summarizeApprovalDelegation(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(state.tick).toBe(state.horizon);
          expect(apply(state, { type: 'review' }, item.rules)).toBe(state);
          expect(
            state.items.every((change) => change.risk !== 'important' || !change.residual),
          ).toBe(true);
        }
      }
    }
  });
});
