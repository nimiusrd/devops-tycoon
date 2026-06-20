/**
 * データ駆動定義の公開エントリ。
 *
 * カード（第7章）・介入アクション（第6章）を宣言的に置き、バランス調整を
 * コード変更なしで行えるようにする。レリック（第8章）・イベント（第9章）・
 * ボス（第10章）は Phase 3 以降で追加する。
 */
export { CARD_DEFS, getCard, RARITY_LABEL, RARITY_WEIGHT } from './cards';
export { ACTION_DEFS, getAction } from './actions';
