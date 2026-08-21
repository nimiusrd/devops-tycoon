import type {
  BalanceDefinition,
  BalanceEntry,
  BalanceValidationError,
  ProbabilityDistribution,
} from './types';

/** 浮動小数点の確率分布合計を比較する許容誤差。 */
const PROBABILITY_TOTAL_EPSILON = 1e-9;

/** 同時に clamp 境界として使う値の順序関係。 */
const ORDERED_BOUND_PAIRS = [
  ['process.rework.minimum', 'process.rework.maximum'],
  ['process.incident.minimum', 'process.incident.maximum'],
  ['process.security.level.minimum', 'process.security.level.maximum'],
  ['process.security.rivalLevel.minimum', 'process.security.level.maximum'],
  ['process.security.fragility.minimum', 'process.security.fragility.maximum'],
  ['member.growth.xp.gainMinimum', 'member.growth.xp.gainMaximum'],
  ['member.formation.coding.speedMinimum', 'member.formation.coding.speedMaximum'],
  ['member.formation.review.efficiencyMinimum', 'member.formation.review.efficiencyMaximum'],
  ['member.formation.reviewCapacity.minimum', 'member.formation.reviewCapacity.maximum'],
  ['member.formation.reworkRate.minimum', 'member.formation.reworkRate.maximum'],
  ['member.formation.incidentRate.minimum', 'member.formation.incidentRate.maximum'],
  ['member.formation.codingSlotBonus.minimum', 'member.formation.codingSlotBonus.maximum'],
  ['action.task.progress.minimum', 'action.task.progress.maximum'],
  ['action.organizationStat.minimum', 'action.organizationStat.maximum'],
  ['action.firefight.seniorHpCost', 'action.firefight.seniorHpCostMaximum'],
  ['action.firefight.seniorHpCostMaximum', 'action.firefight.lightSeniorHpCost'],
  ['action.assignTask.idealMoraleMinimum', 'action.assignTask.moraleCost'],
  ['card.effect.multiplier.minimum', 'card.effect.multiplier.maximum'],
  ['card.effect.reworkRateAdd.minimum', 'card.effect.reworkRateAdd.maximum'],
  ['card.effect.additive.minimum', 'card.effect.additive.maximum'],
  ['outcome.kpi.exceededLowerMultiplier', 'outcome.kpi.exceededHigherMultiplier'],
  ['sprint.grade.stabilizingBonusPerGrant', 'sprint.grade.stabilizingBonusCap'],
  ['coarse.team.rival.moraleMinimum', 'coarse.team.rival.moraleMaximum'],
  ['coarse.team.rival.aiLiteracyMinimum', 'coarse.team.rival.aiLiteracyMaximum'],
  ['coarse.team.rival.seniorHpMinimum', 'coarse.team.rival.seniorHpMaximum'],
  ['coarse.team.rival.testCoverageMinimum', 'coarse.team.rival.testCoverageMaximum'],
  ['coarse.team.rival.documentationMinimum', 'coarse.team.rival.documentationMaximum'],
  ['coarse.team.rival.qualityMinimum', 'coarse.team.rival.qualityMaximum'],
  ['coarse.team.capacity.review.minimum', 'coarse.team.capacity.review.maximum'],
  ['coarse.team.capacity.incident.minimum', 'coarse.team.capacity.incident.maximum'],
  ['coarse.team.step.review.multiplierMinimum', 'coarse.team.step.review.multiplierMaximum'],
  [
    'coarse.team.step.reviewCapacity.multiplierMinimum',
    'coarse.team.step.reviewCapacity.multiplierMaximum',
  ],
  ['coarse.team.step.reworkRateAdd.minimum', 'coarse.team.step.reworkRateAdd.maximum'],
  ['coarse.team.step.morale.minimum', 'coarse.team.step.morale.maximum'],
  [
    'coarse.team.step.seniorHpCost.multiplierMinimum',
    'coarse.team.step.seniorHpCost.multiplierMaximum',
  ],
  ['coarse.team.step.fire.multiplierMinimum', 'coarse.team.step.fire.multiplierMaximum'],
  ['coarse.team.step.fire.chanceMinimum', 'coarse.team.step.fire.chanceMaximum'],
  [
    'coarse.team.step.aiDependency.pressureMinimum',
    'coarse.team.step.aiDependency.pressureMaximum',
  ],
  ['coarse.team.step.quality.minimum', 'coarse.team.step.quality.maximum'],
  ['coarse.team.step.seniorHp.minimum', 'coarse.team.step.seniorHp.maximum'],
  [
    'coarse.team.aggregate.reviewResilience.minimum',
    'coarse.team.aggregate.reviewResilience.maximum',
  ],
  ['pacing.target.sprintWall.absoluteMinMs', 'pacing.target.sprintWall.minTypicalMs'],
  ['pacing.target.sprintWall.minTypicalMs', 'pacing.target.sprintWall.maxTypicalMs'],
  ['pacing.target.bossWall.minMs', 'pacing.target.bossWall.maxMs'],
  ['pacing.target.quarterWall.minMs', 'pacing.target.quarterWall.maxMs'],
  ['pacing.target.runWall.minMs', 'pacing.target.runWall.maxMs'],
  ['pacing.target.interventionPerSprint.min', 'pacing.target.interventionPerSprint.max'],
  ['meta.reward.learningBase', 'meta.reward.learningCap'],
] as const;

