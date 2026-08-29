import { describe, expect, it } from 'vitest';
import {
  BOARD_EFFECT_BUDGET,
  boardEffectProgress,
  boardEffectSfx,
  createTimedBoardEffects,
  mergeTimedBoardEffects,
  type BoardEffectPayload,
} from '../../../src/render/boardEffects';
import { VISUAL_TOKENS } from '../../../src/render/visualTokens';

const ignite: BoardEffectPayload = {
  source: 'fire',
  effect: { kind: 'ignite', taskId: 1, x: 640, y: 320 },
};

const spread: BoardEffectPayload = {
  source: 'fire',
  effect: {
    kind: 'spread',
    fromTaskId: 1,
    toTaskId: 2,
    fromX: 600,
    fromY: 330,
    toX: 760,
    toY: 250,
  },
};

const sweep = (staggerIndex: number): BoardEffectPayload => ({
  source: 'intervention',
  effect: {
    kind: 'reviewSweep',
    taskId: staggerIndex,
    fromX: 760,
    fromY: 250,
    toX: 1120,
    toY: 330,
    staggerIndex,
    outcome: 'done',
  },
});

describe('boardEffects timeline (RI-142)', () => {
  it('発火順・位置・stagger・終了時刻を再現可能な plan に固定する', () => {
    const startedAtMs = 1_000;
    const timeline = createTimedBoardEffects([ignite, sweep(2)], 7, startedAtMs);
    const tokens = VISUAL_TOKENS.dimensions.sprint.boardEffects;

    expect(timeline.nextSequence).toBe(9);
    expect(timeline.effects.map((effect) => effect.sequence)).toEqual([7, 8]);
    expect(timeline.effects[0]).toMatchObject({
      source: 'fire',
      effect: { kind: 'ignite', x: 640, y: 320 },
      startedAtMs,
      delayMs: 0,
      durationMs: tokens.ignite.durationMs,
      endsAtMs: startedAtMs + tokens.ignite.durationMs + tokens.lingerMs,
    });
    expect(timeline.effects[1]).toMatchObject({
      source: 'intervention',
      effect: { kind: 'reviewSweep', fromX: 760, toX: 1120 },
      delayMs: tokens.sweep.staggerMs * 2,
      durationMs: tokens.sweep.durationMs,
      endsAtMs:
        startedAtMs + tokens.sweep.staggerMs * 2 + tokens.sweep.durationMs + tokens.lingerMs,
    });
  });

  it('delay 前・中間・終了後の進捗を 0..1 に丸める', () => {
    const [effect] = createTimedBoardEffects([sweep(1)], 0, 500).effects;
    const start = effect.startedAtMs + effect.delayMs;
    expect(boardEffectProgress(effect, start - 1)).toBe(0);
    expect(boardEffectProgress(effect, start + effect.durationMs / 2)).toBeCloseTo(0.5);
    expect(boardEffectProgress(effect, start + effect.durationMs + 1)).toBe(1);
  });

  it('期限切れを除外し、連続 batch を新しい順に共有上限へ丸める', () => {
    const payloads = Array.from({ length: BOARD_EFFECT_BUDGET + 5 }, (_, index) => sweep(index));
    const timeline = createTimedBoardEffects(payloads, 0, 1_000);
    const merged = mergeTimedBoardEffects([], timeline.effects, 1_000);
    expect(merged).toHaveLength(BOARD_EFFECT_BUDGET);
    expect(merged[0].sequence).toBe(5);

    const afterExpiry = mergeTimedBoardEffects(merged, [], 10_000);
    expect(afterExpiry).toEqual([]);
  });

  it('連続イベントでも最新20件だけを保持しsequenceを単調増加させる', () => {
    let current = [] as ReturnType<typeof createTimedBoardEffects>['effects'];
    let nextSequence = 0;
    for (let batchIndex = 0; batchIndex < 5; batchIndex += 1) {
      const batch = createTimedBoardEffects(
        Array.from({ length: 6 }, (_, index) => sweep(batchIndex * 6 + index)),
        nextSequence,
        1_000,
      );
      nextSequence = batch.nextSequence;
      current = mergeTimedBoardEffects(current, batch.effects, 1_000);
    }
    expect(nextSequence).toBe(30);
    expect(current).toHaveLength(BOARD_EFFECT_BUDGET);
    expect(current.map((effect) => effect.sequence)).toEqual(
      Array.from({ length: BOARD_EFFECT_BUDGET }, (_, index) => index + 10),
    );
  });

  it('複数粒でも効果音を種類ごとに一度だけ返し、描画経路を入力にしない', () => {
    expect(boardEffectSfx([spread, spread, sweep(0), sweep(1)])).toEqual([
      'fireSpread',
      'interventionHit',
    ]);
    expect(boardEffectSfx([ignite])).toEqual([]);
  });
});
