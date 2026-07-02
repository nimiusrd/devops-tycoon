/**
 * データ駆動定義の公開エントリ。
 *
 * カード（第7章）・介入アクション（第6章）に加え、Phase 3 で
 * レリック（第8章）・イベント（第9章）・ボス（第10章）・進化ツリー（第11章）・
 * 難易度/試練（第16章）を、Phase 4 でメンバートレイト・アーキタイプ（第12章）を
 * 宣言的に追加した。バランス調整は各ファイルの編集で完結する。
 */
export { CARD_DEFS, getCard, RARITY_LABEL, RARITY_WEIGHT } from './cards';
export { ACTION_DEFS, getAction } from './actions';
export { RELIC_DEFS, getRelic } from './relics';
export { EVENT_DEFS, getEvent, effectiveKind } from './events';
export type { EventDef, EventChoice, EventOutcome } from './events';
export { BOSS_DEFS, getBoss } from './bosses';
export { EVOLUTION_NODES, getEvolutionNode, BRANCH_LABEL } from './evolution';
export { DIFFICULTY_DEFS, getDifficulty, TRIAL_DEFS, getTrial } from './difficulties';
export { TRAIT_DEFS, getTrait, foldTraitModifiers } from './traits';
export { MEMBER_NAMES, STARTER_ARCHETYPES, RECRUIT_ARCHETYPES } from './members';
