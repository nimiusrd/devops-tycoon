import { describe, expect, it } from 'vitest';
import {
  applyIsolationInput,
  baselineIsolationRules,
  compareIsolationReversals,
  compareIsolationStrategies,
  createIsolationCase,
  createIsolationPrototype,
  runIsolationPlay,
  summarizeIsolation,
  type IsolationFraction,
  type IsolationPlay,
  type IsolationRules,
  type IsolationStrategy,
} from './domainIsolation';
import comparison from '../../docs/prototypes/domain-isolation-comparison.json';
import factors from '../../docs/prototypes/domain-isolation-factor-comparison.json';

describe('RI-171 領域隔離', () => {
  it('隔離対象のCoding/Reviewと新規流入を止め、対象外を進める', () => {
    const initial = createIsolationPrototype('RI-171', true);
    for (const stage of ['coding', 'review'] as const) {
      initial.tasks[0].stage = stage;
      const isolated = applyIsolationInput(initial, { type: 'isolate', domain: 'product' });
      expect(applyIsolationInput(isolated, { type: 'admit', id: 'product-reserve' })).toBe(
        isolated,
      );
      let state = applyIsolationInput(isolated, { type: 'admit', id: 'platform-reserve' });
      state = applyIsolationInput(state, { type: 'tick' });
      expect(state.tasks[0].workLeft).toBe(2);
      expect(state.tasks[2].workLeft).toBe(1);
      expect(summarizeIsolation(state)).toMatchObject({
        spreadTicks: 0,
        customerLoss: 4,
        pausedValue: 8,
        blockedCapacity: { product: 1, platform: 0 },
        remainingWork: 6,
      });
    }
  });
  it('隔離しなければ延焼が対象外を止めるが、元の事故は隔離後も残る', () => {
    let state = applyIsolationInput(createIsolationPrototype('RI-171', true), { type: 'tick' });
    expect(state).toMatchObject({
      customerLoss: 5,
      spreadTicks: 1,
      blockedCapacity: { product: 1, platform: 1 },
    });
    state = applyIsolationInput(state, { type: 'isolate', domain: 'product' });
    state = applyIsolationInput(state, { type: 'tick' });
    expect(state).toMatchObject({ customerLoss: 9, spreadTicks: 1 });
    expect(state.incident.status).toBe('active');
  });
  it('復旧前の解除と連打を拒否し、復旧後は費用を払って同じ仕事を再開する', () => {
    let state = applyIsolationInput(createIsolationPrototype('RI-171'), {
      type: 'isolate',
      domain: 'product',
    });
    const release = { type: 'release', domain: 'product' } as const;
    expect(applyIsolationInput(state, release)).toBe(state);
    expect(applyIsolationInput(state, { type: 'isolate', domain: 'product' })).toBe(state);
    state = applyIsolationInput(state, { type: 'repair' });
    expect(applyIsolationInput(state, { type: 'repair' })).toBe(state);
    for (let i = 0; i < 2; i++) state = applyIsolationInput(state, { type: 'tick' });
    expect(state.incident.status).toBe('resolved');
    expect(state.tasks[0].workLeft).toBe(2);
    state = applyIsolationInput(state, release);
    expect(state.focusSpent).toBe(4);
    expect(applyIsolationInput(state, release)).toBe(state);
    expect(applyIsolationInput(state, { type: 'isolate', domain: 'product' })).toBe(state);
    state = applyIsolationInput(state, { type: 'tick' });
    expect(state.tasks[0].workLeft).toBe(1);
    expect(state.customerLoss).toBe(2);
  });
  it('対象外隔離・未知流入・資源不足・期末を無消費で拒否する', () => {
    const initial = createIsolationPrototype('RI-171');
    expect(applyIsolationInput(initial, { type: 'isolate', domain: 'platform' })).toBe(initial);
    expect(applyIsolationInput(initial, { type: 'admit', id: 'unknown' })).toBe(initial);
    expect(applyIsolationInput(initial, { type: 'admit', id: 'product-job' })).toBe(initial);
    const poor = { ...initial, focus: 0 };
    expect(applyIsolationInput(poor, { type: 'isolate', domain: 'product' })).toBe(poor);
    expect(applyIsolationInput(poor, { type: 'repair' })).toBe(poor);
    const ended = { ...initial, tick: initial.horizon };
    expect(applyIsolationInput(ended, { type: 'tick' })).toBe(ended);
  });
  it('短い障害では隔離を避け、長い障害では対象外を救う方が有利になる', () => {
    const rows = compareIsolationStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    expect(rows.map((r) => r.result.netValue)).toEqual([31, 30, -11, 0]);
    expect(rows[2].result.remaining).toHaveLength(2);
    expect(rows[3].result.remaining).toHaveLength(1);
    expect(rows[3].result.blockedCapacity).toEqual({ product: 6, platform: 0 });
  });
  it('全比較を毎入力JSON保存再開・再生でき、元状態を変えない', () => {
    for (const row of compareIsolationStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(previous);
        live = applyIsolationInput(live, input);
        expect(previous).toEqual(before);
        saved = applyIsolationInput(JSON.parse(JSON.stringify(saved)), input);
        expect(saved).toEqual(live);
      }
      expect(summarizeIsolation(live)).toEqual(row.result);
    }
  });
});

