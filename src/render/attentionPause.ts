/**
 * RI-62③ 重要イベント自動ポーズの描画専用判定。
 *
 * sim の時間刻みや結果は変更せず、UI が保持する前後スナップショットから
 * 短い介入余地（自動ポーズ＋ハイライト）の表示条件だけを導く。
 */
import { REVIEW_HOT_QUEUE } from './boardScene';
import { planBossSlowMotion } from './juicyEffects';
import type { FireSprintEvent, Task } from '../sim/types';

/** 自動ポーズ尺（ms）。ボス最終鎮火スローモより短く介入判断の間を作る。 */
export const ATTENTION_PAUSE_MS = 900;

/** 連発抑止の壁時計クールダウン（ms）。 */
export const ATTENTION_COOLDOWN_MS = 2_500;

export type AttentionPauseKind = 'bossIncident' | 'ignite' | 'reviewJam';

export interface AttentionPausePlan {
  active: boolean;
  kind: AttentionPauseKind | null;
  /** オーバーレイ上部ラベル */
  label: string;
  /** オーバーレイ主文 */
  title: string;
  /** 強調するメーター（CSS class 用） */
  meter: 'fire' | 'jam' | null;
}

const IDLE: AttentionPausePlan = {
  active: false,
  kind: null,
  label: '',
  title: '',
  meter: null,
};

/** 炎上ログのうち点火（review / spread 経由）の件数。 */
export function countIgniteEvents(events: readonly FireSprintEvent[]): number {
  let n = 0;
  for (const event of events) {
    if (event.kind === 'ignite') n += 1;
  }
  return n;
}

/** prev に無く next で Incident になった task ID があるか。 */
export function hasNewIncidentTask(
  prevTasks: readonly Task[],
  nextTasks: readonly Task[],
): boolean {
  const prevIncidentIds = new Set<number>();
  for (const task of prevTasks) {
    if (task.incident) prevIncidentIds.add(task.id);
  }
  for (const task of nextTasks) {
    if (task.incident && !prevIncidentIds.has(task.id)) return true;
  }
  return false;
}

function planForKind(kind: AttentionPauseKind): AttentionPausePlan {
  switch (kind) {
    case 'bossIncident':
      return {
        active: true,
        kind,
        label: 'BOSS INCIDENT',
        title: 'ボス障害発生!',
        meter: 'fire',
      };
    case 'ignite':
      return {
        active: true,
        kind,
        label: 'IGNITE',
        title: '点火!',
        meter: 'fire',
      };
    case 'reviewJam':
      return {
        active: true,
        kind,
        label: 'REVIEW JAM',
        title: 'Review渋滞!',
        meter: 'jam',
      };
  }
}

/**
 * 点火・Review渋滞・ボスIncident の立ち上がりエッジから自動ポーズ計画を返す。
 * 同フレーム複数該当時は bossIncident > ignite > reviewJam。
 * ボス最終鎮火スローモが立つ場合は attention を出さない。
 */
export function planAttentionPause(input: {
  isBoss: boolean;
  prevTasks: readonly Task[];
  nextTasks: readonly Task[];
  /** スプリント累積の Review 待ち最大長（tick 内ピークを含む）。 */
  prevReviewQueueMax: number;
  nextReviewQueueMax: number;
  /** `fireEvents` の ignite 件数（複数 tick 同期でも取りこぼさない）。 */
  prevIgniteEventCount: number;
  nextIgniteEventCount: number;
}): AttentionPausePlan {
  const {
    isBoss,
    prevTasks,
    nextTasks,
    prevReviewQueueMax,
    nextReviewQueueMax,
    prevIgniteEventCount,
    nextIgniteEventCount,
  } = input;

  if (planBossSlowMotion(isBoss, prevTasks, nextTasks).active) {
    return IDLE;
  }

  // 件数差分だと「点火と同時に別件が自動鎮火」で見逃すため、task ID / イベントを見る。
  const ignited =
    hasNewIncidentTask(prevTasks, nextTasks) || nextIgniteEventCount > prevIgniteEventCount;
  // 最終キュー長だけだと tick 内ピーク（advanceReview 前）を見逃すため累積 max を使う。
  const jammed = prevReviewQueueMax < REVIEW_HOT_QUEUE && nextReviewQueueMax >= REVIEW_HOT_QUEUE;

  if (ignited && isBoss) return planForKind('bossIncident');
  if (ignited) return planForKind('ignite');
  if (jammed) return planForKind('reviewJam');
  return IDLE;
}
