/**
 * 初見用語の短い定義（#469）。
 *
 * セットアップ・介入バー・初回ガイドの初出で使う。遊び方ヘルプの長文は置換しない。
 * 無効理由など他画面の共用が必要なときも、同じ語はここに足して参照する。
 */
import { OUTCOME_BALANCE } from './balance/outcome';

export const GLOSSARY_MAX_DEFINITION_LENGTH = 40;

export const GLOSSARY_TERM_IDS = [
  'pr',
  'spread',
  'seniorHp',
  'aiLiteracy',
  'rework',
  'focus',
] as const;

export type GlossaryTermId = (typeof GLOSSARY_TERM_IDS)[number];

export interface GlossaryEntry {
  term: string;
  definition: string;
  /**
   * 折り返し単位。各句は途中で改行せず、句の境だけ折り返す（#941）。
   * 省略時は definition を一続きで出す。
   */
  phrases?: readonly string[];
}

/**
 * AIリテラシーの用語定義（#941 / #949）。
 *
 * 敗北は依存度だけでは起きない。リテラシーの危険上限と依存度の上限を、
 * `OUTCOME_BALANCE` から入れて両方の条件が読めるようにする。
 * 判定はリテラシーが上限以下、かつ依存度が上限以上（`evaluateLose`）。
 * 句は 320px の用語パネルに収まる長さを保つ。
 */
export function aiLiteracyGlossaryPhrases(
  literacyMax: number = OUTCOME_BALANCE.loseAiLiteracyUnsafeMax.value,
  dependencyCap: number = OUTCOME_BALANCE.loseAiDependencyCap.value,
): readonly string[] {
  return [
    '低いと手戻り増。',
    `リテラシー${literacyMax}以下かつ`,
    `依存${dependencyCap}%以上で敗北。`,
  ];
}

const aiLiteracyPhrases = aiLiteracyGlossaryPhrases();

export const GLOSSARY: Record<GlossaryTermId, GlossaryEntry> = {
  pr: {
    term: 'PR',
    definition: 'レビュー待ちの作業単位。溜まると渋滞する。',
  },
  spread: {
    term: '延焼',
    definition: '炎上が隣の作業へ広がること。',
  },
  seniorHp: {
    term: 'シニア体力',
    definition: '1%以下で敗北する組織全体の余力。',
  },
  aiLiteracy: {
    term: 'AIリテラシー',
    phrases: aiLiteracyPhrases,
    definition: aiLiteracyPhrases.join(''),
  },
  rework: {
    term: '手戻り',
    definition: 'レビュー後に作り直しになること。',
  },
  focus: {
    term: 'マネジメント集中力',
    definition: '介入に使う行動資源。足りないと打てない。',
  },
};
