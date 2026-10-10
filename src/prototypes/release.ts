import { createRng, randInt } from '../sim/rng';

/** RI-252: 本番のボス・保存形式から独立した段階戦の比較用モデル。 */
export interface ReleaseConfig {
  deadline: number;
  implementation: number;
  review: number;
  verification: number;
}

export interface ReleaseFeature {
  id: number;
  value: number;
  implementationLeft: number;
  reviewLeft: number;
  verificationLeft: number;
  started: boolean;
}

export interface ReleaseState {
  version: 1;
  tick: number;
  config: ReleaseConfig;
  frozenAt: number | null;
  automaticFreeze: boolean;
  features: ReleaseFeature[];
  implementationSpent: number;
  validationSpent: number;
}

export const RELEASE_CONFIG: ReleaseConfig = {
  deadline: 12,
  implementation: 2,
  review: 1,
  verification: 1,
};

/** #648 再評価と #729 と同じ seed。条件定義のみで比較結果は持たない。 */
export const RELEASE_REEVAL_SEED = 'RI-252';

/** PR #729 の検証不足（3/3/1）条件。再評価の比較基準。 */
export const RELEASE_REEVAL_BASELINE: ReleaseConfig = {
  deadline: 12,
  implementation: 3,
  review: 3,
  verification: 1,
};

/**
 * #648 再評価 Phase 1 の3条件。値は条件の意味から決め、比較結果は見ない。
 * 手戻り規則は追加せず、既存の期限・実装・レビュー・最終検証だけを1つずつ変える。
 */
export const RELEASE_REEVAL_CONDITIONS: {
  scenario: 'deadline-shortened' | 'review-shortage' | 'heavy-rework';
  config: ReleaseConfig;
}[] = [
  {
    // 公開期限だけを12の2/3へ縮める。人員は検証不足のまま。
    scenario: 'deadline-shortened',
    config: { deadline: 8, implementation: 3, review: 3, verification: 1 },
  },
  {
    // レビューだけを最小の1にする。期限と実装・最終検証は基準のまま。
    scenario: 'review-shortage',
    config: { deadline: 12, implementation: 3, review: 1, verification: 1 },
  },
  {
    // 手戻り規則は増やさない。実装能力だけ+2し、実装済みの残件を増やす。
    scenario: 'heavy-rework',
    config: { deadline: 12, implementation: 5, review: 3, verification: 1 },
  },
];

export function createReleasePrototype(
  seed: string | number,
  config: ReleaseConfig = RELEASE_CONFIG,
): ReleaseState {
  if (
    !Number.isInteger(config.deadline) ||
    config.deadline < 3 ||
    [config.implementation, config.review, config.verification].some(
      (capacity) => !Number.isInteger(capacity) || capacity < 1,
    )
  ) {
    throw new Error('期限は3tick以上、各工程の能力は正の整数で指定してください');
  }
  const rng = createRng(seed);
  return {
    version: 1,
    tick: 0,
    config: { ...config },
    frozenAt: null,
    automaticFreeze: false,
    features: Array.from({ length: 12 }, (_, id) => ({
      id,
      value: randInt(rng, 2, 5),
      implementationLeft: randInt(rng, 2, 4),
      reviewLeft: randInt(rng, 1, 2),
      verificationLeft: randInt(rng, 1, 2),
      started: false,
    })),
    implementationSpent: 0,
    validationSpent: 0,
  };
}

/** 入力はtick開始時に適用。工程間の移動は次tickから（2段階を飛ばせない）。 */
export function tickReleasePrototype(state: ReleaseState, freeze = false): ReleaseState {
  if (state.tick >= state.config.deadline) return state;
  const next: ReleaseState = {
    ...state,
    tick: state.tick + 1,
    features: state.features.map((feature) => ({ ...feature })),
  };
  // 凍結忘れで即敗北させない。期限の2tick前に自動凍結し検証窓を残す。
  if (state.frozenAt === null && (freeze || state.tick >= state.config.deadline - 2)) {
    next.frozenAt = state.tick;
    next.automaticFreeze = !freeze;
  }
  let implementation = state.config.implementation;
  let review = state.config.review;
  // 凍結後は実装担当の1能力を最終検証へ移す。着手済みは残りの能力で完了可能。
  let verification = state.config.verification;
  if (next.frozenAt !== null && implementation > 1) {
    implementation -= 1;
    verification += 1;
  }
  for (let i = 0; i < next.features.length; i += 1) {
    const before = state.features[i];
    const feature = next.features[i];
    if (before.implementationLeft > 0) {
      if (next.frozenAt !== null && !before.started) continue;
      const work = Math.min(implementation, before.implementationLeft);
      feature.started ||= work > 0;
      feature.implementationLeft -= work;
      implementation -= work;
      next.implementationSpent += work;
    } else if (before.reviewLeft > 0) {
      const work = Math.min(review, before.reviewLeft);
      feature.reviewLeft -= work;
      review -= work;
      next.validationSpent += work;
    } else if (before.verificationLeft > 0) {
      const work = Math.min(verification, before.verificationLeft);
      feature.verificationLeft -= work;
      verification -= work;
      next.validationSpent += work;
    }
  }
  return next;
}

