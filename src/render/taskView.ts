/**
 * 「状態→見た目」マッピング（SPEC 第4.1 の表）。
 *
 * Task の状態から、盤面に描く粒のサイズ・種別・色を導出する純関数。
 * 描画は状態を読むだけ（第22.2）なので、ここは GPU 不要で Vitest で検証できる（第22.5）。
 */
import type { Task } from '../sim/types';

/** 粒のサイズ（SPEC 第4.1: 小=定型 / 中=通常 / 大=複雑）。 */
export type TaskSize = 'small' | 'medium' | 'large';

/**
 * 粒の種別（SPEC 第4.1 の見た目）。
 * normal=通常 / ai=光る / rework=赤 / incident=炎上 / gold=金 / debt=黒。
 */
export type TaskVariant = 'normal' | 'ai' | 'rework' | 'incident' | 'gold' | 'debt';

/** 種別ごとの色（mockups/main-screen.html 準拠）。 */
export const TASK_COLORS: Record<TaskVariant, string> = {
  normal: '#cdbff0',
  ai: '#9a6bff',
  rework: '#e04b40',
  incident: '#ff5f1f',
  gold: '#f5b400',
  debt: '#14161f',
};

/** 粒の直径（px）。 */
export const TASK_DIAMETER: Record<TaskSize, number> = {
  small: 16,
  medium: 26,
  large: 34,
};

/** タスク規模から粒のサイズを決める。 */
export function taskSize(task: Task): TaskSize {
  switch (task.kind) {
    case 'routine':
      return 'small';
    case 'complex':
      return 'large';
    default:
      return 'medium';
  }
}

/**
 * タスクの状態から粒の種別を決める（優先度順）。
 * 炎上 > 負債 > 手戻り中 > 高価値 > AI利用 > 通常。
 */
export function taskVariant(task: Task): TaskVariant {
  if (task.incident) return 'incident';
  if (task.debt) return 'debt';
  if (task.lane === 'rework') return 'rework';
  if (task.highValue) return 'gold';
  if (task.aiAssisted) return 'ai';
  return 'normal';
}

/** タスクの色（種別から導出）。 */
export function taskColor(task: Task): string {
  return TASK_COLORS[taskVariant(task)];
}

/** タスクの直径 px（サイズから導出）。 */
export function taskDiameter(task: Task): number {
  return TASK_DIAMETER[taskSize(task)];
}
