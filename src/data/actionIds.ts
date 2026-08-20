import { ACTION_CONTENT_DEFS } from './actions';

/** アクション ID の正本から導出した型と表示順。 */
export type ActionId = (typeof ACTION_CONTENT_DEFS)[number]['id'];

export const ACTION_IDS: readonly ActionId[] = ACTION_CONTENT_DEFS.map(({ id }) => id);
