import { describe, expect, it } from 'vitest';
import {
  baselineDepthRules,
  compareDepthAbortExamples,
  compareDepthFactorReversals,
  compareDepthStrategies,
  createDepthFactorState,
  createDepthPrototype,
  depthFactorResources,
  describeDepth,
  summarizeDepth,
  tickDepthPrototype,
  type ReviewImpact,
} from './reviewDepth';
import comparison from '../../docs/prototypes/review-depth-comparison.json';
import factors from '../../docs/prototypes/review-depth-factor-comparison.json';
describe('RI-162 レビュー深度', () => {
  it('公開情報と実際の時間・体力・損失が一致し途中変更は拒否する', () => {
    expect(describeDepth('high', 'focused')).toEqual({ ticks: 3, staminaPerTick: 2, riskLoss: 0 });
    expect(describeDepth('high', 'normal')).toEqual({ ticks: 1, staminaPerTick: 1, riskLoss: 8 });
    expect(describeDepth('low', 'normal').riskLoss).toBe(1);
    const initial = createDepthPrototype(1, 'high');
    const snapshot = structuredClone(initial);
    let state = tickDepthPrototype(initial, 'focused');
    expect(state.board.jobs[0]).toMatchObject({ stage: 'review', reviewLeft: 2 });
    expect(state.stamina).toBe(28);
    expect(tickDepthPrototype(state, 'normal')).toBe(state);
    state = tickDepthPrototype(tickDepthPrototype(state, 'continue'), 'continue');
    expect(state.board.jobs[0]).toMatchObject({ stage: 'ci', reviewLeft: 0 });
    expect(state.stamina).toBe(24);
    state = tickDepthPrototype(state, 'normal');
    expect(summarizeDepth(state)).toMatchObject({ done: ['a'], expectedLoss: 0 });
    expect(initial).toEqual(snapshot);
  });
  it('資源不足・深度未選択・期末を無消費で拒否する', () => {
    const initial = createDepthPrototype(1, 'high');
    expect(tickDepthPrototype(initial, 'continue')).toBe(initial);
    const tired = { ...initial, stamina: 1 };
    expect(tickDepthPrototype(tired, 'focused')).toBe(tired);
    const ended = { ...initial, board: { ...initial.board, tick: initial.board.horizon } };
    expect(tickDepthPrototype(ended, 'normal')).toBe(ended);
  });
  it('低影響は通常、高影響は重点が有利になる同条件比較を再現する', () => {
    expect(compareDepthStrategies(comparison.seed)).toEqual(comparison.results);
    const [lowNormal, lowFocused, highNormal, highFocused] = comparison.results;
    expect(lowNormal.result.netValue).toBeGreaterThan(lowFocused.result.netValue);
    expect(highFocused.result.netValue).toBeGreaterThan(highNormal.result.netValue);
    expect(highFocused.result.stamina).toBeLessThan(highNormal.result.stamina);
    const [mixedNormal, mixedFocused, selective] = comparison.results.slice(4);
    expect(selective.result.netValue).toBeGreaterThan(mixedNormal.result.netValue);
    expect(selective.result.netValue).toBeGreaterThan(mixedFocused.result.netValue);
  });
  it('重点レビュー途中・CI待ちの保存再開と入力再生が一致する', () => {
    for (const row of comparison.results) {
      let live = createDepthPrototype(comparison.seed, row.impact as 'low' | 'high' | 'mixed');
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        live = tickDepthPrototype(live, input as 'normal' | 'focused' | 'continue');
        restored = tickDepthPrototype(
          JSON.parse(JSON.stringify(restored)),
          input as 'normal' | 'focused' | 'continue',
        );
      }
      expect(restored).toEqual(live);
      expect(summarizeDepth(live)).toEqual(row.result);
    }
  });
});

const low: [ReviewImpact, ReviewImpact, ReviewImpact] = ['low', 'low', 'low'];
const high: [ReviewImpact, ReviewImpact, ReviewImpact] = ['high', 'high', 'high'];

