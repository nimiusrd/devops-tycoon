/**
 * Issue #906 Phase 1 の比較条件。PREREG の値は変えない。
 *
 * - base: 現行 Easy（seniorHpCostMul 0.74、初期編成 3 人）
 * - C1: Easy の seniorHpCostMul 0.74 → 0.68
 * - C3: 初期編成に既存テンプレート `recruit-doc` を 4 人目として追加
 * - C2: Kill 済み。実装しない。
 *
 * 本番ファイルは書き換えず、実行時だけ `DIFFICULTY_DEFS` / `STARTER_ARCHETYPES` を上書きする。
 */
import { DIFFICULTY_DEFS } from '../../data/difficulties';
import { RECRUIT_ARCHETYPES, STARTER_ARCHETYPES, type MemberArchetype } from '../../data/members';

export const CONDITION_IDS = ['base', 'c1', 'c3'] as const;
export type ConditionId = (typeof CONDITION_IDS)[number];

/** PREREG / difficulties.ts:69 の現行 Easy 値。 */
export const BASE_EASY_SENIOR_HP_COST_MUL = 0.74;
/** PREREG C1。Easy = Normal 0.8 × Easy/Normal ボス目標比 0.85。 */
export const C1_EASY_SENIOR_HP_COST_MUL = 0.68;
/** PREREG C3。members.ts の既存採用テンプレート。 */
export const C3_STARTER_TEMPLATE_ID = 'recruit-doc';

function cloneArchetype(arch: MemberArchetype): MemberArchetype {
  return {
    ...arch,
    stats: { ...arch.stats },
    traits: [...arch.traits],
  };
}

const ORIGINAL_STARTERS: readonly MemberArchetype[] = STARTER_ARCHETYPES.map(cloneArchetype);
const ORIGINAL_EASY_SENIOR_HP_COST_MUL =
  DIFFICULTY_DEFS.easy.globalEffects?.seniorHpCostMul ?? BASE_EASY_SENIOR_HP_COST_MUL;

if (ORIGINAL_EASY_SENIOR_HP_COST_MUL !== BASE_EASY_SENIOR_HP_COST_MUL) {
  throw new Error(
    `本番 Easy seniorHpCostMul が ${ORIGINAL_EASY_SENIOR_HP_COST_MUL} で PREREG の ${BASE_EASY_SENIOR_HP_COST_MUL} と違う`,
  );
}

function easyEffects(): NonNullable<(typeof DIFFICULTY_DEFS)['easy']['globalEffects']> {
  const effects = DIFFICULTY_DEFS.easy.globalEffects;
  if (!effects) throw new Error('Easy の globalEffects が無い');
  return effects;
}

export interface InjectedCondition {
  cond: ConditionId;
  easySeniorHpCostMul: number;
  starterIds: string[];
  starterCount: number;
}

export function inspectCondition(): Omit<InjectedCondition, 'cond'> {
  return {
    easySeniorHpCostMul: easyEffects().seniorHpCostMul ?? 1,
    starterIds: STARTER_ARCHETYPES.map((arch) => arch.id),
    starterCount: STARTER_ARCHETYPES.length,
  };
}

/** 本番モジュール上の上書きを必ず元に戻す。 */
export function restoreCondition(): void {
  easyEffects().seniorHpCostMul = ORIGINAL_EASY_SENIOR_HP_COST_MUL;
  STARTER_ARCHETYPES.length = 0;
  STARTER_ARCHETYPES.push(...ORIGINAL_STARTERS.map(cloneArchetype));
}

/** 指定条件を本番モジュールへ注入し、注入後の実値を返す。 */
export function applyCondition(cond: ConditionId): InjectedCondition {
  restoreCondition();
  if (cond === 'c1') {
    easyEffects().seniorHpCostMul = C1_EASY_SENIOR_HP_COST_MUL;
  }
  if (cond === 'c3') {
    const doc = RECRUIT_ARCHETYPES.find((arch) => arch.id === C3_STARTER_TEMPLATE_ID);
    if (!doc) throw new Error(`${C3_STARTER_TEMPLATE_ID} が RECRUIT_ARCHETYPES に無い`);
    STARTER_ARCHETYPES.push(cloneArchetype(doc));
  }
  return { cond, ...inspectCondition() };
}

export function withCondition<T>(cond: ConditionId, fn: () => T): T {
  try {
    applyCondition(cond);
    return fn();
  } finally {
    restoreCondition();
  }
}

export function parseConditions(raw: string): ConditionId[] {
  const list = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  if (list.length === 0) throw new Error('--conds が空');
  const unknown = list.filter((id) => !CONDITION_IDS.includes(id as ConditionId));
  if (unknown.length > 0) {
    throw new Error(`未知の条件: ${unknown.join(', ')}（使えるのは ${CONDITION_IDS.join(', ')}）`);
  }
  return list as ConditionId[];
}
