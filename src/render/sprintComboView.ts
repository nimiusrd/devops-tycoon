/**
 * コンボ HUD の「今」の段数（SPEC 第6.2 / 第18.2 / #357）。
 *
 * sim の `metrics.combo` はスプリント内の連続 Done であり、途切れイベントは履歴である。
 * 完了したスプリントを result / draft の背景に残すときも、現在値は 0 として扱う。
 * 描画・状態は知らない純関数（第22.2）。
 */
import type { SprintEvent } from '../sim/types';

/** これ未満のコンボは HUD に出さない（チラつき防止）。 */
export const COMBO_HUD_SHOW_FROM = 2;

/** 出来事ティッカーと同じ直近件数。 */
export const COMBO_HUD_EVENT_WINDOW = 5;

export interface ComboHudSprint {
  complete: boolean;
  metrics: { combo: number };
}

/** コンボ HUD に出す現在段数。終了済みスプリントは次スプリント前なので 0。 */
export function liveComboCount(sprint: ComboHudSprint): number {
  return sprint.complete ? 0 : sprint.metrics.combo;
}

/** 現在段数が COMBO バッジを出す閾値以上か。 */
export function isComboHudVisible(liveCombo: number): boolean {
  return liveCombo >= COMBO_HUD_SHOW_FROM;
}

/**
 * 直近の出来事に途切れが残り、現在値が別なら「今」の段数を履歴と並べて出す。
 * 現在値が閾値未満ならバッジ側が非表示になるので、重複した 0 表示は出さない。
 */
export function shouldShowLiveComboHint(
  liveCombo: number,
  events: readonly SprintEvent[],
  limit = COMBO_HUD_EVENT_WINDOW,
): boolean {
  if (!isComboHudVisible(liveCombo)) return false;
  if (events.length === 0) return false;
  return events.slice(-limit).some((event) => event.kind === 'combo-break');
}
