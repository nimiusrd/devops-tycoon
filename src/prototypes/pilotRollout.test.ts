import { describe, expect, it } from 'vitest';
import {
  applyPilotRollout as apply,
  applyPilotScope,
  choosePilotAction,
  comparePilotFactorReversals,
  comparePilotRollouts,
  createPilotRollout as create,
  summarizePilotRollout,
  viewPilotRollout,
  type PilotBoard,
  type PilotFactorAxis,
  type PilotStrategy,
} from './pilotRollout';
import comparison from '../../docs/prototypes/pilot-rollout-comparison.json';
import factors from '../../docs/prototypes/pilot-rollout-factor-comparison.json';

describe('RI-226 パイロット導入', () => {
  it('試験対象と未導入、展開費用、試験を飛ばした事故を操作前に示す', () => {
    const first = create('RI-226', 'spike');
    expect(create('RI-226', 'spike')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewPilotRollout(first);
    for (let i = 0; i < 8; i++) expect(viewPilotRollout(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      tick: 0,
      adopted: [],
      waiting: ['pilot', 'north', 'south'],
      incidentIfSkipTrial: 20,
      feeIfExpand: 0,
    });
  });

  it('試験中は他チームへ漏れず、展開後も効果は二重にならない', () => {
    const fresh = create('RI-226', 'good');
    expect(applyPilotScope(fresh, 'company')).toBe(fresh);
    const trial = apply(fresh, { type: 'scope', scope: 'pilot' });
    expect(trial.periodShip).toEqual({ pilot: 9, north: 5, south: 5 });
    expect(trial.observations).toEqual([
      { tick: 0, pilotShip: 9, otherShip: 10, delta: 4, kind: 'observed' },
    ]);
    expect(viewPilotRollout(trial)).toMatchObject({
      adopted: ['pilot'],
      waiting: ['north', 'south'],
      incidentIfSkipTrial: 0,
      feeIfExpand: 2,
    });
    const rolled = apply(trial, { type: 'scope', scope: 'all' });
    expect(rolled.periodShip).toEqual({ pilot: 9, north: 9, south: 9 });
    expect(rolled.feePaid).toBe(2);
    expect(rolled.incident).toBe(0);
    const again = apply(rolled, { type: 'scope', scope: 'all' });
    expect(again.feePaid).toBe(2);
    expect(again.periodShip.pilot).toBe(9);
    const skipped = apply(fresh, { type: 'scope', scope: 'all' });
    expect(skipped.incident).toBe(0);
    const spiked = apply(create('RI-226', 'spike'), { type: 'scope', scope: 'all' });
    expect(spiked.incident).toBe(20);
    expect(apply(spiked, { type: 'scope', scope: 'all' }).incident).toBe(20);
    expect(apply(again, { type: 'view' })).toBe(again);
  });

  it('良い効果は即全社、悪い効果は中止、一斉事故は試験後の展開が上回る', () => {
    const rows = comparePilotRollouts(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('good', 'now'), score('good', 'expand'), score('good', 'stop')]).toEqual([
      81, 71, 49,
    ]);
    expect([score('harm', 'stop'), score('harm', 'expand'), score('harm', 'now')]).toEqual([
      42, 22, 18,
    ]);
    expect([score('spike', 'expand'), score('spike', 'now'), score('spike', 'stop')]).toEqual([
      71, 61, 49,
    ]);
    const expanded = rows.find((row) => row.board === 'good' && row.strategy === 'expand')!;
    expect(expanded.result.observed).toBe(4);
    expect(expanded.result.score).not.toBe(expanded.result.observed);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of comparePilotRollouts(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(choosePilotAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizePilotRollout(live)).toEqual(row.result);
    }
  });
});

