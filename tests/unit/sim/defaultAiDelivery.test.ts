/**
 * RI-77: 既定の部分配布（starter-ai-junior のみ ON）が出荷を正方向へ動かすことを固定する。
 *
 * Codex レビュー指摘に合わせ、同一 seed の Q1/S1 無介入で
 * 初期ロスター vs 全員 AI OFF を比較する。
 */
import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../../src/sim/run/engine';
import { summarizeNumeric } from '../helpers/monteCarlo';

const PAIR_SEEDS = Array.from({ length: 64 }, (_, i) => `ri77-pair-${i}`);

function runFirstSprintDelivered(seed: string, clearAi: boolean): number {
  const engine = new RunEngine({ seed, difficulty: 'normal' });
  engine.startRun();
  if (clearAi) {
    for (const member of engine.snapshot().roster.members) {
      engine.setMemberAi(member.id, false);
    }
  }
  engine.beginSetupSprint();
  engine.step(1_000_000);
  const result = engine.snapshot().lastResult;
  if (!result) throw new Error(`no result for ${seed}`);
  return result.delivered;
}

describe('RI-77 既定部分配布の出荷方向', () => {
  it('同一 seed 64 組で既定ロスターの S1 出荷平均が AI なしを上回る', () => {
    const deltas = PAIR_SEEDS.map((seed) => {
      const withDefault = runFirstSprintDelivered(seed, false);
      const withoutAi = runFirstSprintDelivered(seed, true);
      return withDefault - withoutAi;
    });
    const summary = summarizeNumeric(deltas);
    const positive = deltas.filter((d) => d > 0).length;
    expect(summary.mean).toBeGreaterThan(0);
    expect(positive).toBeGreaterThan(deltas.length / 2);
  });
});
