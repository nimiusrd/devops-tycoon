/**
 * バランスレジストリで扱う値の単位。
 *
 * 数値の意味をレビュー時に判別しやすくするため、値の種別ではなく
 * ゲーム内での単位を明示する。
 */
export type BalanceUnit =
  | 'probability'
  | 'multiplier'
  | 'ticks'
  | 'points'
  | 'milliseconds'
  | 'count'
  | 'percent'
  | 'currency';

/** 値に許可する下限と上限。 */
export interface BalanceAllowedRange {
  readonly min: number;
  readonly max: number;
}

/** 型付きバランスレジストリの最小単位。 */
export interface BalanceEntry<
  Id extends string = string,
  Unit extends BalanceUnit = BalanceUnit,
  Value extends number = number,
> {
  /** ドキュメント・差分・将来のルールセット指紋で使う安定ID。 */
  readonly id: Id;
  /** ゲームが参照する実行値。 */
  readonly value: Value;
  readonly unit: Unit;
  readonly allowedRange: BalanceAllowedRange;
  readonly label: string;
  readonly description: string;
  readonly tags: readonly string[];
  /** 他の基本値から導出された値かどうか。 */
  readonly derived: boolean;
  /** 離散的な回数・tick など、整数値のみを許可する。 */
  readonly integer?: boolean;
}

/** 確率分布を構成する、個別の確率エントリー。 */
export type ProbabilityDistributionEntry<Id extends string = string> = BalanceEntry<
  Id,
  'probability'
>;

/**
 * 複数の確率エントリーから成る分布定義。
 *
 * 個々の `entries` は通常の `BalanceEntry` なので、値・単位・説明を
 * 分布の各要素にも残せる。
 */
export interface ProbabilityDistribution<Id extends string = string> {
  readonly id: Id;
  readonly unit: 'probability';
  readonly allowedRange: BalanceAllowedRange;
  readonly label: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly derived: boolean;
  readonly entries: readonly ProbabilityDistributionEntry[];
}

/** レジストリに置ける定義。 */
export type BalanceDefinition = BalanceEntry | ProbabilityDistribution;

/** 定義検証で返す、機械的に判定可能なエラー種別。 */
export type BalanceValidationErrorCode =
  | 'duplicate-id'
  | 'non-finite-value'
  | 'non-integer-value'
  | 'non-finite-range'
  | 'range-inverted'
  | 'related-range-inverted'
  | 'related-total-invalid'
  | 'value-out-of-range'
  | 'probability-out-of-range'
  | 'distribution-weight-not-positive'
  | 'distribution-total-invalid';

/** バランス定義の不変条件違反。 */
export interface BalanceValidationError {
  readonly code: BalanceValidationErrorCode;
  readonly id: string;
  readonly message: string;
}
