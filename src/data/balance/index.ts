/** 型付きバランスレジストリの公開エントリ。 */
export {
  defineBalanceEntry,
  defineProbabilityDistribution,
  flattenBalanceEntries,
  validateBalanceRegistry,
} from './define';
export { MEMBER_BALANCE } from './member';
export { PROCESS_BALANCE } from './process';
export { ACTION_BALANCE, ACTION_BALANCE_BY_ID } from './actions';
export { CARD_BALANCE } from './cards';
export type { ActionRuntimeBalance } from './actions';
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
import { ACTION_BALANCE } from './actions';
import { CARD_BALANCE } from './cards';
import type { BalanceDefinition } from './types';

/** 現時点でゲームが参照する全バランス定義。 */
export const BALANCE_REGISTRY = [
  ...Object.values(PROCESS_BALANCE),
  ...Object.values(MEMBER_BALANCE),
  ...Object.values(ACTION_BALANCE),
  ...Object.values(CARD_BALANCE),
] satisfies readonly BalanceDefinition[];
