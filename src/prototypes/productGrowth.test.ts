import { describe, expect, it } from 'vitest';
import {
  applyFeatureWork,
  applyProductGrowth as apply,
  applyProductSpend,
  boardProductRules,
  chooseProductSpend,
  compareProductGrowth,
  compareProductGrowthFactorReversals,
  createProductGrowth as create,
  evaluateProductGrowthFactor,
  summarizeProductGrowth,
  viewProductGrowth,
  type ProductBoard,
  type ProductFactorLane,
  type ProductGrowthRules,
} from './productGrowth';
import comparison from '../../docs/prototypes/product-growth-comparison.json';
import factors from '../../docs/prototypes/product-growth-factor-comparison.json';

describe('RI-228 製品が育つ機能', () => {
  it('未完了の残量と、運用を空けたときの事故を操作前に示す', () => {
    const first = create('RI-228', 'blocked');
    expect(create('RI-228', 'blocked')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewProductGrowth(first);
    for (let i = 0; i < 8; i++) expect(viewProductGrowth(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toEqual({
      tick: 0,
      horizon: 3,
      capacity: 4,
      incidentIfSkipOps: 6,
      features: [
        { id: 'api', remaining: 5, complete: false },
        { id: 'screen', remaining: 5, complete: false },
        { id: 'billing', remaining: 5, complete: false },
      ],
      ready: [],
    });
    expect(viewProductGrowth(create('RI-228', 'open')).incidentIfSkipOps).toBe(0);
  });

  it('閾値を跨いだ一度だけ完成し、端数と余力の横流しでは機能が増えない', () => {
    const fresh = create('RI-228', 'open');
    expect(applyFeatureWork(5, 5, 4)).toEqual({ done: 5, completed: false, accepted: 0 });
    expect(applyProductSpend(fresh, { api: 3, screen: 0, billing: 0, ops: 0 })).toBe(fresh);
    const partial = apply(fresh, {
      type: 'spend',
      spend: { api: 4, screen: 0, billing: 0, ops: 0 },
    });
    expect(partial.features[0]).toMatchObject({ done: 4, complete: false });
    expect(summarizeProductGrowth(partial).completed).toEqual([]);
    const done = apply(partial, {
      type: 'spend',
      spend: { api: 3, screen: 1, billing: 0, ops: 0 },
    });
    expect(done.features[0]).toMatchObject({ done: 5, complete: true });
    expect(done.features[1]).toMatchObject({ done: 1, complete: false });
    expect(done.completedValue).toBe(8);
    expect(done.shippedWork).toBe(6);
    const again = apply(done, { type: 'spend', spend: { api: 4, screen: 0, billing: 0, ops: 0 } });
    expect(again.completedValue).toBe(8);
    expect(again.shippedWork).toBe(6);
    const blocked = apply(create('RI-228', 'blocked'), {
      type: 'spend',
      spend: { api: 4, screen: 0, billing: 0, ops: 0 },
    });
    expect(blocked.incident).toBe(6);
    expect(apply(blocked, { type: 'view' })).toBe(blocked);
  });

  it('余力がある盤面は機能集中、障害対応が要る盤面は運用枠が上回る', () => {
    const rows = compareProductGrowth(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('open', 'focus'), score('open', 'spread'), score('open', 'ops')]).toEqual([
      16, 8, 8,
    ]);
    expect([
      score('blocked', 'ops'),
      score('blocked', 'focus'),
      score('blocked', 'spread'),
    ]).toEqual([8, -2, -10]);
    const focus = rows.find((row) => row.board === 'open' && row.strategy === 'focus')!;
    const spread = rows.find((row) => row.board === 'open' && row.strategy === 'spread')!;
    expect(focus.result.shippedWork).toBe(spread.result.shippedWork);
    expect(focus.result.completed).toEqual(['api', 'screen']);
    expect(spread.result.completed).toEqual(['api']);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareProductGrowth(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseProductSpend(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeProductGrowth(live)).toEqual(row.result);
    }
  });
});

const STRATEGIES = ['focus', 'spread', 'ops'] as const;

function changedKeys(board: ProductBoard, rules: ProductGrowthRules): (keyof ProductGrowthRules)[] {
  const base = boardProductRules(board);
  return (Object.keys(base) as (keyof ProductGrowthRules)[]).filter(
    (key) => rules[key] !== base[key],
  );
}

function rulesFor(
  patch: Partial<ProductGrowthRules>,
  board: ProductBoard = 'open',
): ProductGrowthRules {
  return { ...boardProductRules(board), ...patch };
}

function preferenceChanges(
  lane: ProductFactorLane,
  board: ProductBoard,
  values: number[],
  patch: (value: number) => Partial<ProductGrowthRules>,
) {
  const changes: string[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const earlierValue = values[index - 1];
    const laterValue = values[index];
    if (earlierValue === undefined || laterValue === undefined) throw new Error('range');
    const before = evaluateProductGrowthFactor(board, rulesFor(patch(earlierValue), board), lane);
    const after = evaluateProductGrowthFactor(board, rulesFor(patch(laterValue), board), lane);
    for (const early of before.pairs) {
      const late = after.pairs.find(
        (item) => item.left === early.left && item.right === early.right,
      );
      if (!late || early.preference === late.preference) continue;
      changes.push(
        `${earlierValue}->${laterValue} ${early.left}-${early.right} ${early.preference}->${late.preference}`,
      );
    }
  }
  return changes;
}

function scoresOf(board: ProductBoard, rules: ProductGrowthRules, lane: ProductFactorLane) {
  const scenario = evaluateProductGrowthFactor(board, rules, lane);
  return STRATEGIES.map((strategy) => {
    const run = scenario.runs.find((item) => item.strategy === strategy);
    if (!run) throw new Error(strategy);
    return { completed: run.result.completed, score: run.result.score };
  });
}

describe('RI-228 要因の反転', () => {
  it('規則を渡さない作成は盤面の必要量5、完成価値8、事故のまま', () => {
    expect(create('RI-228', 'open')).toEqual(create('RI-228', 'open', boardProductRules('open')));
    expect(create('RI-228', 'blocked')).toEqual(
      create('RI-228', 'blocked', boardProductRules('blocked')),
    );
    const open = boardProductRules('open');
    create('RI-228', 'open', { ...open, need: 1 });
    expect(boardProductRules('open')).toEqual(open);
  });

  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareProductGrowthFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-228',
      horizon: 3,
      capacity: 4,
      features: ['api', 'screen', 'billing'],
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    expect(data.conditions.decision).toEqual({
      pairs: ['focus-spread', 'focus-ops', 'spread-ops'],
      preference: '差引が大きい構成。同じときは同点',
    });
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.lane,
        item.left,
        item.right,
        item.before.parameter,
        item.before.preference,
        item.before.leftScore,
        item.before.rightScore,
        item.after.parameter,
        item.after.preference,
        item.after.leftScore,
        item.after.rightScore,
      ]),
    ).toEqual([
      ['need', 'open', 'focus', 'spread', '2', 'tie', 24, 24, '3', 'spread', 16, 24],
      ['need', 'open', 'focus', 'ops', '2', 'focus', 24, 16, '3', 'tie', 16, 16],
      ['need', 'blocked', 'focus', 'spread', '2', 'tie', 6, 6, '3', 'spread', -2, 6],
      ['need', 'open', 'focus', 'spread', '3', 'spread', 16, 24, '4', 'tie', 16, 16],
      ['need', 'open', 'spread', 'ops', '3', 'spread', 24, 16, '4', 'tie', 16, 16],
      ['need', 'blocked', 'focus', 'spread', '3', 'spread', -2, 6, '4', 'tie', -2, -2],
      ['need', 'open', 'focus', 'spread', '4', 'tie', 16, 16, '5', 'focus', 16, 8],
      ['need', 'open', 'focus', 'ops', '4', 'tie', 16, 16, '5', 'focus', 16, 8],
      ['need', 'blocked', 'focus', 'spread', '4', 'tie', -2, -2, '5', 'focus', -2, -10],
      ['need', 'open', 'focus', 'spread', '5', 'focus', 16, 8, '6', 'tie', 0, 0],
      ['need', 'open', 'focus', 'ops', '5', 'focus', 16, 8, '6', 'tie', 0, 0],
      ['need', 'blocked', 'focus', 'spread', '5', 'focus', -2, -10, '6', 'tie', -18, -18],
      ['completeValue', 'open', 'focus', 'spread', '0', 'tie', 0, 0, '1', 'focus', 2, 1],
      ['completeValue', 'open', 'focus', 'ops', '0', 'tie', 0, 0, '1', 'focus', 2, 1],
      ['completeValue', 'blocked', 'focus', 'spread', '0', 'tie', -18, -18, '1', 'focus', -16, -17],
      ['completeValue', 'blocked', 'focus', 'ops', '17', 'ops', 16, 17, '18', 'tie', 18, 18],
      ['completeValue', 'blocked', 'focus', 'ops', '18', 'tie', 18, 18, '19', 'focus', 20, 19],
      ['incident', 'incident', 'spread', 'ops', '0', 'tie', 8, 8, '1', 'ops', 5, 8],
      ['incident', 'incident', 'focus', 'ops', '2', 'focus', 10, 8, '3', 'ops', 7, 8],
    ]);
  });

  it('基準行は初回の集中・分散・運用枠と一致し、動かした規則は一つである', () => {
    const data = compareProductGrowthFactorReversals();
    const first = comparison.results;
    const baselines = [
      ...data.sweeps.need.filter((item) => item.parameter === '5'),
      ...data.sweeps.completeValue.filter((item) => item.parameter === '8'),
      ...data.sweeps.incident.filter((item) => item.parameter === '0' || item.parameter === '6'),
    ];
    expect(baselines).toHaveLength(4);
    for (const point of baselines) {
      for (const scenario of point.scenarios) {
        expect(changedKeys(scenario.board, scenario.rules)).toEqual([]);
        for (const strategy of STRATEGIES) {
          const prior = first.find(
            (row) => row.board === scenario.board && row.strategy === strategy,
          );
          const run = scenario.runs.find((item) => item.strategy === strategy);
          if (!prior || !run) throw new Error(`${scenario.board}:${strategy}`);
          expect(run.inputs).toEqual(prior.inputs);
          expect(run.result).toEqual(prior.result);
        }
      }
    }
    const only: Record<keyof typeof data.sweeps, keyof ProductGrowthRules> = {
      need: 'need',
      completeValue: 'completeValue',
      incident: 'incidentIfIdle',
    };
    for (const [axis, key] of Object.entries(only) as [
      keyof typeof data.sweeps,
      keyof ProductGrowthRules,
    ][]) {
      for (const item of data.sweeps[axis]) {
        for (const scenario of item.scenarios) {
          expect(changedKeys(scenario.board, scenario.rules).every((name) => name === key)).toBe(
            true,
          );
        }
      }
    }
    const encoded = new Set<string>();
    for (const rows of Object.values(data.sweeps)) {
      for (const point of rows) {
        for (const scenario of point.scenarios) {
          for (const run of scenario.runs) {
            encoded.add(`${run.strategy}:${JSON.stringify(run.inputs)}`);
          }
        }
      }
    }
    expect([...encoded].sort()).toEqual(
      STRATEGIES.map((strategy) => {
        const prior = first.find((row) => row.board === 'open' && row.strategy === strategy);
        if (!prior) throw new Error(strategy);
        return `${strategy}:${JSON.stringify(prior.inputs)}`;
      }).sort(),
    );
  });

  it('必要量は完成の構成を変え、完成価値と事故は初回の構成のまま差引だけが動く', () => {
    const openNeed = [1, 2, 3, 4, 5, 6, 7, 8].map((need) =>
      scoresOf('open', rulesFor({ need }), 'open').map((item) => item.score),
    );
    expect(openNeed).toEqual([
      [24, 24, 16],
      [24, 24, 16],
      [16, 24, 16],
      [16, 16, 16],
      [16, 8, 8],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    const blockedNeed = [1, 2, 3, 4, 5, 6].map((need) =>
      scoresOf('blocked', rulesFor({ need }, 'blocked'), 'blocked').map((item) => item.score),
    );
    expect(blockedNeed).toEqual([
      [6, 6, 16],
      [6, 6, 16],
      [-2, 6, 16],
      [-2, -2, 16],
      [-2, -10, 8],
      [-18, -18, 0],
    ]);
    expect(scoresOf('open', rulesFor({ need: 3 }), 'open').map((item) => item.completed)).toEqual([
      ['api', 'screen'],
      ['api', 'screen', 'billing'],
      ['api', 'screen'],
    ]);
    expect(scoresOf('open', rulesFor({ need: 5 }), 'open').map((item) => item.completed)).toEqual([
      ['api', 'screen'],
      ['api'],
      ['api'],
    ]);
    expect(scoresOf('open', rulesFor({ need: 100 }), 'open').map((item) => item.completed)).toEqual(
      [[], [], []],
    );
    const range = (length: number) => Array.from({ length }, (_, index) => index);
    for (const value of range(25)) {
      expect(
        scoresOf('open', rulesFor({ completeValue: value }), 'open').map((item) => item.score),
      ).toEqual([2 * value, value, value]);
      expect(
        scoresOf(
          'blocked',
          rulesFor({ completeValue: value, incidentIfIdle: 6 }, 'blocked'),
          'blocked',
        ).map((item) => item.score),
      ).toEqual([2 * value - 18, value - 18, value]);
      expect(
        scoresOf(
          'blocked',
          rulesFor({ completeValue: value, incidentIfIdle: 6 }, 'blocked'),
          'blocked',
        ).map((item) => item.completed),
      ).toEqual([['api', 'screen'], ['api'], ['api']]);
    }
    for (const incident of range(13)) {
      const board: ProductBoard = incident === 0 ? 'open' : 'blocked';
      expect(
        scoresOf(board, rulesFor({ incidentIfIdle: incident }, board), 'incident').map(
          (item) => item.score,
        ),
      ).toEqual([16 - 3 * incident, 8 - 3 * incident, 8]);
      expect(
        scoresOf(board, rulesFor({ incidentIfIdle: incident }, board), 'incident').map(
          (item) => item.completed,
        ),
      ).toEqual([['api', 'screen'], ['api'], ['api']]);
    }
    expect(preferenceChanges('open', 'open', range(9).slice(1), (need) => ({ need }))).toEqual([
      '2->3 focus-spread tie->spread',
      '2->3 focus-ops focus->tie',
      '3->4 focus-spread spread->tie',
      '3->4 spread-ops spread->tie',
      '4->5 focus-spread tie->focus',
      '4->5 focus-ops tie->focus',
      '5->6 focus-spread focus->tie',
      '5->6 focus-ops focus->tie',
    ]);
    expect(
      preferenceChanges('blocked', 'blocked', range(9).slice(1), (need) => ({ need })),
    ).toEqual([
      '2->3 focus-spread tie->spread',
      '3->4 focus-spread spread->tie',
      '4->5 focus-spread tie->focus',
      '5->6 focus-spread focus->tie',
    ]);
    expect(
      preferenceChanges('open', 'open', range(25), (completeValue) => ({ completeValue })),
    ).toEqual(['0->1 focus-spread tie->focus', '0->1 focus-ops tie->focus']);
    expect(
      preferenceChanges('blocked', 'blocked', range(25), (completeValue) => ({ completeValue })),
    ).toEqual([
      '0->1 focus-spread tie->focus',
      '17->18 focus-ops ops->tie',
      '18->19 focus-ops tie->focus',
    ]);
    expect(
      preferenceChanges('incident', 'blocked', range(13), (incidentIfIdle) => ({ incidentIfIdle })),
    ).toEqual(['0->1 spread-ops tie->ops', '2->3 focus-ops focus->ops']);
  });

  it('要因比較の全入力を再生し、毎入力のJSON保存再開が一致する', () => {
    const data = compareProductGrowthFactorReversals();
    for (const rows of Object.values(data.sweeps)) {
      for (const point of rows) {
        for (const scenario of point.scenarios) {
          for (const run of scenario.runs) {
            let live = create(data.conditions.seed, scenario.board, scenario.rules);
            let saved = structuredClone(live);
            for (const input of run.inputs) {
              const previous = live;
              const before = structuredClone(live);
              expect(chooseProductSpend(previous, run.strategy)).toEqual(input);
              live = apply(live, input);
              saved = apply(JSON.parse(JSON.stringify(saved)), input);
              expect(previous).toEqual(before);
              expect(saved).toEqual(live);
            }
            expect(summarizeProductGrowth(live)).toEqual(run.result);
            expect(live.tick).toBe(live.horizon);
            expect(summarizeProductGrowth(live).lost).toBe(false);
          }
        }
      }
    }
  });
});
