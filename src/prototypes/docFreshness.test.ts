import { describe, expect, it } from 'vitest';
import {
  applyDocInput as apply,
  chooseDocAction,
  compareDocStrategies,
  createDocPrototype as create,
  summarizeDoc,
  viewDoc,
} from './docFreshness';
import comparison from '../../docs/prototypes/doc-freshness-comparison.json';

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
