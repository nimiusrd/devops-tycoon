import { describe, expect, it } from 'vitest';
import {
  createPreventionPrototype,
  tickPreventionPrototype,
  describePrevention,
  comparePreventionStrategies,
  summarizePrevention,
  baselinePreventionFactors,
  comparePreventionFactorSweep,
  createPreventionFactorState,
  type PreventionFactorAxis,
} from './failurePrevention';
import comparison from '../../docs/prototypes/failure-prevention-comparison.json';
import factors from '../../docs/prototypes/failure-prevention-factor-comparison.json';

function firstIncident() {
  let state = createPreventionPrototype(1, 'spec-omission');
  for (let i = 0; i < 4; i++) state = tickPreventionPrototype(state, 'work');
  return state;
}
describe('RI-164 原因別再発防止', () => {
  it('実際の失敗前には対策できず、原因を仕事データから記録する', () => {
    const initial = createPreventionPrototype(1, 'migration-failure');
    expect(tickPreventionPrototype(initial, 'checklist')).toBe(initial);
    const progress = tickPreventionPrototype(initial, 'work');
    expect(progress.incidents).toEqual([]);
    const failed = tickPreventionPrototype(progress, 'work');
    expect(failed.incidents).toEqual([
      { jobId: 'job-0', cause: 'spec-omission', loss: 4, induced: false },
    ]);
    expect(tickPreventionPrototype(failed, 'checklist')).toBe(failed);
    expect(initial.incidents).toEqual([]);
  });
  it('同種だけ損失・修復が減り、異種と残存損失を隠さない', () => {
    expect(describePrevention('spec-omission', 1)).toEqual({ loss: 1, repairTicks: 1 });
    expect(describePrevention('migration-failure', 1)).toEqual(
      describePrevention('migration-failure', 0),
    );
    const initial = firstIncident();
    const protectedState = tickPreventionPrototype(initial, 'checklist');
    expect(protectedState.tick - initial.tick).toBe(2);
    expect(protectedState.investment).toBe(2);
    let state = tickPreventionPrototype(tickPreventionPrototype(protectedState, 'work'), 'work');
    expect(state.incidents[state.incidents.length - 1]).toMatchObject({
      jobId: 'job-1',
      cause: 'spec-omission',
      loss: 1,
    });
    expect(state.jobs[1]).toMatchObject({ stage: 'repair', remaining: 1 });
    state = tickPreventionPrototype(state, 'work');
    expect(state.jobs[1].stage).toBe('done');
  });
  it('上限1で再投資を拒否し、事故を増やしても対策効果を稼げない', () => {
    const initial = firstIncident();
    const protectedState = tickPreventionPrototype(initial, 'checklist');
    expect(tickPreventionPrototype(protectedState, 'checklist')).toBe(protectedState);
    const induced = tickPreventionPrototype(protectedState, 'induce-failure');
    expect(induced.prevention).toBe(1);
    expect(induced.loss - protectedState.loss).toBe(4);
    expect(induced.tick - protectedState.tick).toBe(2);
    expect(summarizePrevention(induced).value).toBe(summarizePrevention(protectedState).value);
  });
  it('仕事構成で投資の優劣が変わり、事故稼ぎは両構成で劣る', () => {
    expect(comparePreventionStrategies(comparison.seed)).toEqual(comparison.results);
    const [sameShip, samePrevent, sameFarm, otherShip, otherPrevent, otherFarm] =
      comparison.results;
    expect(samePrevent.result.netValue).toBeGreaterThan(sameShip.result.netValue);
    expect(otherShip.result.netValue).toBeGreaterThan(otherPrevent.result.netValue);
    expect(sameFarm.result.netValue).toBeLessThan(samePrevent.result.netValue);
    expect(otherFarm.result.netValue).toBeLessThan(otherShip.result.netValue);
  });
  it('初回の事故を故意に作って資格を先取りしても自然な学習を上回らない', () => {
    let state = createPreventionPrototype(1, 'spec-omission');
    state = tickPreventionPrototype(state, 'induce-failure');
    state = tickPreventionPrototype(state, 'checklist');
    while (state.tick < state.horizon) state = tickPreventionPrototype(state, 'work');
    const natural = comparePreventionStrategies(1).find(
      (row) => row.nextCause === 'spec-omission' && row.strategy === 'prevent',
    )!;
    expect(summarizePrevention(state).netValue).toBeLessThan(natural.result.netValue);
  });
  it('資源不足・進行中・期末の操作を無消費で拒否する', () => {
    const initial = firstIncident();
    const short = { ...initial, horizon: initial.tick + 1 };
    expect(tickPreventionPrototype(short, 'checklist')).toBe(short);
    expect(tickPreventionPrototype(short, 'induce-failure')).toBe(short);
    const progress = tickPreventionPrototype(initial, 'work');
    expect(tickPreventionPrototype(progress, 'induce-failure')).toBe(progress);
    const ended = { ...initial, tick: initial.horizon };
    expect(tickPreventionPrototype(ended, 'work')).toBe(ended);
  });
  it('原因確定前後・対策後の保存再開と入力再生が一致する', () => {
    for (const row of comparePreventionStrategies(comparison.seed)) {
      let live = row.initial;
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        live = tickPreventionPrototype(live, input);
        restored = tickPreventionPrototype(JSON.parse(JSON.stringify(restored)), input);
        expect(restored).toEqual(live);
      }
      expect(summarizePrevention(live)).toEqual(row.result);
    }
  });
});

