import { describe, expect, it } from 'vitest';
import { PRODUCT_CAPACITY } from './productGrowth';
import {
  applyFeatureUpkeep as apply,
  baselineUpkeepRules,
  chooseUpkeepAction,
  compareFeatureUpkeep,
  compareFeatureUpkeepFactorReversals,
  createFeatureUpkeep as create,
  summarizeFeatureUpkeep,
  viewFeatureUpkeep,
  type UpkeepFactorAxis,
  type UpkeepStrategy,
} from './featureUpkeep';
import comparison from '../../docs/prototypes/feature-upkeep-comparison.json';
import factors from '../../docs/prototypes/feature-upkeep-factor-comparison.json';

describe('RI-234 機能が生む保守', () => {
  it('完成前の保守は0で、負荷の単価と罰則を操作前に示す', () => {
    const first = create('RI-234', 'light');
    expect(create('RI-234', 'light')).toEqual(first);
    expect(first.capacity).toBe(PRODUCT_CAPACITY);
    const before = structuredClone(first);
    const blank = viewFeatureUpkeep(first);
    for (let i = 0; i < 8; i++) expect(viewFeatureUpkeep(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toEqual({
      tick: 0,
      horizon: 3,
      capacity: 4,
      board: 'light',
      upkeepRate: 1,
      shortfallPenalty: 1,
      featureValue: 6,
      obligation: 0,
      features: [
        { id: 'api', remaining: 4, complete: false, maintenance: 0 },
        { id: 'screen', remaining: 4, complete: false, maintenance: 0 },
        { id: 'billing', remaining: 4, complete: false, maintenance: 0 },
      ],
    });
    expect(blank).not.toHaveProperty('incident');
    expect(blank).not.toHaveProperty('debt');
    expect(viewFeatureUpkeep(create('RI-234', 'heavy'))).toMatchObject({
      upkeepRate: 2,
      shortfallPenalty: 4,
      obligation: 0,
    });
  });

  it('完成した次の期間から保守が増え、同じ機能の再投入では増えない', () => {
    const open = create('RI-234', 'heavy');
    expect(apply(open, { type: 'view' })).toBe(open);
    expect(apply(open, { type: 'assign', feature: 'api', maintain: 5 })).toBe(open);
    expect(apply(open, { type: 'assign', feature: 'api', maintain: 1.5 })).toBe(open);
    const completed = apply(open, { type: 'assign', feature: 'api', maintain: 0 });
    expect(completed.completedValue).toBe(6);
    expect(completed.shortfall).toBe(0);
    expect(completed.periods[0]).toEqual({
      tick: 0,
      feature: 'api',
      maintain: 0,
      built: 4,
      completed: true,
      shortfall: 0,
    });
    expect(viewFeatureUpkeep(completed).features[0]).toEqual({
      id: 'api',
      remaining: 0,
      complete: true,
      maintenance: 2,
    });
    const again = apply(completed, { type: 'assign', feature: 'api', maintain: 0 });
    expect(again.completedValue).toBe(6);
    expect(again.shortfall).toBe(2);
    expect(viewFeatureUpkeep(again).features.filter((feature) => feature.maintenance > 0)).toEqual([
      { id: 'api', remaining: 0, complete: true, maintenance: 2 },
    ]);
    expect(again).not.toHaveProperty('incident');
    expect(again).not.toHaveProperty('debt');
    const done = apply(again, { type: 'assign', feature: 'screen', maintain: 0 });
    expect(apply(done, { type: 'assign', feature: 'billing', maintain: 0 })).toBe(done);
  });

  it('成長を急ぐと短期成果が伸び、体制を先にすると次期の余力が残る', () => {
    const rows = compareFeatureUpkeep(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('light', 'rush').result).toMatchObject({
      completedValue: 18,
      shortfall: 3,
      nextSlack: 1,
      score: 15,
      lost: false,
    });
    expect(row('light', 'staff').result).toMatchObject({
      completedValue: 12,
      shortfall: 0,
      nextSlack: 2,
      score: 12,
    });
    expect(row('heavy', 'rush').result).toMatchObject({
      completedValue: 18,
      maintenance: 6,
      nextSlack: -2,
      score: -6,
    });
    expect(row('heavy', 'staff').result).toMatchObject({
      completedValue: 12,
      maintenance: 4,
      nextSlack: 0,
      score: 12,
    });
    expect(row('heavy', 'staff').result.score).toBeGreaterThan(row('heavy', 'rush').result.score);
    expect(row('light', 'rush').result.score).toBeGreaterThan(row('light', 'staff').result.score);
    for (const item of rows) expect(item.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareFeatureUpkeep(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseUpkeepAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeFeatureUpkeep(live)).toEqual(row.result);
    }
  });
});

describe('RI-234 要因の反転', () => {
  const axes = ['upkeepRate', 'need', 'penalty'] as const satisfies readonly UpkeepFactorAxis[];
  const strategies = ['rush', 'staff'] as const satisfies readonly UpkeepStrategy[];
  const fieldOf = {
    upkeepRate: 'upkeepRate',
    need: 'need',
    penalty: 'shortfallPenalty',
  } as const;

  it('規則を渡さない作成は軽い観測のままで、渡した欄だけが状態に入る', () => {
    const baseline = create('RI-234', 'light');
    const moved = create('RI-234', 'light', { upkeepRate: 5 });
    expect(create('RI-234', 'light')).toEqual(baseline);
    expect(moved).toMatchObject({
      board: 'light',
      upkeepRate: 5,
      shortfallPenalty: 1,
      capacity: 4,
      horizon: 3,
      featureValue: 6,
    });
    expect(moved.features.map((feature) => feature.need)).toEqual([4, 4, 4]);
    expect(baseline.upkeepRate).toBe(1);
    expect(viewFeatureUpkeep(baseline)).toMatchObject({ upkeepRate: 1, shortfallPenalty: 1 });
    expect(viewFeatureUpkeep(moved)).toMatchObject({
      upkeepRate: 5,
      shortfallPenalty: 1,
      obligation: 0,
      features: [
        { id: 'api', remaining: 4, maintenance: 0 },
        { id: 'screen', remaining: 4, maintenance: 0 },
        { id: 'billing', remaining: 4, maintenance: 0 },
      ],
    });
    const heavy = create('RI-234', 'heavy', { need: 2 });
    expect(heavy).toMatchObject({ board: 'heavy', upkeepRate: 2, shortfallPenalty: 4 });
    expect(heavy.features.map((feature) => feature.need)).toEqual([2, 2, 2]);
    expect(create('RI-234', 'heavy').features.map((feature) => feature.need)).toEqual([4, 4, 4]);
  });

  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareFeatureUpkeepFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-234',
      anchor: 'light',
      features: ['api', 'screen', 'billing'],
      capacity: 4,
      horizon: 3,
      featureValue: 6,
      score: 'completedValue - shortfall * shortfallPenalty',
      strategies: ['rush', 'staff'],
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    expect(data.conditions.baseline).toEqual(baselineUpkeepRules);
    expect(data.conditions.steps).toEqual({
      upkeepRate: [0, 1, 2, 3, 4, 5, 6],
      need: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      penalty: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(Object.keys(data.sweeps)).toEqual([...axes]);

    for (const axis of axes) {
      const series = data.sweeps[axis];
      expect(series.anchor).toBe('light');
      expect(series.rows.map((row) => row.parameter)).toEqual(
        data.conditions.steps[axis].map(String),
      );
      for (const row of series.rows) {
        expect(row.axis).toBe(axis);
        expect(row.board).toBe('light');
        expect(row.rules).toMatchObject(series.held);
        const changed = (['upkeepRate', 'need', 'shortfallPenalty'] as const).filter(
          (field) => row.rules[field] !== baselineUpkeepRules[field],
        );
        const parameter = Number(row.parameter);
        expect(row.rules[fieldOf[axis]]).toBe(parameter);
        if (parameter === baselineUpkeepRules[fieldOf[axis]]) expect(changed).toEqual([]);
        else expect(changed).toEqual([fieldOf[axis]]);
        expect(row.margin).toBe(row.scores.staff - row.scores.rush);
        expect(row.preference).toBe(
          row.scores.staff > row.scores.rush
            ? 'staff'
            : row.scores.rush > row.scores.staff
              ? 'rush'
              : 'tie',
        );
        const top = Math.max(row.scores.rush, row.scores.staff);
        expect(row.leaders).toEqual(strategies.filter((strategy) => row.scores[strategy] === top));
        expect(row.initial.capacity).toBe(4);
        expect(row.initial.horizon).toBe(3);
        expect(row.initial.featureValue).toBe(6);
        expect(row.initial.seed).toBe('RI-234');
        for (const strategy of strategies) {
          const run = row.runs[strategy];
          expect(run.result.score).toBe(row.scores[strategy]);
          expect(run.result.lost).toBe(false);
          expect(run.result.completedValue).toBe(run.result.completed.length * 6);
          expect(new Set(run.result.completed).size).toBe(run.result.completed.length);
          expect(run.result.maintenance).toBe(row.rules.upkeepRate * run.result.completed.length);
          expect(run.result.nextSlack).toBe(row.initial.capacity - run.result.maintenance);
          expect(run.result.score).toBe(
            run.result.completedValue - run.result.shortfall * row.rules.shortfallPenalty,
          );
          expect(run.result).not.toHaveProperty('incident');
          expect(run.result).not.toHaveProperty('debt');
          expect(run.inputs).toHaveLength(row.initial.horizon);
        }
      }
    }

    for (const strategy of strategies) {
      const first = comparison.results.find(
        (row) => row.board === 'light' && row.strategy === strategy,
      );
      expect(first).toBeDefined();
      for (const axis of axes) {
        const row = data.sweeps[axis].rows.find(
          (item) =>
            item.rules.upkeepRate === 1 &&
            item.rules.need === 4 &&
            item.rules.shortfallPenalty === 1,
        );
        expect(row?.initial).toEqual(first?.initial);
        expect(row?.runs[strategy].inputs).toEqual(first?.inputs);
        expect(row?.runs[strategy].result).toEqual(first?.result);
      }
    }
    const heavyPair = { rush: -6, staff: 12 };
    for (const row of Object.values(data.sweeps).flatMap((series) => series.rows)) {
      expect(row.rules.upkeepRate === 2 && row.rules.shortfallPenalty === 4).toBe(false);
      expect(row.scores).not.toEqual(heavyPair);
    }
  });

  it('単価・必要作業・罰則のどこで急ぐと体制の優劣が反転するかを再計算できる', () => {
    const data = compareFeatureUpkeepFactorReversals();
    const line = (axis: UpkeepFactorAxis) =>
      data.sweeps[axis].rows.map((row) => [
        row.parameter,
        row.scores.rush,
        row.scores.staff,
        row.preference,
        row.leaders,
      ]);

    expect(line('upkeepRate')).toEqual([
      ['0', 18, 18, 'tie', ['rush', 'staff']],
      ['1', 15, 12, 'rush', ['rush']],
      ['2', 12, 12, 'tie', ['rush', 'staff']],
      ['3', 9, 6, 'rush', ['rush']],
      ['4', 6, 6, 'tie', ['rush', 'staff']],
      ['5', 3, 4, 'staff', ['staff']],
      ['6', 0, 2, 'staff', ['staff']],
    ]);
    expect(line('need')).toEqual([
      ['1', 15, 18, 'staff', ['staff']],
      ['2', 15, 18, 'staff', ['staff']],
      ['3', 15, 12, 'rush', ['rush']],
      ['4', 15, 12, 'rush', ['rush']],
      ['5', 5, 6, 'staff', ['staff']],
      ['6', 5, 6, 'staff', ['staff']],
      ['7', 5, 6, 'staff', ['staff']],
      ['8', 5, 6, 'staff', ['staff']],
      ['9', 6, 6, 'tie', ['rush', 'staff']],
    ]);
    expect(line('penalty')).toEqual([
      ['0', 18, 12, 'rush', ['rush']],
      ['1', 15, 12, 'rush', ['rush']],
      ['2', 12, 12, 'tie', ['rush', 'staff']],
      ['3', 9, 12, 'staff', ['staff']],
      ['4', 6, 12, 'staff', ['staff']],
      ['5', 3, 12, 'staff', ['staff']],
      ['6', 0, 12, 'staff', ['staff']],
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
      ['upkeepRate', { need: 4, shortfallPenalty: 1 }, '0', 'tie', '1', 'rush'],
      ['upkeepRate', { need: 4, shortfallPenalty: 1 }, '1', 'rush', '2', 'tie'],
      ['upkeepRate', { need: 4, shortfallPenalty: 1 }, '2', 'tie', '3', 'rush'],
      ['upkeepRate', { need: 4, shortfallPenalty: 1 }, '3', 'rush', '4', 'tie'],
      ['upkeepRate', { need: 4, shortfallPenalty: 1 }, '4', 'tie', '5', 'staff'],
      ['need', { upkeepRate: 1, shortfallPenalty: 1 }, '2', 'staff', '3', 'rush'],
      ['need', { upkeepRate: 1, shortfallPenalty: 1 }, '4', 'rush', '5', 'staff'],
      ['need', { upkeepRate: 1, shortfallPenalty: 1 }, '8', 'staff', '9', 'tie'],
      ['penalty', { upkeepRate: 1, need: 4 }, '1', 'rush', '2', 'tie'],
      ['penalty', { upkeepRate: 1, need: 4 }, '2', 'tie', '3', 'staff'],
    ]);

    for (const row of data.sweeps.upkeepRate.rows) {
      const rate = Number(row.parameter);
      expect(row.runs.rush.result).toMatchObject({
        completedValue: 18,
        shortfall: 3 * rate,
        score: 18 - 3 * rate,
      });
      const staffCompleted = rate === 0 ? 18 : rate <= 2 ? 12 : 6;
      const staffShortfall = rate <= 4 ? 0 : 2 * (rate - 4);
      expect(row.runs.staff.result).toMatchObject({
        completedValue: staffCompleted,
        shortfall: staffShortfall,
        score: staffCompleted - staffShortfall,
      });
    }
    for (const row of data.sweeps.need.rows) {
      const need = Number(row.parameter);
      const rush =
        need <= 4
          ? { completedValue: 18, shortfall: 3, score: 15 }
          : need <= 8
            ? { completedValue: 6, shortfall: 1, score: 5 }
            : { completedValue: 6, shortfall: 0, score: 6 };
      const staff =
        need <= 2
          ? { completedValue: 18, shortfall: 0, score: 18 }
          : need <= 4
            ? { completedValue: 12, shortfall: 0, score: 12 }
            : { completedValue: 6, shortfall: 0, score: 6 };
      expect(row.runs.rush.result).toMatchObject(rush);
      expect(row.runs.staff.result).toMatchObject(staff);
    }
    for (const row of data.sweeps.penalty.rows) {
      const penalty = Number(row.parameter);
      expect(row.runs.rush.result).toMatchObject({
        completedValue: 18,
        shortfall: 3,
        score: 18 - 3 * penalty,
        nextSlack: 1,
      });
      expect(row.runs.staff.result).toMatchObject({
        completedValue: 12,
        shortfall: 0,
        score: 12,
        nextSlack: 2,
      });
    }

    const anchored = data.sweeps.upkeepRate.rows.find((row) => row.parameter === '1');
    expect(anchored?.preference).toBe('rush');
    expect(anchored?.runs.rush.result.nextSlack).toBeLessThan(
      anchored?.runs.staff.result.nextSlack ?? 0,
    );
    expect(data.sweeps.upkeepRate.rows.find((row) => row.parameter === '2')?.scores).toEqual({
      rush: 12,
      staff: 12,
    });
    expect(data.sweeps.penalty.rows.find((row) => row.parameter === '4')?.scores).toEqual({
      rush: 6,
      staff: 12,
    });
    const heavyRush = comparison.results.find(
      (row) => row.board === 'heavy' && row.strategy === 'rush',
    );
    expect(heavyRush?.result.score).toBe(-6);
  });

  it('罰則では入力が動かず、保存再開と入力再生が一致し、保存した係数は変わらない', () => {
    const data = compareFeatureUpkeepFactorReversals();
    const light = compareFeatureUpkeep(comparison.seed).filter((row) => row.board === 'light');
    for (const row of data.sweeps.penalty.rows) {
      for (const strategy of strategies) {
        expect(row.runs[strategy].inputs).toEqual(
          light.find((item) => item.strategy === strategy)?.inputs,
        );
      }
    }
    const rate5 = data.sweeps.upkeepRate.rows.find((row) => row.parameter === '5');
    expect(rate5?.runs.staff.inputs).toEqual([
      { type: 'assign', feature: 'api', maintain: 0 },
      { type: 'assign', feature: 'screen', maintain: 4 },
      { type: 'assign', feature: 'screen', maintain: 4 },
    ]);
    const small = data.sweeps.need.rows.find((row) => row.parameter === '1');
    expect(small?.runs.staff.inputs).toEqual([
      { type: 'assign', feature: 'api', maintain: 0 },
      { type: 'assign', feature: 'screen', maintain: 1 },
      { type: 'assign', feature: 'billing', maintain: 2 },
    ]);
    const late = data.sweeps.need.rows.find((row) => row.parameter === '9');
    expect(late?.runs.rush.inputs).toEqual(late?.runs.staff.inputs);
    expect(
      late?.runs.rush.inputs.map((input) => (input.type === 'assign' ? input.feature : input.type)),
    ).toEqual(['api', 'api', 'api']);

    for (const series of Object.values(data.sweeps)) {
      for (const row of series.rows) {
        expect(create(data.conditions.seed, row.board, row.rules)).toEqual(row.initial);
        for (const strategy of strategies) {
          let live = row.initial;
          let saved = structuredClone(live);
          for (const input of row.runs[strategy].inputs) {
            const previous = live;
            const before = structuredClone(live);
            expect(chooseUpkeepAction(previous, strategy)).toEqual(input);
            live = apply(live, input);
            saved = apply(JSON.parse(JSON.stringify(saved)), input);
            expect(previous).toEqual(before);
            expect(saved).toEqual(live);
          }
          expect(summarizeFeatureUpkeep(live)).toEqual(row.runs[strategy].result);
          expect(live.upkeepRate).toBe(row.initial.upkeepRate);
          expect(live.shortfallPenalty).toBe(row.initial.shortfallPenalty);
          expect(live.features.map((feature) => feature.need)).toEqual(
            row.initial.features.map((feature) => feature.need),
          );
          expect(live.tick).toBe(row.initial.horizon);
        }
      }
    }
  });
});
