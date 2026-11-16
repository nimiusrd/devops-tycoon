import { describe, expect, it } from 'vitest';
import {
  applyReusableInput as apply,
  baselineAssetRules,
  compareReusableFactorReversals,
  compareReusableStrategies,
  createReusablePrototype as create,
  summarizeReusable,
  viewReusable,
  type AssetInput,
  type AssetScenario,
} from './reusableAsset';
import comparison from '../../docs/prototypes/reusable-asset-comparison.json';
import factors from '../../docs/prototypes/reusable-asset-factor-comparison.json';

describe('RI-180 再利用資産', () => {
  it('同じseedの初期状態は一致し、閲覧は資産の古さだけを足して状態を変えない', () => {
    const state = create(1, 'repeat');
    expect(create(1, 'repeat')).toEqual(state);
    expect(create(2, 'repeat').seed).toBe(2);
    const before = structuredClone(state);
    expect(viewReusable(state).stale).toBe(false);
    expect(state).toEqual(before);
  });
  it('新鮮な資産は同種だけを速くし、無関係な仕事は速度1のまま', () => {
    const base = create(1, 'single');
    const matching = apply(
      {
        ...base,
        asset: 'fresh',
        jobs: [{ id: 'm', kind: 'matching', effort: 4, progress: 0, value: 6 }],
      },
      { type: 'tick' },
    );
    const other = apply(
      {
        ...base,
        asset: 'fresh',
        jobs: [{ id: 'o', kind: 'other', effort: 4, progress: 0, value: 6 }],
      },
      { type: 'tick' },
    );
    expect(matching.jobs[0].progress).toBe(2);
    expect(other.jobs[0].progress).toBe(1);
    expect(viewReusable(matching).jobs[0].speed).toBe(2);
    expect(viewReusable(other).jobs[0].speed).toBe(1);
  });
  it('前提変更で古さが表示され、更新・見送り・継続利用が一度だけ定義どおり進む', () => {
    let state = apply(create(1, 'stale-few'), { type: 'build' });
    while (viewReusable(state).asset !== 'stale-held') state = apply(state, { type: 'tick' });
    const seen = viewReusable(state);
    expect(seen.stale).toBe(true);
    expect(seen.premiseVersion).toBe(1);
    expect(seen.assetPremise).toBe(0);
    expect(apply(state, { type: 'build' })).toBe(state);
    const retired = apply(state, { type: 'retire' });
    expect(retired.asset).toBe('retired');
    expect(viewReusable(retired).stale).toBe(false);
    expect(apply(retired, { type: 'update' })).toBe(retired);
    expect(apply(retired, { type: 'continue-stale' })).toBe(retired);
    const continued = apply(state, { type: 'continue-stale' });
    expect(continued.asset).toBe('stale-used');
    expect(apply(continued, { type: 'continue-stale' })).toBe(continued);
    const updating = apply(state, { type: 'update' });
    expect(updating.focusSpent).toBe(state.focusSpent + 1);
    expect(updating.busy).toEqual({ kind: 'update', remaining: 4 });
    let done = updating;
    while (done.busy) done = apply(done, { type: 'tick' });
    expect(done.asset).toBe('fresh');
    expect(done.assetPremise).toBe(1);
    expect(done.updateTicksSpent).toBe(4);
    const sped = apply(
      { ...done, jobs: [{ id: 'm', kind: 'matching', effort: 4, progress: 0, value: 6 }] },
      { type: 'tick' },
    );
    expect(sped.jobs[0].progress).toBe(2);
    expect(sped.stalePenalty).toBe(0);
  });
  it('継続利用は同種の完成だけに古さの損失を足し、整備中は出荷しない', () => {
    const stale = {
      ...create(1, 'single'),
      asset: 'stale-used' as const,
      premiseVersion: 1,
      jobs: [
        { id: 'm', kind: 'matching' as const, effort: 2, progress: 0, value: 6 },
        { id: 'o', kind: 'other' as const, effort: 2, progress: 0, value: 6 },
      ],
    };
    let state = apply(apply(stale, { type: 'tick' }), { type: 'tick' });
    expect(state.earnedValue).toBe(6);
    expect(state.stalePenalty).toBe(2);
    state = apply(apply(state, { type: 'tick' }), { type: 'tick' });
    expect(state.earnedValue).toBe(12);
    expect(state.stalePenalty).toBe(2);
    const building = apply(create(1, 'repeat'), { type: 'build' });
    const during = apply(building, { type: 'tick' });
    expect(during.jobs.every((item) => item.progress === 0)).toBe(true);
    expect(during.buildTicksSpent).toBe(1);
    const view = viewReusable(during);
    expect(view.jobs.every((item) => item.speed === 0)).toBe(true);
    expect(view.busy).toEqual({ kind: 'build', remaining: 3 });
    expect(view.busy).not.toBe(during.busy);
    view.busy!.remaining = 0;
    expect(during.busy?.remaining).toBe(3);
  });
  it('整備の二重開始・資源不足・期末の操作は無消費で拒否する', () => {
    const built = apply(create(1, 'repeat'), { type: 'build' });
    expect(apply(built, { type: 'build' })).toBe(built);
    const poor = { ...create(1, 'repeat'), focus: 0 };
    expect(apply(poor, { type: 'build' })).toBe(poor);
    const fresh = { ...create(1, 'repeat'), asset: 'fresh' as const };
    expect(apply(fresh, { type: 'update' })).toBe(fresh);
    expect(apply(fresh, { type: 'retire' })).toBe(fresh);
    const ended = { ...create(1, 'repeat'), tick: 20 };
    for (const type of ['build', 'update', 'retire', 'continue-stale', 'tick'] as const)
      expect(apply(ended, { type })).toBe(ended);
  });
  it('単発は直接納品、反復は整備、残件の多少で更新と見送りが入れ替わる', () => {
    const rows = compareReusableStrategies();
    expect(rows).toEqual(comparison.results);
    const net = (scenario: string, strategy: string) =>
      rows.find((row) => row.scenario === scenario && row.strategy === strategy)!.result.netValue;
    expect(net('single', 'direct')).toBe(12);
    expect(net('single', 'build')).toBe(11);
    expect(net('repeat', 'direct')).toBe(30);
    expect(net('repeat', 'build')).toBe(47);
    expect(net('stale-many', 'update')).toBe(40);
    expect(net('stale-many', 'continue')).toBe(33);
    expect(net('stale-many', 'retire')).toBe(29);
    expect(net('stale-few', 'retire')).toBe(17);
    expect(net('stale-few', 'update')).toBe(16);
    expect(net('stale-few', 'continue')).toBe(13);
    expect(rows.find((row) => row.scenario === 'stale-few')!.initial.horizon).toBe(24);
    expect(rows.find((row) => row.scenario === 'stale-many')!.initial.horizon).toBe(24);
    const built = rows.find((row) => row.scenario === 'repeat' && row.strategy === 'build')!;
    expect(built.result.buildTicksSpent).toBe(4);
    expect(built.result.focusSpent).toBe(1);
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、元状態を変えない', () => {
    for (const row of compareReusableStrategies()) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeReusable(live)).toEqual(row.result);
    }
  });
  it('速度を上げても無関係な仕事は進捗1で、損失と整備tickは規則を使う', () => {
    const rules = { buildTicks: 3, matchingSpeed: 5, stalePenalty: 7 };
    const matching = apply(
      {
        ...create(1, 'single'),
        rules,
        asset: 'fresh',
        jobs: [{ id: 'm', kind: 'matching', effort: 8, progress: 0, value: 6 }],
      },
      { type: 'tick' },
    );
    expect(matching.jobs[0].progress).toBe(5);
    expect(viewReusable(matching).jobs[0].speed).toBe(5);
    const other = apply(
      {
        ...create(1, 'single'),
        rules,
        asset: 'fresh',
        jobs: [{ id: 'o', kind: 'other', effort: 8, progress: 0, value: 6 }],
      },
      { type: 'tick' },
    );
    expect(other.jobs[0].progress).toBe(1);
    expect(viewReusable(other).jobs[0].speed).toBe(1);
    const staleOther = apply(
      {
        ...create(1, 'single'),
        rules,
        asset: 'stale-used',
        jobs: [{ id: 'o', kind: 'other', effort: 1, progress: 0, value: 6 }],
      },
      { type: 'tick' },
    );
    expect(staleOther.earnedValue).toBe(6);
    expect(staleOther.stalePenalty).toBe(0);
    const staleMatching = apply(
      {
        ...create(1, 'single'),
        rules,
        asset: 'stale-used',
        jobs: [{ id: 'm', kind: 'matching', effort: 5, progress: 0, value: 6 }],
      },
      { type: 'tick' },
    );
    expect(staleMatching.earnedValue).toBe(6);
    expect(staleMatching.stalePenalty).toBe(7);
    expect(apply({ ...create(1, 'repeat'), rules }, { type: 'build' }).busy).toEqual({
      kind: 'build',
      remaining: 3,
    });
    const absent = create(1, 'repeat');
    let plain = apply(absent, { type: 'build' });
    let ruled = apply(
      { ...create(1, 'repeat'), rules: { ...baselineAssetRules } },
      { type: 'build' },
    );
    expect(absent.rules).toBeUndefined();
    expect(plain.busy).toEqual({ kind: 'build', remaining: 4 });
    while (plain.tick < plain.horizon) {
      plain = apply(plain, { type: 'tick' });
      ruled = apply(ruled, { type: 'tick' });
    }
    expect(summarizeReusable(plain)).toEqual(summarizeReusable(ruled));
  });
});

