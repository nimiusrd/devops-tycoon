/**
 * 実績の宣言的定義（コレクション表示・獲得条件ヒント。第17章）。
 *
 * ID はメタ進行、アンロック、生成カタログが共有する正本とする。
 */
export const ACHIEVEMENT_IDS = {
  firstClear: 'first-clear',
  noDamage: 'no-damage',
  comboMaster: 'combo-master',
  allBosses: 'all-bosses',
  nightmareClear: 'nightmare-clear',
  reviewExceeded: 'review-exceeded',
  reviewSurvivor: 'review-survivor',
} as const;

export interface AchievementDef {
  id: (typeof ACHIEVEMENT_IDS)[keyof typeof ACHIEVEMENT_IDS];
  label: string;
  /** 未取得時に表示する獲得条件のヒント。 */
  hint: string;
}

export const ACHIEVEMENT_DEFS: readonly AchievementDef[] = [
  {
    id: ACHIEVEMENT_IDS.firstClear,
    label: '初クリア',
    hint: 'いずれかの難易度で四半期（ボス）を突破する',
  },
  {
    id: ACHIEVEMENT_IDS.noDamage,
    label: 'ノーダメージ突破',
    hint: '残業・アンドン未使用・延焼ゼロ・手戻り率15%未満に加え、品質・士気・シニア体力を高水準で保ち健全系診断でボスを突破する（ノーダメージ勝利）',
  },
  {
    id: ACHIEVEMENT_IDS.comboMaster,
    label: 'コンボ x20 達成',
    hint: '1 ラン中にコンボ x20 以上を達成してからボスを突破する',
  },
  {
    id: ACHIEVEMENT_IDS.allBosses,
    label: '全ボス撃破',
    hint: 'すべてのボスを少なくとも 1 回ずつ撃破する',
  },
  {
    id: ACHIEVEMENT_IDS.nightmareClear,
    label: 'Nightmare 制覇',
    hint: 'Nightmare 難易度で四半期を突破する',
  },
  {
    id: ACHIEVEMENT_IDS.reviewExceeded,
    label: '超過達成クリア',
    hint: '四半期レビューで超過達成（exceeded）を出してランを勝利する',
  },
  {
    id: ACHIEVEMENT_IDS.reviewSurvivor,
    label: '目標修正からの生還',
    hint: '四半期レビューで目標修正（missed_adjustable）を経験したうえでランを勝利する',
  },
];
