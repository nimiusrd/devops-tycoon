import { describe, expect, it } from 'vitest';
import {
  applyAdoptionInput as apply,
  baselineAdoptionRules,
  chooseAdoptionAction,
  chooseAdoptionTool,
  compareAdoptionFactorReversals,
  compareAdoptionStrategies,
  createAdoptionEval as create,
  summarizeAdoption,
  viewAdoptionEval,
  type AdoptionRules,
} from './adoptionEval';
import comparison from '../../docs/prototypes/adoption-eval-comparison.json';
import factors from '../../docs/prototypes/adoption-eval-factor-comparison.json';

const cells = [
  ['swift', 'routine'],
  ['swift', 'migration'],
  ['swift', 'incident'],
  ['careful', 'routine'],
  ['careful', 'migration'],
  ['careful', 'incident'],
] as const;

function evaluateAll(mix: 'balanced' | 'routineHeavy', horizon: number) {
  let state = create(197, horizon, mix);
  for (const [tool, kind] of cells) {
    state = apply(state, { type: 'benchmark', tool, kind });
    state = apply(state, { type: 'tick' });
  }
  return state;
}

describe('RI-197 導入前の評価セット', () => {
  it('同じseedの評価は再現し、表示では未測定の手戻りを出さない', () => {
    const first = create(197, 8, 'balanced');
    expect(create(197, 8, 'balanced')).toEqual(first);
    expect(create(198, 8, 'balanced').generation).not.toBe(first.generation);
    const before = structuredClone(first);
    const seen = viewAdoptionEval(first);
    for (let i = 0; i < 10; i++) expect(viewAdoptionEval(first)).toEqual(seen);
    expect(first).toEqual(before);
    expect(seen.observations).toEqual([]);
    expect(seen.tools[0]!.jobs.map((job) => job.rework)).toEqual([null, null, null]);
    expect(seen.tools[0]!.jobs.map((job) => job.ticks)).toEqual([1, 1, 1]);
    expect(seen.production).toEqual(['migration', 'incident', 'routine']);
    seen.production.shift();
    seen.production.sort();
    expect(first.queue).toEqual(['migration', 'incident', 'routine']);
    expect(viewAdoptionEval(first).production).toEqual(['migration', 'incident', 'routine']);
  });
  it('代表仕事の結果を種類別に残し、測定中は本番価値を出さない', () => {
    let state = apply(create(197, 20, 'balanced'), {
      type: 'benchmark',
      tool: 'swift',
      kind: 'migration',
    });
    expect(apply(state, { type: 'benchmark', tool: 'swift', kind: 'incident' })).toBe(state);
    state = apply(state, { type: 'tick' });
    expect(state.shippedValue).toBe(0);
    expect(state.observations).toEqual([
      { tool: 'swift', kind: 'migration', ticks: 1, rework: 14 },
    ]);
    expect(viewAdoptionEval(state).tools[0]!.jobs.map((job) => job.rework)).toEqual([
      null,
      14,
      null,
    ]);
    expect(apply(state, { type: 'benchmark', tool: 'swift', kind: 'migration' })).toBe(state);
    const done = evaluateAll('routineHeavy', 20);
    expect(done.observations).toHaveLength(6);
    expect(done.shippedValue).toBe(0);
    expect(done.observations.map((item) => item.rework)).toEqual([0, 14, 10, 0, 1, 1]);
    expect(chooseAdoptionTool(done, 'perKind')).toBe('swift');
    expect(chooseAdoptionTool(done, 'pooled')).toBe('careful');
    expect(chooseAdoptionTool(evaluateAll('balanced', 20), 'perKind')).toBe('careful');
    expect(chooseAdoptionTool(evaluateAll('balanced', 8), 'perKind')).toBe('swift');
  });
  it('採用後の再測定、二重採用、判断前のtick、期末は無消費で拒否する', () => {
    const initial = create(197, 8, 'balanced');
    expect(apply(initial, { type: 'tick' })).toBe(initial);
    expect(apply(initial, { type: 'start' })).toBe(initial);
    const adopted = apply(initial, { type: 'adopt', tool: 'swift' });
    expect(apply(adopted, { type: 'adopt', tool: 'careful' })).toBe(adopted);
    expect(apply(adopted, { type: 'benchmark', tool: 'swift', kind: 'routine' })).toBe(adopted);
    const ended = { ...initial, tick: initial.horizon };
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'adopt', tool: 'swift' })).toBe(ended);
  });
  it('短期は見切りの速さが有利で、長期の定型偏重では種類別評価が合算評価を上回る', () => {
    const rows = compareAdoptionStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (mix: string, horizon: number, strategy: string) =>
      rows.find((row) => row.mix === mix && row.horizon === horizon && row.strategy === strategy)!
        .result.netValue;
    expect([
      net('balanced', 8, 'swift'),
      net('balanced', 8, 'careful'),
      net('balanced', 8, 'perKind'),
    ]).toEqual([5, 2, -20]);
    expect([
      net('balanced', 20, 'swift'),
      net('balanced', 20, 'careful'),
      net('balanced', 20, 'perKind'),
    ]).toEqual([17, 33, 27]);
    expect(net('routineHeavy', 8, 'swift')).toBe(36);
    expect([
      net('routineHeavy', 20, 'swift'),
      net('routineHeavy', 20, 'perKind'),
      net('routineHeavy', 20, 'careful'),
      net('routineHeavy', 20, 'pooled'),
    ]).toEqual([48, 42, 40, 34]);
    expect(
      rows.find(
        (row) => row.mix === 'routineHeavy' && row.horizon === 20 && row.strategy === 'pooled',
      )!.result.adopted,
    ).toBe('careful');
    expect(
      rows.find(
        (row) => row.mix === 'routineHeavy' && row.horizon === 20 && row.strategy === 'perKind',
      )!.result.adopted,
    ).toBe('swift');
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、評価と本番の価値を混ぜない', () => {
    for (const row of compareAdoptionStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseAdoptionAction(previous, row.strategy)).toEqual(input);
        const shippedBefore = live.shippedValue;
        live = apply(live, input);
        if (input.type === 'benchmark' || (input.type === 'tick' && previous.benchmark)) {
          expect(live.shippedValue).toBe(shippedBefore);
        }
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeAdoption(live)).toEqual(row.result);
      if (row.strategy === 'perKind' || row.strategy === 'pooled')
        expect(live.observations).toHaveLength(6);
    }
  });
});

