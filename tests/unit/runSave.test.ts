import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../src/sim/run/engine';
import { RUN_SAVE_ENGINE_VERSION, RUN_SAVE_SCHEMA_VERSION } from '../../src/sim/run/hydrateState';
import { normalizeRunSave } from '../../src/state/runSave';
import { playUntil } from './helpers/runFlow';

function exportWithGame(engine: RunEngine) {
  const partial = engine.exportHydrateState();
  if (!partial) throw new Error('export failed');
  return {
    ...partial,
    savedAt: 1,
    game: { activeDailyDate: null as string | null, recorded: false },
  };
}

describe('ランセーブ正規化（RI-58）', () => {
  it('export した blob を normalize で往復できる', () => {
    const engine = new RunEngine({ seed: 'save-norm', difficulty: 'easy' });
    engine.startRun('easy', [], 'save-norm');
    const blob = exportWithGame(engine);
    expect(normalizeRunSave(blob)).toEqual(blob);
  });

  it('schemaVersion / engineVersion 不一致は null', () => {
    const engine = new RunEngine({ seed: 'save-ver', difficulty: 'easy' });
    engine.startRun('easy', [], 'save-ver');
    const blob = exportWithGame(engine);
    expect(normalizeRunSave({ ...blob, schemaVersion: RUN_SAVE_SCHEMA_VERSION + 1 })).toBeNull();
    expect(normalizeRunSave({ ...blob, engineVersion: RUN_SAVE_ENGINE_VERSION + 1 })).toBeNull();
  });

  it('壊れた JSON 相当は null', () => {
    expect(normalizeRunSave(null)).toBeNull();
    expect(normalizeRunSave({})).toBeNull();
    expect(normalizeRunSave({ schemaVersion: 1, engineVersion: 1 })).toBeNull();
  });

  it('sprint フェーズの export は null', () => {
    const engine = new RunEngine({ seed: 'save-sprint', difficulty: 'easy' });
    engine.startRun('easy', [], 'save-sprint');
    engine.beginSetupSprint();
    expect(engine.currentPhase()).toBe('sprint');
    expect(engine.exportHydrateState()).toBeNull();
  });
});

describe('RunEngine hydrate（RI-58）', () => {
  it('setup セーブを往復しても snapshot の決定論フィールドが一致する', () => {
    const a = new RunEngine({ seed: 'hydrate-setup', difficulty: 'normal' });
    a.startRun('normal', [], 'hydrate-setup');
    a.applyOrgLever('standardize');
    const before = a.snapshot();
    const blob = exportWithGame(a);

    const b = new RunEngine({ seed: 'other', difficulty: 'easy' });
    expect(b.hydrate(blob)).toBe(true);
    const after = b.snapshot();

    expect(after.seed).toBe(before.seed);
    expect(after.phase).toBe('setup');
    expect(after.budget).toBe(before.budget);
    expect(after.org).toEqual(before.org);
    expect(after.deck).toEqual(before.deck);
    expect(after.sprint).toBeNull();
  });

  it('quarterReview まで進めたセーブから再開すると同一結果になる', () => {
    const seed = 'hydrate-qr';
    const original = new RunEngine({ seed, difficulty: 'easy' });
    playUntil(original, 'quarterReview', { skilled: true });
    const blob = exportWithGame(original);
    const mid = original.snapshot();

    const restored = new RunEngine({ seed: 'x', difficulty: 'nightmare' });
    expect(restored.hydrate(blob)).toBe(true);
    expect(restored.snapshot().phase).toBe(mid.phase);
    expect(restored.snapshot().sprintsPlayed).toBe(mid.sprintsPlayed);
    expect(restored.snapshot().quarterTotals).toEqual(mid.quarterTotals);

    // 同じ操作で最終結果も一致させる（レビュー承認）。
    original.acknowledgeQuarterReview();
    restored.acknowledgeQuarterReview();
    expect(restored.snapshot().status).toBe(original.snapshot().status);
  });

  it('allowedCards を保存時のプールで固定する', () => {
    const engine = new RunEngine({ seed: 'hydrate-pool', difficulty: 'easy' });
    engine.setUnlockedContent(new Set(['devin']), new Set());
    engine.startRun('easy', [], 'hydrate-pool');
    const blob = exportWithGame(engine);
    expect(blob.private.allowedCards).toContain('devin');

    const other = new RunEngine({ seed: 'hydrate-pool', difficulty: 'easy' });
    other.setUnlockedContent(new Set(), new Set());
    expect(other.hydrate(blob)).toBe(true);
    const reexport = other.exportHydrateState();
    expect(reexport?.private.allowedCards).toContain('devin');
  });
});
