import { describe, expect, it } from 'vitest';
import { rosterHeadcount } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';
import {
  applyStabilityContract as apply,
  boardContractRules,
  chooseContractAction,
  compareStabilityContracts,
  compareStabilityContractSensitivity,
  createStabilityContract as create,
  evaluateStabilityContractRules,
  summarizeStabilityContract,
  viewStabilityContract,
} from './stabilityContract';
import comparison from '../../docs/prototypes/stability-contract-comparison.json';
import sensitivity from '../../docs/prototypes/stability-contract-sensitivity.json';

describe('RI-236 安定運用の契約', () => {
  it('契約前に確保枠、報酬、違反の影響を示し、閲覧では期間が動かない', () => {
    const first = create('RI-236', 'strict');
    expect(create('RI-236', 'strict')).toEqual(first);
    expect(first.capacity).toBe(PRODUCT_CAPACITY);
    expect(first.respondents).toBe(rosterHeadcount('keeper'));
    const before = structuredClone(first);
    const blank = viewStabilityContract(first);
    for (let i = 0; i < 8; i++) expect(viewStabilityContract(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(blank).toEqual({
      tick: 0,
      horizon: 3,
      capacity: 4,
      respondents: 4,
      segment: 'keeper',
      reserve: 2,
      reward: 4,
      penalty: 10,
      featureValue: 12,
      budget: 0,
      features: [
        { id: 'api', remaining: 4, complete: false },
        { id: 'screen', remaining: 4, complete: false },
        { id: 'billing', remaining: 4, complete: false },
      ],
    });
    expect(viewStabilityContract(create('RI-236', 'calm')).penalty).toBe(1);
  });

  it('期間の達成は一度だけ報酬になり、余力を全部守っても報酬は増えない', () => {
    const open = create('RI-236', 'calm');
    expect(apply(open, { type: 'assign', feature: 'api', maintain: 5 })).toBe(open);
    expect(apply(open, { type: 'assign', feature: 'api', maintain: 1.5 })).toBe(open);
    const guarded = apply(open, { type: 'assign', feature: 'api', maintain: 4 });
    expect(guarded.budget).toBe(4);
    expect(guarded.rewards).toBe(1);
    expect(guarded.breaches).toBe(0);
    expect(guarded.features[0].done).toBe(0);
    const missed = apply(open, { type: 'assign', feature: 'api', maintain: 1 });
    expect(missed.budget).toBe(-1);
    expect(missed.rewards).toBe(0);
    expect(missed.breaches).toBe(1);
    expect(missed.features[0].complete).toBe(false);
    expect(missed.features[0].done).toBe(3);
    const done = apply(apply(missed, { type: 'assign', feature: 'screen', maintain: 0 }), {
      type: 'assign',
      feature: 'billing',
      maintain: 0,
    });
    expect(done.rewards).toBe(0);
    expect(apply(done, { type: 'assign', feature: 'api', maintain: 2 })).toBe(done);
  });

  it('違反が軽いときは新機能、重いときは安定枠の確保が予算で上回る', () => {
    const rows = compareStabilityContracts(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('calm', 'steady').result).toMatchObject({
      budget: 24,
      rewards: 3,
      breaches: 0,
      path: [4, 20, 24],
      completed: ['api'],
      score: 24,
    });
    expect(row('calm', 'rush').result).toMatchObject({
      budget: 33,
      rewards: 0,
      breaches: 3,
      path: [11, 22, 33],
      completed: ['api', 'screen', 'billing'],
      score: 33,
    });
    expect(row('strict', 'steady').result.score).toBe(24);
    expect(row('strict', 'rush').result).toMatchObject({
      budget: 6,
      path: [2, 4, 6],
      breaches: 3,
      score: 6,
    });
    expect(row('calm', 'rush').result.score).toBeGreaterThan(row('calm', 'steady').result.score);
    expect(row('strict', 'steady').result.score).toBeGreaterThan(
      row('strict', 'rush').result.score,
    );
    for (const item of rows) expect(item.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareStabilityContracts(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseContractAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeStabilityContract(live)).toEqual(row.result);
    }
  });
});

describe('RI-236 契約係数の感度', () => {
  it('初回の係数とJSONを維持し、変更した係数を契約前に閲覧できる', () => {
    expect(boardContractRules('calm')).toEqual({ reserve: 2, reward: 4, penalty: 1 });
    expect(boardContractRules('strict')).toEqual({ reserve: 2, reward: 4, penalty: 10 });
    expect(compareStabilityContracts(comparison.seed)).toEqual(comparison.results);
    const rules = { reserve: 3, reward: 7, penalty: 5 };
    const initial = create('RI-236', 'calm', rules);
    rules.reserve = 1;
    expect(viewStabilityContract(initial)).toMatchObject({ reserve: 3, reward: 7, penalty: 5 });
    for (const patch of [
      { reserve: -1 },
      { reserve: 5 },
      { reserve: 0.5 },
      { reward: -1 },
      { reward: NaN },
      { penalty: Infinity },
      { penalty: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(() => create('RI-236', 'calm', { ...boardContractRules('calm'), ...patch })).toThrow(
        RangeError,
      );
    }
  });

  it('一係数ずつ比較し、反転と同点の位置をJSONへ固定する', () => {
    const data = compareStabilityContractSensitivity();
    expect(data).toEqual(sensitivity);
    expect(
      data.sweeps.map((sweep) => [sweep.id, sweep.axis, sweep.points.map((p) => p.value)]),
    ).toEqual([
      ['reserve-calm', 'reserve', [0, 1, 2, 3, 4]],
      ['reserve-boundary', 'reserve', [0, 1, 2, 3, 4]],
      ['reward', 'reward', [0, 4, 6, 7, 8]],
      ['penalty', 'penalty', [0, 1, 3, 4, 5, 10]],
    ]);
    for (const sweep of data.sweeps) {
      for (const point of sweep.points) {
        expect(point.rules).toEqual({ ...sweep.anchor, [sweep.axis]: point.value });
        expect(point.initial).toMatchObject(point.rules);
      }
    }
    expect(data.sweeps.map((sweep) => [sweep.id, sweep.transitions])).toEqual([
      [
        'reserve-calm',
        [
          {
            before: { value: 0, preference: 'tie', margin: 0 },
            after: { value: 1, preference: 'rush', margin: -9 },
          },
        ],
      ],
      [
        'reserve-boundary',
        [
          {
            before: { value: 0, preference: 'tie', margin: 0 },
            after: { value: 1, preference: 'steady', margin: 3 },
          },
          {
            before: { value: 2, preference: 'steady', margin: 3 },
            after: { value: 3, preference: 'rush', margin: -9 },
          },
        ],
      ],
      [
        'reward',
        [
          {
            before: { value: 6, preference: 'rush', margin: -3 },
            after: { value: 7, preference: 'tie', margin: 0 },
          },
          {
            before: { value: 7, preference: 'tie', margin: 0 },
            after: { value: 8, preference: 'steady', margin: 3 },
          },
        ],
      ],
      [
        'penalty',
        [
          {
            before: { value: 3, preference: 'rush', margin: -3 },
            after: { value: 4, preference: 'tie', margin: 0 },
          },
          {
            before: { value: 4, preference: 'tie', margin: 0 },
            after: { value: 5, preference: 'steady', margin: 3 },
          },
        ],
      ],
    ]);
  });

  it('成果の段差と報酬・損失の境界式を、各列の外側を含む整数範囲でも確認する', () => {
    const completedByReserve = [3, 1, 1, 0, 0];
    for (let reserve = 0; reserve <= 4; reserve++) {
      for (let reward = 0; reward <= 12; reward++) {
        for (let penalty = 0; penalty <= 12; penalty++) {
          const point = evaluateStabilityContractRules('RI-236', { reserve, reward, penalty });
          const [steady, rush] = point.runs;
          const expectedSteady = 12 * completedByReserve[reserve] + 3 * reward;
          const expectedRush = reserve === 0 ? 36 + 3 * reward : 36 - 3 * penalty;
          expect(steady.result.completed.length).toBe(completedByReserve[reserve]);
          expect(rush.result.completed).toEqual(['api', 'screen', 'billing']);
          expect(steady.result.budget).toBe(expectedSteady);
          expect(rush.result.budget).toBe(expectedRush);
          expect(point.margin).toBe(expectedSteady - expectedRush);
          expect(point.preference).toBe(
            expectedSteady > expectedRush
              ? 'steady'
              : expectedSteady < expectedRush
                ? 'rush'
                : 'tie',
          );
          for (const run of point.runs) {
            const a = run.accounting;
            expect(run.result.budget).toBe(a.completedValue + a.rewardIncome - a.breachLoss);
            expect(a.maintenanceWork + a.assignedFeatureWork).toBe(12);
            expect(a.acceptedFeatureWork + a.discardedFeatureWork).toBe(a.assignedFeatureWork);
            expect(a.acceptedFeatureWork).toBe(run.result.completed.length * 4 + a.unfinishedWork);
            expect(run.result.lost).toBe(false);
          }
        }
      }
    }
    const point = evaluateStabilityContractRules('RI-236', { reserve: 1, reward: 4, penalty: 5 });
    expect(point.runs[0].accounting).toEqual({
      completedValue: 12,
      rewardIncome: 12,
      breachLoss: 0,
      maintenanceWork: 3,
      assignedFeatureWork: 9,
      acceptedFeatureWork: 7,
      discardedFeatureWork: 2,
      unfinishedWork: 3,
    });
    expect(
      evaluateStabilityContractRules('RI-236', { reserve: 4, reward: 0, penalty: 24 }).runs.map(
        (run) => run.result.budget,
      ),
    ).toEqual([0, -36]);
  });

  it('全42入力列で閲覧・毎入力の保存再開・方針の再生が一致し、期間終了後は動かない', () => {
    const data = compareStabilityContractSensitivity();
    let count = 0;
    for (const sweep of data.sweeps) {
      for (const point of sweep.points) {
        for (const run of point.runs) {
          count++;
          let live = point.initial;
          let saved = JSON.parse(JSON.stringify(live));
          for (const input of run.inputs) {
            const previous = live;
            const before = structuredClone(live);
            expect(chooseContractAction(previous, run.strategy)).toEqual(input);
            expect(chooseContractAction(saved, run.strategy)).toEqual(input);
            expect(apply(live, { type: 'view' })).toBe(live);
            expect(viewStabilityContract(live)).toEqual(viewStabilityContract(saved));
            live = apply(live, input);
            saved = apply(JSON.parse(JSON.stringify(saved)), input);
            expect(previous).toEqual(before);
            expect(saved).toEqual(live);
          }
          expect(summarizeStabilityContract(live)).toEqual(run.result);
          expect(live.tick).toBe(3);
          expect(live.rewards + live.breaches).toBe(3);
          expect(apply(live, chooseContractAction(live, run.strategy))).toBe(live);
          expect(point.initial.tick).toBe(0);
        }
      }
    }
    expect(count).toBe(42);
  });
});
