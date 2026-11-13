/**
 * ボス定義のプレイヤー向け表示（#1011）。
 * `bosses.ts` と循環参照しないよう、説明文の組み立てだけを担う。
 */
import { planBossPlayerDescription } from './bossPlayerCopy';
import { BOSS_TEMPLATES, type BossDef } from './bosses';
import type { DifficultyId } from '../sim/types';

const BY_ID = new Map(BOSS_TEMPLATES.map((boss) => [boss.id, boss]));

/** ボス定義を ID で取得する（未知は undefined）。 */
export function getBoss(id: string): BossDef | undefined {
  const boss = BY_ID.get(id);
  if (!boss) return undefined;
  return {
    ...boss,
    description: planBossPlayerDescription(boss, 'normal'),
  };
}

/** 難易度を反映したプレイヤー向けボス説明。 */
export function getBossPlayerDescription(
  id: string,
  difficulty: DifficultyId = 'normal',
): string | undefined {
  const boss = BY_ID.get(id);
  if (!boss) return undefined;
  return planBossPlayerDescription(boss, difficulty);
}
