/** 型付きバランスレジストリの公開エントリ。 */
export {
  defineBalanceEntry,
  defineProbabilityDistribution,
  flattenBalanceEntries,
  validateBalanceRegistry,
} from './define';
export { MEMBER_BALANCE } from './member';
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

import { MEMBER_BALANCE } from './member';
import { PROCESS_BALANCE } from './process';
import type { BalanceDefinition } from './types';

/** 現時点でゲームが参照する全バランス定義。 */
export const BALANCE_REGISTRY = [
  ...Object.values(PROCESS_BALANCE),
  ...Object.values(MEMBER_BALANCE),
] satisfies readonly BalanceDefinition[];