function changedKeys(rules: AdoptionRules): (keyof AdoptionRules)[] {
  return (Object.keys(baselineAdoptionRules) as (keyof AdoptionRules)[]).filter(
    (key) => rules[key] !== baselineAdoptionRules[key],
  );
}

describe('RI-197 要因の反転', () => {
  it('評価tickが0のときは期末を進めず、2のときは2tick目に手戻りを残す', () => {
    const free = { ...baselineAdoptionRules, evalTicks: 0 };
    const seen = apply(
      create(197, 8, 'balanced'),
      { type: 'benchmark', tool: 'swift', kind: 'migration' },
      free,
    );
    expect(seen.tick).toBe(0);
    expect(seen.benchmark).toBeNull();
    expect(seen.shippedValue).toBe(0);
    expect(seen.observations).toEqual([{ tool: 'swift', kind: 'migration', ticks: 1, rework: 14 }]);
    const slow = { ...baselineAdoptionRules, evalTicks: 2, reworkScale: 2 };
    let state = apply(
      create(197, 8, 'balanced'),
      { type: 'benchmark', tool: 'swift', kind: 'migration' },
      slow,
    );
    expect(state.tick).toBe(0);
    expect(state.observations).toEqual([]);
    state = apply(state, { type: 'tick' }, slow);
    expect(state.tick).toBe(1);
    expect(state.observations).toEqual([]);
    expect(state.shippedValue).toBe(0);
    state = apply(state, { type: 'tick' }, slow);
    expect(state).toMatchObject({ tick: 2, benchmark: null, shippedValue: 0 });
    expect(state.observations).toEqual([
      { tool: 'swift', kind: 'migration', ticks: 1, rework: 28 },
    ]);
  });

  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareAdoptionFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 197,
      horizons: [8, 20],
      mixes: ['balanced', 'routineHeavy'],
      value: 8,
      follow: 1,
      cells: 6,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    const nets = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((item) => [
        item.parameter,
        item.boards.map((board) => [
          board.mix,
          board.horizon,
          board.evaluate.result.netValue,
          board.skips.map((skip) => [skip.opponent, skip.skip.result.netValue, skip.preference]),
        ]),
      ]);
    expect(nets('evalTicks')).toEqual([
      [
        '0',
        [
          [
            'balanced',
            8,
            5,
            [
              ['swift', 5, 'tie'],
              ['careful', 2, 'evaluate'],
            ],
          ],
          [
            'balanced',
            20,
            33,
            [
              ['swift', 17, 'evaluate'],
              ['careful', 33, 'tie'],
            ],
          ],
          [
            'routineHeavy',
            8,
            36,
            [
              ['swift', 36, 'tie'],
              ['careful', -8, 'evaluate'],
            ],
          ],
          [
            'routineHeavy',
            20,
            48,
            [
              ['swift', 48, 'tie'],
              ['careful', 40, 'evaluate'],
            ],
          ],
        ],
      ],
      [
        '1',
        [
          [
            'balanced',
            8,
            -20,
            [
              ['swift', 5, 'skip'],
              ['careful', 2, 'skip'],
            ],
          ],
          [
            'balanced',
            20,
            27,
            [
              ['swift', 17, 'evaluate'],
              ['careful', 33, 'skip'],
            ],
          ],
          [
            'routineHeavy',
            8,
            -8,
            [
              ['swift', 36, 'skip'],
              ['careful', -8, 'tie'],
            ],
          ],
          [
            'routineHeavy',
            20,
            42,
            [
              ['swift', 48, 'skip'],
              ['careful', 40, 'evaluate'],
            ],
          ],
        ],
      ],
      [
        '2',
        [
          [
            'balanced',
            8,
            -36,
            [
              ['swift', 5, 'skip'],
              ['careful', 2, 'skip'],
            ],
          ],
          [
            'balanced',
            20,
            5,
            [
              ['swift', 17, 'skip'],
              ['careful', 33, 'skip'],
            ],
          ],
          [
            'routineHeavy',
            8,
            -48,
            [
              ['swift', 36, 'skip'],
              ['careful', -8, 'skip'],
            ],
          ],
          [
            'routineHeavy',
            20,
            36,
            [
              ['swift', 48, 'skip'],
              ['careful', 40, 'skip'],
            ],
          ],
        ],
      ],
      [
        '3',
        [
          [
            'balanced',
            8,
            -36,
            [
              ['swift', 5, 'skip'],
              ['careful', 2, 'skip'],
            ],
          ],
          [
            'balanced',
            20,
            -20,
            [
              ['swift', 17, 'skip'],
              ['careful', 33, 'skip'],
            ],
          ],
          [
            'routineHeavy',
            8,
            -48,
            [
              ['swift', 36, 'skip'],
              ['careful', -8, 'skip'],
            ],
          ],
          [
            'routineHeavy',
            20,
            -8,
            [
              ['swift', 48, 'skip'],
              ['careful', 40, 'skip'],
            ],
          ],
        ],
      ],
    ]);
    expect(nets('reworkScale')).toEqual([
      [
        '0',
        [
          [
            'balanced',
            8,
            4,
            [
              ['swift', 29, 'skip'],
              ['careful', 4, 'tie'],
            ],
          ],
          [
            'balanced',
            20,
            35,
            [
              ['swift', 41, 'skip'],
              ['careful', 35, 'tie'],
            ],
          ],
          [
            'routineHeavy',
            8,
            -8,
            [
              ['swift', 36, 'skip'],
              ['careful', -8, 'tie'],
            ],
          ],
          [
            'routineHeavy',
            20,
            42,
            [
              ['swift', 48, 'skip'],
              ['careful', 40, 'evaluate'],
            ],
          ],
        ],
      ],
      [
        '0.5',
        [
          [
            'balanced',
            8,
            -8,
            [
              ['swift', 17, 'skip'],
              ['careful', 3, 'skip'],
            ],
          ],
          [
            'balanced',
            20,
            28,
            [
              ['swift', 29, 'skip'],
              ['careful', 34, 'skip'],
            ],
          ],
          [
            'routineHeavy',
            8,
            -8,
            [
              ['swift', 36, 'skip'],
              ['careful', -8, 'tie'],
            ],
          ],
          [
            'routineHeavy',
            20,
            42,
            [
              ['swift', 48, 'skip'],
              ['careful', 40, 'evaluate'],
            ],
          ],
        ],
      ],
      [
        '1',
        [
          [
            'balanced',
            8,
            -20,
            [
              ['swift', 5, 'skip'],
              ['careful', 2, 'skip'],
            ],
          ],
          [
            'balanced',
            20,
            27,
            [
              ['swift', 17, 'evaluate'],
              ['careful', 33, 'skip'],
            ],
          ],
          [
            'routineHeavy',
            8,
            -8,
            [
              ['swift', 36, 'skip'],
              ['careful', -8, 'tie'],
            ],
          ],
          [
            'routineHeavy',
            20,
            42,
            [
              ['swift', 48, 'skip'],
              ['careful', 40, 'evaluate'],
            ],
          ],
        ],
      ],
      [
        '2',
        [
          [
            'balanced',
            8,
            -36,
            [
              ['swift', -19, 'skip'],
              ['careful', 0, 'skip'],
            ],
          ],
          [
            'balanced',
            20,
            25,
            [
              ['swift', -7, 'evaluate'],
              ['careful', 31, 'skip'],
            ],
          ],
          [
            'routineHeavy',
            8,
            -8,
            [
              ['swift', 36, 'skip'],
              ['careful', -8, 'tie'],
            ],
          ],
          [
            'routineHeavy',
            20,
            42,
            [
              ['swift', 48, 'skip'],
              ['careful', 40, 'evaluate'],
            ],
          ],
        ],
      ],
    ]);
    expect(nets('penalty')).toEqual([
      [
        '0',
        [
          [
            'balanced',
            8,
            0,
            [
              ['swift', 5, 'skip'],
              ['careful', 14, 'skip'],
            ],
          ],
          [
            'balanced',
            20,
            27,
            [
              ['swift', 17, 'evaluate'],
              ['careful', 33, 'skip'],
            ],
          ],
          [
            'routineHeavy',
            8,
            16,
            [
              ['swift', 36, 'skip'],
              ['careful', 16, 'tie'],
            ],
          ],
          [
            'routineHeavy',
            20,
            42,
            [
              ['swift', 48, 'skip'],
              ['careful', 40, 'evaluate'],
            ],
          ],
        ],
      ],
      [
        '6',
        [
          [
            'balanced',
            8,
            -14,
            [
              ['swift', 5, 'skip'],
              ['careful', 8, 'skip'],
            ],
          ],
          [
            'balanced',
            20,
            27,
            [
              ['swift', 17, 'evaluate'],
              ['careful', 33, 'skip'],
            ],
          ],
          [
            'routineHeavy',
            8,
            4,
            [
              ['swift', 36, 'skip'],
              ['careful', 4, 'tie'],
            ],
          ],
          [
            'routineHeavy',
            20,
            42,
            [
              ['swift', 48, 'skip'],
              ['careful', 40, 'evaluate'],
            ],
          ],
        ],
      ],
      [
        '12',
        [
          [
            'balanced',
            8,
            -20,
            [
              ['swift', 5, 'skip'],
              ['careful', 2, 'skip'],
            ],
          ],
          [
            'balanced',
            20,
            27,
            [
              ['swift', 17, 'evaluate'],
              ['careful', 33, 'skip'],
            ],
          ],
          [
            'routineHeavy',
            8,
            -8,
            [
              ['swift', 36, 'skip'],
              ['careful', -8, 'tie'],
            ],
          ],
          [
            'routineHeavy',
            20,
            42,
            [
              ['swift', 48, 'skip'],
              ['careful', 40, 'evaluate'],
            ],
          ],
        ],
      ],
      [
        '24',
        [
          [
            'balanced',
            8,
            -32,
            [
              ['swift', 5, 'skip'],
              ['careful', -10, 'skip'],
            ],
          ],
          [
            'balanced',
            20,
            27,
            [
              ['swift', 17, 'evaluate'],
              ['careful', 33, 'skip'],
            ],
          ],
          [
            'routineHeavy',
            8,
            -32,
            [
              ['swift', 36, 'skip'],
              ['careful', -32, 'tie'],
            ],
          ],
          [
            'routineHeavy',
            20,
            42,
            [
              ['swift', 48, 'skip'],
              ['careful', 40, 'evaluate'],
            ],
          ],
        ],
      ],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.mix,
        item.horizon,
        item.opponent,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['evalTicks', 'balanced', 8, 'swift', '0', 'tie', '1', 'skip'],
      ['evalTicks', 'balanced', 8, 'careful', '0', 'evaluate', '1', 'skip'],
      ['evalTicks', 'balanced', 20, 'careful', '0', 'tie', '1', 'skip'],
      ['evalTicks', 'routineHeavy', 8, 'swift', '0', 'tie', '1', 'skip'],
      ['evalTicks', 'routineHeavy', 8, 'careful', '0', 'evaluate', '1', 'tie'],
      ['evalTicks', 'routineHeavy', 20, 'swift', '0', 'tie', '1', 'skip'],
      ['evalTicks', 'balanced', 20, 'swift', '1', 'evaluate', '2', 'skip'],
      ['evalTicks', 'routineHeavy', 8, 'careful', '1', 'tie', '2', 'skip'],
      ['evalTicks', 'routineHeavy', 20, 'careful', '1', 'evaluate', '2', 'skip'],
      ['reworkScale', 'balanced', 8, 'careful', '0', 'tie', '0.5', 'skip'],
      ['reworkScale', 'balanced', 20, 'careful', '0', 'tie', '0.5', 'skip'],
      ['reworkScale', 'balanced', 20, 'swift', '0.5', 'skip', '1', 'evaluate'],
    ]);
    expect(data.reversals.some((item) => item.axis === 'penalty')).toBe(false);
    expect(
      data.reversals.some((item) => item.mix === 'routineHeavy' && item.axis === 'reworkScale'),
    ).toBe(false);
  });

  it('基準行は初回の見切りと種類別と一致し、動かした規則は一つである', () => {
    const data = compareAdoptionFactorReversals();
    const first = compareAdoptionStrategies(comparison.seed);
    expect(first.some((row) => row.strategy === 'pooled')).toBe(true);
    for (const point of [
      data.sweeps.evalTicks.find((item) => item.parameter === '1'),
      data.sweeps.reworkScale.find((item) => item.parameter === '1'),
      data.sweeps.penalty.find((item) => item.parameter === '12'),
    ]) {
      if (!point) throw new Error('baseline');
      expect(changedKeys(point.rules)).toEqual([]);
      for (const board of point.boards) {
        const evaluated = first.find(
          (row) =>
            row.mix === board.mix && row.horizon === board.horizon && row.strategy === 'perKind',
        );
        if (!evaluated) throw new Error('perKind');
        expect(board.evaluate.inputs).toEqual(evaluated.inputs);
        expect(board.evaluate.result).toEqual(evaluated.result);
        expect(board.skips.map((skip) => skip.opponent)).toEqual(['swift', 'careful']);
        for (const skip of board.skips) {
          const blind = first.find(
            (row) =>
              row.mix === board.mix &&
              row.horizon === board.horizon &&
              row.strategy === skip.opponent,
          );
          if (!blind) throw new Error(skip.opponent);
          expect(skip.skip.inputs).toEqual(blind.inputs);
          expect(skip.skip.result).toEqual(blind.result);
          expect(skip.margin).toBe(board.evaluate.result.netValue - blind.result.netValue);
        }
      }
    }
    const only: Record<string, keyof AdoptionRules> = {
      evalTicks: 'evalTicks',
      reworkScale: 'reworkScale',
      penalty: 'penalty',
    };
    for (const [axis, key] of Object.entries(only)) {
      for (const item of data.sweeps[axis as keyof typeof data.sweeps])
        expect(changedKeys(item.rules).every((name) => name === key)).toBe(true);
    }
    const routine = data.sweeps.reworkScale.map((item) =>
      item.boards.filter((board) => board.mix === 'routineHeavy'),
    );
    for (const boards of routine.slice(1)) expect(boards).toEqual(routine[0]);
    const short = data.sweeps.evalTicks.find((item) => item.parameter === '2');
    const longer = data.sweeps.evalTicks.find((item) => item.parameter === '3');
    expect(
      short?.boards.find((board) => board.mix === 'balanced' && board.horizon === 8)?.evaluate
        .result,
    ).toMatchObject({ adopted: null, observations: 4, completed: 0, netValue: -36 });
    expect(
      longer?.boards.find((board) => board.mix === 'balanced' && board.horizon === 8)?.evaluate
        .result,
    ).toMatchObject({ adopted: null, observations: 2, completed: 0, netValue: -36 });
    const heavyRisk = data.sweeps.reworkScale.find((item) => item.parameter === '2');
    expect(
      heavyRisk?.boards.find((board) => board.mix === 'balanced' && board.horizon === 8)?.evaluate
        .result,
    ).toMatchObject({ adopted: 'careful', completed: 0, netValue: -36 });
    const freePenalty = data.sweeps.penalty.find((item) => item.parameter === '0');
    const mildPenalty = data.sweeps.penalty.find((item) => item.parameter === '6');
    const basePenalty = data.sweeps.penalty.find((item) => item.parameter === '12');
    const balancedShort = (point: typeof freePenalty) =>
      point?.boards.find((board) => board.mix === 'balanced' && board.horizon === 8);
    expect(balancedShort(freePenalty)?.evaluate.result).toMatchObject({
      adopted: 'careful',
      completed: 0,
      netValue: 0,
    });
    expect(balancedShort(freePenalty)?.skips.map((skip) => skip.preference)).toEqual([
      'skip',
      'skip',
    ]);
    expect(balancedShort(mildPenalty)?.skips.map((skip) => skip.skip.result.netValue)).toEqual([
      5, 8,
    ]);
    expect(balancedShort(basePenalty)?.skips.map((skip) => skip.skip.result.netValue)).toEqual([
      5, 2,
    ]);
  });

  it('要因比較の入力を再生すると差引が一致し、期末では同じ状態を返す', () => {
    const data = compareAdoptionFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      for (const board of item.boards) {
        const runs = [
          { strategy: 'perKind' as const, run: board.evaluate },
          ...board.skips.map((skip) => ({ strategy: skip.opponent, run: skip.skip })),
        ];
        for (const { strategy, run } of runs) {
          let state = create(data.conditions.seed, board.horizon, board.mix);
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseAdoptionAction(state, strategy, item.rules)).toEqual(input);
            state = apply(state, input, item.rules);
            const restored = apply(JSON.parse(JSON.stringify(before)), input, item.rules);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
            expect(
              state.shippedValue -
                state.rework +
                state.followUp -
                state.queue.length * item.rules.penalty,
            ).toBe(summarizeAdoption(state, item.rules).netValue);
          }
          expect(summarizeAdoption(state, item.rules)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(apply(state, { type: 'tick' }, item.rules)).toBe(state);
        }
      }
    }
  });
});
