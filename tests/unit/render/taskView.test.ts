import { describe, expect, it } from 'vitest';
import {
  TASK_COLORS,
  taskColor,
  taskDiameter,
  taskSize,
  taskVariant,
} from '../../../src/render/taskView';
import type { Task } from '../../../src/sim/types';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 0,
    kind: 'normal',
    highValue: false,
    aiAssisted: false,
    lane: 'coding',
    progress: 0,
    reworkAttempts: 0,
    wasReworked: false,
    incident: false,
    debt: false,
    ...overrides,
  };
}

describe('taskSize（規模→サイズ）', () => {
  it('定型=小 / 通常=中 / 複雑=大', () => {
    expect(taskSize(task({ kind: 'routine' }))).toBe('small');
    expect(taskSize(task({ kind: 'normal' }))).toBe('medium');
    expect(taskSize(task({ kind: 'complex' }))).toBe('large');
  });

  it('大きい規模ほど直径が大きい', () => {
    expect(taskDiameter(task({ kind: 'complex' }))).toBeGreaterThan(
      taskDiameter(task({ kind: 'routine' })),
    );
  });
});

describe('taskVariant（状態→種別、優先度順）', () => {
  it('通常タスクは normal', () => {
    expect(taskVariant(task())).toBe('normal');
  });

  it('AI 利用は ai（光る）', () => {
    expect(taskVariant(task({ aiAssisted: true }))).toBe('ai');
  });

  it('高価値は gold（AI 利用より優先）', () => {
    expect(taskVariant(task({ highValue: true, aiAssisted: true }))).toBe('gold');
  });

  it('Rework 工程中は rework（赤）', () => {
    expect(taskVariant(task({ lane: 'rework', aiAssisted: true }))).toBe('rework');
  });

  it('炎上は incident（最優先）', () => {
    expect(taskVariant(task({ incident: true, lane: 'rework', highValue: true }))).toBe('incident');
  });

  it('負債は debt（炎上の次に優先）', () => {
    expect(taskVariant(task({ debt: true, highValue: true }))).toBe('debt');
  });
});

describe('taskColor', () => {
  it('種別に対応する色を返す', () => {
    expect(taskColor(task({ aiAssisted: true }))).toBe(TASK_COLORS.ai);
    expect(taskColor(task({ highValue: true }))).toBe(TASK_COLORS.gold);
    expect(taskColor(task({ incident: true }))).toBe(TASK_COLORS.incident);
  });
});
