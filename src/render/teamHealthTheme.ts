import type { TeamHealth } from '../sim/orgscale/types';

/**
 * チーム健全度の表示写像（バッジのトーンと文言）。
 *
 * 部門ビューと全社ビューで同じ実装が重複していたため集約した。
 * 片方だけ直すと同じ状態のチームが画面によって違う見え方になるので、
 * 表記を変えるときはここだけを直すこと。
 */

/** バッジの色調。 */
export function badgeTone(health: TeamHealth): 'ok' | 'warn' | 'hell' {
  if (health === 'reviewHell') return 'hell';
  if (health === 'congested') return 'warn';
  return 'ok';
}

/** バッジ tag 文言。 */
export function healthTag(health: TeamHealth): string {
  if (health === 'reviewHell') return 'Review Hell';
  if (health === 'congested') return '渋滞ぎみ';
  return 'Healthy';
}