describe('RI-162 要因を一つずつ動かした再計算', () => {
  const rows = compareDepthFactorReversals(comparison.seed);
  const pair = (factor: string, level: string, board: string) => {
    const normal = rows.find(
      (row) =>
        row.factor === factor &&
        row.level === level &&
        row.board === board &&
        row.strategy === 'normal',
    )!;
    const focused = rows.find(
      (row) =>
        row.factor === factor &&
        row.level === level &&
        row.board === board &&
        row.strategy === 'focused',
    )!;
    const winner =
      normal.result.netValue === focused.result.netValue
        ? 'tie'
        : normal.result.netValue > focused.result.netValue
          ? 'normal'
          : 'focused';
    return { normal, focused, winner };
  };
  const legacy = (impact: 'low' | 'high' | 'mixed', depth: 'normal' | 'focused') =>
    comparison.results.find((row) => row.impact === impact && row.depth === depth)!;

  it('対照行は初回の一律通常・一律重点と一致し、高だけ重点は再計算しない', () => {
    for (const [factor, level, board, impact] of [
      ['residual', '0', 'low', 'low'],
      ['residual', '0', 'high', 'high'],
      ['forecast', 'none', 'low', 'low'],
      ['forecast', 'none', 'high', 'high'],
      ['composition', 'LLL', 'LLL', 'low'],
      ['composition', 'LHL', 'LHL', 'mixed'],
      ['composition', 'HHH', 'HHH', 'high'],
      ['focusedTicks', '3', 'low', 'low'],
      ['normalTicks', '1', 'high', 'high'],
      ['horizon', '6', 'low', 'low'],
      ['recovery', '0', 'high', 'high'],
      ['abort', 'false', 'low', 'low'],
      ['reviewers', '1', 'high', 'high'],
    ] as const) {
      for (const strategy of ['normal', 'focused'] as const) {
        const row = pair(factor, level, board)[strategy];
        expect(row.inputs).toEqual(legacy(impact, strategy).inputs);
        expect(row.result).toEqual(legacy(impact, strategy).result);
        expect(row.initial.stamina).toBe(depthFactorResources.stamina);
        expect(row.initial.board.capacity).toBe(depthFactorResources.capacity);
        expect(row.initial.board.budget).toBe(depthFactorResources.budget);
      }
    }
    expect([...new Set(rows.map((row) => row.strategy))].sort()).toEqual(['focused', 'normal']);
    expect(factors.seed).toBe(comparison.seed);
    expect(factors.resources).toEqual(depthFactorResources);
    expect(rows).toEqual(factors.results);
  });

  it('軽減率と予告の外れは同点までで、通常と重点の勝ち負けは反転しない', () => {
    for (const level of ['0', '0.25', '0.5', '0.75', '1']) {
      expect(pair('residual', level, 'low').winner).toBe('normal');
    }
    expect(pair('residual', '0', 'high').focused.result.netValue).toBe(-4);
    expect(pair('residual', '0.5', 'high').focused.result.netValue).toBe(-8);
    expect(pair('residual', '1', 'high').winner).toBe('tie');
    expect(pair('residual', '0.75', 'high').winner).toBe('focused');
    for (const level of ['none', 'a', 'b', 'c', 'all']) {
      expect(pair('forecast', level, 'low').winner).toBe('normal');
    }
    expect(pair('forecast', 'b', 'high').focused.result.netValue).toBe(-4);
    expect(pair('forecast', 'c', 'high').focused.result.netValue).toBe(-4);
    expect(pair('forecast', 'a', 'high').winner).toBe('tie');
    expect(pair('forecast', 'all', 'high').winner).toBe('tie');
    expect(describeDepth('high', 'focused', baselineDepthRules, 'low').riskLoss).toBe(8);
    expect(
      describeDepth('high', 'focused', { ...baselineDepthRules, residual: 0.5 }, 'high').riskLoss,
    ).toBe(4);
  });

  it('高影響が2件以上で重点が上になり、仕事の位置では差引が変わらない', () => {
    for (const board of ['LLL', 'HLL', 'LHL', 'LLH']) {
      expect(pair('composition', board, board).winner).toBe('normal');
    }
    for (const board of ['HHL', 'HLH', 'LHH', 'HHH']) {
      expect(pair('composition', board, board).winner).toBe('focused');
    }
    expect(pair('composition', 'LLL', 'LLL').normal.result.netValue).toBe(9);
    expect(pair('composition', 'HLL', 'HLL').normal.result.netValue).toBe(2);
    expect(pair('composition', 'LHL', 'LHL').normal.result.netValue).toBe(2);
    expect(pair('composition', 'LLH', 'LLH').normal.result.netValue).toBe(2);
    expect(pair('composition', 'HHL', 'HHL').normal.result.netValue).toBe(-5);
    expect(pair('composition', 'LHH', 'LHH').normal.result.netValue).toBe(-5);
    expect(pair('composition', 'HLH', 'HLH').focused.result.netValue).toBe(-4);
    expect(pair('composition', 'HHH', 'HHH').focused.result.netValue).toBe(-4);
  });

  it('工数・期限・担当数では全件低の優劣が反転し、回復と中止しない固定戦略では反転しない', () => {
    expect(pair('focusedTicks', '1', 'low')).toMatchObject({
      winner: 'focused',
      focused: { result: { netValue: 12, done: ['a', 'b', 'c'] } },
    });
    expect(pair('focusedTicks', '2', 'low').winner).toBe('normal');
    expect(pair('focusedTicks', '2', 'low').focused.result.netValue).toBe(4);
    expect(pair('focusedTicks', '4', 'low').winner).toBe('normal');
    expect(pair('focusedTicks', '4', 'low').focused.result.netValue).toBe(-4);
    expect(pair('normalTicks', '2', 'low').winner).toBe('normal');
    expect(pair('normalTicks', '2', 'low').normal.result.netValue).toBe(2);
    expect(pair('normalTicks', '3', 'low')).toMatchObject({
      winner: 'focused',
      normal: { result: { netValue: -5 } },
      focused: { result: { netValue: -4 } },
    });
    expect(pair('horizon', '2', 'high').winner).toBe('tie');
    expect(pair('horizon', '2', 'low').winner).toBe('normal');
    expect(pair('horizon', '9', 'low').normal.result.netValue).toBe(3);
    expect(pair('horizon', '9', 'low').focused.result.netValue).toBe(-2);
    expect(pair('horizon', '10', 'low')).toMatchObject({
      winner: 'focused',
      normal: { result: { netValue: 1, cost: 20 } },
      focused: { result: { netValue: 4, cost: 20, done: ['a', 'b', 'c'] } },
    });
    expect(pair('reviewers', '2', 'low').winner).toBe('normal');
    expect(pair('reviewers', '2', 'low').focused.result).toMatchObject({
      netValue: 4,
      done: ['a', 'b'],
    });
    expect(pair('reviewers', '3', 'low')).toMatchObject({
      winner: 'focused',
      focused: { result: { netValue: 12, done: ['a', 'b', 'c'] } },
    });
    expect(pair('reviewers', '3', 'low').focused.initial.board.capacity).toBe(2);
    for (const board of ['low', 'high'] as const) {
      const rest = pair('recovery', '1', board);
      const base = pair('recovery', '0', board);
      expect(rest.normal.result.netValue).toBe(base.normal.result.netValue);
      expect(rest.focused.result.netValue).toBe(base.focused.result.netValue);
      expect(rest.winner).toBe(base.winner);
      expect(rest.normal.result.stamina).toBeGreaterThan(base.normal.result.stamina);
      expect(pair('abort', 'true', board).normal.result).toEqual(
        pair('abort', 'false', board).normal.result,
      );
      expect(pair('abort', 'true', board).focused.result).toEqual(
        pair('abort', 'false', board).focused.result,
      );
      expect(pair('abort', 'true', board).focused.inputs).not.toContain('abort');
    }
  });

  it('体力0でも回復1なら通常を始められ、中止は時間を進めず末尾へ戻す', () => {
    const tired = createDepthPrototype(comparison.seed, 'low');
    tired.stamina = 0;
    expect(tickDepthPrototype(tired, 'normal')).toBe(tired);
    const rested = createDepthFactorState(
      comparison.seed,
      low,
      { ...baselineDepthRules, recovery: 1 },
      low,
    );
    rested.stamina = 0;
    const resumed = tickDepthPrototype(rested, 'normal');
    expect(resumed.board.tick).toBe(1);
    expect(resumed.stamina).toBe(0);
    expect(resumed.choices.a).toBe('normal');
    const blocked = createDepthFactorState(comparison.seed, high, baselineDepthRules, high);
    const started = tickDepthPrototype(blocked, 'focused');
    expect(tickDepthPrototype(started, 'abort')).toBe(started);
    const aborting = createDepthFactorState(
      comparison.seed,
      low,
      { ...baselineDepthRules, abort: true },
      low,
    );
    let state = tickDepthPrototype(aborting, 'focused');
    expect(state.stamina).toBe(28);
    state = tickDepthPrototype(state, 'abort');
    expect(state.board.tick).toBe(1);
    expect(state.stamina).toBe(28);
    expect(state.board.jobs.map((job) => job.id)).toEqual(['b', 'c', 'a']);
    expect(state.choices).toEqual({});
    expect(state.board.jobs[2]).toMatchObject({ id: 'a', stage: 'review', reviewLeft: -1 });
    for (const input of ['normal', 'normal', 'normal', 'continue', 'continue'] as const) {
      state = tickDepthPrototype(state, input);
    }
    expect(summarizeDepth(state)).toMatchObject({
      done: ['b', 'c', 'a'],
      expectedLoss: 3,
      netValue: 9,
      stamina: 25,
    });
    let harsh = tickDepthPrototype(
      tickDepthPrototype(
        createDepthFactorState(comparison.seed, high, { ...baselineDepthRules, abort: true }, high),
        'focused',
      ),
      'abort',
    );
    for (const input of ['normal', 'normal', 'normal', 'continue', 'continue'] as const) {
      harsh = tickDepthPrototype(harsh, input);
    }
    expect(summarizeDepth(harsh).netValue).toBe(-12);
    expect(compareDepthAbortExamples(factors.seed)).toEqual(factors.abortExamples);
    expect(
      factors.abortExamples.map((row) => [
        row.board,
        row.result.netValue,
        row.result.stamina,
        row.result.done,
      ]),
    ).toEqual([
      ['low', 9, 25, ['b', 'c', 'a']],
      ['high', -12, 25, ['b', 'c', 'a']],
    ]);
  });

  it('要因比較も毎入力のJSON保存再開と再生が一致し、期限か予算で止まる', () => {
    for (const row of rows) {
      let live = createDepthFactorState(
        comparison.seed,
        [row.initial.impacts.a, row.initial.impacts.b, row.initial.impacts.c],
        row.initial.rules!,
        [row.initial.announced!.a, row.initial.announced!.b, row.initial.announced!.c],
      );
      expect(live).toEqual(row.initial);
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = tickDepthPrototype(live, input);
        saved = tickDepthPrototype(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeDepth(live)).toEqual(row.result);
      expect(
        live.board.tick === live.board.horizon || live.board.budget < live.board.capacity,
      ).toBe(true);
    }
  });

  it('担当3は同じtickで3件のレビューを進め、CI枠は2のまま', () => {
    const parallel = createDepthFactorState(
      comparison.seed,
      high,
      { ...baselineDepthRules, reviewers: 3 },
      high,
    );
    const once = tickDepthPrototype(parallel, 'focused');
    expect(once.board.capacity).toBe(2);
    expect(once.board.jobs.map((job) => job.reviewLeft)).toEqual([2, 2, 2]);
    expect(once.stamina).toBe(24);
    expect(once.choices).toEqual({ a: 'focused', b: 'focused', c: 'focused' });
  });
});
