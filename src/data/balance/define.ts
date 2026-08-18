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
  ['member.growth.promotion.middleLevel', 'member.growth.promotion.seniorLevel'],
  ['member.growth.xp.gainMinimum', 'member.growth.xp.gainMaximum'],
  ['member.formation.coding.speedMinimum', 'member.formation.coding.speedMaximum'],
  ['member.formation.review.efficiencyMinimum', 'member.formation.review.efficiencyMaximum'],
  ['member.formation.reviewCapacity.minimum', 'member.formation.reviewCapacity.maximum'],
  ['member.formation.reworkRate.minimum', 'member.formation.reworkRate.maximum'],
  ['member.formation.incidentRate.minimum', 'member.formation.incidentRate.maximum'],
  ['member.formation.codingSlotBonus.minimum', 'member.formation.codingSlotBonus.maximum'],
] as const;

/** 合計が固定される係数の組み合わせ。 */
const FIXED_TOTAL_PAIRS = [
  ['process.review.hpEfficiency.floor', 'process.review.hpEfficiency.range', 1],
] as const;

/** 指定したエントリーに適用される関係制約を、パラメータ表向けに返す。 */
export function balanceEntryConstraintLabels(entryId: string): readonly string[] {
  const ordered = ORDERED_BOUND_PAIRS.filter(
    ([minimumId, maximumId]) => minimumId === entryId || maximumId === entryId,
  ).map(([minimumId, maximumId]) => `\`${minimumId}\` ≤ \`${maximumId}\``);
  const fixedTotals = FIXED_TOTAL_PAIRS.filter(
    ([firstId, secondId]) => firstId === entryId || secondId === entryId,
  ).map(([firstId, secondId, total]) => `\`${firstId}\` + \`${secondId}\` = ${total}`);

  return [...ordered, ...fixedTotals];
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
  if (entry.unit === 'probability' && (entry.value < 0 || entry.value > 1)) {
    errors.push(
      validationError(
        'probability-out-of-range',
        entry.id,
        '確率は 0 以上 1 以下でなければなりません。',
      ),
    );
  }
  return errors;
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

  return errors;
}
