import { describe, expect, it } from 'vitest';
import {
  applyDocInput as apply,
  chooseDocAction,
  compareDocFactorReversals,
  compareDocStrategies,
  createDocPrototype as create,
  summarizeDoc,
  viewDoc,
} from './docFreshness';
import comparison from '../../docs/prototypes/doc-freshness-comparison.json';
import factors from '../../docs/prototypes/doc-freshness-factor-comparison.json';

describe('RI-192 古いドキュメントの罠', () => {
  it('仕様変更だけが仕様書を古くし、時間経過や増刷では鮮度が戻らない', () => {
    let stable = apply(create('RI-192', 'stable'), { type: 'add' });
    for (let count = 0; count < 5; count += 1) stable = apply(stable, { type: 'use' });
    expect(stable).toMatchObject({ tick: 6, quantity: 1, freshness: 'fresh', value: 25 });
    expect(stable.resolutions.some((line) => line.includes('stale'))).toBe(false);
    let changed = apply(apply(create('RI-192', 'changed'), { type: 'add' }), { type: 'use' });
    expect(changed.freshness).toBe('fresh');
    const beforeAdd = changed.value;
    changed = apply(changed, { type: 'add' });
    expect(changed).toMatchObject({ quantity: 2, freshness: 'stale', value: beforeAdd });
    expect(changed.resolutions[changed.resolutions.length - 1]).toBe(
      't3:add,stale:spec-change,qty:2,freshness:stale',
    );
    const ignored = apply(
      apply(apply(create('RI-192', 'changed'), { type: 'use' }), { type: 'use' }),
      {
        type: 'use',
      },
    );
    expect(ignored.resolutions[2]).toBe('t3:use,change:no-doc,score:2,freshness:none');
    expect(ignored.freshness).toBe('none');
  });

  it('更新は古い仕様書だけを新しさへ戻し、新しい仕様書や未作成への更新は拒否する', () => {
    const fresh = apply(create('RI-192', 'changed'), { type: 'add' });
    expect(apply(fresh, { type: 'refresh' })).toBe(fresh);
    const empty = create('RI-192', 'changed');
    expect(apply(empty, { type: 'refresh' })).toBe(empty);
    const stale = apply(apply(fresh, { type: 'use' }), { type: 'use' });
    expect(stale.freshness).toBe('stale');
    const restored = apply(stale, { type: 'refresh' });
    expect(restored).toMatchObject({ quantity: 1, freshness: 'fresh', value: stale.value });
    expect(restored.resolutions[restored.resolutions.length - 1]).toBe(
      't4:refresh,qty:1,freshness:fresh',
    );
    const full = apply(restored, { type: 'add' });
    expect(apply(full, { type: 'add' })).toBe(full);
  });

  it('閲覧では鮮度も時間も動かず、期末の操作は無消費で拒否する', () => {
    const initial = create('RI-192', 'stable');
    const before = structuredClone(initial);
    for (let count = 0; count < 30; count += 1) viewDoc(initial);
    expect(initial).toEqual(before);
    const viewed = viewDoc(initial);
    expect(viewed.scores).toEqual({ fresh: 5, none: 2, stale: -4 });
    viewed.scores.none = 99;
    const used = apply(initial, { type: 'use' });
    expect(used.value).toBe(2);
    expect(used.resolutions[0]).toBe('t1:use,score:2,freshness:none');
    const ended = { ...initial, tick: initial.horizon };
    expect(apply(ended, { type: 'add' })).toBe(ended);
    expect(apply(ended, { type: 'use' })).toBe(ended);
    expect(apply(ended, { type: 'refresh' })).toBe(ended);
  });

  it('安定局面は1枚の維持、仕様変更後は更新が有力で、増刷は鮮度を戻さない', () => {
    const rows = compareDocStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (scenario: string, strategy: string) =>
      rows.find((row) => row.scenario === scenario && row.strategy === strategy)!.result.netValue;
    expect([
      net('stable', 'add'),
      net('stable', 'refresh'),
      net('stable', 'expand'),
      net('stable', 'ignore'),
    ]).toEqual([25, 25, 20, 12]);
    expect([
      net('changed', 'refresh'),
      net('changed', 'ignore'),
      net('changed', 'add'),
      net('changed', 'expand'),
    ]).toEqual([21, 16, -19, -24]);
    const refreshed = rows.find((row) => row.scenario === 'changed' && row.strategy === 'refresh')!;
    expect(refreshed.result).toMatchObject({ quantity: 1, freshness: 'fresh' });
    const expanded = rows.find((row) => row.scenario === 'changed' && row.strategy === 'expand')!;
    expect(expanded.result).toMatchObject({ quantity: 2, freshness: 'stale' });
    const calm = rows.find((row) => row.scenario === 'stable' && row.strategy === 'add')!;
    expect(calm.result.freshness).toBe('fresh');
    expect(calm.result.resolutions.some((line) => line.includes('stale'))).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致する', () => {
    for (const row of compareDocStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(chooseDocAction(previous, row.strategy)).toEqual(input);
      }
      expect(summarizeDoc(live)).toEqual(row.result);
      const again = row.inputs.reduce((state, input) => apply(state, input), row.initial);
      expect(again).toEqual(live);
    }
  });
});