export function summarizeRelease(state: ReleaseState) {
  const complete = (feature: ReleaseFeature) =>
    feature.implementationLeft + feature.reviewLeft + feature.verificationLeft === 0;
  return {
    delivered: state.features.filter(complete).reduce((sum, feature) => sum + feature.value, 0),
    unverified: state.features.filter(
      (feature) => feature.implementationLeft === 0 && !complete(feature),
    ).length,
    unfinished: state.features.filter(
      (feature) => feature.started && feature.implementationLeft > 0,
    ).length,
    deferred: state.features.filter((feature) => !feature.started).length,
    implementationSpent: state.implementationSpent,
    validationSpent: state.validationSpent,
    frozenAt: state.frozenAt,
    automaticFreeze: state.automaticFreeze,
  };
}

export function compareReleaseStrategies(seed: string | number, config = RELEASE_CONFIG) {
  if (config.deadline < 4) throw new Error('三つの凍結時点を比較する期限は4tick以上');
  const late = Math.min(Math.floor((config.deadline * 2) / 3), config.deadline - 3);
  const early = Math.min(Math.floor(config.deadline / 4), late - 1);
  return [
    { strategy: 'early', freezeAt: early },
    { strategy: 'late', freezeAt: late },
    { strategy: 'continue', freezeAt: null },
  ].map(({ strategy, freezeAt }) => {
    let state = createReleasePrototype(seed, config);
    while (state.tick < config.deadline) {
      state = tickReleasePrototype(state, state.tick === freezeAt);
    }
    return { strategy, ...summarizeRelease(state) };
  });
}

/** #648 再評価 Phase 2: 凍結済み4条件を既存比較APIへ渡すだけ。規則は変えない。 */
export function compareReleaseReeval() {
  return [
    { scenario: 'verification-bottleneck' as const, config: RELEASE_REEVAL_BASELINE },
    ...RELEASE_REEVAL_CONDITIONS,
  ].map(({ scenario, config }) => ({
    scenario,
    seed: RELEASE_REEVAL_SEED,
    config,
    results: compareReleaseStrategies(RELEASE_REEVAL_SEED, config).map((row) => ({
      ...row,
      consumption: row.implementationSpent + row.validationSpent,
      // 既存比較は期限まで tick を進める。期限未達の敗北判定はない。
      deadlineMet: true,
    })),
  }));
}

export function evaluateReleaseReevalCriteria(
  rows: ReturnType<typeof compareReleaseReeval> = compareReleaseReeval(),
) {
  const created = rows.filter((row) => row.scenario !== 'verification-bottleneck');
  const passConditions = created
    .filter((row) => {
      const early = row.results.find((result) => result.strategy === 'early');
      if (!early) return false;
      const top = Math.max(...row.results.map((result) => result.delivered));
      return (
        early.delivered === top &&
        early.unverified === 0 &&
        row.results.every((result) => result.deadlineMet)
      );
    })
    .map((row) => row.scenario);
  const fail = created.every((row) => {
    const early = row.results.find((result) => result.strategy === 'early');
    const late = row.results.find((result) => result.strategy === 'late');
    return early !== undefined && late !== undefined && early.delivered <= late.delivered;
  });
  const pass = passConditions.length >= 1;
  return {
    pass,
    fail,
    passConditions,
    met: pass && fail ? 'pass-and-fail' : pass ? 'pass' : fail ? 'fail' : 'neither',
  };
}
