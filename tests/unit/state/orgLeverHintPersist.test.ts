import { describe, expect, it } from 'vitest';
import { createGame } from '../../../src/game';
import { MIN_ORG_LEVER_BUDGET } from '../../../src/render/orgLeverHintView';
import { MemoryRunStorage } from '../../../src/state/runPersistence';
import {
  noteOrgLeverBudgetDepleted,
  resetOrgLeverHintSession,
  resolveOrgLeverHint,
} from '../../../src/ui/orgLeverHintSession';

async function flushSave(storage: MemoryRunStorage): Promise<void> {
  await storage.load();
}

describe('組織レバー案内のランセーブ', () => {
  it('レバーを開いた記録を保存し、続きから再開しても案内を出さない', async () => {
    const storage = new MemoryRunStorage();
    const game = createGame({ seed: 'org-hint-persist', runStorage: storage, metaReady: true });
    game.attachRunPersistence(storage, null);
    game.startRun('easy', [], 'org-hint-persist');
    game.persistOrgLeverHintDismissal();
    await flushSave(storage);

    const saved = await storage.load();
    expect(saved?.state.extras.orgLeverHintDismissed).toBe(true);

    resetOrgLeverHintSession();
    const resumed = createGame({ seed: 'fresh', runStorage: storage, metaReady: true });
    resumed.attachRunPersistence(storage, saved);
    resumed.resumeRun();
    const hint = resolveOrgLeverHint({
      epoch: resumed.getRunEpoch(),
      quarterNumber: 1,
      budget: MIN_ORG_LEVER_BUDGET,
      readOnly: false,
    });
    expect(hint.show).toBe(false);
    expect(hint.dismissed).toBe(true);
  });

  it('予算 0 で消した記録も保存し、再開後も案内を出さない', async () => {
    const storage = new MemoryRunStorage();
    const game = createGame({ seed: 'org-hint-zero', runStorage: storage, metaReady: true });
    game.attachRunPersistence(storage, null);
    game.startRun('easy', [], 'org-hint-zero');
    const epoch = game.getRunEpoch();
    noteOrgLeverBudgetDepleted(epoch, 0, false);
    game.persistOrgLeverHintDismissal();
    await flushSave(storage);

    const saved = await storage.load();
    expect(saved?.state.extras.orgLeverHintDismissed).toBe(true);

    resetOrgLeverHintSession();
    const resumed = createGame({ seed: 'fresh', runStorage: storage, metaReady: true });
    resumed.attachRunPersistence(storage, saved);
    resumed.resumeRun();
    const hint = resolveOrgLeverHint({
      epoch: resumed.getRunEpoch(),
      quarterNumber: 1,
      budget: MIN_ORG_LEVER_BUDGET + 50,
      readOnly: false,
    });
    expect(hint.show).toBe(false);
  });

  it('新しいランでは案内を出す', async () => {
    const storage = new MemoryRunStorage();
    const game = createGame({ seed: 'org-hint-new-run', runStorage: storage, metaReady: true });
    game.attachRunPersistence(storage, null);
    game.startRun('easy', [], 'org-hint-new-run');
    game.persistOrgLeverHintDismissal();
    await flushSave(storage);
    game.startRun('easy', [], 'org-hint-new-run-2');

    const hint = resolveOrgLeverHint({
      epoch: game.getRunEpoch(),
      quarterNumber: 1,
      budget: MIN_ORG_LEVER_BUDGET,
      readOnly: false,
    });
    expect(hint.show).toBe(true);
  });

  it('旧セーブにフィールドが無くても壊さない', async () => {
    const storage = new MemoryRunStorage();
    const game = createGame({ seed: 'org-hint-legacy', runStorage: storage, metaReady: true });
    game.attachRunPersistence(storage, null);
    game.startRun('easy', [], 'org-hint-legacy');
    await flushSave(storage);
    const saved = await storage.load();
    expect(saved).not.toBeNull();
    delete (saved!.state.extras as { orgLeverHintDismissed?: boolean }).orgLeverHintDismissed;

    resetOrgLeverHintSession();
    const resumed = createGame({ seed: 'fresh', runStorage: storage, metaReady: true });
    resumed.attachRunPersistence(storage, saved);
    expect(resumed.resumeRun()).not.toBeNull();
    const hint = resolveOrgLeverHint({
      epoch: resumed.getRunEpoch(),
      quarterNumber: 1,
      budget: MIN_ORG_LEVER_BUDGET,
      readOnly: false,
    });
    expect(hint.show).toBe(true);
  });
});