/** 各段階を飛ばさないため、最小値が最大値より厳密に小さくなければならない関係。 */
const STRICTLY_ORDERED_BOUND_PAIRS = [
  ['member.growth.promotion.middleLevel', 'member.growth.promotion.seniorLevel'],
  ['run.event.softOutcome.loseThreshold', 'run.event.softOutcome.survivalFloor'],
  ['outcome.quarter.shutdown.trustMax', 'outcome.quarter.crisis.trustMax'],
  ['outcome.quarter.crisis.trustMax', 'outcome.quarter.reorg.trustMax'],
  ['sprint.grade.threshold.C', 'sprint.grade.threshold.B'],
  ['sprint.grade.threshold.B', 'sprint.grade.threshold.A'],
  ['sprint.grade.threshold.A', 'sprint.grade.threshold.S'],
  ['coarse.team.health.congested.queueMinimum', 'coarse.team.health.reviewHell.queueMinimum'],
  ['coarse.team.aggregate.healthRank.threshold.A', 'coarse.team.aggregate.healthRank.threshold.S'],
  ['coarse.team.aggregate.healthRank.threshold.B', 'coarse.team.aggregate.healthRank.threshold.A'],
  ['coarse.team.aggregate.healthRank.threshold.C', 'coarse.team.aggregate.healthRank.threshold.B'],
  ['coarse.team.industry.league.platinumMaximum', 'coarse.team.industry.league.goldMaximum'],
  ['coarse.team.industry.league.goldMaximum', 'coarse.team.industry.league.silverMaximum'],
  ['pacing.tick.sprint.minComplete', 'pacing.tick.boss.minComplete'],
  ['pacing.tick.boss.minComplete', 'pacing.tick.boss.maximum'],
] as const;

/** 合計が固定される係数の組み合わせ。 */
const FIXED_TOTAL_PAIRS = [
  ['process.review.hpEfficiency.floor', 'process.review.hpEfficiency.range', 1],
] as const;

const REVIEW_FREEZE_WARNING_IDS = [
  'outcome.lose.reviewFreezePeak',
  'outcome.warning.reviewFreeze.watchRatio',
  'outcome.warning.reviewFreeze.dangerOffset',
] as const;

const REVIEW_FREEZE_WARNING_CONSTRAINT =
  'Math.round(`outcome.lose.reviewFreezePeak` × `outcome.warning.reviewFreeze.watchRatio`) < `outcome.lose.reviewFreezePeak` - `outcome.warning.reviewFreeze.dangerOffset` < `outcome.lose.reviewFreezePeak`';

