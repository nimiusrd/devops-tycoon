/**
 * 初見向けオンボーディング（RI-60 / RI-67）。
 *
 * sim 決定論の外側（UI 層のみ）。`?tutorial=` は E2E / 強制再表示用のフック。
 */
import { TUTORIAL_CONTENT_VERSION } from '../state/meta';
import { SENIOR_HP_HOWTO_BODY } from './howToPlayContent';

export { LEGACY_TUTORIAL_VERSION, TUTORIAL_CONTENT_VERSION } from '../state/meta';

/** `?tutorial=` の解釈結果。 */
export type TutorialQuery = '1' | 'force' | 'help' | 'off' | null;

/** 段階ガイドのステップ ID（`data-tutorial-step` と一致）。 */
export type TutorialStepId = 'action-bar' | 'senior-hp' | 'jam-meter' | 'combo-gauge';

export interface TutorialStep {
  id: TutorialStepId;
  /** ハイライト対象の data-testid（ステップ ID と異なる場合あり）。 */
  targetTestId: string;
  title: string;
  body: string;
}

/** 初回ラン限定ガイド（介入バー → シニア体力 → レビュー渋滞 → コンボ）。 */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'action-bar',
    targetTestId: 'action-bar',
    title: '介入バー',
    body: 'マネジメント集中力を使って現場へ介入します。緊急対応は複数炎上や延焼直前（タイマーが短いとき）だけが本命で、余裕のある先消しは高コストです。アンドンは既存キューを捌く猶予、AIスロットルは新規タスクをAIなしにします。点火の抑制はリテラシーが低いときだけ、手戻りの抑制はワークフローが未熟なときだけで効きます。前提度が高く成熟しているときは工程ずれで手戻りが増えることがあります。品質・PR分割は手戻り率だけを下げます。ペアレビューは詰まったPRを処理しつつAI Literacyを上げ、依存度が高くてもリテラシーが低いままだと敗北するので早めに使いましょう。編成で review や稼働人数を増やすと、レビュー単価とシニア消耗が薄まり燃え尽きにくくなります。',
  },
  {
    id: 'senior-hp',
    targetTestId: 'hud-seniorHp',
    title: 'シニア体力',
    body: SENIOR_HP_HOWTO_BODY,
  },
  {
    id: 'jam-meter',
    targetTestId: 'jam-meter',
    title: 'レビュー渋滞',
    body: 'Review レーンにタスクが溜まると渋滞メーターが上がります。枠を超える前にレビューを回し、手戻りや士気低下を防ぎましょう。',
  },
  {
    id: 'combo-gauge',
    targetTestId: 'combo-gauge',
    title: '連携コンボ',
    body: '介入を繋げると連携ゲージが溜まり、コンボが伸びます。無理な残業だけに頼らず、流れを作る介入を意識すると四半期が安定します。',
  },
];

/**
 * クエリ文字列からチュートリアルモードを解決する。純関数。
 * 未知値・空は null（通常の初回判定）。
 */
export function resolveTutorial(search: string): TutorialQuery {
  const value = new URLSearchParams(search).get('tutorial');
  if (value === '1' || value === 'force' || value === 'help' || value === 'off') return value;
  return null;
}

/** 現在のブラウザ URL からチュートリアルモードを解決する。 */
export function resolveTutorialFromLocation(): TutorialQuery {
  if (typeof window === 'undefined') return null;
  return resolveTutorial(window.location.search);
}

/**
 * スプリント段階ガイドを出すか。
 * `force` / `1` は表示済みでも再表示。`off` / `help` は出さない。
 * 通常起動では `seenTutorialVersion` が現行版未満なら再表示する（RI-67）。
 */
export function shouldShowTutorialGuide(seenTutorialVersion: number, mode: TutorialQuery): boolean {
  if (mode === 'off' || mode === 'help') return false;
  if (mode === '1' || mode === 'force') return true;
  return seenTutorialVersion < TUTORIAL_CONTENT_VERSION;
}

/**
 * URL に `tutorial` が無ければ付与する（E2E 既定でガイドを抑止する用途）。
 * 既に明示されている値は変更しない。
 */
export function ensureTutorialQuery(
  url: string,
  value: Exclude<TutorialQuery, null> = 'off',
): string {
  const parsed = new URL(url, 'http://localhost');
  if (!parsed.searchParams.has('tutorial')) {
    parsed.searchParams.set('tutorial', value);
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
