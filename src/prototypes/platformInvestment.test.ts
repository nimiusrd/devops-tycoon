import { describe, expect, it } from 'vitest';
import {
  applyPlatformInvestment as apply,
  baselineInvestRules,
  chooseInvestmentAction,
  comparePlatformInvestmentFactorReversals,
  comparePlatformInvestments,
  createPlatformInvestment as create,
  INSTANT_COST,
  pipelineActive,
  produceValue,
  summarizePlatformInvestment,
  teamCapacity,
  viewPlatformInvestment,
  type InvestRules,
} from './platformInvestment';
import comparison from '../../docs/prototypes/platform-investment-comparison.json';
import factors from '../../docs/prototypes/platform-investment-factor-comparison.json';

describe('RI-217 基盤投資を仕事にする', () => {
  it('着工費用、担当、残作業、完成後の対象チームを事前に示す', () => {
    const first = create('RI-217', 'sprint');
    expect(create('RI-217', 'sprint')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewPlatformInvestment(first);
    for (let i = 0; i < 8; i++) expect(viewPlatformInvestment(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      startCost: 2,
      assignee: 'platform',
      workLeft: 4,
      jobTotal: 4,
      targets: ['product', 'incident'],
      effectLive: false,
      capacity: { platform: 1, product: 1, incident: 1 },
    });
    blank.targets.push('platform');
    blank.capacity.product = 99;
    expect(viewPlatformInvestment(first).targets).toEqual(['product', 'incident']);
    expect(teamCapacity(first).product).toBe(1);
  });

  it('完成と同じ期間には効果が出ず、対象へは一度ずつしか足さない', () => {
    let state = create('RI-217', 'quarter');
    state = apply(state, { type: 'start' });
    const deltas: number[] = [];
    while (state.jobDoneTick === null) {
      const before = state.value;
      state = apply(state, { type: 'work', platform: 'build' });
      deltas.push(state.value - before);
    }
    expect(deltas).toEqual([7, 7, 7, 7]);
    expect(state).toMatchObject({ tick: 4, effectApplied: true, bonusTicks: 0, jobDoneTick: 3 });
    expect(pipelineActive(state)).toBe(true);
    expect(teamCapacity(state)).toEqual({ platform: 1, product: 2, incident: 2 });

    const doubled = structuredClone(state);
    doubled.targets = ['product', 'product', 'incident', 'platform'];
    expect(teamCapacity(doubled)).toEqual({ platform: 1, product: 2, incident: 2 });
    expect(produceValue(state, ['platform', 'product', 'incident'], 'ship')).toBe(16);
    expect(produceValue(state, ['incident', 'product', 'platform'], 'ship')).toBe(16);

    const before = state.value;
    state = apply(state, { type: 'work', platform: 'ship' });
    expect(state.value - before).toBe(16);
    expect(teamCapacity(state)).toEqual({ platform: 1, product: 2, incident: 2 });
    expect(state.bonusTicks).toBe(1);
  });

  it('着工前の建設、二重の開始、即時との同時利用を受け付けない', () => {
    const fresh = create('RI-217', 'sprint');
    expect(apply(fresh, { type: 'work', platform: 'build' })).toBe(fresh);
    const started = apply(fresh, { type: 'start' });
    expect(apply(started, { type: 'start' })).toBe(started);
    expect(apply(started, { type: 'immediate' })).toBe(started);
    const instant = apply(fresh, { type: 'immediate' });
    expect(instant.instantLeft).toBe(2);
    expect(apply(instant, { type: 'start' })).toBe(instant);
    expect(apply(instant, { type: 'immediate' })).toBe(instant);
    let done = instant;
    while (done.tick < done.horizon) done = apply(done, { type: 'work', platform: 'ship' });
    expect(apply(done, { type: 'work', platform: 'ship' })).toBe(done);
    expect(summarizePlatformInvestment(done).lost).toBe(false);
  });

  it('短い期末は即時、長い期末は早い着工の差引が上回る', () => {
    const rows = comparePlatformInvestments(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([
      score('sprint', 'immediate'),
      score('sprint', 'ship'),
      score('sprint', 'late'),
      score('sprint', 'invest'),
    ]).toEqual([40, 36, 30, 26]);
    expect([
      score('quarter', 'invest'),
      score('quarter', 'late'),
      score('quarter', 'immediate'),
      score('quarter', 'ship'),
    ]).toEqual([90, 76, 76, 72]);
    const sprintInvest = rows.find((row) => row.board === 'sprint' && row.strategy === 'invest')!;
    expect(sprintInvest.result).toMatchObject({
      bonusTicks: 0,
      effectApplied: true,
      jobWorkLeft: 0,
    });
    const quarterInvest = rows.find((row) => row.board === 'quarter' && row.strategy === 'invest')!;
    expect(quarterInvest.result.bonusTicks).toBe(4);
    expect(rows.every((row) => row.result.lost === false)).toBe(true);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of comparePlatformInvestments(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseInvestmentAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizePlatformInvestment(live)).toEqual(row.result);
    }
  });
});

function changedKeys(rules: InvestRules): (keyof InvestRules)[] {
  return (Object.keys(baselineInvestRules) as (keyof InvestRules)[]).filter(
    (key) => rules[key] !== baselineInvestRules[key],
  );
}

describe('RI-217 要因の反転', () => {
  it('残作業1でも完成と同じtickには効果が出ず、費用0でも着工は1回で終わる', () => {
    const short = { ...baselineInvestRules, jobTotal: 1 };
    let state = apply(create('RI-217', 'sprint', short), { type: 'start' }, short);
    const built = apply(state, { type: 'work', platform: 'build' }, short);
    expect(built).toMatchObject({ tick: 1, value: 7, jobDoneTick: 0, effectApplied: true });
    expect(pipelineActive(built)).toBe(true);
    const lived = apply(built, { type: 'work', platform: 'ship' }, short);
    expect(lived.value - built.value).toBe(16);

    const free = { ...baselineInvestRules, startCost: 0 };
    state = apply(create('RI-217', 'quarter', free), { type: 'start' }, free);
    expect(state).toMatchObject({ budgetPaid: 0, started: true, tick: 0 });
    expect(apply(state, { type: 'start' }, free)).toBe(state);
    const next = apply(state, { type: 'work', platform: 'build' }, free);
    expect(next.tick).toBe(1);

    const none = { ...baselineInvestRules, instantTicks: 0 };
    const instant = apply(create('RI-217', 'sprint', none), { type: 'immediate' }, none);
    expect(instant).toMatchObject({ instantLeft: 0, budgetPaid: INSTANT_COST, value: 0 });
    const worked = apply(instant, { type: 'work', platform: 'ship' }, none);
    expect(worked.value).toBe(9);
    expect(teamCapacity(instant).product).toBe(1);
  });

  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = comparePlatformInvestmentFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-217',
      boards: ['sprint', 'quarter'],
      horizons: { sprint: 4, quarter: 8 },
      yields: { platform: 2, product: 3, incident: 4 },
      baseCapacity: 1,
      targets: ['product', 'incident'],
      instantCost: 2,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    expect(data.conditions.decision).toEqual({
      invest: 'invest',
      front: ['ship', 'immediate'],
      score: 'value - budgetPaid',
      preference: '投資の差引が大きいとき投資、目の前が大きいとき出荷または即時、同じとき同点',
    });
    const nets = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((item) => [
        item.parameter,
        item.boards.map((board) => [
          board.board,
          board.invest.result.score,
          board.opponents.map((opponent) => [
            opponent.opponent,
            opponent.front.result.score,
            opponent.preference,
          ]),
        ]),
      ]);
    expect(nets('startCost')).toEqual([
      [
        '0',
        [
          [
            'sprint',
            28,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            92,
            [
              ['ship', 72, 'invest'],
              ['immediate', 76, 'invest'],
            ],
          ],
        ],
      ],
      [
        '2',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            90,
            [
              ['ship', 72, 'invest'],
              ['immediate', 76, 'invest'],
            ],
          ],
        ],
      ],
      [
        '8',
        [
          [
            'sprint',
            20,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            84,
            [
              ['ship', 72, 'invest'],
              ['immediate', 76, 'invest'],
            ],
          ],
        ],
      ],
      [
        '15',
        [
          [
            'sprint',
            13,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            77,
            [
              ['ship', 72, 'invest'],
              ['immediate', 76, 'invest'],
            ],
          ],
        ],
      ],
      [
        '16',
        [
          [
            'sprint',
            12,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            76,
            [
              ['ship', 72, 'invest'],
              ['immediate', 76, 'tie'],
            ],
          ],
        ],
      ],
      [
        '17',
        [
          [
            'sprint',
            11,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            75,
            [
              ['ship', 72, 'invest'],
              ['immediate', 76, 'immediate'],
            ],
          ],
        ],
      ],
      [
        '19',
        [
          [
            'sprint',
            9,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            73,
            [
              ['ship', 72, 'invest'],
              ['immediate', 76, 'immediate'],
            ],
          ],
        ],
      ],
      [
        '20',
        [
          [
            'sprint',
            8,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            72,
            [
              ['ship', 72, 'tie'],
              ['immediate', 76, 'immediate'],
            ],
          ],
        ],
      ],
      [
        '21',
        [
          [
            'sprint',
            7,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            71,
            [
              ['ship', 72, 'ship'],
              ['immediate', 76, 'immediate'],
            ],
          ],
        ],
      ],
    ]);
    expect(nets('jobTotal')).toEqual([
      [
        '1',
        [
          [
            'sprint',
            53,
            [
              ['ship', 36, 'invest'],
              ['immediate', 40, 'invest'],
            ],
          ],
          [
            'quarter',
            117,
            [
              ['ship', 72, 'invest'],
              ['immediate', 76, 'invest'],
            ],
          ],
        ],
      ],
      [
        '2',
        [
          [
            'sprint',
            44,
            [
              ['ship', 36, 'invest'],
              ['immediate', 40, 'invest'],
            ],
          ],
          [
            'quarter',
            108,
            [
              ['ship', 72, 'invest'],
              ['immediate', 76, 'invest'],
            ],
          ],
        ],
      ],
      [
        '3',
        [
          [
            'sprint',
            35,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            99,
            [
              ['ship', 72, 'invest'],
              ['immediate', 76, 'invest'],
            ],
          ],
        ],
      ],
      [
        '4',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            90,
            [
              ['ship', 72, 'invest'],
              ['immediate', 76, 'invest'],
            ],
          ],
        ],
      ],
      [
        '5',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            81,
            [
              ['ship', 72, 'invest'],
              ['immediate', 76, 'invest'],
            ],
          ],
        ],
      ],
      [
        '6',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            72,
            [
              ['ship', 72, 'tie'],
              ['immediate', 76, 'immediate'],
            ],
          ],
        ],
      ],
      [
        '7',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            63,
            [
              ['ship', 72, 'ship'],
              ['immediate', 76, 'immediate'],
            ],
          ],
        ],
      ],
      [
        '8',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            54,
            [
              ['ship', 72, 'ship'],
              ['immediate', 76, 'immediate'],
            ],
          ],
        ],
      ],
      [
        '9',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            54,
            [
              ['ship', 72, 'ship'],
              ['immediate', 76, 'immediate'],
            ],
          ],
        ],
      ],
    ]);
    expect(nets('instantTicks')).toEqual([
      [
        '0',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 34, 'immediate'],
            ],
          ],
          [
            'quarter',
            90,
            [
              ['ship', 72, 'invest'],
              ['immediate', 70, 'invest'],
            ],
          ],
        ],
      ],
      [
        '1',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 37, 'immediate'],
            ],
          ],
          [
            'quarter',
            90,
            [
              ['ship', 72, 'invest'],
              ['immediate', 73, 'invest'],
            ],
          ],
        ],
      ],
      [
        '2',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 40, 'immediate'],
            ],
          ],
          [
            'quarter',
            90,
            [
              ['ship', 72, 'invest'],
              ['immediate', 76, 'invest'],
            ],
          ],
        ],
      ],
      [
        '3',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 43, 'immediate'],
            ],
          ],
          [
            'quarter',
            90,
            [
              ['ship', 72, 'invest'],
              ['immediate', 79, 'invest'],
            ],
          ],
        ],
      ],
      [
        '4',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 46, 'immediate'],
            ],
          ],
          [
            'quarter',
            90,
            [
              ['ship', 72, 'invest'],
              ['immediate', 82, 'invest'],
            ],
          ],
        ],
      ],
      [
        '5',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 46, 'immediate'],
            ],
          ],
          [
            'quarter',
            90,
            [
              ['ship', 72, 'invest'],
              ['immediate', 85, 'invest'],
            ],
          ],
        ],
      ],
      [
        '6',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 46, 'immediate'],
            ],
          ],
          [
            'quarter',
            90,
            [
              ['ship', 72, 'invest'],
              ['immediate', 88, 'invest'],
            ],
          ],
        ],
      ],
      [
        '7',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 46, 'immediate'],
            ],
          ],
          [
            'quarter',
            90,
            [
              ['ship', 72, 'invest'],
              ['immediate', 91, 'immediate'],
            ],
          ],
        ],
      ],
      [
        '8',
        [
          [
            'sprint',
            26,
            [
              ['ship', 36, 'ship'],
              ['immediate', 46, 'immediate'],
            ],
          ],
          [
            'quarter',
            90,
            [
              ['ship', 72, 'invest'],
              ['immediate', 94, 'immediate'],
            ],
          ],
        ],
      ],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.board,
        item.opponent,
        item.before.parameter,
        item.before.preference,
        item.before.invest,
        item.before.front,
        item.after.parameter,
        item.after.preference,
        item.after.invest,
        item.after.front,
      ]),
    ).toEqual([
      ['startCost', 'quarter', 'immediate', '15', 'invest', 77, 76, '16', 'tie', 76, 76],
      ['startCost', 'quarter', 'immediate', '16', 'tie', 76, 76, '17', 'immediate', 75, 76],
      ['startCost', 'quarter', 'ship', '19', 'invest', 73, 72, '20', 'tie', 72, 72],
      ['startCost', 'quarter', 'ship', '20', 'tie', 72, 72, '21', 'ship', 71, 72],
      ['jobTotal', 'sprint', 'ship', '2', 'invest', 44, 36, '3', 'ship', 35, 36],
      ['jobTotal', 'sprint', 'immediate', '2', 'invest', 44, 40, '3', 'immediate', 35, 40],
      ['jobTotal', 'quarter', 'ship', '5', 'invest', 81, 72, '6', 'tie', 72, 72],
      ['jobTotal', 'quarter', 'immediate', '5', 'invest', 81, 76, '6', 'immediate', 72, 76],
      ['jobTotal', 'quarter', 'ship', '6', 'tie', 72, 72, '7', 'ship', 63, 72],
      ['instantTicks', 'quarter', 'immediate', '6', 'invest', 90, 88, '7', 'immediate', 90, 91],
    ]);
  });

  it('基準行は初回の出荷・すぐ着工・即時と一致し、動かした規則は一つである', () => {
    const data = comparePlatformInvestmentFactorReversals();
    const first = comparePlatformInvestments(comparison.seed);
    expect(first.filter((row) => row.strategy === 'late')).toHaveLength(2);
    const baselines = [
      data.sweeps.startCost.find((item) => item.parameter === '2'),
      data.sweeps.jobTotal.find((item) => item.parameter === '4'),
      data.sweeps.instantTicks.find((item) => item.parameter === '2'),
    ];
    for (const point of baselines) {
      if (!point) throw new Error('baseline');
      expect(changedKeys(point.rules)).toEqual([]);
      for (const board of point.boards) {
        for (const strategy of ['invest', 'ship', 'immediate'] as const) {
          const prior = first.find((row) => row.board === board.board && row.strategy === strategy);
          if (!prior) throw new Error(`${board.board}:${strategy}`);
          const run =
            strategy === 'invest'
              ? board.invest
              : board.opponents.find((item) => item.opponent === strategy)?.front;
          expect(run?.inputs).toEqual(prior.inputs);
          expect(run?.result).toEqual(prior.result);
        }
      }
    }
    const only: Record<keyof typeof data.sweeps, keyof InvestRules> = {
      startCost: 'startCost',
      jobTotal: 'jobTotal',
      instantTicks: 'instantTicks',
    };
    for (const [axis, key] of Object.entries(only) as [
      keyof typeof data.sweeps,
      keyof InvestRules,
    ][]) {
      for (const item of data.sweeps[axis]) {
        expect(changedKeys(item.rules).every((name) => name === key)).toBe(true);
      }
    }
    const sprintValues = data.sweeps.startCost.map(
      (item) => item.boards.find((board) => board.board === 'sprint')?.invest.result.value,
    );
    const quarterValues = data.sweeps.startCost.map(
      (item) => item.boards.find((board) => board.board === 'quarter')?.invest.result.value,
    );
    expect(new Set(sprintValues)).toEqual(new Set([28]));
    expect(new Set(quarterValues)).toEqual(new Set([92]));
    const investInputs = data.sweeps.startCost.map((item) =>
      JSON.stringify(item.boards.map((board) => board.invest.inputs)),
    );
    expect(new Set(investInputs).size).toBe(1);
    for (const item of data.sweeps.startCost) {
      for (const board of item.boards) {
        expect(board.invest.result.budgetPaid).toBe(item.rules.startCost);
        expect(board.invest.result.score).toBe(board.invest.result.value - item.rules.startCost);
        const ship = board.opponents.find((opponent) => opponent.opponent === 'ship');
        const immediate = board.opponents.find((opponent) => opponent.opponent === 'immediate');
        expect(ship?.front.result).toMatchObject({
          budgetPaid: 0,
          score: board.board === 'sprint' ? 36 : 72,
        });
        expect(immediate?.front.result).toMatchObject({
          budgetPaid: INSTANT_COST,
          score: board.board === 'sprint' ? 40 : 76,
        });
        expect(ship?.margin).toBe(board.invest.result.score - (ship?.front.result.score ?? 0));
      }
    }
    for (const item of data.sweeps.jobTotal) {
      for (const board of item.boards) {
        const ship = board.opponents.find((opponent) => opponent.opponent === 'ship');
        const immediate = board.opponents.find((opponent) => opponent.opponent === 'immediate');
        expect(ship?.front.result.score).toBe(board.board === 'sprint' ? 36 : 72);
        expect(immediate?.front.result.score).toBe(board.board === 'sprint' ? 40 : 76);
        expect(immediate?.front.result.budgetPaid).toBe(INSTANT_COST);
      }
    }
    for (const item of data.sweeps.instantTicks) {
      for (const board of item.boards) {
        expect(board.invest.result.score).toBe(board.board === 'sprint' ? 26 : 90);
        const ship = board.opponents.find((opponent) => opponent.opponent === 'ship');
        const immediate = board.opponents.find((opponent) => opponent.opponent === 'immediate');
        expect(ship?.front.result.score).toBe(board.board === 'sprint' ? 36 : 72);
        expect(immediate?.front.result.budgetPaid).toBe(INSTANT_COST);
      }
    }
    const unfinished = data.sweeps.jobTotal
      .find((item) => item.parameter === '9')
      ?.boards.find((board) => board.board === 'quarter');
    expect(unfinished?.invest.result).toMatchObject({
      value: 56,
      score: 54,
      jobWorkLeft: 1,
      jobDoneTick: null,
      effectApplied: false,
      bonusTicks: 0,
    });
    const finishedLate = data.sweeps.jobTotal
      .find((item) => item.parameter === '8')
      ?.boards.find((board) => board.board === 'quarter');
    expect(finishedLate?.invest.result).toMatchObject({
      value: 56,
      score: 54,
      jobWorkLeft: 0,
      jobDoneTick: 7,
      effectApplied: true,
      bonusTicks: 0,
    });
    for (const rows of Object.values(data.sweeps)) {
      for (const point of rows) {
        for (const board of point.boards) {
          const runs = [
            { strategy: 'invest' as const, run: board.invest },
            ...board.opponents.map((opponent) => ({
              strategy: opponent.opponent,
              run: opponent.front,
            })),
          ];
          for (const { strategy, run } of runs) {
            let live = create(data.conditions.seed, board.board, point.rules);
            let saved = structuredClone(live);
            for (const input of run.inputs) {
              const previous = live;
              expect(chooseInvestmentAction(previous, strategy)).toEqual(input);
              live = apply(live, input, point.rules);
              saved = apply(JSON.parse(JSON.stringify(saved)) as typeof saved, input, point.rules);
              expect(previous).not.toBe(live);
              expect(saved).toEqual(live);
            }
            expect(summarizePlatformInvestment(live)).toEqual(run.result);
            expect(live.tick).toBe(live.horizon);
          }
        }
      }
    }
  });
});