/** 指定したエントリーに適用される関係制約を、パラメータ表向けに返す。 */
export function balanceEntryConstraintLabels(entryId: string): readonly string[] {
  const ordered = ORDERED_BOUND_PAIRS.filter(
    ([minimumId, maximumId]) => minimumId === entryId || maximumId === entryId,
  ).map(([minimumId, maximumId]) => `\`${minimumId}\` ≤ \`${maximumId}\``);
  const strictlyOrdered = STRICTLY_ORDERED_BOUND_PAIRS.filter(
    ([minimumId, maximumId]) => minimumId === entryId || maximumId === entryId,
  ).map(([minimumId, maximumId]) => `\`${minimumId}\` < \`${maximumId}\``);
  const fixedTotals = FIXED_TOTAL_PAIRS.filter(
    ([firstId, secondId]) => firstId === entryId || secondId === entryId,
  ).map(([firstId, secondId, total]) => `\`${firstId}\` + \`${secondId}\` = ${total}`);

  const reviewFreezeWarning = REVIEW_FREEZE_WARNING_IDS.some((id) => id === entryId)
    ? [REVIEW_FREEZE_WARNING_CONSTRAINT]
    : [];

  return [...ordered, ...strictlyOrdered, ...fixedTotals, ...reviewFreezeWarning];
}

/** 定義時にリテラル型を保つスカラー値ヘルパー。 */
export function defineBalanceEntry<const Entry extends BalanceEntry>(entry: Entry): Entry {
  return entry;
}

/** 定義時にリテラル型を保つ確率分布ヘルパー。 */
export function defineProbabilityDistribution<const Distribution extends ProbabilityDistribution>(
  distribution: Distribution,
): Distribution {
  return distribution;
}

/** 分布内の値を含め、ゲームが参照するスカラーエントリーへ平坦化する。 */
export function flattenBalanceEntries(
  definitions: readonly BalanceDefinition[],
): readonly BalanceEntry[] {
  const entries: BalanceEntry[] = [];
  for (const definition of definitions) {
    if ('entries' in definition) {
      entries.push(...definition.entries);
    } else {
      entries.push(definition);
    }
  }
  return entries;
}

function validationError(
  code: BalanceValidationError['code'],
  id: string,
  message: string,
): BalanceValidationError {
  return { code, id, message };
}

function validateRange(
  id: string,
  range: { readonly min: number; readonly max: number },
): BalanceValidationError[] {
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) {
    return [validationError('non-finite-range', id, '許容範囲は有限値でなければなりません。')];
  }
  if (range.min > range.max) {
    return [validationError('range-inverted', id, '許容範囲の最小値が最大値を超えています。')];
  }
  return [];
}

function validateEntry(entry: BalanceEntry): BalanceValidationError[] {
  const errors = validateRange(entry.id, entry.allowedRange);
  if (!Number.isFinite(entry.value)) {
    errors.push(validationError('non-finite-value', entry.id, '値は有限値でなければなりません。'));
    return errors;
  }
  if (entry.integer && !Number.isInteger(entry.value)) {
    errors.push(validationError('non-integer-value', entry.id, '値は整数でなければなりません。'));
  }
  if (entry.value < entry.allowedRange.min || entry.value > entry.allowedRange.max) {
    errors.push(validationError('value-out-of-range', entry.id, '値が許容範囲外です。'));
  }
  if (
    (entry.unit === 'probability' || entry.unit === 'ratio') &&
    (entry.value < 0 || entry.value > 1)
  ) {
    errors.push(
      validationError(
        entry.unit === 'ratio' ? 'ratio-out-of-range' : 'probability-out-of-range',
        entry.id,
        entry.unit === 'ratio'
          ? '割合は 0 以上 1 以下でなければなりません。'
          : '確率は 0 以上 1 以下でなければなりません。',
      ),
    );
  }
  return errors;
}

