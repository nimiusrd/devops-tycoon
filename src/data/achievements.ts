/**
 * 実績の宣言的定義（コレクション表示・獲得条件ヒント。SPEC 第17章）。
 *
 * 解除判定は `src/state/meta.ts` の `applyRunReward` が持つ。
 * ルールセット指紋は ID と定義順だけを入力にし、ラベルとヒントは除外する。
 */
export interface AchievementDef {
  id: string;
  label: string;
  /** 未取得時に表示する獲得条件のヒント。 */
  hint: string;
}

export const ACHIEVEMENT_DEFS: readonly AchievementDef[] = [
  {
    id: 'first-clear',
    label: '初クリア',
    hint: 'いずれかの難易度で四半期（ボス）を突破する',
  },
  {
    id: 'no-damage',
    label: 'ノーダメージ突破',
    hint: '残業・アンドン未使用・延焼ゼロ・手戻り率15%未満に加え、品質・士気・シニア体力を高水準で保ち健全系診断でボスを突破する（ノーダメージ勝利）',
  },
  {
    id: 'combo-master',
    label: 'コンボ x20 達成',
    hint: '1 ラン中にコンボ x20 以上を達成してからボスを突破する',
  },
  {
    id: 'all-bosses',
    label: '全ボス撃破',
    hint: 'すべてのボスを少なくとも 1 回ずつ撃破する',
  },
  {
    id: 'nightmare-clear',
    label: 'Nightmare 制覇',
    hint: 'Nightmare 難易度で四半期を突破する',
  },
  {
    id: 'review-exceeded',
    label: '超過達成クリア',
    hint: '四半期レビューで超過達成（exceeded）を出してランを勝利する',
  },
  {
    id: 'review-survivor',
    label: '目標修正からの生還',
    hint: '四半期レビューで目標修正（missed_adjustable）を経験したうえでランを勝利する',
  },
];
