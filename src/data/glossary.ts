/**
 * 初見用語の短い定義（#469）。
 *
 * セットアップ・介入バー・初回ガイドの初出で使う。遊び方ヘルプの長文は置換しない。
 * 無効理由など他画面の共用が必要なときも、同じ語はここに足して参照する。
 */
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
}

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
    definition: '低いと手戻りが増える。依存が高いと敗北する。',
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
