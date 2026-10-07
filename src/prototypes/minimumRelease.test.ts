import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/minimum-release-comparison.json';
import {
  compareMinimumReleaseStrategies,
  createMinimumReleasePrototype,
  summarizeMinimumRelease,
  tickMinimumReleasePrototype,
  type MinimumReleaseInput,
} from './minimumRelease';

function publishCore() {
  let state = createMinimumReleasePrototype('RI-158', 'roomy');
  for (let i = 0; i < 3; i++)
    state = tickMinimumReleasePrototype(state, { kind: 'work', id: 'core' });
  return state;
}
describe('RI-158 最低限使える版', () => {
  it('必須公開前の追加着手と先送りを拒否する', () => {
    const state = createMinimumReleasePrototype(1, 'tight');
    expect(tickMinimumReleasePrototype(state, { kind: 'work', id: 'extra' })).toBe(state);
    expect(tickMinimumReleasePrototype(state, { kind: 'defer' })).toBe(state);
  });
  it('必須だけで出荷し、先送り後も巻き戻さず約束と代償を残す', () => {
    const core = publishCore();
    expect(summarizeMinimumRelease(core).edition).toBe('minimum');
    const deferred = tickMinimumReleasePrototype(core, { kind: 'defer' });
    expect(deferred.released).toEqual([{ part: 'core', tick: 3, value: 6 }]);
    expect(deferred.trust).toBe(4);
    expect(summarizeMinimumRelease(deferred).promise).toEqual({
      part: 'extra',
      deferred: true,
      workLeft: 4,
      additionalValue: 10,
    });
    expect(tickMinimumReleasePrototype(deferred, { kind: 'work', id: 'extra' })).toBe(deferred);
    expect(tickMinimumReleasePrototype(deferred, { kind: 'defer' })).toBe(deferred);
    expect(core.extraDeferred).toBe(false);
    expect(core.trust).toBe(5);
  });
  it('完全版の出荷で必須の価値を重複加算しない', () => {
    let state = publishCore();
    for (let i = 0; i < 4; i++)
      state = tickMinimumReleasePrototype(state, { kind: 'work', id: 'extra' });
    expect(summarizeMinimumRelease(state)).toMatchObject({
      edition: 'full',
      value: 16,
      promise: null,
    });
    expect(state.released).toHaveLength(2);
    expect(tickMinimumReleasePrototype(state, { kind: 'work', id: 'extra' })).toBe(state);
    expect(tickMinimumReleasePrototype(state, { kind: 'defer' })).toBe(state);
  });
  it('逼迫では最低限版、余裕があれば完全版の価値が高くなる', () => {
    expect(compareMinimumReleaseStrategies(comparison.seed)).toEqual(comparison.results);
    const [tightFull, tightMinimum, roomyFull, roomyMinimum] = comparison.results;
    expect(tightMinimum.value).toBeGreaterThan(tightFull.value);
    expect(roomyFull.value).toBeGreaterThan(roomyMinimum.value);
    expect(tightMinimum.trust).toBeLessThan(tightFull.trust);
  });
  it('入力再生と先送り後の保存再開が一致し、期間終了後は変化しない', () => {
    const initial = createMinimumReleasePrototype('RI-158', 'roomy');
    const snapshot = structuredClone(initial);
    const inputs: MinimumReleaseInput[] = [
      ...Array.from({ length: 3 }, () => ({ kind: 'work' as const, id: 'core' })),
      { kind: 'defer' },
      { kind: 'work', id: 'urgent' },
      { kind: 'work', id: 'urgent' },
    ];
    const live = inputs.reduce(tickMinimumReleasePrototype, initial);
    const partial = inputs.slice(0, 4).reduce(tickMinimumReleasePrototype, initial);
    const restored = inputs
      .slice(4)
      .reduce(tickMinimumReleasePrototype, JSON.parse(JSON.stringify(partial)));
    expect(restored).toEqual(live);
    expect(initial).toEqual(snapshot);
    const ended = { ...live, board: { ...live.board, tick: live.board.horizon } };
    expect(tickMinimumReleasePrototype(ended, { kind: 'wait' })).toBe(ended);
    expect(tickMinimumReleasePrototype(initial, { kind: 'work', id: 'unknown' })).toBe(initial);
  });
});
