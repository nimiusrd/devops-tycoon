/**
 * スプリント内イベント記録（RI-52）。
 *
 * sim 層は構造化ペイロードのみ append し、文言・演出は描画層が読む（第22.2）。
 */
import type { SprintEvent, SprintState } from './types';

/** イベントログの上限（古いものから落とす ring buffer）。 */
export const SPRINT_EVENT_LIMIT = 64;

/** スプリントイベントを append する（ティッカー用 ring buffer + 介入は全件保持）。 */
export function appendSprintEvent(sprint: SprintState, event: SprintEvent): void {
  sprint.events.push(event);
  if (event.kind === 'intervention') {
    sprint.interventionEvents.push(event);
  }
  if (sprint.events.length > SPRINT_EVENT_LIMIT) {
    sprint.events.splice(0, sprint.events.length - SPRINT_EVENT_LIMIT);
  }
}
