/**
 * スプリントイベント → ティッカー文言（RI-52）。
 *
 * sim の構造化 `SprintEvent` を読むだけの純関数。描画・状態は知らない（第22.2）。
 */
import { getAction } from '../data/actions';
import type { ActionId, InterventionOutcome, SprintEvent } from '../sim/types';
import { formatInterventionFailure } from './actionBarView';
import { resolveIconKey, type IconKey } from './visualIcons';

/** ティッカー 1 行の表示データ。 */
export interface SprintEventView {
  /** 安定キー（tick + kind + 補助）。 */
  key: string;
  /** 先頭アイコン（意味キー）。 */
  icon: IconKey;
  /** 本文。 */
  text: string;
  /** 見た目のトーン。 */
  tone: 'info' | 'good' | 'bad' | 'warn';
}

/** 介入結果を読むための表示時間。期限の作成と UI タイマーで共有する（#536）。 */
export const INTERVENTION_RESULT_HOLD_MS = 2500;

/** 共通の介入経路で取得した結果。自然進行の前後差分は効果へ混ぜない（#536）。 */
export interface SprintInterventionFeedback {
  id: ActionId;
  outcome: InterventionOutcome;
  /** 連続した介入も同じ文言でも、表示保持を更新する識別子。 */
  nonce: number;
  /** dispatch 直前の履歴。保持中に起きた重要イベントを判別する。 */
  previousEvents: readonly SprintEvent[];
  /** performance.now() 基準の期限。配置変更による再マウントでも保持を延長しない。 */
  expiresAt?: number;
  /** dispatch の同期区間で取得した after - before。レビュー処理による消費も含む。 */
  resourceChanges?: { focus: number; seniorHp: number; morale: number; aiLiteracy: number };
}

/** 実際に返った介入結果だけを、短時間保持する出来事行へ変換する。 */
export function formatInterventionFeedback(feedback: SprintInterventionFeedback): SprintEventView {
  const { id, outcome, nonce } = feedback;
  const def = getAction(id);
  const label = def?.label ?? id;
  const base = { key: `outcome:${nonce}`, icon: resolveIconKey(def?.icon, 'focus') };
  if (!outcome.ok) {
    return {
      ...base,
      text: `${label}: ${outcome.reason ? formatInterventionFailure(outcome.reason, id) : '実行できませんでした'}`,
      tone: 'warn',
    };
  }

  const effect = outcome.effect;
  const parts: string[] = [];
  if (effect?.reviewedCount != null) {
    // レビュー処理は出荷成功を意味しない。0 件も実測として示す。
    parts.push(`PR${effect.reviewedCount}件処理`);
  } else if (effect?.containedTaskId != null) {
    parts.push('1件鎮火');
  } else if (effect?.affectedTaskIds && effect.affectedTaskIds.length > 0) {
    const count = effect.affectedTaskIds.length;
    parts.push(
      id === 'splitPr'
        ? `PR${count}件分割`
        : id === 'assignTask'
          ? `${count}件差配`
          : `${count}件に適用`,
    );
  }
  if (effect?.modifier) {
    const modifierLabel = {
      andon: '流入停止開始',
      overtime: '残業開始',
      stability: '運用安定開始',
      throttle: '新規タスクのAI割当停止',
    }[effect.modifier.kind];
    parts.push(modifierLabel);
  }
  if (effect?.brokeCombo) parts.push('コンボ切断');
  const observed = feedback.resourceChanges;
  const resourceChanges: [string, number][] = observed
    ? [
        ['シニアHP', observed.seniorHp],
        ['士気', observed.morale],
        ['AI Literacy', observed.aiLiteracy],
        ['集中力', observed.focus],
      ]
    : [
        // hpCost はレビューで失う HP を含まない追加コスト。総消費とは区別する。
        ['追加シニアHP', -(effect?.hpCost ?? 0)],
        ['士気', -(effect?.moraleCost ?? 0)],
        ['AI Literacy', effect?.literacyGain ?? 0],
        ['集中力', -(effect?.focusCost ?? 0)],
        ['集中力', effect?.focusRefund ?? 0],
      ];
  for (const [resource, delta] of resourceChanges) {
    const value = formatSpreadMagnitude(Math.abs(delta));
    const signedValue = value ? `${delta < 0 ? '-' : '+'}${value}` : '±0';
    if (observed && resource === '集中力' && effect?.focusRefund && effect.focusRefund > 0) {
      const cost = formatSpreadMagnitude(effect.focusCost) ?? '0';
      const refund = formatSpreadMagnitude(effect.focusRefund) ?? '0';
      parts.push(`集中力 ${signedValue}（消費${cost}・還元${refund}）`);
    } else if (value) {
      parts.push(`${resource} ${signedValue}`);
    }
  }
  const spentOrgResources = observed
    ? observed.seniorHp < 0 || observed.morale < 0
    : Boolean(effect?.hpCost || effect?.moraleCost);
  return {
    ...base,
    text: `${label}: ${parts.length > 0 ? parts.join(' / ') : '実行完了'}`,
    tone: effect?.brokeCombo
      ? 'warn'
      : id === 'firefight'
        ? 'good'
        : spentOrgResources
          ? 'warn'
          : 'info',
  };
}

