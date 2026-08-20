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
export { RUN_BALANCE } from './run';
export { OUTCOME_BALANCE } from './outcome';
export { CARD_BALANCE } from './cards';
export { SPRINT_BALANCE, SPRINT_TASK_KIND_WEIGHTS } from './sprint';
export { COARSE_TEAM_BALANCE } from './coarse-team';
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
import { RUN_BALANCE } from './run';
import { OUTCOME_BALANCE } from './outcome';
import { CARD_BALANCE } from './cards';
import { SPRINT_BALANCE } from './sprint';
import { COARSE_TEAM_BALANCE } from './coarse-team';
import type { BalanceDefinition } from './types';

/** 現時点でゲームが参照する全バランス定義。 */
export const BALANCE_REGISTRY = [
  ...Object.values(PROCESS_BALANCE),
  ...Object.values(MEMBER_BALANCE),
  ...Object.values(ACTION_BALANCE),
  ...Object.values(RUN_BALANCE),
  ...Object.values(OUTCOME_BALANCE),
  ...Object.values(CARD_BALANCE),
  ...Object.values(SPRINT_BALANCE),
  ...Object.values(COARSE_TEAM_BALANCE),
] satisfies readonly BalanceDefinition[];