describe('RI-192 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareDocFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-192',
      scenario: 'changed',
      horizon: 8,
      quantityCap: 2,
      addTickScores: false,
      refreshTickScores: false,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    const nets = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((item) => [
        item.parameter,
        item.refresh.result.netValue,
        item.add.result.netValue,
        item.preference,
      ]);
    expect(nets('changeAt')).toEqual([
      ['1', 35, 35, 'tie'],
      ['2', 21, -28, 'refresh'],
      ['3', 21, -19, 'refresh'],
      ['4', 21, -10, 'refresh'],
      ['5', 21, -1, 'refresh'],
      ['6', 21, 8, 'refresh'],
      ['7', 21, 17, 'refresh'],
      ['8', 26, 26, 'tie'],
    ]);
    expect(nets('staleScore')).toEqual([
      ['-8', 17, -43, 'refresh'],
      ['-4', 21, -19, 'refresh'],
      ['-2', 23, -7, 'refresh'],
      ['0', 25, 5, 'refresh'],
      ['2', 27, 17, 'refresh'],
      ['3', 28, 23, 'refresh'],
      ['4', 29, 29, 'tie'],
      ['5', 30, 35, 'add'],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['changeAt', '1', 'tie', '2', 'refresh'],
      ['changeAt', '7', 'refresh', '8', 'tie'],
      ['staleScore', '3', 'refresh', '4', 'tie'],
      ['staleScore', '4', 'tie', '5', 'add'],
    ]);
    expect(
      data.reversals.some((item) => item.after.preference === 'add' && item.axis === 'changeAt'),
    ).toBe(false);
  });

  it('基準行は初回の更新と1枚のままと一致し、動かした規則は一つである', () => {
    const data = compareDocFactorReversals();
    const first = compareDocStrategies(comparison.seed);
    for (const point of [
      data.sweeps.changeAt.find((item) => item.parameter === '3'),
      data.sweeps.staleScore.find((item) => item.parameter === '-4'),
    ]) {
      if (!point) throw new Error('baseline');
      expect(point.sameAsFirstComparison).toBe(true);
      expect(point.rules).toEqual({ changeAt: 3, fresh: 5, none: 2, stale: -4 });
      for (const strategy of ['refresh', 'add'] as const) {
        const row = first.find((item) => item.scenario === 'changed' && item.strategy === strategy);
        if (!row) throw new Error('first');
        expect(point[strategy].inputs).toEqual(row.inputs);
        expect(point[strategy].result).toEqual(row.result);
      }
    }
    expect(first.some((row) => row.scenario === 'stable' && row.strategy === 'expand')).toBe(true);
    expect(first.some((row) => row.strategy === 'ignore')).toBe(true);
    expect(Object.keys(data.sweeps)).toEqual(['changeAt', 'staleScore']);
    for (const item of data.sweeps.changeAt) {
      expect(item.rules).toMatchObject({ fresh: 5, none: 2, stale: -4 });
      expect(item.rules.changeAt).toBe(Number(item.parameter));
      expect(item.refresh.result.tick).toBe(8);
      expect(item.add.result.quantity).toBe(1);
    }
    for (const item of data.sweeps.staleScore) {
      expect(item.rules).toMatchObject({ changeAt: 3, fresh: 5, none: 2 });
      expect(item.rules.stale).toBe(Number(item.parameter));
      expect(item.sameAsFirstComparison).toBe(item.parameter === '-4');
    }
    const early = data.sweeps.changeAt.find((item) => item.parameter === '1');
    expect(early?.refresh.inputs).toEqual(early?.add.inputs);
    expect(early?.refresh.result.freshness).toBe('fresh');
    expect(early?.refresh.result.resolutions.some((line) => line.includes('stale'))).toBe(false);
    expect(early?.refresh.result.resolutions[0]).toBe('t1:add,change:no-doc,qty:1,freshness:fresh');
    const late = data.sweeps.changeAt.find((item) => item.parameter === '8');
    expect(late?.refresh.inputs).toEqual(late?.add.inputs);
    expect(late?.refresh.inputs.some((input) => input.type === 'refresh')).toBe(false);
    expect(late?.add.result.freshness).toBe('stale');
    const harsh = data.sweeps.staleScore.find((item) => item.parameter === '-8');
    const flipped = data.sweeps.staleScore.find((item) => item.parameter === '5');
    expect(harsh?.preference).toBe('refresh');
    expect(flipped?.refresh.inputs).toEqual(harsh?.refresh.inputs);
    expect(flipped?.refresh.inputs.filter((input) => input.type === 'refresh')).toHaveLength(1);
    expect(create('RI-192', 'stable', 4).changeAt).toBe(0);
    expect(create('RI-192', 'changed').changeAt).toBe(3);
  });

  it('要因比較の入力を再生すると差引が一致し、期末では同じ状態を返す', () => {
    const data = compareDocFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      const scores = { fresh: item.rules.fresh, none: item.rules.none, stale: item.rules.stale };
      for (const strategy of ['refresh', 'add'] as const) {
        const run = item[strategy];
        let state = create(data.conditions.seed, 'changed', item.rules.changeAt);
        const snapshot = structuredClone(state);
        for (const input of run.inputs) {
          const previous = state;
          const before = structuredClone(state);
          expect(chooseDocAction(state, strategy)).toEqual(input);
          state = apply(state, input, scores);
          const restored = apply(JSON.parse(JSON.stringify(before)), input, scores);
          expect(previous).toEqual(before);
          expect(restored).toEqual(state);
        }
        expect(snapshot.tick).toBe(0);
        expect(snapshot.horizon).toBe(8);
        expect(summarizeDoc(state)).toEqual(run.result);
        expect(state.inputs).toEqual(run.inputs);
        expect(apply(state, { type: 'use' }, scores)).toBe(state);
      }
    }
  });
});