describe('RI-164 要因を一つずつ動かす', () => {
  const sweep = comparePreventionFactorSweep(factors.conditions.seed);
  const first = comparePreventionStrategies(factors.conditions.seed);
  const same = (cause: 'spec-omission' | 'migration-failure', strategy: 'ship' | 'prevent') =>
    first.find((row) => row.nextCause === cause && row.strategy === strategy)!;
  const rows = (axis: PreventionFactorAxis) => sweep.points.filter((point) => point.axis === axis);
  const scores = (axis: PreventionFactorAxis) =>
    rows(axis).map((point) => [
      point.level,
      point.results.place.score,
      point.results.ship.score,
      point.leaders,
    ]);

  it('比較条件と入力列と結果を再計算し、初回の事故稼ぎは再走しない', () => {
    expect(sweep).toEqual(factors);
    expect(sweep.conditions).toMatchObject({
      horizon: 12,
      jobs: 3,
      workTicks: 2,
      jobValue: 8,
      failureLoss: 4,
      failureRepair: 2,
      checklistTicks: 2,
      checklistInvestment: 2,
      protectedRepair: 1,
      repeatedFirstComparison: false,
      excludedStrategies: ['farm'],
      strategies: ['ship', 'place'],
      opportunityHeldFailurePattern: '0',
      fixedStrategies: true,
      humanPlaytest: false,
      productionIntegration: false,
      forecastDoesNotAdapt: true,
    });
    expect(scores('forecastHits')).toEqual([
      [2, 16, 12, ['place']],
      [1, 5, 12, ['ship']],
      [0, 2, 12, ['ship']],
    ]);
    expect(scores('failurePattern')).toEqual([
      ['2', 16, 12, ['place']],
      ['1-leading', 17, 16, ['place']],
      ['1-trailing', 17, 16, ['place']],
      ['0', 18, 20, ['ship']],
    ]);
    expect(scores('residualLoss')).toEqual([
      [0, 18, 12, ['place']],
      [1, 16, 12, ['place']],
      [2, 14, 12, ['place']],
      [3, 12, 12, ['place', 'ship']],
      [4, 10, 12, ['ship']],
    ]);
    expect(scores('maintenancePerTick')).toEqual([
      [0, 16, 12, ['place']],
      [1, 10, 12, ['ship']],
      [2, 4, 12, ['ship']],
      [3, -2, 12, ['ship']],
    ]);
    expect(scores('earlyAccidents')).toEqual([
      [0, 16, 12, ['place']],
      [1, 7, 12, ['ship']],
      [2, 4, 12, ['ship']],
    ]);
    expect(scores('multiPattern')).toEqual([
      ['0', 16, 12, ['place']],
      ['1-leading', 4, 8, ['ship']],
      ['1-trailing', 4, 8, ['ship']],
      ['2', 0, 4, ['ship']],
    ]);
    expect(scores('opportunityPerTick')).toEqual([
      [0, 18, 20, ['ship']],
      [1, 20, 24, ['ship']],
      [2, 22, 28, ['ship']],
      [3, 24, 32, ['ship']],
      [4, 26, 36, ['ship']],
    ]);
    expect(sweep.boundaries.map((row) => [row.axis, row.edges, row.fractionalTie])).toEqual([
      [
        'forecastHits',
        [{ before: 2, after: 1, beforeLeaders: ['place'], afterLeaders: ['ship'] }],
        { kind: 'endpointWeight', high: 2, low: 0, num: 5, den: 7 },
      ],
      [
        'failurePattern',
        [{ before: '1-trailing', after: '0', beforeLeaders: ['place'], afterLeaders: ['ship'] }],
        null,
      ],
      [
        'residualLoss',
        [
          { before: 2, after: 3, beforeLeaders: ['place'], afterLeaders: ['place', 'ship'] },
          { before: 3, after: 4, beforeLeaders: ['place', 'ship'], afterLeaders: ['ship'] },
        ],
        null,
      ],
      [
        'maintenancePerTick',
        [{ before: 0, after: 1, beforeLeaders: ['place'], afterLeaders: ['ship'] }],
        { kind: 'perTick', num: 2, den: 3 },
      ],
      [
        'earlyAccidents',
        [{ before: 0, after: 1, beforeLeaders: ['place'], afterLeaders: ['ship'] }],
        null,
      ],
      [
        'multiPattern',
        [{ before: '0', after: '1-leading', beforeLeaders: ['place'], afterLeaders: ['ship'] }],
        null,
      ],
      ['opportunityPerTick', [], null],
    ]);
  });

  it('対照は初回の同種と一致し、軸のアンカーから動く要因は一つ', () => {
    const specShip = same('spec-omission', 'ship');
    const specPrevent = same('spec-omission', 'prevent');
    const migrationShip = same('migration-failure', 'ship');
    const migrationPrevent = same('migration-failure', 'prevent');
    const anchors = (Object.keys(baselinePreventionFactors) as PreventionFactorAxis[]).filter(
      (axis) => axis !== 'opportunityPerTick',
    );
    for (const axis of anchors) {
      const point = rows(axis).find(
        (candidate) => candidate.level === baselinePreventionFactors[axis],
      )!;
      expect(point.factors).toEqual(baselinePreventionFactors);
      expect(point.initial).toEqual(specShip.initial);
      expect(point.inputs.ship).toEqual(specShip.inputs);
      expect(point.inputs.place).toEqual(specPrevent.inputs);
      expect(point.results.ship.netValue).toBe(specShip.result.netValue);
      expect(point.results.place.netValue).toBe(specPrevent.result.netValue);
      expect(point.initial).not.toHaveProperty('residualLoss');
      expect(point.initial).not.toHaveProperty('maintenancePerTick');
    }
    const missed = rows('forecastHits').find((point) => point.level === 0)!;
    expect(missed.initial).toEqual(migrationShip.initial);
    expect(missed.inputs.ship).toEqual(migrationShip.inputs);
    expect(missed.inputs.place).toEqual(migrationPrevent.inputs);
    expect(missed.results.place.incidents).toEqual(migrationPrevent.result.incidents);
    const forecastInputs = rows('forecastHits').map((point) => point.inputs.place);
    expect(forecastInputs.every((inputs) => inputs.join() === forecastInputs[0]!.join())).toBe(
      true,
    );
    for (const point of sweep.points) {
      const changed = (Object.keys(baselinePreventionFactors) as PreventionFactorAxis[]).filter(
        (key) => point.factors[key] !== baselinePreventionFactors[key],
      );
      if (point.axis === 'opportunityPerTick') {
        expect(changed).toEqual(
          point.level === 0 ? ['failurePattern'] : ['failurePattern', 'opportunityPerTick'],
        );
      } else if (point.level === baselinePreventionFactors[point.axis]) expect(changed).toEqual([]);
      else expect(changed).toEqual([point.axis]);
      expect(createPreventionFactorState(sweep.conditions.seed, point.factors)).toEqual(
        point.initial,
      );
    }
  });

  it('維持費は導入後の作業tick、機会費用は余力の得点、失敗しない仕事は台帳に残さない', () => {
    const maintenance = rows('maintenancePerTick');
    const adoption = maintenance[0]!;
    expect(adoption.results.place.investment).toBe(2);
    for (const point of maintenance) {
      expect(point.inputs).toEqual(adoption.inputs);
      expect(point.results.place.investment).toBe(2 + 6 * Number(point.level));
      expect(point.results.ship.score).toBe(12);
    }
    const idle = rows('opportunityPerTick');
    const idleAnchor = idle[0]!;
    const noFailure = rows('failurePattern').find((point) => point.level === '0')!;
    expect(idleAnchor.results.place.netValue).toBe(noFailure.results.place.netValue);
    expect(idleAnchor.results.ship.netValue).toBe(noFailure.results.ship.netValue);
    expect(noFailure.results.place.incidents).toEqual([
      { jobId: 'job-0', cause: 'spec-omission', loss: 4, induced: false },
    ]);
    expect(noFailure.initial.jobs[1]).toMatchObject({ cause: 'spec-omission', fails: false });
    for (const point of idle) {
      expect(point.inputs).toEqual(idleAnchor.inputs);
      expect(point.results.place.spareTicks).toBe(2);
      expect(point.results.ship.spareTicks).toBe(4);
      expect(point.results.place.netValue).toBe(18);
      expect(point.results.ship.netValue).toBe(20);
      expect(point.results.place.score).toBe(18 + 2 * Number(point.level));
      expect(point.results.ship.score).toBe(20 + 4 * Number(point.level));
    }
    const cleared = rows('residualLoss').find((point) => point.level === 0)!;
    expect(cleared.results.place.incidents).toEqual([
      { jobId: 'job-0', cause: 'spec-omission', loss: 4, induced: false },
      { jobId: 'job-1', cause: 'spec-omission', loss: 0, induced: false },
      { jobId: 'job-2', cause: 'spec-omission', loss: 0, induced: false },
    ]);
  });

  it('早期の事故と複数原因は原因の記録を崩さず、毎入力の保存再開が一致する', () => {
    for (const point of rows('earlyAccidents')) {
      const induced = point.inputs.place.filter((input) => input === 'induce-failure');
      expect(induced).toHaveLength(Number(point.level));
      expect(point.inputs.place.filter((input) => input === 'checklist')).toEqual(['checklist']);
      expect(point.inputs.ship.every((input) => input === 'work')).toBe(true);
      expect(point.results.place.prevention).toBe(1);
      expect(point.results.place.incidents.filter((incident) => incident.induced)).toHaveLength(
        Number(point.level),
      );
    }
    const multi = rows('multiPattern').find((point) => point.level === '1-leading')!;
    expect(
      multi.results.place.incidents
        .filter((incident) => incident.jobId === 'job-1')
        .map((incident) => [incident.cause, incident.loss]),
    ).toEqual([
      ['spec-omission', 1],
      ['migration-failure', 4],
    ]);
    expect(
      multi.results.ship.incidents
        .filter((incident) => incident.jobId === 'job-1')
        .map((incident) => incident.loss),
    ).toEqual([4, 4]);
    expect((5 * 16 + 2 * 2) / 7).toBe(12);
    for (const point of sweep.points) {
      for (const choice of ['ship', 'place'] as const) {
        let live = point.initial;
        let restored = structuredClone(live);
        for (const input of point.inputs[choice]) {
          live = tickPreventionPrototype(live, input);
          restored = tickPreventionPrototype(JSON.parse(JSON.stringify(restored)), input);
          expect(restored).toEqual(live);
        }
        const summary = summarizePrevention(live);
        const result = point.results[choice];
        expect(summary).toEqual({
          value: result.value,
          loss: result.loss,
          investment: result.investment,
          netValue: result.netValue,
          prevention: result.prevention,
          incidents: result.incidents,
          pending: result.pending,
        });
        expect(result.spareTicks).toBe(point.initial.horizon - live.tick);
        expect(result.spareValue).toBe(result.spareTicks * point.factors.opportunityPerTick);
        expect(result.score).toBe(result.netValue + result.spareValue);
      }
      expect(point.initial.tick).toBe(0);
      expect(point.initial.inputs).toEqual([]);
    }
  });
});
