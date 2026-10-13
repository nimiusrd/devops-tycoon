/**
 * #573 throwaway R&D — frozen comparison parameters.
 * Phase 1: do not retune after seeing results. Production paths stay untouched.
 */

export const FROZEN = Object.freeze({
  version: 1,
  issue: 573,
  basedOnIssue: 730,
  basedOnPrototype: 'src/prototypes/reviewBot.ts',
  seeds: Object.freeze(['RI-177', 'RI-573-a', 'RI-573-b', 'RI-573-c', 'RI-573-d']),
  compositions: Object.freeze(['routine-heavy', 'complex-heavy', 'half-half']),
  arms: Object.freeze(['coefficient', 'dedicated']),
  itemCount: 20,
  deadline: 12,
  staffSlots: 3,
  coefficient: 1.2,
  humanEffortPerTickHumanOnly: 3,
  humanEffortPerTickDedicated: 2,
  botEffortPerTickDedicated: 2,
  verificationPerTick: 2,
  dedicatedSetupHumanEffort: 2,
  falsePositiveRates: Object.freeze({
    default: 0.25,
    double: 0.5,
  }),
  rework: Object.freeze({
    triageEffort: 1,
    reviewEffort: 3,
  }),
  job: Object.freeze({
    routine: Object.freeze({ value: 2, humanLeft: 3, botLeft: 1 }),
    complex: Object.freeze({ value: 5, humanLeft: 6, botLeft: 1 }),
  }),
  botEligibleKind: 'routine',
  halfHalfPattern: 'alternate-routine-first',
  metrics: Object.freeze({
    primary: 'shippedCount',
    secondary: 'medianReviewWaitTicks',
  }),
});

export function compositionKinds(composition, itemCount = FROZEN.itemCount) {
  if (composition === 'routine-heavy') return Array.from({ length: itemCount }, () => 'routine');
  if (composition === 'complex-heavy') return Array.from({ length: itemCount }, () => 'complex');
  if (composition === 'half-half') {
    if (itemCount % 2 !== 0) {
      throw new Error('half-half は偶数件数が必要です');
    }
    return Array.from({ length: itemCount }, (_, id) => (id % 2 === 0 ? 'routine' : 'complex'));
  }
  throw new Error(`未知の composition: ${composition}`);
}

export function falsePositiveRateList() {
  return [FROZEN.falsePositiveRates.default, FROZEN.falsePositiveRates.double];
}