function replay(
  severe: boolean,
  strategy: IsolationStrategy,
  rules: IsolationRules,
  play: IsolationPlay,
  world: { spreadHits?: boolean; isolationStopsSpread?: boolean } = {},
) {
  expect(runIsolationPlay('RI-171', severe, strategy, rules, world)).toEqual(play);
  let state = createIsolationCase('RI-171', severe, rules, world);
  for (const input of play.inputs) {
    const previous = state;
    const before = structuredClone(state);
    state = applyIsolationInput(state, input);
    expect(previous).toEqual(before);
    expect(state).not.toBe(previous);
  }
  expect(summarizeIsolation(state)).toEqual(play.result);
  expect(state.announcedLoss ?? null).toBe(play.announcedLoss);
}

describe('RI-171 要因を一つずつ動かした比較', () => {
  it('初回と同じ資源と入力で、隔離の優劣が反転する条件を再計算する', () => {
    const report = compareIsolationReversals(factors.seed);
    expect(report).toEqual(factors);
    expect(report.resources).toMatchObject({
      publishedValue: 20,
      focus: 6,
      horizon: 8,
      recoveryPerTick: 1,
      jobValue: 8,
      jobWork: 4,
      reserveValue: 4,
    });
    expect(report.fixedStrategies).toBe(true);
    expect(report.humanPlaytest).toBe(false);
    expect(report.productionIntegration).toBe(false);
    expect(report.randomDraws).toBe(false);
    expect(report.control).toMatchObject({
      matchesFirstComparison: true,
      light: { open: 31, isolate: 30, preference: 'open' },
      severe: { open: -11, isolate: 0, preference: 'isolate' },
    });
    const first = compareIsolationStrategies(factors.seed);
    const delay0 = report.isolationDelay[0]!;
    expect(delay0.delay).toBe(0);
    expect(delay0.light.open.inputs).toEqual(first[0]!.inputs);
    expect(delay0.light.isolate.inputs).toEqual(first[1]!.inputs);
    expect(delay0.severe.open.inputs).toEqual(first[2]!.inputs);
    expect(delay0.severe.isolate.inputs).toEqual(first[3]!.inputs);
    expect(report.factors.map((factor) => factor.changed)).toEqual([
      ['incidentCount'],
      ['inflowDuringRecovery'],
      ['publicForecast'],
      ['domainDependency'],
      ['recurrenceAfterRelease'],
    ]);
    expect(report.factors.map((factor) => [factor.factor, factor.reversed])).toEqual([
      ['incidentCount', ['light']],
      ['inflowDuringRecovery', ['light']],
      ['publicForecast', []],
      ['domainDependency', []],
      ['recurrenceAfterRelease', []],
    ]);
    const incident = report.factors[0]!;
    const inflow = report.factors[1]!;
    const forecast = report.factors[2]!;
    const dependency = report.factors[3]!;
    const recurrence = report.factors[4]!;
    expect([incident.light.open.result.netValue, incident.light.isolate.result.netValue]).toEqual([
      26, 27,
    ]);
    expect(incident.light.isolate.result.focusSpent).toBe(5);
    expect([inflow.light.open.result.netValue, inflow.light.isolate.result.netValue]).toEqual([
      31, 34,
    ]);
    expect(inflow.light.isolate.result.value).toBe(20);
    expect(inflow.light.isolate.inputs).toContainEqual({ type: 'admit', id: 'platform-reserve' });
    expect(inflow.light.isolate.inputs).not.toContainEqual({
      type: 'admit',
      id: 'product-reserve',
    });
    expect(inflow.severe.isolate.result).toMatchObject({ value: 12, netValue: 4 });
    for (const board of ['light', 'severe'] as const) {
      for (const strategy of ['open', 'isolate'] as const) {
        expect(forecast[board][strategy].announcedLoss).toBe(
          forecast[board][strategy].result.customerLoss,
        );
      }
    }
    expect(dependency.severe.isolate.result).toMatchObject({
      value: 0,
      customerLoss: 24,
      focusSpent: 4,
      netValue: -8,
    });
    expect(recurrence.severe.isolate.result).toMatchObject({ value: 8, netValue: -40 });
    expect(recurrence.light.isolate.inputs.filter((input) => input.type === 'repair')).toHaveLength(
      1,
    );
    expect(report.delayReversals).toEqual([
      {
        factor: 'isolationDelay',
        board: 'light',
        beforeDelay: 1,
        afterDelay: 2,
        before: 'open',
        after: 'tie',
        sameInputs: true,
      },
      {
        factor: 'isolationDelay',
        board: 'severe',
        beforeDelay: 4,
        afterDelay: 5,
        before: 'isolate',
        after: 'open',
        sameInputs: false,
      },
      {
        factor: 'isolationDelay',
        board: 'severe',
        beforeDelay: 5,
        afterDelay: 6,
        before: 'open',
        after: 'tie',
        sameInputs: true,
      },
    ]);
    const delay4 = report.isolationDelay.find((point) => point.delay === 4)!;
    const delay5 = report.isolationDelay.find((point) => point.delay === 5)!;
    const delay2 = report.isolationDelay.find((point) => point.delay === 2)!;
    const delay6 = report.isolationDelay.find((point) => point.delay === 6)!;
    expect(delay4.severe.isolate.result).toMatchObject({ value: 8, netValue: -4 });
    expect(delay5.severe.isolate.inputs.some((input) => input.type === 'isolate')).toBe(true);
    expect(delay5.severe.isolate.result.netValue).toBe(-13);
    expect(delay5.severe.preference).toBe('open');
    expect(delay2.light.isolate.inputs).toEqual(delay2.light.open.inputs);
    expect(delay2.light.isolate.inputs.some((input) => input.type === 'isolate')).toBe(false);
    expect(delay6.severe.isolate.inputs).toEqual(delay6.severe.open.inputs);
    expect(report.thresholds).toEqual({
      light: {
        spreadProbability: { num: 3, den: 2 },
        mitigationRate: { num: 3, den: 2 },
      },
      severe: {
        spreadProbability: { num: 3, den: 14 },
        mitigationRate: { num: 3, den: 14 },
      },
    });
    const at = (
      points: typeof report.spreadProbability.points,
      value: IsolationFraction,
      board: 'light' | 'severe',
    ) =>
      points.find((point) => point.value.num === value.num && point.value.den === value.den)![
        board
      ];
    expect(at(report.spreadProbability.points, { num: 0, den: 1 }, 'severe').preference).toBe(
      'open',
    );
    expect(at(report.spreadProbability.points, { num: 3, den: 14 }, 'severe').preference).toBe(
      'tie',
    );
    expect(at(report.spreadProbability.points, { num: 1, den: 4 }, 'severe').preference).toBe(
      'isolate',
    );
    expect(at(report.mitigationRate.points, { num: 0, den: 1 }, 'severe').preference).toBe('open');
    expect(at(report.mitigationRate.points, { num: 3, den: 14 }, 'severe').preference).toBe('tie');
    expect(at(report.mitigationRate.points, { num: 1, den: 4 }, 'severe').preference).toBe(
      'isolate',
    );
    expect(
      report.spreadProbability.points.every((point) => point.light.preference === 'open'),
    ).toBe(true);
    expect(report.mitigationRate.points.every((point) => point.light.preference === 'open')).toBe(
      true,
    );
    expect(report.spreadProbability.heldMitigationRate).toBe(1);
    expect(report.mitigationRate.heldSpreadProbability).toBe(1);
  });
  it('要因比較の入力列をJSONから再生でき、規則が無い状態は初回のまま進む', () => {
    const report = compareIsolationReversals(factors.seed);
    const ruleFor = (factor: (typeof report.factors)[number]): IsolationRules => {
      switch (factor.factor) {
        case 'incidentCount':
          return { ...baselineIsolationRules, incidentCount: 2 };
        case 'inflowDuringRecovery':
          return { ...baselineIsolationRules, inflowDuringRecovery: true };
        case 'publicForecast':
          return { ...baselineIsolationRules, publicForecast: true };
        case 'domainDependency':
          return { ...baselineIsolationRules, domainDependency: true };
        case 'recurrenceAfterRelease':
          return { ...baselineIsolationRules, recurrenceAfterRelease: true };
        default:
          throw new Error(factor.factor);
      }
    };
    for (const factor of report.factors) {
      const rules = ruleFor(factor);
      for (const severe of [false, true]) {
        const board = severe ? factor.severe : factor.light;
        replay(severe, 'open', rules, board.open);
        replay(severe, 'isolate', rules, board.isolate);
      }
    }
    for (const point of report.isolationDelay) {
      const rules = { ...baselineIsolationRules, isolationDelay: point.delay };
      replay(false, 'open', rules, point.light.open);
      replay(false, 'isolate', rules, point.light.isolate);
      replay(true, 'open', rules, point.severe.open);
      replay(true, 'isolate', rules, point.severe.isolate);
    }
    for (const [severe, worlds] of [
      [false, report.spreadWorlds.light],
      [true, report.spreadWorlds.severe],
    ] as const) {
      replay(severe, 'open', baselineIsolationRules, worlds.openSpread);
      replay(severe, 'open', baselineIsolationRules, worlds.openMiss, { spreadHits: false });
      replay(severe, 'isolate', baselineIsolationRules, worlds.isolateContained);
      replay(severe, 'isolate', baselineIsolationRules, worlds.isolateFailed, {
        isolationStopsSpread: false,
      });
    }
    const legacy = createIsolationPrototype('RI-171');
    const opened = applyIsolationInput(legacy, { type: 'tick' });
    expect(opened).toMatchObject({ customerLoss: 2, spreadTicks: 1 });
    expect(applyIsolationInput(legacy, { type: 'repair' }).focusSpent).toBe(1);
  });
  it('波及の外れと軽減失敗、依存、公開見積、再発は別入力でも規則どおりに効く', () => {
    const missed = applyIsolationInput(
      createIsolationCase('RI-171', true, baselineIsolationRules, { spreadHits: false }),
      { type: 'tick' },
    );
    expect(missed).toMatchObject({
      customerLoss: 4,
      spreadTicks: 0,
      blockedCapacity: { product: 1, platform: 0 },
    });
    expect(missed.tasks[2]?.workLeft).toBe(1);
    const failed = applyIsolationInput(
      applyIsolationInput(
        createIsolationCase('RI-171', true, baselineIsolationRules, {
          isolationStopsSpread: false,
        }),
        { type: 'isolate', domain: 'product' },
      ),
      { type: 'tick' },
    );
    expect(failed).toMatchObject({
      customerLoss: 5,
      spreadTicks: 1,
      blockedCapacity: { product: 1, platform: 1 },
    });
    const dependent = applyIsolationInput(
      applyIsolationInput(
        createIsolationCase('RI-171', false, { ...baselineIsolationRules, domainDependency: true }),
        { type: 'isolate', domain: 'product' },
      ),
      { type: 'tick' },
    );
    expect(dependent.tasks[2]?.workLeft).toBe(2);
    expect(dependent.blockedCapacity.platform).toBe(1);
    let quoted = createIsolationCase('RI-171', false, {
      ...baselineIsolationRules,
      publicForecast: true,
    });
    quoted = applyIsolationInput(quoted, { type: 'isolate', domain: 'product' });
    quoted = applyIsolationInput(quoted, { type: 'repair' });
    quoted = applyIsolationInput(quoted, { type: 'tick' });
    expect(quoted.announcedLoss).toBe(2);
    expect(quoted.customerLoss).toBe(1);
    expect(summarizeIsolation(quoted).netValue).toBe(
      summarizeIsolation({ ...quoted, rules: { ...quoted.rules!, publicForecast: false } })
        .netValue - 1,
    );
    const recurred = runIsolationPlay('RI-171', false, 'isolate', {
      ...baselineIsolationRules,
      recurrenceAfterRelease: true,
    });
    expect(recurred.inputs.filter((input) => input.type === 'isolate')).toHaveLength(1);
    expect(recurred.result.remainingWork).toBe(2);
    expect(recurred.result.customerLoss).toBe(14);
  });
});
