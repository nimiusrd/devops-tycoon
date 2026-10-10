import { describe, expect, it } from 'vitest';
import {
  applyQuotaInput as apply,
  chooseQuotaAction,
  compareQuotaStrategies,
  createQuotaPrototype as create,
  summarizeQuota,
  viewQuota,
} from './quotaAllocation';
import comparison from '../../docs/prototypes/quota-allocation-comparison.json';

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
