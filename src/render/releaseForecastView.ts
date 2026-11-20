import {
  releaseAutomaticFreezeTick,
  summarizeRelease,
  type ReleaseState,
} from '../prototypes/release';

/** RI-252の工程と予定を、進行速度に依存しない表示用の状態に変換する。 */
export function releaseForecastView(state: ReleaseState) {
  const { tick, config, frozenAt, automaticFreeze } = state;
  const remaining = config.deadline - tick;
  const phase = remaining === 0 ? 'release' : frozenAt === null ? 'add' : 'verify';
  const freezeTick = releaseAutomaticFreezeTick(config);
  const { delivered, unverified, unfinished, deferred } = summarizeRelease(state);
  const awaitingReview = state.features.filter(
    (feature) => feature.implementationLeft === 0 && feature.reviewLeft > 0,
  ).length;

  return {
    phase,
    remaining,
    freezeTick,
    frozenAt,
    automaticFreeze,
    ticksUntilFreeze: freezeTick - tick,
    delivered,
    awaitingReview,
    awaitingVerification: unverified - awaitingReview,
    unverified,
    unfinished,
    deferred,
  } as const;
}
