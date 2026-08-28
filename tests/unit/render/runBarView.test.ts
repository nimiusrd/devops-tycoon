import { describe, expect, it } from 'vitest';
import { runBarSprintView } from '../../../src/render/runBarView';
import type { RunPhase } from '../../../src/sim/run/types';

const TOTAL = 6;
const INTER_SPRINT_PHASES: readonly RunPhase[] = [
  'setup',
  'result',
  'draft',
  'evolution',
  'beat',
  'shop',
  'rest',
  'recruit',
  'quarterReview',
];

describe('runBarSprintView', () => {
  it('未開始の編成では 1/6 を出し、導線の次スプリントと一致する', () => {
    expect(
      runBarSprintView({
        phase: 'setup',
        sprintIndexInQuarter: 0,
        sprintsPerQuarter: TOTAL,
      }),
    ).toEqual({ current: 1, total: TOTAL, bossNext: false });
  });

  it('スプリント 1 進行中は 1/6 を出す', () => {
    expect(
      runBarSprintView({
        phase: 'sprint',
        sprintIndexInQuarter: 1,
        sprintsPerQuarter: TOTAL,
      }),
    ).toEqual({ current: 1, total: TOTAL, bossNext: false });
  });

  it('スプリント 1 終了後は次スプリント 2/6 を出す', () => {
    for (const phase of INTER_SPRINT_PHASES) {
      expect(
        runBarSprintView({
          phase,
          sprintIndexInQuarter: 1,
          sprintsPerQuarter: TOTAL,
        }),
        phase,
      ).toEqual({ current: 2, total: TOTAL, bossNext: false });
    }
  });

  it('スプリント 5 進行中は 5/6 と次が山場を出す', () => {
    expect(
      runBarSprintView({
        phase: 'sprint',
        sprintIndexInQuarter: 5,
        sprintsPerQuarter: TOTAL,
      }),
    ).toEqual({ current: 5, total: TOTAL, bossNext: true });
  });

  it('ボス直前の編成では 6/6 を出し、次が山場は出さない', () => {
    expect(
      runBarSprintView({
        phase: 'setup',
        sprintIndexInQuarter: 5,
        sprintsPerQuarter: TOTAL,
      }),
    ).toEqual({ current: 6, total: TOTAL, bossNext: false });
  });

  it('ボススプリント中は 6/6 を出し、次が山場は出さない', () => {
    expect(
      runBarSprintView({
        phase: 'sprint',
        sprintIndexInQuarter: 6,
        sprintsPerQuarter: TOTAL,
      }),
    ).toEqual({ current: 6, total: TOTAL, bossNext: false });
  });

  it('四半期最終スプリント終了後も 6 を超えない', () => {
    expect(
      runBarSprintView({
        phase: 'quarterReview',
        sprintIndexInQuarter: 6,
        sprintsPerQuarter: TOTAL,
      }),
    ).toEqual({ current: 6, total: TOTAL, bossNext: false });
  });
});
