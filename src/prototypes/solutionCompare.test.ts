import { describe, expect, it } from 'vitest';
import {
  applySolutionInput as apply,
  baselineSolutionRules,
  chooseSolutionAction,
  compareSolutionFactorReversals,
  compareSolutionStrategies,
  createSolutionPrototype as create,
  summarizeSolution,
  viewSolution,
  type SolutionRules,
} from './solutionCompare';
import comparison from '../../docs/prototypes/solution-compare-comparison.json';
import factors from '../../docs/prototypes/solution-compare-factor-comparison.json';

describe('RI-195 複数案の比較', () => {
  it('同じseedの二案を再現し、表示を繰り返しても引き直さない', () => {
    const first = create(195, 6, 'launch');
    const again = create(195, 6, 'launch');
    expect(again).toEqual(first);
    expect(create(196, 6, 'launch').generation).not.toBe(first.generation);
    const before = structuredClone(first);
    const seen = viewSolution(first);
    for (let i = 0; i < 10; i++) expect(viewSolution(first)).toEqual(seen);
    expect(first).toEqual(before);
    expect(seen.proposals[0]).toMatchObject({
      id: 'fast',
      work: 2,
      shipValue: 8,
      upkeepPerTick: null,
      safetyLoss: null,
    });
    expect(seen.proposals[1]).toMatchObject({
      id: 'durable',
      revealed: false,
      work: null,
      shipValue: null,
      upkeepPerTick: null,
    });
    expect(viewSolution(create(196, 14, 'maintain')).proposals).toEqual(seen.proposals);
  });
  it('探索は2tickと集中力1を一度だけ払い、選択中は時間を止めて両方を見せる', () => {
    let state = apply(create(195, 14, 'maintain'), { type: 'explore' });
    expect(state).toMatchObject({ phase: 'exploring', focus: 1, focusSpent: 1, tick: 0 });
    expect(apply(state, { type: 'explore' })).toBe(state);
    state = apply(state, { type: 'tick' });
    expect(viewSolution(state).proposals[1]!.revealed).toBe(false);
    state = apply(state, { type: 'tick' });
    expect(state).toMatchObject({ phase: 'choosing', tick: 2 });
    expect(viewSolution(state).timeStopped).toBe(true);
    expect(viewSolution(state).proposals.map((proposal) => proposal.upkeepPerTick)).toEqual([3, 0]);
    expect(apply(state, { type: 'tick' })).toBe(state);
    const picked = apply(state, { type: 'adopt', proposal: 'durable' });
    expect(picked).toMatchObject({
      phase: 'implementing',
      adopted: 'durable',
      rejected: 'fast',
      tick: 2,
    });
    expect(apply(picked, { type: 'adopt', proposal: 'fast' })).toBe(picked);
  });
  it('未探索では速い案だけ採用でき、不採用案の成果を出荷へ足さない', () => {
    const initial = create(195, 6, 'launch');
    expect(apply(initial, { type: 'adopt', proposal: 'durable' })).toBe(initial);
    let state = apply(initial, { type: 'adopt', proposal: 'fast' });
    expect(state).toMatchObject({ rejected: 'durable', shippedValue: 0 });
    state = apply(apply(state, { type: 'tick' }), { type: 'tick' });
    expect(state).toMatchObject({ phase: 'shipped', shippedValue: 8, safetyLoss: 4, upkeep: 6 });
    const summary = summarizeSolution(state);
    expect(summary.withheldValue).toBe(8);
    expect(summary.netValue).toBe(8 + state.followUp - state.upkeep - state.safetyLoss);
    expect(summary.netValue).not.toBe(summary.shippedValue + summary.withheldValue);
    state = apply(state, { type: 'tick' });
    expect(state.shippedValue).toBe(8);
    expect(state.upkeep).toBe(6);
  });
  it('集中力不足・探索中の採用・期末は無消費で拒否する', () => {
    const poor = { ...create(195, 6, 'launch'), focus: 0 };
    expect(apply(poor, { type: 'explore' })).toBe(poor);
    const busy = apply(create(195, 6, 'launch'), { type: 'explore' });
    expect(apply(busy, { type: 'adopt', proposal: 'fast' })).toBe(busy);
    const ended = { ...create(195, 6, 'launch'), tick: 6 };
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'explore' })).toBe(ended);
    expect(apply(ended, { type: 'adopt', proposal: 'fast' })).toBe(ended);
  });
  it('投入期間が短い、または保守負担が軽いときは即採用、長い保守局面だけ比較後の耐久案が有利', () => {
    const rows = compareSolutionStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (posture: string, horizon: number, strategy: string) =>
      rows.find(
        (row) => row.posture === posture && row.horizon === horizon && row.strategy === strategy,
      )!.result.netValue;
    expect([
      net('launch', 6, 'rush'),
      net('launch', 6, 'compare-fast'),
      net('launch', 6, 'compare-durable'),
    ]).toEqual([14, 5, -13]);
    expect([net('launch', 14, 'rush'), net('launch', 14, 'compare-durable')]).toEqual([38, 35]);
    expect(net('maintain', 6, 'rush')).toBeGreaterThan(net('maintain', 6, 'compare-durable'));
    expect([
      net('maintain', 14, 'rush'),
      net('maintain', 14, 'compare-fast'),
      net('maintain', 14, 'compare-durable'),
    ]).toEqual([10, 1, 35]);
    for (const posture of ['launch', 'maintain'] as const) {
      for (const horizon of [6, 14] as const) {
        expect(net(posture, horizon, 'compare-fast')).toBeLessThan(net(posture, horizon, 'rush'));
      }
    }
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareSolutionStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(chooseSolutionAction(previous, row.strategy)).toEqual(input);
      }
      expect(summarizeSolution(live)).toEqual(row.result);
      expect(live.shippedValue === 0 || live.shippedValue === 8).toBe(true);
    }
  });
});

