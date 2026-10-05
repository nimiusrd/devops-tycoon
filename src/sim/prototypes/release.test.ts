import { describe, expect, it } from 'vitest';
import comparison from '../../../docs/prototypes/release-comparison.json';
import {
  compareReleaseStrategies,
  createReleasePrototype,
  summarizeRelease,
  tickReleasePrototype,
} from './release';

describe('大型リリース段階戦の試作', () => {
  it('設計記録の比較結果を同じseed・資源制約から再生成できる', () => {
    for (const scenario of comparison) {
      expect(compareReleaseStrategies(scenario.seed, scenario.config)).toEqual(scenario.results);
    }
    const [, late, continuous] = comparison[1].results;
    expect(late.delivered).toBeGreaterThan(continuous.delivered);
    expect(late.unverified).toBeLessThan(continuous.unverified);
  });
  it('同じseedと入力で再現し、JSON保存から同じ結果へ再開する', () => {
    let state = createReleasePrototype('RI-252');
    for (let tick = 0; tick < 5; tick += 1) state = tickReleasePrototype(state, tick === 3);
    let restored = JSON.parse(JSON.stringify(state));
    while (state.tick < state.config.deadline) {
      state = tickReleasePrototype(state);
      restored = tickReleasePrototype(restored);
    }
    expect(restored).toEqual(state);
    expect(compareReleaseStrategies('RI-252')).toEqual(compareReleaseStrategies('RI-252'));
    expect(tickReleasePrototype(state, true)).toEqual(state);
  });

  it('凍結後は新規着手せず、着手済みだけ完了し、凍結を変更できない', () => {
    const initial = createReleasePrototype(1);
    initial.features[0].implementationLeft = 3;
    const started = tickReleasePrototype(initial);
    const frozen = tickReleasePrototype(started, true);
    expect(initial.features[0].started).toBe(false);
    expect(frozen.features[0].implementationLeft).toBe(0);
    expect(frozen.features.slice(1).every((feature) => !feature.started)).toBe(true);
    expect(tickReleasePrototype(frozen, true).frozenAt).toBe(1);
  });

  it('実装・レビュー・最終検証を同一tickで通過せず、未検証を出荷しない', () => {
    const state = createReleasePrototype(1);
    state.features = [
      {
        id: 0,
        value: 5,
        implementationLeft: 1,
        reviewLeft: 1,
        verificationLeft: 1,
        started: false,
      },
    ];
    const implemented = tickReleasePrototype(state);
    const reviewed = tickReleasePrototype(implemented);
    expect(summarizeRelease(implemented).delivered).toBe(0);
    expect(summarizeRelease(reviewed).delivered).toBe(0);
    expect(summarizeRelease(tickReleasePrototype(reviewed)).delivered).toBe(5);
  });

  it('変更継続も自動凍結で終了し、早期凍結との機会費用を比較できる', () => {
    const [early, late, continuous] = compareReleaseStrategies('RI-252');
    expect(early.deferred).toBeGreaterThan(late.deferred);
    expect(continuous.automaticFreeze).toBe(true);
    expect(continuous.frozenAt).toBe(10);
    expect(continuous.delivered).toBeGreaterThan(0);
    expect(continuous.implementationSpent).toBeGreaterThan(early.implementationSpent);
  });

  it('不正な期限・能力を拒否する', () => {
    expect(() =>
      createReleasePrototype(1, {
        deadline: 2,
        implementation: 2,
        review: 1,
        verification: 1,
      }),
    ).toThrow();
  });
});
