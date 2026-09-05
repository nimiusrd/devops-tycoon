/** 共有の人物状態から、Pixi の足元照明と仕事の所作を導く。 */
import type { BoardStationPlan } from './boardScene';
import { VISUAL_TOKENS } from './visualTokens';

export function officeLight(station: Pick<BoardStationPlan, 'mood' | 'count' | 'lane'>) {
  const colors = VISUAL_TOKENS.colors;
  if (station.mood === 'panic') return { color: colors.health.reviewHell, alpha: 0.42 };
  if (station.mood === 'exhausted' || station.mood === 'tired' || station.mood === 'sad') {
    return { color: colors.health.congested, alpha: 0.16 };
  }
  if (station.lane === 'done') {
    return { color: colors.health.healthy, alpha: station.count > 0 ? 0.32 : 0.08 };
  }
  return { color: colors.sky, alpha: station.count > 0 ? 0.3 : 0.08 };
}

/** 位相0は静止画と一致。空席・疲労時は作業の所作を抑え、稼働中だけ手元へ傾く。 */
export function officeActorMotion(
  station: Pick<BoardStationPlan, 'mood' | 'count' | 'lane'>,
  elapsedMs: number,
) {
  if (elapsedMs === 0) return { x: 0, y: 0, rotation: 0 };
  const tired = ['tired', 'exhausted', 'sad'].includes(station.mood);
  const working = station.count > 0 && station.lane !== 'done' && !tired;
  const period = working ? 1200 : 3400;
  const wave = (1 - Math.cos((elapsedMs * Math.PI * 2) / period)) / 2;
  return {
    x: working ? wave * 1.4 : 0,
    y: -wave * (tired ? 0.6 : working ? 2 : 1),
    rotation: working ? wave * 0.014 : 0,
  };
}