const POSTURES = ['launch', 'maintain'] as const;
const HORIZONS = [6, 14] as const;

function changedKeys(rules: SolutionRules): (keyof SolutionRules)[] {
  return (Object.keys(baselineSolutionRules) as (keyof SolutionRules)[]).filter(
    (key) => rules[key] !== baselineSolutionRules[key],
  );
}

function scenarioNet(
  rows: ReturnType<typeof compareSolutionFactorReversals>['sweeps']['exploreTicks'],
  parameter: string,
  posture: string,
  horizon: number,
) {
  const point = rows.find((item) => item.parameter === parameter);
  const scenario = point?.scenarios.find(
    (item) => item.posture === posture && item.horizon === horizon,
  );
  if (!point || !scenario) throw new Error(`${parameter}:${posture}:${horizon}`);
  return scenario;
}

describe('RI-195 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareSolutionFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 195,
      postures: ['launch', 'maintain'],
      horizons: [6, 14],
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
      twoProposalChoiceStopsTime: true,
    });
    expect(data.conditions.resources).toMatchObject({
      ship: 8,
      followPerTick: 4,
      fastWork: 2,
      durableWork: 5,
      spareWork: 6,
      exploreFocus: 1,
      unfinishedPenalty: 12,
      postureUpkeep: { launch: 1, maintain: 3 },
    });
    const nets = (axis: keyof typeof data.sweeps, parameters: string[]) =>
      data.sweeps[axis]
        .filter((item) => parameters.includes(item.parameter))
        .map((item) => [
          item.parameter,
          item.scenarios.map((scenario) => [
            scenario.posture,
            scenario.horizon,
            scenario.first.result.netValue,
            scenario.compare.result.netValue,
            scenario.compare.result.adopted,
            scenario.preference,
          ]),
        ]);
    expect(nets('exploreTicks', ['0', '1', '2', '8', '9'])).toEqual([
      [
        '0',
        [
          ['launch', 6, 14, 13, 'fast', 'first'],
          ['launch', 14, 38, 43, 'durable', 'compare'],
          ['maintain', 6, 2, 11, 'durable', 'compare'],
          ['maintain', 14, 10, 43, 'durable', 'compare'],
        ],
      ],
      [
        '1',
        [
          ['launch', 6, 14, 9, 'fast', 'first'],
          ['launch', 14, 38, 39, 'durable', 'compare'],
          ['maintain', 6, 2, 7, 'durable', 'compare'],
          ['maintain', 14, 10, 39, 'durable', 'compare'],
        ],
      ],
      [
        '2',
        [
          ['launch', 6, 14, 5, 'fast', 'first'],
          ['launch', 14, 38, 35, 'durable', 'first'],
          ['maintain', 6, 2, -7, 'fast', 'first'],
          ['maintain', 14, 10, 35, 'durable', 'compare'],
        ],
      ],
      [
        '8',
        [
          ['launch', 6, 14, -13, null, 'first'],
          ['launch', 14, 38, 11, 'durable', 'first'],
          ['maintain', 6, 2, -13, null, 'first'],
          ['maintain', 14, 10, 11, 'durable', 'compare'],
        ],
      ],
      [
        '9',
        [
          ['launch', 6, 14, -13, null, 'first'],
          ['launch', 14, 38, 7, 'durable', 'first'],
          ['maintain', 6, 2, -13, null, 'first'],
          ['maintain', 14, 10, 7, 'durable', 'first'],
        ],
      ],
    ]);
    expect(nets('upkeepScale', ['0', '0.5', '1', '1.5', '2', '5.5', '6'])).toEqual([
      [
        '0',
        [
          ['launch', 6, 20, 11, 'fast', 'first'],
          ['launch', 14, 52, 43, 'fast', 'first'],
          ['maintain', 6, 20, 11, 'fast', 'first'],
          ['maintain', 14, 52, 43, 'fast', 'first'],
        ],
      ],
      [
        '0.5',
        [
          ['launch', 6, 17, 8, 'fast', 'first'],
          ['launch', 14, 45, 36, 'fast', 'first'],
          ['maintain', 6, 11, 2, 'fast', 'first'],
          ['maintain', 14, 31, 35, 'durable', 'compare'],
        ],
      ],
      [
        '1',
        [
          ['launch', 6, 14, 5, 'fast', 'first'],
          ['launch', 14, 38, 35, 'durable', 'first'],
          ['maintain', 6, 2, -7, 'fast', 'first'],
          ['maintain', 14, 10, 35, 'durable', 'compare'],
        ],
      ],
      [
        '1.5',
        [
          ['launch', 6, 11, 2, 'fast', 'first'],
          ['launch', 14, 31, 35, 'durable', 'compare'],
          ['maintain', 6, -7, -13, 'durable', 'first'],
          ['maintain', 14, -11, 35, 'durable', 'compare'],
        ],
      ],
      [
        '2',
        [
          ['launch', 6, 8, -1, 'fast', 'first'],
          ['launch', 14, 24, 35, 'durable', 'compare'],
          ['maintain', 6, -16, -13, 'durable', 'compare'],
          ['maintain', 14, -32, 35, 'durable', 'compare'],
        ],
      ],
      [
        '5.5',
        [
          ['launch', 6, -13, -13, 'durable', 'tie'],
          ['launch', 14, -25, 35, 'durable', 'compare'],
          ['maintain', 6, -79, -13, 'durable', 'compare'],
          ['maintain', 14, -179, 35, 'durable', 'compare'],
        ],
      ],
      [
        '6',
        [
          ['launch', 6, -16, -13, 'durable', 'compare'],
          ['launch', 14, -32, 35, 'durable', 'compare'],
          ['maintain', 6, -88, -13, 'durable', 'compare'],
          ['maintain', 14, -200, 35, 'durable', 'compare'],
        ],
      ],
    ]);
    expect(nets('safetyLoss', ['4', '6', '7', '8', '19', '31'])).toEqual([
      [
        '4',
        [
          ['launch', 6, 14, 5, 'fast', 'first'],
          ['launch', 14, 38, 35, 'durable', 'first'],
          ['maintain', 6, 2, -7, 'fast', 'first'],
          ['maintain', 14, 10, 35, 'durable', 'compare'],
        ],
      ],
      [
        '6',
        [
          ['launch', 6, 12, 3, 'fast', 'first'],
          ['launch', 14, 36, 35, 'durable', 'first'],
          ['maintain', 6, 0, -9, 'fast', 'first'],
          ['maintain', 14, 8, 35, 'durable', 'compare'],
        ],
      ],
      [
        '7',
        [
          ['launch', 6, 11, 2, 'fast', 'first'],
          ['launch', 14, 35, 35, 'durable', 'tie'],
          ['maintain', 6, -1, -10, 'fast', 'first'],
          ['maintain', 14, 7, 35, 'durable', 'compare'],
        ],
      ],
      [
        '8',
        [
          ['launch', 6, 10, 1, 'fast', 'first'],
          ['launch', 14, 34, 35, 'durable', 'compare'],
          ['maintain', 6, -2, -11, 'fast', 'first'],
          ['maintain', 14, 6, 35, 'durable', 'compare'],
        ],
      ],
      [
        '19',
        [
          ['launch', 6, -1, -10, 'fast', 'first'],
          ['launch', 14, 23, 35, 'durable', 'compare'],
          ['maintain', 6, -13, -13, 'durable', 'tie'],
          ['maintain', 14, -5, 35, 'durable', 'compare'],
        ],
      ],
      [
        '31',
        [
          ['launch', 6, -13, -13, 'durable', 'tie'],
          ['launch', 14, 11, 35, 'durable', 'compare'],
          ['maintain', 6, -25, -13, 'durable', 'compare'],
          ['maintain', 14, -17, 35, 'durable', 'compare'],
        ],
      ],
    ]);
    expect(nets('choicePauseTicks', ['0', '6', '7', '8'])).toEqual([
      [
        '0',
        [
          ['launch', 6, 14, 5, 'fast', 'first'],
          ['launch', 14, 38, 35, 'durable', 'first'],
          ['maintain', 6, 2, -7, 'fast', 'first'],
          ['maintain', 14, 10, 35, 'durable', 'compare'],
        ],
      ],
      [
        '6',
        [
          ['launch', 6, 14, -13, null, 'first'],
          ['launch', 14, 38, 11, 'durable', 'first'],
          ['maintain', 6, 2, -13, null, 'first'],
          ['maintain', 14, 10, 11, 'durable', 'compare'],
        ],
      ],
      [
        '7',
        [
          ['launch', 6, 14, -13, null, 'first'],
          ['launch', 14, 38, 7, 'durable', 'first'],
          ['maintain', 6, 2, -13, null, 'first'],
          ['maintain', 14, 10, 7, 'durable', 'first'],
        ],
      ],
      [
        '8',
        [
          ['launch', 6, 14, -13, null, 'first'],
          ['launch', 14, 38, -3, 'fast', 'first'],
          ['maintain', 6, 2, -13, null, 'first'],
          ['maintain', 14, 10, -13, 'durable', 'first'],
        ],
      ],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.posture,
        item.horizon,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['exploreTicks', 'launch', 14, '1', 'compare', '2', 'first'],
      ['exploreTicks', 'maintain', 6, '1', 'compare', '2', 'first'],
      ['exploreTicks', 'maintain', 14, '8', 'compare', '9', 'first'],
      ['upkeepScale', 'maintain', 14, '0', 'first', '0.5', 'compare'],
      ['upkeepScale', 'launch', 14, '1', 'first', '1.5', 'compare'],
      ['upkeepScale', 'maintain', 6, '1.5', 'first', '2', 'compare'],
      ['upkeepScale', 'launch', 6, '5', 'first', '5.5', 'tie'],
      ['upkeepScale', 'launch', 6, '5.5', 'tie', '6', 'compare'],
      ['safetyLoss', 'launch', 14, '6', 'first', '7', 'tie'],
      ['safetyLoss', 'launch', 14, '7', 'tie', '8', 'compare'],
      ['safetyLoss', 'maintain', 6, '18', 'first', '19', 'tie'],
      ['safetyLoss', 'maintain', 6, '19', 'tie', '20', 'compare'],
      ['safetyLoss', 'launch', 6, '30', 'first', '31', 'tie'],
      ['safetyLoss', 'launch', 6, '31', 'tie', '32', 'compare'],
      ['choicePauseTicks', 'maintain', 14, '6', 'compare', '7', 'first'],
    ]);
    expect(
      data.reversals.some(
        (item) => item.axis === 'exploreTicks' && item.horizon === 6 && item.posture === 'launch',
      ),
    ).toBe(false);
    expect(
      data.reversals.some(
        (item) => item.axis === 'safetyLoss' && item.posture === 'maintain' && item.horizon === 14,
      ),
    ).toBe(false);
    expect(
      data.reversals
        .filter((item) => item.axis === 'choicePauseTicks')
        .map((item) => item.posture + item.horizon),
    ).toEqual(['maintain14']);
  });

  it('基準行は初回の最初の案・比べる判断と一致し、動かした規則は一つである', () => {
    const data = compareSolutionFactorReversals();
    const first = compareSolutionStrategies(comparison.seed);
    const anchors = [
      data.sweeps.exploreTicks.find((item) => item.parameter === '2'),
      data.sweeps.upkeepScale.find((item) => item.parameter === '1'),
      data.sweeps.safetyLoss.find((item) => item.parameter === '4'),
    ];
    for (const point of anchors) {
      if (!point) throw new Error('baseline');
      expect(changedKeys(point.rules)).toEqual([]);
      for (const scenario of point.scenarios) {
        const rush = first.find(
          (row) =>
            row.posture === scenario.posture &&
            row.horizon === scenario.horizon &&
            row.strategy === 'rush',
        );
        const picked = first.find(
          (row) =>
            row.posture === scenario.posture &&
            row.horizon === scenario.horizon &&
            row.strategy ===
              (scenario.compare.result.adopted === 'durable' ? 'compare-durable' : 'compare-fast'),
        );
        if (!rush || !picked) throw new Error('first');
        expect(scenario.first.inputs).toEqual(rush.inputs);
        expect(scenario.first.result).toEqual(rush.result);
        expect(scenario.compare.inputs).toEqual(picked.inputs);
        expect(scenario.compare.result).toEqual(picked.result);
      }
    }
    const paused = data.sweeps.choicePauseTicks.find((item) => item.parameter === '0');
    if (!paused) throw new Error('pause');
    expect(changedKeys(paused.rules)).toEqual(['proposalCount']);
    expect(paused.rules.choicePauseTicks).toBe(0);
    const baselineCompare = data.sweeps.exploreTicks.find((item) => item.parameter === '2');
    expect(paused.scenarios.map((scenario) => [scenario.first, scenario.compare])).toEqual(
      baselineCompare?.scenarios.map((scenario) => [scenario.first, scenario.compare]),
    );
    const only: Record<string, keyof SolutionRules> = {
      exploreTicks: 'exploreTicks',
      upkeepScale: 'upkeepScale',
      safetyLoss: 'safetyLoss',
      choicePauseTicks: 'choicePauseTicks',
    };
    for (const [axis, key] of Object.entries(only)) {
      for (const item of data.sweeps[axis as keyof typeof data.sweeps]) {
        const allowed = axis === 'choicePauseTicks' ? [key, 'proposalCount'] : [key];
        expect(changedKeys(item.rules).every((name) => allowed.includes(name))).toBe(true);
        expect(item.rules.proposalCount).toBe(axis === 'choicePauseTicks' ? 3 : 2);
      }
    }
    for (const item of Object.values(data.sweeps).flat()) {
      for (const scenario of item.scenarios) {
        expect(Number.isInteger(scenario.first.result.netValue)).toBe(true);
        expect(Number.isInteger(scenario.compare.result.netValue)).toBe(true);
        expect(scenario.compare.result.adopted).not.toBe('spare');
        expect(
          scenario.compare.inputs.some(
            (input) => input.type === 'adopt' && input.proposal === 'spare',
          ),
        ).toBe(false);
        expect(scenario.margin).toBe(
          scenario.compare.result.netValue - scenario.first.result.netValue,
        );
      }
    }
    const zero = scenarioNet(data.sweeps.upkeepScale, '0', 'launch', 14);
    const zeroMaintain = scenarioNet(data.sweeps.upkeepScale, '0', 'maintain', 14);
    expect(zero.first.result).toEqual(zeroMaintain.first.result);
    expect(zero.compare.result).toEqual(zeroMaintain.compare.result);
    const costly = scenarioNet(data.sweeps.upkeepScale, '2', 'maintain', 6);
    expect(costly.compare.result).toMatchObject({
      phase: 'implementing',
      adopted: 'durable',
      shippedValue: 0,
      netValue: -13,
    });
    expect(costly.first.result.netValue).toBeLessThan(-13);
  });

  it('探索0tickは時刻を止め、3案の選択停止だけが期末を消費する', () => {
    const instant = { ...baselineSolutionRules, exploreTicks: 0 };
    const revealed = apply(create(195, 14, 'maintain'), { type: 'explore' }, instant);
    expect(revealed).toMatchObject({ phase: 'choosing', tick: 0, focusSpent: 1, workLeft: 0 });
    expect(viewSolution(revealed, instant).timeStopped).toBe(true);
    expect(
      viewSolution(revealed, instant).proposals.map((proposal) => proposal.safetyLoss),
    ).toEqual([4, 0]);
    const ignored = { ...baselineSolutionRules, choicePauseTicks: 4 };
    let state = apply(
      apply(create(195, 14, 'launch'), { type: 'explore' }, ignored),
      { type: 'tick' },
      ignored,
    );
    state = apply(state, { type: 'tick' }, ignored);
    expect(state).toMatchObject({ phase: 'choosing', tick: 2, workLeft: 0 });
    expect(apply(state, { type: 'tick' }, ignored)).toBe(state);
    const paused = { ...baselineSolutionRules, proposalCount: 3 as const, choicePauseTicks: 2 };
    const initial = create(195, 14, 'maintain');
    expect(viewSolution(initial, paused).proposals[2]).toMatchObject({
      id: 'spare',
      revealed: false,
      work: null,
      shipValue: null,
    });
    expect(apply(initial, { type: 'adopt', proposal: 'spare' }, paused)).toBe(initial);
    state = apply(initial, { type: 'explore' }, paused);
    state = apply(apply(state, { type: 'tick' }, paused), { type: 'tick' }, paused);
    expect(state).toMatchObject({ phase: 'choosing', tick: 2, workLeft: 2, shippedValue: 0 });
    expect(apply(state, { type: 'adopt', proposal: 'durable' }, paused)).toBe(state);
    state = apply(apply(state, { type: 'tick' }, paused), { type: 'tick' }, paused);
    expect(state).toMatchObject({
      phase: 'choosing',
      tick: 4,
      workLeft: 0,
      shippedValue: 0,
      followUp: 0,
    });
    expect(viewSolution(state, paused).timeStopped).toBe(true);
    expect(viewSolution(state, paused).proposals[2]).toMatchObject({
      id: 'spare',
      revealed: true,
      work: 6,
      shipValue: 8,
      upkeepPerTick: 0,
      safetyLoss: 0,
    });
    const spare = apply(state, { type: 'adopt', proposal: 'spare' }, paused);
    expect(spare).toMatchObject({ phase: 'implementing', adopted: 'spare', workLeft: 6 });
    const picked = apply(state, { type: 'adopt', proposal: 'durable' }, paused);
    expect(picked.workLeft).toBe(5);
    expect(picked.upkeep).toBe(0);
  });

  it('要因比較の入力を再生すると差引が一致し、期末では同じ状態を返す', () => {
    const data = compareSolutionFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      for (const scenario of item.scenarios) {
        for (const side of ['first', 'compare'] as const) {
          const run = scenario[side];
          const strategy =
            side === 'first'
              ? 'rush'
              : run.result.adopted === 'durable'
                ? 'compare-durable'
                : 'compare-fast';
          let state = create(data.conditions.seed, scenario.horizon, scenario.posture);
          const snapshot = structuredClone(state);
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseSolutionAction(previous, strategy)).toEqual(input);
            state = apply(state, input, item.rules);
            const restored = apply(JSON.parse(JSON.stringify(before)), input, item.rules);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
            const summary = summarizeSolution(state);
            expect(
              summary.shippedValue +
                summary.followUp -
                summary.upkeep -
                summary.safetyLoss -
                summary.focusSpent -
                summary.unfinishedPenalty,
            ).toBe(summary.netValue);
            expect(summary.withheldValue === 0 || summary.withheldValue === 8).toBe(true);
          }
          expect(snapshot.tick).toBe(0);
          expect(summarizeSolution(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(apply(state, { type: 'tick' }, item.rules)).toBe(state);
        }
      }
    }
    for (const posture of POSTURES) {
      for (const horizon of HORIZONS) {
        expect(scenarioNet(data.sweeps.exploreTicks, '2', posture, horizon).preference).toBe(
          scenarioNet(data.sweeps.choicePauseTicks, '0', posture, horizon).preference,
        );
      }
    }
  });
});
