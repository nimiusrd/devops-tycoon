import { describe, expect, it } from 'vitest';
import {
  applyQuotaInput as apply,
  chooseQuotaAction,
  compareQuotaFactorReversals,
  compareQuotaStrategies,
  createQuotaPrototype as create,
  summarizeQuota,
  viewQuota,
} from './quotaAllocation';
import comparison from '../../docs/prototypes/quota-allocation-comparison.json';
import factors from '../../docs/prototypes/quota-allocation-factor-comparison.json';

describe('RI-200 利用枠の配分', () => {
  it('配分前に枠・納期・通常運転の価値を示し、閲覧は状態を変えない', () => {
    const first = create('RI-200', 'flagship');
    expect(create('RI-200', 'flagship')).toEqual(first);
    expect(create('RI-200-other', 'spread').scenario).toBe('spread');
    const before = structuredClone(first);
    const blank = viewQuota(first);
    for (let i = 0; i < 10; i++) expect(viewQuota(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      pool: 6,
      horizon: 4,
      humanValue: 3,
      aiValue: { core: 8, platform: 5, product: 5 },
      opened: false,
    });
    expect(blank.teams.map((team) => team.deadline)).toEqual([24, null, null]);
  });

  it('配分合計が枠を超えると拒否し、未配分チームは人間速度で価値を積む', () => {
    const initial = create('RI-200', 'spread');
    expect(apply(initial, { type: 'tick' })).toBe(initial);
    expect(apply(initial, { type: 'release' })).toBe(initial);
    expect(
      apply(initial, {
        type: 'allocate',
        amounts: { core: 4, platform: 2, product: 1 },
        reserve: 0,
      }),
    ).toBe(initial);
    expect(
      apply(initial, { type: 'allocate', amounts: { core: 1, platform: 1 }, reserve: 0 }),
    ).toBe(initial);
    expect(
      apply(initial, {
        type: 'allocate',
        amounts: { core: 1.5, platform: 0, product: 0 },
        reserve: 0,
      }),
    ).toBe(initial);
    const opened = apply(initial, {
      type: 'allocate',
      amounts: { core: 0, platform: 0, product: 0 },
      reserve: 0,
    });
    expect(opened).toMatchObject({ opened: true, forfeited: 6 });
    expect(
      apply(opened, {
        type: 'allocate',
        amounts: { core: 1, platform: 1, product: 1 },
        reserve: 0,
      }),
    ).toBe(opened);
    let state = opened;
    for (let i = 0; i < 4; i++) state = apply(state, { type: 'tick' });
    expect(state.teams.every((team) => team.value === 12 && team.used === 0)).toBe(true);
    expect(summarizeQuota(state).score).toBe(6);
  });

  it('期末に使い切らなかった割当は remaining に残さず失効へ移す', () => {
    let state = apply(create('RI-200', 'flagship'), {
      type: 'allocate',
      amounts: { core: 6, platform: 0, product: 0 },
      reserve: 0,
    });
    for (let i = 0; i < 4; i++) state = apply(state, { type: 'tick' });
    expect(state.teams.map((team) => team.allocation)).toEqual([4, 0, 0]);
    expect(viewQuota(state).teams.map((team) => team.remaining)).toEqual([0, 0, 0]);
    expect(state.forfeited).toBe(2);
    expect(state.reserve).toBe(0);
    expect(summarizeQuota(state).singleLedger).toBe(true);
  });

  it('1tickの消費はチームあたり一度だけで、tick2の再配分は最大不足へ渡す', () => {
    let state = apply(create('RI-200', 'flagship'), {
      type: 'allocate',
      amounts: { core: 2, platform: 2, product: 0 },
      reserve: 2,
    });
    expect(apply(state, { type: 'release' })).toBe(state);
    state = apply(apply(state, { type: 'tick' }), { type: 'tick' });
    expect(state.charges).toBe(4);
    expect(state.teams.reduce((sum, team) => sum + team.used, 0)).toBe(state.charges);
    const released = apply(state, { type: 'release' });
    expect(released.teams.map((team) => team.allocation)).toEqual([4, 2, 0]);
    expect(released.reserve).toBe(0);
    expect(apply(released, { type: 'release' })).toBe(released);
    const spread = apply(
      apply(
        apply(
          apply(create('RI-200', 'spread'), {
            type: 'allocate',
            amounts: { core: 2, platform: 2, product: 0 },
            reserve: 2,
          }),
          { type: 'tick' },
        ),
        { type: 'tick' },
      ),
      { type: 'release' },
    );
    expect(spread.teams.map((team) => team.allocation)).toEqual([2, 2, 2]);
  });

  it('主力集中と均等配分は盤面で優劣が入れ替わり、保留の再配分は不足側を満たす', () => {
    const rows = compareQuotaStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (scenario: string, strategy: string) =>
      rows.find((row) => row.scenario === scenario && row.strategy === strategy)!.result.score;
    const fatigue = (scenario: string, strategy: string) =>
      rows.find((row) => row.scenario === scenario && row.strategy === strategy)!.result.fatigue;
    expect([
      score('flagship', 'focus'),
      score('flagship', 'even'),
      score('flagship', 'none'),
    ]).toEqual([60, 42, 24]);
    expect([score('spread', 'focus'), score('spread', 'even'), score('spread', 'none')]).toEqual([
      40, 54, 6,
    ]);
    expect(score('flagship', 'reserve')).toBe(60);
    expect(score('spread', 'reserve')).toBe(54);
    expect(fatigue('flagship', 'focus')).toBe(8);
    expect(fatigue('spread', 'even')).toBe(10);
    expect(fatigue('flagship', 'none')).toBe(0);
    expect(rows.every((row) => row.result.singleLedger)).toBe(true);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareQuotaStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseQuotaAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeQuota(live)).toEqual(row.result);
    }
  });
});

