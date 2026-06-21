/**
 * 全社レバー / 部門レバーの定義（SPEC 第4.8 / 第4.9）。
 *
 * 四半期予算を原資に、下位（チーム）の制約をまとめて緩める上位の采配。
 * 効果は `OrgAdjust` への差分として宣言し、生成時に全チーム／対象部門へ波及
 * させる（規模効果。第4.7）。データ駆動でバランス調整を完結させる（architecture §4.3）。
 */
import type { LeverDef } from '../sim/orgscale/types';

/** 全社レバー（SPEC 第4.8）。全チームへ波及する。 */
export const COMPANY_LEVERS: readonly LeverDef[] = [
  {
    id: 'recruitDraft',
    name: '採用ドラフト',
    scope: 'company',
    cost: 40,
    effect: { extraTeams: 1, moraleDelta: -3 },
    description: '新チームを 1 つ増設する（短期的に士気は下がる）。',
  },
  {
    id: 'aiGuideline',
    name: '全社AIガイドライン',
    scope: 'company',
    cost: 25,
    effect: { aiDependencyDelta: -10, infraBoost: 6 },
    description: '雑なAI利用を全社で抑え、AI依存度を下げる。',
  },
  {
    id: 'infraInvest',
    name: '基盤投資',
    scope: 'company',
    cost: 35,
    effect: { reviewQueueDelta: -3, infraBoost: 12 },
    description: '共通基盤(CI/AI)へ投資し、全チームのレビュー渋滞を緩める。',
  },
  {
    id: 'standardize',
    name: '標準化(CI/Docs)',
    scope: 'company',
    cost: 30,
    effect: { techDebtDelta: -20, infraBoost: 10 },
    description: 'CI/Docs を標準化し、全社の技術的負債を返済する。',
  },
  {
    id: 'firefighters',
    name: '火消し部隊派遣',
    scope: 'company',
    cost: 20,
    effect: { incidentDelta: -2, moraleDelta: 4 },
    description: '火消し部隊を派遣し、炎上を鎮火して士気を回復する。',
  },
  {
    id: 'reorg',
    name: '組織再編',
    scope: 'company',
    cost: 45,
    effect: { extraTeams: 1, reviewQueueDelta: -2, moraleDelta: -6 },
    description: '部門を再編して詰まりを解消する（混乱で一時的に士気が下がる）。',
  },
];

/** 部門レバー（SPEC 第4.9）。対象部門のチームへ波及する。 */
export const DEPARTMENT_LEVERS: readonly LeverDef[] = [
  {
    id: 'reviewReinforce',
    name: 'レビュー応援を送る',
    scope: 'department',
    cost: 12,
    effect: { reviewQueueDelta: -4 },
    description: '部門にレビュー応援を送り、PRの山を崩す。',
  },
  {
    id: 'prSizeLimit',
    name: 'PRサイズ制限',
    scope: 'department',
    cost: 10,
    effect: { reviewQueueDelta: -2, techDebtDelta: -6 },
    description: 'PRサイズを一括制限し、レビュー負荷と負債を抑える。',
  },
  {
    id: 'aiThrottleDept',
    name: 'AIスロットル(部門)',
    scope: 'department',
    cost: 8,
    effect: { aiDependencyDelta: -8 },
    description: '部門のAI流入を絞り、過剰生成を抑える。',
  },
  {
    id: 'seniorHiring',
    name: 'シニア採用集中',
    scope: 'department',
    cost: 18,
    effect: { reviewQueueDelta: -3, moraleDelta: 3 },
    description: 'シニアを集中採用し、レビュー耐性を底上げする。',
  },
  {
    id: 'dependencyCleanup',
    name: '依存整理',
    scope: 'department',
    cost: 14,
    effect: { techDebtDelta: -12, incidentDelta: -1 },
    description: 'チーム間依存を整理し、連鎖炎上の火種を減らす。',
  },
  {
    id: 'deptFreeze',
    name: '部門フリーズ',
    scope: 'department',
    cost: 6,
    effect: { incidentDelta: -2, reviewQueueDelta: -2, moraleDelta: -4 },
    description: '一時的に流入を凍結して立て直す（士気は下がる）。',
  },
];

/** 全レバー（全社 + 部門）。 */
export const LEVER_DEFS: readonly LeverDef[] = [...COMPANY_LEVERS, ...DEPARTMENT_LEVERS];

/** レバー ID から定義を引く。 */
export function getLever(id: string): LeverDef | undefined {
  return LEVER_DEFS.find((l) => l.id === id);
}
