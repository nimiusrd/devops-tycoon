/**
 * 四半期トレンド履歴のエンジン記録と再開（RI-128）。
 */
import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../../src/sim/run/engine';
import { E2E_MISSED_ADJUSTABLE_SEED } from '../../../src/sim/run/quarterReviewSeeds';
import { playUntil } from '../helpers/runFlow';

describe('trendHistory エンジン記録 (RI-128)', () => {
  it('通常スプリント完了では履歴を増やさない', () => {
    const e = new RunEngine({ seed: 'ri128-normal-sprint', difficulty: 'easy' });
    e.startRun();
    const s = playUntil(e, 'result');
    expect(s.phase).toBe('result');
    expect(s.trendHistory).toEqual([]);
    expect(s.reviewHistory).toEqual([]);
  });

  it('ボス完了で四半期スナップショットを1件追加する', () => {
    const e = new RunEngine({ seed: E2E_MISSED_ADJUSTABLE_SEED, difficulty: 'easy' });
    e.startRun();
    const s = playUntil(e, 'quarterReview');
    expect(s.phase).toBe('quarterReview');
    expect(s.trendHistory).toHaveLength(1);
    const snap = s.trendHistory[0]!;
    expect(snap.quarterNumber).toBe(s.quarterNumber);
    expect(snap.diagnosis).toBe(s.diagnosis);
    expect(snap.kpis).toEqual(s.quarterReview?.progress);
    expect(snap.company.selfRank).toBeGreaterThanOrEqual(1);
    expect(snap.departments.length).toBeGreaterThan(0);
  });

  it('途中セーブ再開後も保存前と同じ履歴を復元する', () => {
    const e = new RunEngine({ seed: E2E_MISSED_ADJUSTABLE_SEED, difficulty: 'easy' });
    e.startRun();
    playUntil(e, 'quarterReview');
    const exported = e.exportPersistState();
    expect(exported?.trendHistory).toHaveLength(1);
    const before = structuredClone(exported!.trendHistory);

    const restored = new RunEngine({ seed: 'other', difficulty: 'hard' });
    restored.hydratePersistState(exported!);
    expect(restored.snapshot().trendHistory).toEqual(before);
  });
});