describe('RI-200 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareQuotaFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-200',
      horizon: 4,
      human: 3,
      capPerTeam: 4,
      fatigueInScore: false,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    const scores = (axis: keyof typeof data.sweeps, scenario: string) =>
      data.sweeps[axis]
        .filter((item) => item.scenario === scenario)
        .map((item) => [
          item.parameter,
          item.focus.result.score,
          item.even.result.score,
          item.none.result.score,
          item.preference,
        ]);
    expect(scores('aiValue', 'flagship')).toEqual([
      ['0', 18, 12, 24, 'none'],
      ['1', 24, 18, 24, 'tie'],
      ['2', 30, 24, 24, 'allocate'],
      ['3', 48, 30, 24, 'allocate'],
      ['4', 54, 36, 24, 'allocate'],
      ['5', 60, 42, 24, 'allocate'],
      ['6', 66, 60, 24, 'allocate'],
      ['7', 72, 66, 24, 'allocate'],
      ['8', 78, 72, 24, 'allocate'],
    ]);
    expect(scores('aiValue', 'spread')).toEqual([
      ['0', 0, -6, 6, 'none'],
      ['1', 16, 0, 6, 'allocate'],
      ['2', 22, 16, 6, 'allocate'],
      ['3', 28, 22, 6, 'allocate'],
      ['4', 34, 28, 6, 'allocate'],
      ['5', 40, 54, 6, 'allocate'],
      ['6', 66, 60, 6, 'allocate'],
      ['7', 72, 66, 6, 'allocate'],
      ['8', 78, 72, 6, 'allocate'],
    ]);
    expect(scores('pool', 'flagship').filter(([parameter]) => parameter === '0')).toEqual([
      ['0', 24, 24, 24, 'tie'],
    ]);
    expect(
      data.sweeps.pool.every(
        (item) => item.preference === (item.parameter === '0' ? 'tie' : 'allocate'),
      ),
    ).toBe(true);
    expect(data.sweeps.penalty.every((item) => item.preference === 'allocate')).toBe(true);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.scenario,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['pool', 'flagship', '0', 'tie', '1', 'allocate'],
      ['pool', 'spread', '0', 'tie', '1', 'allocate'],
      ['aiValue', 'flagship', '0', 'none', '1', 'tie'],
      ['aiValue', 'flagship', '1', 'tie', '2', 'allocate'],
      ['aiValue', 'spread', '0', 'none', '1', 'allocate'],
    ]);
    expect(data.reversals.some((item) => item.axis === 'penalty')).toBe(false);
  });

  it('基準行は初回の集中・均等・未配分と一致し、動かした規則は一つである', () => {
    const data = compareQuotaFactorReversals();
    const first = compareQuotaStrategies(comparison.seed);
    const baselines = Object.values(data.sweeps)
      .flat()
      .filter((item) => item.sameAsFirstComparison);
    expect(baselines).toHaveLength(6);
    for (const point of baselines) {
      expect(point.rules.pool).toBe(6);
      expect(point.rules.aiValue).toEqual({ core: 8, platform: 5, product: 5 });
      expect(point.preference).toBe('allocate');
      for (const strategy of ['focus', 'even', 'none'] as const) {
        const row = first.find(
          (item) => item.scenario === point.scenario && item.strategy === strategy,
        );
        if (!row) throw new Error('first');
        expect(point[strategy].inputs).toEqual(row.inputs);
        expect(point[strategy].result).toEqual(row.result);
      }
    }
    expect(first.some((row) => row.strategy === 'reserve')).toBe(true);
    expect(Object.keys(data.sweeps)).toEqual(['pool', 'aiValue', 'penalty']);
    for (const item of data.sweeps.pool) {
      expect(item.rules.aiValue).toEqual({ core: 8, platform: 5, product: 5 });
      expect(item.rules.penalty).toBe(item.scenario === 'flagship' ? 12 : 10);
      expect(item.rules.pool).toBe(Number(item.parameter));
      expect(item.sameAsFirstComparison).toBe(item.parameter === '6');
    }
    for (const item of data.sweeps.aiValue) {
      expect(item.rules.pool).toBe(6);
      expect(item.rules.penalty).toBe(item.scenario === 'flagship' ? 12 : 10);
      expect(item.rules.aiValue.platform).toBe(Number(item.parameter));
      expect(item.rules.aiValue.product).toBe(Number(item.parameter));
      expect(item.rules.aiValue.core).toBe(Number(item.parameter) + 3);
      expect(item.sameAsFirstComparison).toBe(item.parameter === '5');
    }
    for (const item of data.sweeps.penalty) {
      expect(item.rules.pool).toBe(6);
      expect(item.rules.aiValue).toEqual({ core: 8, platform: 5, product: 5 });
      expect(item.rules.penalty).toBe(Number(item.parameter));
      const met = (strategy: 'focus' | 'even' | 'none') =>
        item[strategy].result.teams.map((team) => team.met);
      const baseline = data.sweeps.penalty.find(
        (point) => point.sameAsFirstComparison && point.scenario === item.scenario,
      );
      if (!baseline) throw new Error('penalty');
      expect(met('focus')).toEqual(baseline.focus.result.teams.map((team) => team.met));
      expect(met('even')).toEqual(baseline.even.result.teams.map((team) => team.met));
      expect(met('none')).toEqual(baseline.none.result.teams.map((team) => team.met));
    }
    const opened = (pool: number, strategy: 'focus' | 'even' | 'none') => {
      const action = chooseQuotaAction(create('RI-200', 'flagship', { pool }), strategy);
      if (action.type !== 'allocate') throw new Error('allocate');
      return [action.amounts.core, action.amounts.platform, action.amounts.product, action.reserve];
    };
    expect(opened(6, 'focus')).toEqual([4, 1, 1, 0]);
    expect(opened(6, 'even')).toEqual([2, 2, 2, 0]);
    expect(opened(4, 'focus')).toEqual([4, 0, 0, 0]);
    expect(opened(4, 'even')).toEqual([2, 1, 1, 0]);
    expect(opened(1, 'focus')).toEqual([1, 0, 0, 0]);
    expect(opened(12, 'even')).toEqual([4, 4, 4, 0]);
    expect(opened(9, 'none')).toEqual([0, 0, 0, 0]);
    const low = data.sweeps.aiValue.find(
      (item) => item.scenario === 'spread' && item.parameter === '1',
    );
    const harsh = data.sweeps.aiValue.find(
      (item) => item.scenario === 'flagship' && item.parameter === '0',
    );
    if (!low || !harsh) throw new Error('ai');
    expect(low.even.result.score).toBeLessThan(low.none.result.score);
    expect(low.focus.result.score).toBeGreaterThan(low.none.result.score);
    expect(harsh.even.result.score).toBeLessThan(harsh.none.result.score);
    expect(harsh.focus.inputs).toEqual(
      data.sweeps.aiValue.find((item) => item.scenario === 'flagship' && item.parameter === '5')
        ?.focus.inputs,
    );
    const full = data.sweeps.pool.find(
      (item) => item.scenario === 'flagship' && item.parameter === '12',
    );
    const extra = data.sweeps.pool.find(
      (item) => item.scenario === 'flagship' && item.parameter === '13',
    );
    if (!full || !extra) throw new Error('pool');
    expect(extra.focus.result.score).toBe(full.focus.result.score);
    expect(extra.focus.result.forfeited).toBe(1);
    expect(extra.focus.result.used).toBe(12);
    const base = create('RI-200', 'flagship');
    expect(create('RI-200', 'flagship', { pool: 6, penalty: 12 })).toEqual(base);
    expect(create('RI-200', 'flagship', { pool: -1, penalty: 1.5 })).toMatchObject({
      pool: 6,
      penalty: 12,
    });
    expect(create('RI-200', 'spread', { pool: 0, penalty: 0 })).toMatchObject({
      pool: 0,
      penalty: 0,
    });
    const seen = viewQuota(base, { human: 3, aiValue: { core: 4, platform: 1, product: 1 } });
    seen.aiValue.core = 99;
    expect(viewQuota(base).aiValue).toEqual({ core: 8, platform: 5, product: 5 });
    const small = create('RI-200', 'spread', { pool: 3 });
    expect(
      apply(small, { type: 'allocate', amounts: { core: 2, platform: 2, product: 2 }, reserve: 0 }),
    ).toBe(small);
  });

  it('要因比較の入力を再生すると差引が一致し、期末では同じ状態を返す', () => {
    const data = compareQuotaFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      const rates = { human: item.rules.human, aiValue: item.rules.aiValue };
      for (const strategy of ['focus', 'even', 'none'] as const) {
        const run = item[strategy];
        let state = create(data.conditions.seed, item.scenario, {
          pool: item.rules.pool,
          penalty: item.rules.penalty,
        });
        const snapshot = structuredClone(state);
        for (const input of run.inputs) {
          const previous = state;
          const before = structuredClone(state);
          expect(chooseQuotaAction(state, strategy)).toEqual(input);
          state = apply(state, input, rates);
          const restored = apply(JSON.parse(JSON.stringify(before)), input, rates);
          expect(previous).toEqual(before);
          expect(restored).toEqual(state);
        }
        expect(snapshot.tick).toBe(0);
        expect(snapshot.horizon).toBe(4);
        expect(summarizeQuota(state)).toEqual(run.result);
        expect(state.inputs).toEqual(run.inputs);
        expect(run.result.singleLedger).toBe(true);
        expect(apply(state, { type: 'tick' }, rates)).toBe(state);
      }
    }
  });
});