function validateReviewFreezeWarningOrder(
  entriesById: ReadonlyMap<string, BalanceEntry>,
): BalanceValidationError[] {
  const peak = entriesById.get('outcome.lose.reviewFreezePeak');
  const watchRatio = entriesById.get('outcome.warning.reviewFreeze.watchRatio');
  const dangerOffset = entriesById.get('outcome.warning.reviewFreeze.dangerOffset');
  if (!peak || !watchRatio || !dangerOffset) return [];

  const watchPeak = Math.round(peak.value * watchRatio.value);
  const dangerPeak = peak.value - dangerOffset.value;
  if (0 <= watchPeak && watchPeak < dangerPeak && dangerPeak < peak.value) return [];

  return [
    validationError(
      'related-range-inverted',
      watchRatio.id,
      `${REVIEW_FREEZE_WARNING_CONSTRAINT} を満たさなければなりません。`,
    ),
  ];
}

/**
 * レジストリの不変条件を検証する。
 *
 * 外部I/Oやグローバル状態を使わず、テストと将来の検証コマンドで共用できる。
 */
export function validateBalanceRegistry(
  definitions: readonly BalanceDefinition[],
): readonly BalanceValidationError[] {
  const errors: BalanceValidationError[] = [];
  const seenIds = new Set<string>();
  const registerId = (id: string): void => {
    if (seenIds.has(id)) {
      errors.push(validationError('duplicate-id', id, 'バランスIDが重複しています。'));
      return;
    }
    seenIds.add(id);
  };

  for (const definition of definitions) {
    registerId(definition.id);

    if (!('entries' in definition)) {
      errors.push(...validateEntry(definition));
      continue;
    }

    errors.push(...validateRange(definition.id, definition.allowedRange));
    let total = 0;
    for (const entry of definition.entries) {
      registerId(entry.id);
      errors.push(...validateEntry(entry));
      if (!Number.isFinite(entry.value) || entry.value <= 0) {
        errors.push(
          validationError(
            'distribution-weight-not-positive',
            entry.id,
            '確率分布の重みは有限の正数でなければなりません。',
          ),
        );
      } else {
        total += entry.value;
      }
    }
    if (Math.abs(total - 1) > PROBABILITY_TOTAL_EPSILON) {
      errors.push(
        validationError(
          'distribution-total-invalid',
          definition.id,
          '確率分布の重みの合計は 1 でなければなりません。',
        ),
      );
    }
  }

  const entriesById = new Map(flattenBalanceEntries(definitions).map((entry) => [entry.id, entry]));
  for (const [minimumId, maximumId] of ORDERED_BOUND_PAIRS) {
    const minimum = entriesById.get(minimumId);
    const maximum = entriesById.get(maximumId);
    if (!minimum || !maximum || minimum.value <= maximum.value) continue;
    errors.push(
      validationError(
        'related-range-inverted',
        minimumId,
        `${minimumId} は ${maximumId} 以下でなければなりません。`,
      ),
    );
  }

  for (const [minimumId, maximumId] of STRICTLY_ORDERED_BOUND_PAIRS) {
    const minimum = entriesById.get(minimumId);
    const maximum = entriesById.get(maximumId);
    if (!minimum || !maximum || minimum.value < maximum.value) continue;
    errors.push(
      validationError(
        'related-range-inverted',
        minimumId,
        `${minimumId} は ${maximumId} 未満でなければなりません。`,
      ),
    );
  }

  for (const [firstId, secondId, total] of FIXED_TOTAL_PAIRS) {
    const first = entriesById.get(firstId);
    const second = entriesById.get(secondId);
    if (
      !first ||
      !second ||
      Math.abs(first.value + second.value - total) <= PROBABILITY_TOTAL_EPSILON
    ) {
      continue;
    }
    errors.push(
      validationError(
        'related-total-invalid',
        firstId,
        `${firstId} と ${secondId} の合計は ${total} でなければなりません。`,
      ),
    );
  }

  errors.push(...validateReviewFreezeWarningOrder(entriesById));

  return errors;
}
