/**
 * RI-10 の描画専用演出判定。
 *
 * シミュレーションの時間刻みや結果を変更せず、UI が保持する
 * 介入前後のスナップショットから短い演出の表示条件だけを導く。
 */
import type { SprintResult, Task } from '../sim/types';

export interface BossSlowMotionPlan {
  active: boolean;
  /** 直前に残っていた Incident 数。演出の説明文に使う。 */
  clearedIncidentCount: number;
}

export function planBossSlowMotion(
  isBoss: boolean,
  prevTasks: readonly Task[],
  nextTasks: readonly Task[],
): BossSlowMotionPlan {
  if (!isBoss) return { active: false, clearedIncidentCount: 0 };

  const prevIncidents = prevTasks.filter((task) => task.lane === 'rework' && task.incident).length;
  const nextIncidents = nextTasks.filter((task) => task.lane === 'rework' && task.incident).length;

  return {
    active: prevIncidents > 0 && nextIncidents === 0,
    clearedIncidentCount: prevIncidents > 0 && nextIncidents === 0 ? prevIncidents : 0,
  };
}

export function isSpecialGrade(grade: SprintResult['grade']): boolean {
  return grade === 'S';
}
