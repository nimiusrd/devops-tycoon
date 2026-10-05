import { createRng, randInt } from '../rng';

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
  return [
    { strategy: 'early', freezeAt: 3 },
    { strategy: 'late', freezeAt: 8 },
    { strategy: 'continue', freezeAt: null },
  ].map(({ strategy, freezeAt }) => {
    let state = createReleasePrototype(seed, config);
    while (state.tick < config.deadline) {
      state = tickReleasePrototype(state, state.tick === freezeAt);
    }
    return { strategy, ...summarizeRelease(state) };
  });
}