describe('RI-226 要因の反転', () => {
  const axes = ['effect', 'expandFee', 'incident'] as const satisfies readonly PilotFactorAxis[];
  const strategies = ['now', 'expand', 'stop'] as const satisfies readonly PilotStrategy[];
  const axisField = {
    effect: 'effect',
    expandFee: 'expandFee',
    incident: 'incidentIfAll',
  } as const;

  it('上書きは基準の盤面を書き換えず、渡した欄だけを変える', () => {
    const baseline = create('RI-226', 'good');
    const moved = create('RI-226', 'good', { effect: -1, expandFee: 0 });
    expect(create('RI-226', 'good')).toEqual(baseline);
    expect(moved).toMatchObject({ board: 'good', effect: -1, incidentIfAll: 0, expandFee: 0 });
    expect(baseline.effect).toBe(4);
  });

  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = comparePilotFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-226',
      teams: ['pilot', 'north', 'south'],
      base: 5,
      horizon: 3,
      score: 'shipped - fee',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    expect(data.conditions.baselines).toEqual({
      good: { effect: 4, incidentIfAll: 0, expandFee: 2 },
      harm: { effect: -3, incidentIfAll: 0, expandFee: 2 },
      spike: { effect: 4, incidentIfAll: 20, expandFee: 2 },
    });
    expect(data.conditions.strategies).toEqual({
      now: ['all', 'all', 'all'],
      expand: ['pilot', 'all', 'all'],
      stop: ['pilot', 'stop', 'stop'],
    });

    for (const axis of axes) {
      for (const series of data.sweeps[axis]) {
        const baseline = data.conditions.baselines[series.anchor];
        expect(series.axis).toBe(axis);
        expect(series.rows.length).toBeGreaterThan(1);
        for (const row of series.rows) {
          expect(row.axis).toBe(axis);
          expect(row.rules).toMatchObject(series.held);
          const changed = (['effect', 'incidentIfAll', 'expandFee'] as const).filter(
            (field) => row.rules[field] !== baseline[field],
          );
          if (row.parameter === String(baseline[axisField[axis]])) expect(changed).toEqual([]);
          else expect(changed).toEqual([axisField[axis]]);
          expect(row.margin).toBe(row.scores.expand - row.scores.now);
          expect(row.preference).toBe(
            row.scores.expand > row.scores.now
              ? 'expand'
              : row.scores.now > row.scores.expand
                ? 'now'
                : 'tie',
          );
          const periods = row.initial.horizon;
          const teams = data.conditions.teams.length;
          const { base } = row.initial;
          const { effect, expandFee, incidentIfAll } = row.rules;
          expect(row.scores.stop).toBe(periods * teams * base + effect);
          expect(row.scores.now).toBe(periods * teams * (base + effect) - incidentIfAll);
          expect(row.scores.expand).toBe(
            teams * base + effect + (periods - 1) * teams * (base + effect) - expandFee,
          );
          expect(row.margin).toBe(incidentIfAll - expandFee - 2 * effect);
          for (const strategy of strategies) {
            expect(row.runs[strategy].result.score).toBe(row.scores[strategy]);
            expect(row.runs[strategy].result.lost).toBe(false);
          }
        }
      }
    }

    for (const board of ['good', 'harm', 'spike'] as const) {
      for (const strategy of strategies) {
        const first = comparison.results.find(
          (row) => row.board === board && row.strategy === strategy,
        );
        expect(first).toBeDefined();
        const matched = axes.flatMap((axis) =>
          data.sweeps[axis].flatMap((series) =>
            series.rows.filter(
              (row) =>
                row.rules.effect === data.conditions.baselines[board].effect &&
                row.rules.incidentIfAll === data.conditions.baselines[board].incidentIfAll &&
                row.rules.expandFee === data.conditions.baselines[board].expandFee,
            ),
          ),
        );
        expect(matched.length).toBeGreaterThan(0);
        for (const row of matched) {
          expect(row.initial).toEqual(first!.initial);
          expect(row.runs[strategy].inputs).toEqual(first!.inputs);
          expect(row.runs[strategy].result).toEqual(first!.result);
        }
      }
    }
  });

  it('展開と即全社の優劣が反転する位置は効果、事故、展開費用に分かれる', () => {
    const data = comparePilotFactorReversals();
    const line = (axis: PilotFactorAxis, anchor: PilotBoard) => {
      const series = data.sweeps[axis].find((item) => item.anchor === anchor);
      expect(series).toBeDefined();
      return series!.rows.map((row) => [
        row.parameter,
        row.scores.now,
        row.scores.expand,
        row.scores.stop,
        row.preference,
        row.leaders,
      ]);
    };
    expect(line('effect', 'good')).toEqual([
      ['-4', 9, 15, 41, 'expand', ['stop']],
      ['-3', 18, 22, 42, 'expand', ['stop']],
      ['-2', 27, 29, 43, 'expand', ['stop']],
      ['-1', 36, 36, 44, 'tie', ['stop']],
      ['0', 45, 43, 45, 'now', ['now', 'stop']],
      ['1', 54, 50, 46, 'now', ['now']],
      ['4', 81, 71, 49, 'now', ['now']],
    ]);
    expect(line('effect', 'spike')).toEqual([
      ['4', 61, 71, 49, 'expand', ['expand']],
      ['8', 97, 99, 53, 'expand', ['expand']],
      ['9', 106, 106, 54, 'tie', ['now', 'expand']],
      ['10', 115, 113, 55, 'now', ['now']],
    ]);
    expect(line('incident', 'good')).toEqual([
      ['0', 81, 71, 49, 'now', ['now']],
      ['9', 72, 71, 49, 'now', ['now']],
      ['10', 71, 71, 49, 'tie', ['now', 'expand']],
      ['11', 70, 71, 49, 'expand', ['expand']],
      ['20', 61, 71, 49, 'expand', ['expand']],
    ]);
    expect(line('incident', 'harm')).toEqual([
      ['0', 18, 22, 42, 'expand', ['stop']],
      ['10', 8, 22, 42, 'expand', ['stop']],
      ['20', -2, 22, 42, 'expand', ['stop']],
    ]);
    expect(line('expandFee', 'good')).toEqual([
      ['0', 81, 73, 49, 'now', ['now']],
      ['2', 81, 71, 49, 'now', ['now']],
      ['8', 81, 65, 49, 'now', ['now']],
      ['12', 81, 61, 49, 'now', ['now']],
    ]);
    expect(line('expandFee', 'harm')).toEqual([
      ['0', 18, 24, 42, 'expand', ['stop']],
      ['2', 18, 22, 42, 'expand', ['stop']],
      ['5', 18, 19, 42, 'expand', ['stop']],
      ['6', 18, 18, 42, 'tie', ['stop']],
      ['7', 18, 17, 42, 'now', ['stop']],
    ]);
    expect(line('expandFee', 'spike')).toEqual([
      ['0', 61, 73, 49, 'expand', ['expand']],
      ['2', 61, 71, 49, 'expand', ['expand']],
      ['11', 61, 62, 49, 'expand', ['expand']],
      ['12', 61, 61, 49, 'tie', ['now', 'expand']],
      ['13', 61, 60, 49, 'now', ['now']],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.held,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['effect', { incidentIfAll: 0, expandFee: 2 }, '-2', 'expand', '-1', 'tie'],
      ['effect', { incidentIfAll: 0, expandFee: 2 }, '-1', 'tie', '0', 'now'],
      ['effect', { incidentIfAll: 20, expandFee: 2 }, '8', 'expand', '9', 'tie'],
      ['effect', { incidentIfAll: 20, expandFee: 2 }, '9', 'tie', '10', 'now'],
      ['expandFee', { effect: -3, incidentIfAll: 0 }, '5', 'expand', '6', 'tie'],
      ['expandFee', { effect: -3, incidentIfAll: 0 }, '6', 'tie', '7', 'now'],
      ['expandFee', { effect: 4, incidentIfAll: 20 }, '11', 'expand', '12', 'tie'],
      ['expandFee', { effect: 4, incidentIfAll: 20 }, '12', 'tie', '13', 'now'],
      ['incident', { effect: 4, expandFee: 2 }, '9', 'now', '10', 'tie'],
      ['incident', { effect: 4, expandFee: 2 }, '10', 'tie', '11', 'expand'],
    ]);
    expect(data.sweeps.expandFee.find((series) => series.anchor === 'good')!.reversals).toEqual([]);
    expect(data.sweeps.incident.find((series) => series.anchor === 'harm')!.reversals).toEqual([]);
    const harmFees = data.sweeps.expandFee.find((series) => series.anchor === 'harm')!;
    expect(
      harmFees.rows.every((row) => row.leaders.includes('stop') && row.scores.stop === 42),
    ).toBe(true);
  });

  it('入力列は係数で変わらず、観測は事故を含まず、保存再開が一致する', () => {
    const data = comparePilotFactorReversals();
    const plans = data.conditions.strategies;
    for (const axis of axes) {
      for (const series of data.sweeps[axis]) {
        for (const row of series.rows) {
          expect(create('RI-226', row.board, row.rules)).toEqual(row.initial);
          for (const strategy of strategies) {
            const run = row.runs[strategy];
            expect(
              run.inputs.map((input) => (input.type === 'scope' ? input.scope : input.type)),
            ).toEqual(plans[strategy]);
            let live = row.initial;
            let saved = structuredClone(live);
            for (const input of run.inputs) {
              const previous = live;
              const before = structuredClone(live);
              expect(choosePilotAction(previous, strategy)).toEqual(input);
              live = apply(live, input);
              saved = apply(JSON.parse(JSON.stringify(saved)), input);
              expect(previous).toEqual(before);
              expect(saved).toEqual(live);
            }
            expect(summarizePilotRollout(live)).toEqual(run.result);
            expect(live.tick).toBe(row.initial.horizon);
          }
          expect(row.runs.now.result.observed).toBe(0);
          expect(row.runs.expand.result.observed).toBe(row.rules.effect);
          expect(row.runs.stop.result.observed).toBe(row.rules.effect);
          expect(row.runs.expand.result.incident).toBe(0);
          expect(row.runs.stop.result.incident).toBe(0);
          expect(row.runs.now.result.incident).toBe(row.rules.incidentIfAll);
        }
      }
    }
    const good = data.sweeps.effect
      .find((series) => series.anchor === 'good')!
      .rows.find((row) => row.parameter === '4')!;
    const spike = data.sweeps.effect
      .find((series) => series.anchor === 'spike')!
      .rows.find((row) => row.parameter === '4')!;
    expect(good.runs.expand.result.observed).toBe(spike.runs.expand.result.observed);
    expect(good.runs.now.result.incident).toBe(0);
    expect(spike.runs.now.result.incident).toBe(20);
  });
});
