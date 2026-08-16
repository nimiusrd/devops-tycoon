/** 型付きバランスレジストリの公開エントリ。 */
export {
  defineBalanceEntry,
  defineProbabilityDistribution,
  flattenBalanceEntries,
  validateBalanceRegistry,
} from './define';
export { PROCESS_BALANCE } from './process';
export type {
  BalanceAllowedRange,
  BalanceDefinition,
  BalanceEntry,
  BalanceUnit,
  BalanceValidationError,
  BalanceValidationErrorCode,
  ProbabilityDistribution,
  ProbabilityDistributionEntry,
} from './types';

import type { BalanceDefinition } from './types';
import { PROCESS_BALANCE } from './process';

/** 現時点でゲームが参照する全バランス定義。 */
export const BALANCE_REGISTRY = [
  PROCESS_BALANCE.codingBaseTicks,
  PROCESS_BALANCE.aiCodingSpeedup,
  PROCESS_BALANCE.aiAdoption,
] as const satisfies readonly BalanceDefinition[];
