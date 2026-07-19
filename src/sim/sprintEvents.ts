/**
 * スプリント内イベント記録（RI-52 / RI-53 / RI-34′）。
 *
 * sim 層は構造化ペイロードのみ append し、文言・演出は描画層が読む（第22.2）。
 */
import type { FireSprintEvent, SprintEvent, SprintState } from './types';

/** イベントログの上限（古いものから落とす ring buffer）。 */
export const SPRINT_EVENT_LIMIT = 64;

function isFireEvent(event: SprintEvent): event is FireSprintEvent {
  return (
    event.kind === 'ignite' ||
    event.kind === 'contain' ||
    event.kind === 'auto-contain' ||
    event.kind === 'spread'
  );
}

/**
 * スプリントイベントを append する。
 * - ティッカー用 ring buffer（全 kind）
 * - 介入は全件保持（RI-53）
 * - 炎上関連は全件保持（RI-34′）
 */
export function appendSprintEvent(sprint: SprintState, event: SprintEvent): void {
  sprint.events.push(event);
  if (event.kind === 'intervention') {
    sprint.interventionEvents.push(event);
  }
  if (isFireEvent(event)) {
    sprint.fireEvents.push(event);
  }
  if (sprint.events.length > SPRINT_EVENT_LIMIT) {
    sprint.events.splice(0, sprint.events.length - SPRINT_EVENT_LIMIT);
  }
}
