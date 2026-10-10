import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/release-comparison.json';
import reeval from '../../docs/prototypes/release-reeval-conditions.json';
import reevalComparison from '../../docs/prototypes/release-reeval-comparison.json';
import {
  RELEASE_REEVAL_BASELINE,
  RELEASE_REEVAL_CONDITIONS,
  RELEASE_REEVAL_SEED,
  compareReleaseReeval,
  compareReleaseStrategies,
  createReleasePrototype,
  evaluateReleaseReevalCriteria,
  summarizeRelease,
  tickReleasePrototype,
} from './release';

describe('大型リリース段階戦の試作', () => {
  it.each([4, 9, 12])('期限%itickでも自動凍結に先行する二つの手動凍結を比較する', (deadline) => {
    const results = compareReleaseStrategies(1, {
      deadline,
      implementation: 2,
      review: 1,
      verification: 1,
    });
    expect(results[0].frozenAt).toBeLessThan(results[1].frozenAt!);
    expect(results[1].frozenAt).toBeLessThan(results[2].frozenAt!);
    expect(results.map((result) => result.automaticFreeze)).toEqual([false, false, true]);
  });
  it('三つの異なる凍結時点を確保できない期限は比較で拒否する', () => {
    expect(() =>
      compareReleaseStrategies(1, { deadline: 3, implementation: 2, review: 1, verification: 1 }),
    ).toThrow();
  });
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

  it('再評価Phase1の3条件は#729と同じseedと基準人員から、結果を見ずに定義する', () => {
    const recorded = comparison.find((scenario) => scenario.scenario === 'verification-bottleneck');
    expect(RELEASE_REEVAL_SEED).toBe('RI-252');
    expect(reeval.seed).toBe(RELEASE_REEVAL_SEED);
    expect(reeval.phase).toBe(1);
    expect(RELEASE_REEVAL_BASELINE).toEqual(recorded?.config);
    expect(reeval.baseline.config).toEqual(RELEASE_REEVAL_BASELINE);
    expect(RELEASE_REEVAL_CONDITIONS.map(({ scenario, config }) => ({ scenario, config }))).toEqual(
      reeval.conditions.map(({ scenario, config }) => ({ scenario, config })),
    );
    for (const condition of reeval.conditions) {
      expect(condition.rationale.length).toBeGreaterThan(0);
      expect(createReleasePrototype(RELEASE_REEVAL_SEED, condition.config).config).toEqual(
        condition.config,
      );
    }
  });

  it('再評価Phase2は凍結済み4条件を同じseedで再生成し、ロック判定を照合する', () => {
    expect(reeval.conditions.map(({ scenario, config }) => ({ scenario, config }))).toEqual(
      RELEASE_REEVAL_CONDITIONS.map(({ scenario, config }) => ({ scenario, config })),
    );
    expect(compareReleaseReeval()).toEqual(reevalComparison.scenarios);
    expect(evaluateReleaseReevalCriteria()).toEqual(reevalComparison.criteria);
    expect(reevalComparison.scenarios.map((scenario) => scenario.config)).toEqual([
      RELEASE_REEVAL_BASELINE,
      ...RELEASE_REEVAL_CONDITIONS.map((condition) => condition.config),
    ]);
  });
});
