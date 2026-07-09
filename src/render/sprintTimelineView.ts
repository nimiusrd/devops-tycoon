/**
 * スプリントタイムライン → SVG スパークライン計画（RI-53）。
 *
 * sim の `timeline` / `events` を読むだけの純関数。Recharts は使わない（第22.2）。
 */
import { getAction } from '../data/actions';
import type { ActionId, SprintEvent, TimelineSample } from '../sim/types';

export interface TimelineMarker {
  tick: number;
  actionId: ActionId;
  label: string;
  icon: string;
  /** SVG 上の x 座標。 */
  x: number;
}

export interface TimelineSeriesPath {
  /** 系列キー。 */
  key: 'reviewQueue' | 'burningCount' | 'combo' | 'seniorHp';
  label: string;
  /** SVG path の d 属性（折れ線）。 */
  d: string;
  /** 系列の色クラス用。 */
  tone: 'queue' | 'fire' | 'combo' | 'hp';
}

export interface SprintTimelineView {
  width: number;
  height: number;
  /** 余白込みの描画領域。 */
  pad: { left: number; right: number; top: number; bottom: number };
  series: TimelineSeriesPath[];
  markers: TimelineMarker[];
  /** 横軸ラベル（開始・終了 tick）。 */
  tickStart: number;
  tickEnd: number;
  /** 空データか。 */
  empty: boolean;
}

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 120;
const PAD = { left: 8, right: 8, top: 14, bottom: 18 };

function maxOf(samples: readonly TimelineSample[], key: keyof TimelineSample): number {
  let max = 0;
  for (const s of samples) {
    const v = s[key];
    if (typeof v === 'number' && v > max) max = v;
  }
  return max;
}

function buildPolyline(
  samples: readonly TimelineSample[],
  key: 'reviewQueue' | 'burningCount' | 'combo' | 'seniorHp',
  yMax: number,
  width: number,
  height: number,
  pad: typeof PAD,
): string {
  if (samples.length === 0) return '';
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const tick0 = samples[0].tick;
  const tick1 = samples[samples.length - 1].tick;
  const tickSpan = Math.max(1, tick1 - tick0);
  const scaleY = yMax > 0 ? innerH / yMax : 0;

  const points: string[] = [];
  for (const s of samples) {
    const x = pad.left + ((s.tick - tick0) / tickSpan) * innerW;
    const y = pad.top + innerH - s[key] * scaleY;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `M ${points.join(' L ')}`;
}

/** 介入イベントからマーカー一覧を抽出する。 */
export function extractInterventionMarkers(
  events: readonly SprintEvent[],
  samples: readonly TimelineSample[],
  width = DEFAULT_WIDTH,
  pad = PAD,
): TimelineMarker[] {
  if (samples.length === 0) return [];
  const tick0 = samples[0].tick;
  const tick1 = samples[samples.length - 1].tick;
  const tickSpan = Math.max(1, tick1 - tick0);
  const innerW = width - pad.left - pad.right;

  const markers: TimelineMarker[] = [];
  for (const e of events) {
    if (e.kind !== 'intervention') continue;
    const def = getAction(e.effect.actionId);
    const x = pad.left + ((e.tick - tick0) / tickSpan) * innerW;
    markers.push({
      tick: e.tick,
      actionId: e.effect.actionId,
      label: def?.label ?? e.effect.actionId,
      icon: def?.icon ?? '⚡',
      x,
    });
  }
  return markers;
}

export interface PlanSprintTimelineOptions {
  width?: number;
  height?: number;
}

/** リザルト用スパークラインの描画計画を導出する。 */
export function planSprintTimeline(
  timeline: readonly TimelineSample[],
  events: readonly SprintEvent[],
  options: PlanSprintTimelineOptions = {},
): SprintTimelineView {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const pad = PAD;

  if (timeline.length === 0) {
    return {
      width,
      height,
      pad,
      series: [],
      markers: [],
      tickStart: 0,
      tickEnd: 0,
      empty: true,
    };
  }

  const queueMax = Math.max(1, maxOf(timeline, 'reviewQueue'));
  const fireMax = Math.max(1, maxOf(timeline, 'burningCount'));
  const comboMax = Math.max(1, maxOf(timeline, 'combo'));
  // シニアHP は 0..100 固定スケールの方が読みやすい。
  const hpMax = 100;

  const series: TimelineSeriesPath[] = [
    {
      key: 'reviewQueue',
      label: 'Review待ち',
      d: buildPolyline(timeline, 'reviewQueue', queueMax, width, height, pad),
      tone: 'queue',
    },
    {
      key: 'burningCount',
      label: '炎上',
      d: buildPolyline(timeline, 'burningCount', fireMax, width, height, pad),
      tone: 'fire',
    },
    {
      key: 'combo',
      label: 'コンボ',
      d: buildPolyline(timeline, 'combo', comboMax, width, height, pad),
      tone: 'combo',
    },
    {
      key: 'seniorHp',
      label: 'シニアHP',
      d: buildPolyline(timeline, 'seniorHp', hpMax, width, height, pad),
      tone: 'hp',
    },
  ];

  return {
    width,
    height,
    pad,
    series,
    markers: extractInterventionMarkers(events, timeline, width, pad),
    tickStart: timeline[0].tick,
    tickEnd: timeline[timeline.length - 1].tick,
    empty: false,
  };
}
