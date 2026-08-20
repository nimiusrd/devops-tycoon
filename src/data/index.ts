/**
 * データ駆動定義の公開エントリ。
 *
 * カード、介入、レリック、イベント、ボス、OKRテンプレート、進化、難易度、メンバーを
 * 宣言的に定義する。バランス調整は各ファイルの編集で完結する。
 */
export { CARD_DEFS, getCard, RARITY_LABEL, RARITY_WEIGHT } from './cards';
export { ACTION_DEFS, getAction } from './actions';
export { RELIC_DEFS, getRelic } from './relics';
export { EVENT_DEFS, getEvent, effectiveKind } from './events';
export type { EventDef, EventChoice, EventOutcome } from './events';
export { BOSS_DEFS, getBoss } from './bosses';
export { FALLBACK_OKR_TEMPLATE_ID, getOkrTemplateByBossId, OKR_TEMPLATES } from './okrTemplates';
export { EVOLUTION_NODES, getEvolutionNode, BRANCH_LABEL } from './evolution';
export {
  DAILY_RUN_DIFFICULTY,
  DAILY_RUN_TRIALS,
  DIFFICULTY_DEFS,
  DIFFICULTY_ORDER,
  getDifficulty,
  TRIAL_DEFS,
  getTrial,
} from './difficulties';
export { TRAIT_DEFS, getTrait, foldTraitModifiers } from './traits';
export { MEMBER_NAMES, STARTER_ARCHETYPES, RECRUIT_ARCHETYPES } from './members';
export * from './assets';
export * from './balance';