/** UI が保持期間を決め、表示モデルは新しい重要イベントを最優先する（#536）。 */
export function formatSprintTickerRows(
  events: readonly SprintEvent[],
  feedback: SprintInterventionFeedback | null,
  limit = 5,
): SprintEventView[] {
  const rows = formatRecentSprintEvents(events, limit);
  if (!feedback) return rows;
  // ring buffer の append 順を比較する。同 tick の同タスク再点火も新規として扱う。
  // snapshot は独立コピーなので参照比較は使わず、残存する連続区間を探す。
  const previousSignatures = feedback.previousEvents.map((event) => JSON.stringify(event));
  const currentSignatures = events.map((event) => JSON.stringify(event));
  let overlap = Math.min(previousSignatures.length, currentSignatures.length);
  while (overlap > 0) {
    const previousOffset = previousSignatures.length - overlap;
    if (
      currentSignatures
        .slice(0, overlap)
        .every((signature, index) => signature === previousSignatures[previousOffset + index])
    ) {
      break;
    }
    overlap -= 1;
  }
  const newEvents = events.slice(overlap);
  const importantEvents = [...newEvents]
    .reverse()
    .filter(
      (event) =>
        event.kind === 'ignite' ||
        event.kind === 'spread' ||
        event.kind === 'auto-contain' ||
        event.kind === 'combo-break',
    );
  // 同じ tick の二次的なコンボ切断で、点火・延焼・自動鎮火の原因と実測損失を隠さない。
  const priority =
    importantEvents.find(
      (event) => event.tick === importantEvents[0]?.tick && event.kind !== 'combo-break',
    ) ?? importantEvents[0];
  const intervention = [...newEvents]
    .reverse()
    .find((event) => event.kind === 'intervention' && event.effect.actionId === feedback.id);
  const interventionKey =
    feedback.outcome.ok && intervention ? formatSprintEvent(intervention).key : null;
  const priorityRow = priority ? formatSprintEvent(priority) : null;
  return [
    ...(priorityRow ? [priorityRow] : []),
    formatInterventionFeedback(feedback),
    ...rows.filter((row) => row.key !== interventionKey && row.key !== priorityRow?.key),
  ].slice(0, limit);
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
  const icon = resolveIconKey(def?.icon, 'focus');
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
    parts.push(`追加シニアHP -${Math.round(effect.hpCost)}`);
  }
  if (effect.moraleCost != null && effect.moraleCost > 0) {
    parts.push(`士気 -${Math.round(effect.moraleCost)}`);
  }
  if (effect.literacyGain != null && effect.literacyGain > 0) {
    parts.push(`AI Literacy +${Math.round(effect.literacyGain)}`);
  }
  if (effect.focusRefund != null && effect.focusRefund > 0) {
    parts.push(`集中力 +${effect.focusRefund}`);
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
          icon: 'contain',
          text: '先消し鎮火 → コンボ切断',
          tone: 'warn',
        };
      }
      return {
        key: `${event.tick}:contain:${event.taskId}`,
        icon: 'contain',
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
        icon: 'comboBreak',
        text: `コンボ途切れ: ${reasonLabel}`,
        tone: 'bad',
      };
    }

    case 'ignite':
      return {
        key: `${event.tick}:ignite:${event.taskId}:${event.source}`,
        icon: 'fire',
        text:
          event.source === 'spread' ? '点火! 延焼で隣の PR が炎上' : '点火! Review 落ち PR が炎上',
        tone: 'warn',
      };

    case 'auto-contain':
      return {
        key: `${event.tick}:auto-contain:${event.taskId}`,
        icon: 'autoContain',
        text: `自動鎮火 / シニアHP -${Math.round(event.hpCost)}`,
        tone: 'bad',
      };

    case 'spread':
      return {
        key: `${event.tick}:spread:${event.taskId}:${event.spreadToTaskId ?? ''}`,
        icon: 'fire',
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

/** 折りたたみ時の1行サマリー。最新件と残り件数だけを出す（#471）。 */
export function formatTickerSummary(rows: readonly SprintEventView[]): string {
  if (rows.length === 0) return '';
  if (rows.length === 1) return rows[0].text;
  return `${rows[0].text} ほか${rows.length - 1}件`;
}