describe('RI-180 要因を一つずつ動かした再計算', () => {
  const generated = compareReusableFactorReversals();
  const stored = {
    conditions: generated.conditions,
    reversals: generated.reversals,
    rows: generated.rows.map((row) => ({
      factor: row.factor,
      level: row.level,
      scenario: row.scenario,
      decision: row.decision,
      rules: row.rules,
      premiseChangeAt: row.premiseChangeAt,
      inputs: row.inputs.map((input) => input.type),
      result: row.result,
    })),
  };
  const skipNet = { single: 12, repeat: 30, 'stale-many': 36, 'stale-few': 18 };
  it('比較JSONと再計算が一致し、同点は無い', () => {
    expect(stored).toEqual(factors);
    for (const row of generated.rows) {
      if (row.decision !== 'maintain') continue;
      const skip = generated.rows.find(
        (item) =>
          item.factor === row.factor &&
          item.level === row.level &&
          item.scenario === row.scenario &&
          item.decision === 'skip',
      );
      expect(row.result.netValue).not.toBe(skip?.result.netValue);
    }
  });
  it('対照は初回の直接・整備・継続利用と一致し、更新と見送りは出さない', () => {
    const baseline = (scenario: string, decision: 'skip' | 'maintain') =>
      generated.rows.find(
        (row) =>
          row.factor === 'buildTicks' &&
          row.level === '4' &&
          row.scenario === scenario &&
          row.decision === decision,
      );
    const same = (scenario: string, strategy: string, decision: 'skip' | 'maintain') => {
      const prior = comparison.results.find(
        (row) => row.scenario === scenario && row.strategy === strategy,
      );
      const next = baseline(scenario, decision);
      expect(next?.inputs).toEqual(prior?.inputs);
      expect(next?.result).toEqual(prior?.result);
    };
    same('single', 'direct', 'skip');
    same('single', 'build', 'maintain');
    same('repeat', 'direct', 'skip');
    same('repeat', 'build', 'maintain');
    same('stale-many', 'continue', 'maintain');
    same('stale-few', 'continue', 'maintain');
    for (const row of generated.rows) {
      const sample = create(1, row.scenario);
      const moved = [
        row.rules.buildTicks !== baselineAssetRules.buildTicks,
        row.rules.matchingSpeed !== baselineAssetRules.matchingSpeed,
        row.rules.stalePenalty !== baselineAssetRules.stalePenalty,
        row.premiseChangeAt !== sample.premiseChangeAt,
      ].filter(Boolean).length;
      expect(moved).toBeLessThanOrEqual(1);
      expect(row.inputs.some((input) => input.type === 'update' || input.type === 'retire')).toBe(
        false,
      );
      if (row.decision === 'skip') {
        expect(row.inputs.every((input) => input.type === 'tick')).toBe(true);
        expect(row.result.netValue).toBe(skipNet[row.scenario]);
      } else expect(row.inputs[0]?.type).toBe('build');
      const level =
        row.factor === 'premiseChangeAt'
          ? sample.premiseChangeAt === null
            ? 'none'
            : String(sample.premiseChangeAt)
          : String(baselineAssetRules[row.factor]);
      if (row.level !== level) continue;
      expect(row.inputs).toEqual(baseline(row.scenario, row.decision)?.inputs);
      expect(row.result).toEqual(baseline(row.scenario, row.decision)?.result);
    }
  });
  it('優劣が反転する隣り合う水準だけを記録する', () => {
    expect(
      generated.reversals.map((item) => [
        item.factor,
        item.scenario,
        item.from.level,
        item.from.winner,
        item.from.maintain,
        item.from.skip,
        item.to.level,
        item.to.winner,
        item.to.maintain,
        item.to.skip,
      ]),
    ).toEqual([
      ['buildTicks', 'single', '2', 'maintain', 17, 12, '3', 'skip', 11, 12],
      ['matchingSpeed', 'single', '3', 'skip', 11, 12, '4', 'maintain', 17, 12],
      ['buildTicks', 'repeat', '8', 'maintain', 35, 30, '9', 'skip', 29, 30],
      ['matchingSpeed', 'repeat', '1', 'skip', 23, 30, '2', 'maintain', 47, 30],
      ['premiseChangeAt', 'repeat', '4', 'maintain', 47, 30, '5', 'skip', 27, 30],
      ['premiseChangeAt', 'repeat', '8', 'skip', 29, 30, '9', 'maintain', 31, 30],
      ['buildTicks', 'stale-many', '1', 'maintain', 37, 36, '2', 'skip', 35, 36],
      ['buildTicks', 'stale-many', '7', 'skip', 31, 36, '8', 'maintain', 47, 36],
      ['buildTicks', 'stale-many', '10', 'maintain', 41, 36, '11', 'skip', 35, 36],
      ['matchingSpeed', 'stale-many', '3', 'skip', 35, 36, '4', 'maintain', 37, 36],
      ['stalePenalty', 'stale-many', '1', 'maintain', 40, 36, '2', 'skip', 33, 36],
      ['premiseChangeAt', 'stale-many', '4', 'maintain', 47, 36, '5', 'skip', 31, 36],
      ['premiseChangeAt', 'stale-many', '10', 'skip', 35, 36, '11', 'maintain', 37, 36],
    ]);
    expect(generated.reversals.some((item) => item.scenario === 'stale-few')).toBe(false);
    expect(
      generated.reversals.some(
        (item) =>
          item.factor === 'stalePenalty' &&
          (item.scenario === 'single' || item.scenario === 'repeat'),
      ),
    ).toBe(false);
  });
  it('保存した入力列を再生すると差引が一致し、無関係な仕事は速度1を超えない', () => {
    for (const row of factors.rows) {
      let live = create(factors.conditions.seed, row.scenario as AssetScenario);
      live.premiseChangeAt = row.premiseChangeAt;
      live.rules = { ...row.rules };
      let saved = structuredClone(live);
      for (const type of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        const input = { type: type as AssetInput['type'] };
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        live.jobs.forEach((job, index) => {
          const delta = job.progress - before.jobs[index].progress;
          if (job.kind === 'other') expect(delta).toBeLessThanOrEqual(1);
          if (delta > 1) expect(job.kind).toBe('matching');
        });
      }
      expect(summarizeReusable(live)).toEqual(row.result);
    }
  });
});
