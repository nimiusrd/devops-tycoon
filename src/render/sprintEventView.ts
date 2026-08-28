/**
 * スプリントイベント → ティッカー文言（RI-52）。
 *
 * sim の構造化 `SprintEvent` を読むだけの純関数。描画・状態は知らない（第22.2）。
 */
import { getAction } from '../data/actions';
import type { SprintEvent } from '../sim/types';

/** ティッカー 1 行の表示データ。 */
export interface SprintEventView {
  /** 安定キー（tick + kind + 補助）。 */
  key: string;
  /** 先頭アイコン（絵文字）。 */
  icon: string;
  /** 本文。 */
  text: string;
  /** 見た目のトーン。 */
  tone: 'info' | 'good' | 'bad' | 'warn';
}

function interventionKey(event: Extract<SprintEvent, { kind: 'intervention' }>): string {
  const e = event.effect;
  const ids = e.affectedTaskIds?.join(',') ?? e.containedTaskId ?? '';
  return `${event.tick}:intervention:${e.actionId}:${ids}`;
}

function formatIntervention(
  event: Extract<SprintEvent, { kind: 'intervention' }>,
): SprintEventView {
  const { effect } = event;
  const def = getAction(effect.actionId);
  const icon = def?.icon ?? '⚡';
  const label = def?.label ?? effect.actionId;
  const parts: string[] = [];

  if (effect.reviewedCount != null && effect.reviewedCount > 0) {
    parts.push(`PR${effect.reviewedCount}件処理`);
  } else if (effect.containedTaskId != null) {
    // 鎮火の「コンボ継続」は contain イベント側。介入行はコスト等を出す。
  } else if (effect.affectedTaskIds && effect.affectedTaskIds.length > 0) {
    parts.push(`${effect.affectedTaskIds.length}件に適用`);
  }

  if (effect.hpCost != null && effect.hpCost > 0) {
    parts.push(`シニアHP -${Math.round(effect.hpCost)}`);
  }
  if (effect.moraleCost != null && effect.moraleCost > 0) {
    parts.push(`士気 -${Math.round(effect.moraleCost)}`);
  }
  if (effect.literacyGain != null && effect.literacyGain > 0) {
    parts.push(`AI Literacy +${Math.round(effect.literacyGain)}`);
  }
  if (effect.focusRefund != null && effect.focusRefund > 0) {
    parts.push(`⚡+${effect.focusRefund}`);
  }

  const detail = parts.length > 0 ? `: ${parts.join(' / ')}` : '';
  // 緊急鎮火のみ成功トーン。余裕のある先消しは contain / combo-break と同列の警告（RI-73）。
  const tone: SprintEventView['tone'] = effect.brokeCombo
    ? 'warn'
    : effect.actionId === 'firefight'
      ? 'good'
      : effect.hpCost || effect.moraleCost
        ? 'warn'
        : 'info';

  return {
    key: interventionKey(event),
    icon,
    text: `${label}${detail}`,
    tone,
  };
}

/**
 * 延焼の正の量。整数はそのまま、小数は最大 2 桁。丸めで HUD の実測と食い違わせない。
 */
export function formatSpreadMagnitude(value: number): string | null {
  if (!(value > 0)) return null;
  const hundredths = Math.round(value * 100) / 100;
  return hundredths > 0 ? String(hundredths) : null;
}

/**
 * 延焼で実際に動いた負債・士気。旧リプレイ（フィールド欠落）では null。
 * 両方 0 のときは空文字ではなく null とし、呼び元が文言を落とせるようにする。
 */
export function formatSpreadImpact(event: Extract<SprintEvent, { kind: 'spread' }>): string | null {
  if (event.debtGain == null && event.moraleCost == null) return null;
  const parts: string[] = [];
  const debt = formatSpreadMagnitude(event.debtGain ?? 0);
  const morale = formatSpreadMagnitude(event.moraleCost ?? 0);
  if (debt) parts.push(`負債 +${debt}`);
  if (morale) parts.push(`士気 -${morale}`);
  return parts.length > 0 ? parts.join(' / ') : null;
}

function formatSpreadText(event: Extract<SprintEvent, { kind: 'spread' }>): string {
  const impact = formatSpreadImpact(event);
  if (event.spreadToTaskId != null) {
    return impact
      ? `延焼! 隣の Review 待ち PR に連鎖（${impact}）`
      : '延焼! 隣の Review 待ち PR に連鎖';
  }
  if (impact) return `延焼! ${impact}`;
  if (event.debtGain == null && event.moraleCost == null) return '延焼! 負債と士気に波及';
  return '延焼!';
}

/** 1 イベントをティッカー表示用にフォーマットする。 */
export function formatSprintEvent(event: SprintEvent): SprintEventView {
  switch (event.kind) {
    case 'intervention':
      return formatIntervention(event);

    case 'contain':
      if (event.brokeCombo) {
        return {
          key: `${event.tick}:contain:${event.taskId}`,
          icon: '🚒',
          text: '先消し鎮火 → コンボ切断',
          tone: 'warn',
        };
      }
      return {
        key: `${event.tick}:contain:${event.taskId}`,
        icon: '🚒',
        text: `鎮火成功 → コンボ x${event.combo} 継続`,
        tone: 'good',
      };

    case 'combo-break': {
      const reasonLabel =
        event.reason === 'rework'
          ? '手戻り発生'
          : event.reason === 'auto-contain'
            ? '自動鎮火'
            : event.reason === 'light-firefight'
              ? '余裕のある先消し'
              : '延焼';
      return {
        key: `${event.tick}:combo-break:${event.reason}:${event.taskId ?? ''}`,
        icon: '💔',
        text: `コンボ途切れ: ${reasonLabel}`,
        tone: 'bad',
      };
    }

    case 'ignite':
      return {
        key: `${event.tick}:ignite:${event.taskId}:${event.source}`,
        icon: '🔥',
        text:
          event.source === 'spread' ? '点火! 延焼で隣の PR が炎上' : '点火! Review 落ち PR が炎上',
        tone: 'warn',
      };

    case 'auto-contain':
      return {
        key: `${event.tick}:auto-contain:${event.taskId}`,
        icon: '🧯',
        text: `自動鎮火 / シニアHP -${Math.round(event.hpCost)}`,
        tone: 'bad',
      };

    case 'spread':
      return {
        key: `${event.tick}:spread:${event.taskId}:${event.spreadToTaskId ?? ''}`,
        icon: '🔥',
        text: formatSpreadText(event),
        tone: 'bad',
      };
  }
}

/** 直近 N 件を新しい順でフォーマットする（ティッカー用）。 */
export function formatRecentSprintEvents(
  events: readonly SprintEvent[],
  limit = 5,
): SprintEventView[] {
  if (events.length === 0) return [];
  const slice = events.slice(-limit);
  return slice.map(formatSprintEvent).reverse();
}
