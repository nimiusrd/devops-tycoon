import { describe, expect, it } from 'vitest';
import { rosterHeadcount } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';
import {
  applyUsageSignal as apply,
  chooseUsageAction,
  compareUsageFactorReversals,
  compareUsageSignals,
  createUsageSignal as create,
  summarizeUsageSignal,
  viewUsageSignal,
  type UsageFactorAxis,
  type UsageSituation,
} from './usageSignal';
import comparison from '../../docs/prototypes/usage-signal-comparison.json';
import factors from '../../docs/prototypes/usage-signal-factor-comparison.json';

describe('RI-233 出荷後の利用状況', () => {
  it('操作前は予測と出荷量だけを示し、実際の利用は出さない', () => {
    const first = create('RI-233', 'star');
    expect(create('RI-233', 'star')).toEqual(first);
    expect(first.capacity).toBe(PRODUCT_CAPACITY);
    expect(first.respondents).toBe(rosterHeadcount('pioneer'));
    const before = structuredClone(first);
    const blank = viewUsageSignal(first);
    for (let i = 0; i < 8; i++) expect(viewUsageSignal(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toEqual({
      tick: 0,
      horizon: 4,
      capacity: 4,
      respondents: 4,
      features: ['api', 'screen', 'billing'],
      shipVolume: 15,
      shipped: false,
      forecast: { api: 3, screen: 3, billing: 3 },
      observed: false,
      retireValue: 8,
      polishBonus: 1,
      repaired: null,
      collected: false,
    });
    expect(blank).not.toHaveProperty('usage');
    expect(blank).not.toHaveProperty('actual');
    const sleeper = create('RI-233', 'sleeper');
    const blocked = create('RI-233', 'blocked');
    expect(sleeper.shipVolume).toBe(first.shipVolume);
    expect(blocked.shipVolume).toBe(first.shipVolume);
    expect(viewUsageSignal(sleeper).forecast).toEqual(blank.forecast);
    expect(viewUsageSignal(blocked).forecast).toEqual(blank.forecast);
  });

  it('出荷だけでは利用も価値も付かず、観測前の改善と二度目の操作は拒否する', () => {
    const open = create('RI-233', 'blocked');
    expect(apply(open, { type: 'observe' })).toBe(open);
    expect(apply(open, { type: 'repair', feature: 'billing' })).toBe(open);
    expect(apply(open, { type: 'collect' })).toBe(open);
    const shipped = apply(open, { type: 'ship' });
    expect(shipped.shipped).toBe(true);
    expect(shipped.value).toBe(0);
    expect(viewUsageSignal(shipped)).not.toHaveProperty('usage');
    expect(apply(shipped, { type: 'ship' })).toBe(shipped);
    expect(apply(shipped, { type: 'repair', feature: 'billing' })).toBe(shipped);
    expect(apply(shipped, { type: 'extend', feature: 'billing' })).toBe(shipped);
    const seen = apply(shipped, { type: 'observe' });
    const seenView = viewUsageSignal(seen);
    expect('usage' in seenView).toBe(true);
    if (!('usage' in seenView)) throw new Error('observed');
    expect(seenView.usage).toEqual({ api: 1, screen: 3, billing: 0 });
    expect(apply(seen, { type: 'observe' })).toBe(seen);
    expect(apply(seen, { type: 'view' })).toBe(seen);
    const repaired = apply(seen, { type: 'repair', feature: 'billing' });
    expect(repaired.value).toBe(0);
    expect(apply(repaired, { type: 'repair', feature: 'billing' })).toBe(repaired);
    const paid = apply(repaired, { type: 'collect' });
    expect(paid.value).toBe(8);
    expect(apply(paid, { type: 'collect' })).toBe(paid);
  });

  it('同じ出荷量でも、観測した利用によって次の投資の勝者が変わる', () => {
    const rows = compareUsageSignals(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (situation: string, strategy: string) =>
      rows.find((row) => row.situation === situation && row.strategy === strategy)!.result.score;
    expect([score('star', 'skipRead'), score('star', 'extend'), score('star', 'repair')]).toEqual([
      12, 8, 2,
    ]);
    expect([
      score('sleeper', 'extend'),
      score('sleeper', 'skipRead'),
      score('sleeper', 'repair'),
    ]).toEqual([8, 3, 2]);
    expect([
      score('blocked', 'repair'),
      score('blocked', 'extend'),
      score('blocked', 'skipRead'),
    ]).toEqual([8, 6, 3]);
    const volumes = new Set(rows.map((row) => row.initial.shipVolume));
    expect([...volumes]).toEqual([15]);
    const starRepair = rows.find((row) => row.situation === 'star' && row.strategy === 'repair')!;
    expect(starRepair.inputs).toEqual([
      { type: 'ship' },
      { type: 'observe' },
      { type: 'repair', feature: 'screen' },
      { type: 'collect' },
    ]);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareUsageSignals(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseUsageAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeUsageSignal(live)).toEqual(row.result);
    }
  });
});

const axes = ['retireValue', 'observeTicks', 'forecastBias'] as const;
const situations = ['star', 'sleeper', 'blocked'] as const;
const strategies = ['skipRead', 'extend', 'repair'] as const;

describe('RI-233 撤退値・観測期間・予測の偏り', () => {
  it('初回と同じ資源で要因を一つずつ動かし、基準行は初回JSONと一致する', () => {
    const data = compareUsageFactorReversals(comparison.seed);
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-233',
      capacity: 4,
      respondents: 4,
      shipVolume: 15,
      horizon: 4,
      polishBonus: 1,
      baseline: { retireValue: 8, observeTicks: 1, forecastBias: 0 },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    expect(data.conditions.actual).toEqual({
      star: { api: 4, screen: 1, billing: 1 },
      sleeper: { api: 1, screen: 2, billing: 4 },
      blocked: { api: 1, screen: 3, billing: 0 },
    });
    const plain = create('RI-233', 'star');
    expect(create('RI-233', 'star', { retireValue: 8, forecastBias: 0 })).toEqual(plain);
    expect(viewUsageSignal(create('RI-233', 'sleeper', { forecastBias: -2 }))).toMatchObject({
      forecast: { api: 1, screen: 3, billing: 5 },
      observed: false,
    });
    expect(viewUsageSignal(create('RI-233', 'blocked', { forecastBias: 4 })).forecast).toEqual({
      api: 7,
      screen: 3,
      billing: 0,
    });
    for (const situation of situations) {
      for (const strategy of strategies) {
        const first = comparison.results.find(
          (row) => row.situation === situation && row.strategy === strategy,
        );
        expect(first).toBeDefined();
        const matched = axes.flatMap((axis) =>
          data.sweeps[axis].flatMap((series) =>
            series.rows.filter(
              (row) =>
                row.situation === situation &&
                row.rules.retireValue === 8 &&
                row.rules.observeTicks === 1 &&
                row.rules.forecastBias === 0,
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

  it('追加と撤退の優劣は、使われない機能では撤退値と観測期間で反転し、予測の偏りでは反転しない', () => {
    const data = compareUsageFactorReversals(comparison.seed);
    const line = (axis: UsageFactorAxis, situation: UsageSituation) => {
      const series = data.sweeps[axis].find((item) => item.situation === situation);
      expect(series).toBeDefined();
      return series!.rows.map((row) => [
        row.parameter,
        row.scores.skipRead,
        row.scores.extend,
        row.scores.repair,
        row.preference,
        row.leaders,
      ]);
    };
    expect(line('retireValue', 'star')).toEqual([
      ['0', 12, 8, 2, 'extend', ['skipRead']],
      ['5', 12, 8, 2, 'extend', ['skipRead']],
      ['6', 12, 8, 2, 'extend', ['skipRead']],
      ['7', 12, 8, 2, 'extend', ['skipRead']],
      ['8', 12, 8, 2, 'extend', ['skipRead']],
      ['12', 12, 8, 2, 'extend', ['skipRead']],
    ]);
    expect(line('retireValue', 'sleeper')).toEqual([
      ['0', 3, 8, 2, 'extend', ['extend']],
      ['5', 3, 8, 2, 'extend', ['extend']],
      ['6', 3, 8, 2, 'extend', ['extend']],
      ['7', 3, 8, 2, 'extend', ['extend']],
      ['8', 3, 8, 2, 'extend', ['extend']],
      ['12', 3, 8, 2, 'extend', ['extend']],
    ]);
    expect(line('retireValue', 'blocked')).toEqual([
      ['0', 3, 6, 0, 'extend', ['extend']],
      ['5', 3, 6, 5, 'extend', ['extend']],
      ['6', 3, 6, 6, 'tie', ['extend', 'repair']],
      ['7', 3, 6, 7, 'repair', ['repair']],
      ['8', 3, 6, 8, 'repair', ['repair']],
      ['12', 3, 6, 12, 'repair', ['repair']],
    ]);
    expect(line('observeTicks', 'star')).toEqual([
      ['0', 12, 12, 2, 'extend', ['skipRead', 'extend']],
      ['1', 12, 8, 2, 'extend', ['skipRead']],
      ['2', 12, 4, 0, 'extend', ['skipRead']],
      ['3', 12, 0, 0, 'tie', ['skipRead']],
    ]);
    expect(line('observeTicks', 'sleeper')).toEqual([
      ['0', 3, 12, 2, 'extend', ['extend']],
      ['1', 3, 8, 2, 'extend', ['extend']],
      ['2', 3, 4, 0, 'extend', ['extend']],
      ['3', 3, 0, 0, 'tie', ['skipRead']],
    ]);
    expect(line('observeTicks', 'blocked')).toEqual([
      ['0', 3, 9, 8, 'extend', ['extend']],
      ['1', 3, 6, 8, 'repair', ['repair']],
      ['2', 3, 3, 0, 'extend', ['skipRead', 'extend']],
      ['3', 3, 0, 0, 'tie', ['skipRead']],
    ]);
    expect(line('forecastBias', 'star')).toEqual([
      ['-2', 3, 8, 2, 'extend', ['extend']],
      ['-1', 3, 8, 2, 'extend', ['extend']],
      ['0', 12, 8, 2, 'extend', ['skipRead']],
      ['1', 12, 8, 2, 'extend', ['skipRead']],
      ['2', 12, 8, 2, 'extend', ['skipRead']],
    ]);
    expect(line('forecastBias', 'sleeper')).toEqual([
      ['-2', 12, 8, 2, 'extend', ['skipRead']],
      ['-1', 12, 8, 2, 'extend', ['skipRead']],
      ['0', 3, 8, 2, 'extend', ['extend']],
      ['1', 3, 8, 2, 'extend', ['extend']],
      ['2', 3, 8, 2, 'extend', ['extend']],
    ]);
    expect(line('forecastBias', 'blocked')).toEqual([
      ['-2', 0, 6, 8, 'repair', ['repair']],
      ['-1', 0, 6, 8, 'repair', ['repair']],
      ['0', 3, 6, 8, 'repair', ['repair']],
      ['1', 3, 6, 8, 'repair', ['repair']],
      ['2', 3, 6, 8, 'repair', ['repair']],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.situation,
        item.held,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['retireValue', 'blocked', { observeTicks: 1, forecastBias: 0 }, '5', 'extend', '6', 'tie'],
      ['retireValue', 'blocked', { observeTicks: 1, forecastBias: 0 }, '6', 'tie', '7', 'repair'],
      ['observeTicks', 'star', { retireValue: 8, forecastBias: 0 }, '2', 'extend', '3', 'tie'],
      ['observeTicks', 'sleeper', { retireValue: 8, forecastBias: 0 }, '2', 'extend', '3', 'tie'],
      [
        'observeTicks',
        'blocked',
        { retireValue: 8, forecastBias: 0 },
        '0',
        'extend',
        '1',
        'repair',
      ],
      [
        'observeTicks',
        'blocked',
        { retireValue: 8, forecastBias: 0 },
        '1',
        'repair',
        '2',
        'extend',
      ],
      ['observeTicks', 'blocked', { retireValue: 8, forecastBias: 0 }, '2', 'extend', '3', 'tie'],
    ]);
    expect(
      data.sweeps.retireValue.find((series) => series.situation === 'star')!.reversals,
    ).toEqual([]);
    expect(
      data.sweeps.retireValue.find((series) => series.situation === 'sleeper')!.reversals,
    ).toEqual([]);
    for (const series of data.sweeps.forecastBias) expect(series.reversals).toEqual([]);
  });

  it('入力列と保存再開が一致し、追加と撤退の対象は要因で変わらない', () => {
    const data = compareUsageFactorReversals(comparison.seed);
    const extendFeature: Record<UsageSituation, string> = {
      star: 'api',
      sleeper: 'billing',
      blocked: 'screen',
    };
    const repairFeature: Record<UsageSituation, string> = {
      star: 'screen',
      sleeper: 'api',
      blocked: 'billing',
    };
    for (const axis of axes) {
      for (const series of data.sweeps[axis]) {
        expect(series.rows.length).toBeGreaterThan(1);
        for (const row of series.rows) {
          expect(row.initial).toMatchObject({
            seed: 'RI-233',
            situation: series.situation,
            horizon: 4,
            capacity: 4,
            respondents: 4,
            shipVolume: 15,
            polishBonus: 1,
            actual: data.conditions.actual[series.situation],
          });
          expect(row.rules.retireValue).toBe(axis === 'retireValue' ? Number(row.parameter) : 8);
          expect(row.rules.observeTicks).toBe(axis === 'observeTicks' ? Number(row.parameter) : 1);
          expect(row.rules.forecastBias).toBe(axis === 'forecastBias' ? Number(row.parameter) : 0);
          expect(create('RI-233', series.situation, row.rules)).toEqual(row.initial);
          const rules = { observeTicks: row.rules.observeTicks };
          for (const strategy of strategies) {
            const run = row.runs[strategy];
            let live = row.initial;
            let saved = structuredClone(live);
            for (const input of run.inputs) {
              const previous = live;
              const before = structuredClone(live);
              expect(chooseUsageAction(previous, strategy)).toEqual(input);
              live = apply(live, input, rules);
              saved = apply(JSON.parse(JSON.stringify(saved)), input, rules);
              expect(previous).toEqual(before);
              expect(saved).toEqual(live);
            }
            expect(live.tick).toBe(row.initial.horizon);
            expect(summarizeUsageSignal(live)).toEqual(run.result);
            expect(run.result.lost).toBe(false);
          }
          expect(
            row.runs.extend.inputs.every(
              (input) =>
                input.type !== 'extend' || input.feature === extendFeature[series.situation],
            ),
          ).toBe(true);
          expect(
            row.runs.repair.inputs.every(
              (input) =>
                input.type !== 'repair' || input.feature === repairFeature[series.situation],
            ),
          ).toBe(true);
          const holds = row.runs.repair.inputs.filter((input) => input.type === 'hold');
          expect(holds).toHaveLength(row.rules.observeTicks === 0 ? 1 : 0);
          for (const strategy of ['skipRead', 'extend'] as const) {
            expect(row.runs[strategy].inputs.some((input) => input.type === 'hold')).toBe(false);
          }
          if (row.rules.observeTicks >= 2) expect(row.runs.repair.result.score).toBe(0);
        }
      }
    }
    const biased = data.sweeps.forecastBias.find((series) => series.situation === 'sleeper')!;
    expect(biased.rows.find((row) => row.parameter === '-1')!.runs.skipRead.inputs).toContainEqual({
      type: 'extend',
      feature: 'billing',
    });
    expect(biased.rows.find((row) => row.parameter === '0')!.runs.skipRead.inputs).toContainEqual({
      type: 'extend',
      feature: 'api',
    });
    const free = data.sweeps.observeTicks
      .find((series) => series.situation === 'blocked')!
      .rows.find((row) => row.parameter === '0')!;
    expect(free.runs.repair.inputs).toEqual([
      { type: 'ship' },
      { type: 'observe' },
      { type: 'repair', feature: 'billing' },
      { type: 'collect' },
      { type: 'hold' },
    ]);
    expect(free.runs.extend.inputs).toEqual([
      { type: 'ship' },
      { type: 'observe' },
      { type: 'extend', feature: 'screen' },
      { type: 'extend', feature: 'screen' },
      { type: 'extend', feature: 'screen' },
    ]);
  });
});
