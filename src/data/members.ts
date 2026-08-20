/**
 * 個体メンバーの初期構成・採用候補のアーキタイプ定義（SPEC 第12章）。
 *
 * 個体の名前プールとアーキタイプ（初期ステータス・トレイト・推奨レーン）を
 * 宣言的に置く。生成ロジック（RNG 消費）は `src/sim/member/roster.ts` の純関数が
 * これを読んで担う。バランス調整・メンバー追加はこのファイルで完結（architecture §4.3）。
 */
import type { MemberRank, MemberStats } from '../sim/member/types';
import type { TraitId } from './traits';

/** アーキタイプ（個体の雛形）。生成時にレベル/スタミナを肉付けする。 */
export interface MemberArchetype {
  id: string;
  rank: MemberRank;
  stats: MemberStats;
  traits: TraitId[];
  /** 生成時の推奨レーン（初期編成のヒント）。 */
  preferred: 'coding' | 'review';
}

/** 表示名プール（採用・初期生成で順に/抽選で割り当てる）。 */
export const MEMBER_NAMES: string[] = [
  'アオイ',
  'ハルキ',
  'ミナ',
  'ソウタ',
  'リン',
  'カエデ',
  'ユウ',
  'ナギ',
  'ツバサ',
  'ヒナタ',
  'レン',
  'サキ',
];

/** 初期ロスターで AI を配布する既定アーキタイプ。 */
export const STARTER_DEFAULT_AI_ARCHETYPE_ID = 'starter-ai-junior';

/**
 * 初期ロスターのアーキタイプ（バランス型コーダー2 + レビュアー1）。
 * 既定編成で破綻しない、やや上振れ程度の手触りにする。
 */
export const STARTER_ARCHETYPES: MemberArchetype[] = [
  {
    id: 'starter-coder',
    rank: 'middle',
    stats: { implementation: 58, review: 40, aiMastery: 50 },
    traits: [],
    preferred: 'coding',
  },
  {
    id: 'starter-ai-junior',
    rank: 'junior',
    stats: { implementation: 48, review: 32, aiMastery: 62 },
    traits: ['aiArtisan'],
    preferred: 'coding',
  },
  {
    id: 'starter-reviewer',
    rank: 'senior',
    stats: { implementation: 46, review: 64, aiMastery: 48 },
    traits: ['reviewDemon'],
    preferred: 'review',
  },
];

/**
 * 採用候補のアーキタイプ（ジュニア中心の「未来の主力候補」）。
 * 採用＝育成対象の獲得という選択にする（SPEC 第12.2 / 第7章 採用カードの趣旨）。
 */
export const RECRUIT_ARCHETYPES: MemberArchetype[] = [
  {
    id: 'recruit-ai-prodigy',
    rank: 'junior',
    stats: { implementation: 42, review: 30, aiMastery: 66 },
    traits: ['aiArtisan', 'juniorStar'],
    preferred: 'coding',
  },
  {
    id: 'recruit-doc',
    rank: 'junior',
    stats: { implementation: 40, review: 44, aiMastery: 40 },
    traits: ['docMaster'],
    preferred: 'review',
  },
  {
    id: 'recruit-mega',
    rank: 'middle',
    stats: { implementation: 60, review: 28, aiMastery: 44 },
    traits: ['megaPrMaker'],
    preferred: 'coding',
  },
  {
    id: 'recruit-rookie',
    rank: 'junior',
    stats: { implementation: 38, review: 38, aiMastery: 46 },
    traits: ['juniorStar', 'burnoutProne'],
    preferred: 'coding',
  },
];
