import { describe, expect, it } from 'vitest';
import { defaultUnlockedCardIds, defaultUnlockedRelicIds } from '../../src/data/unlocks';
import { createGame } from '../../src/game';
import { RunEngine } from '../../src/sim/run/engine';
import { defaultMeta, type MetaState } from '../../src/state/meta';
import type { MetaStorage } from '../../src/state/metaPersistence';

function reachFirstDraft(e: RunEngine): string[] {
  let s = e.snapshot();
  let guard = 0;
  while (s.phase !== 'draft' && s.status === 'playing' && guard < 5000) {
    guard += 1;
    switch (s.phase) {
      case 'setup':
        e.beginSetupSprint();
        break;
      case 'sprint':
        e.step(1_000_000);
        break;
      case 'result':
        e.acknowledgeResult();
        break;
      default:
        guard = 5000;
        break;
    }
    s = e.snapshot();
  }
  expect(s.phase).toBe('draft');
  return s.draft ?? [];
}

describe('解放プールのラン反映（spec-mapping §2 M7）', () => {
  it('RunEngine は allowed 指定時、ドラフトが解放セット内に限定される', () => {
    const allowed = defaultUnlockedCardIds();
    const e = new RunEngine({ seed: 'pool-draft' });
    e.setUnlockedContent(allowed, defaultUnlockedRelicIds());
    e.startRun('easy', [], 'pool-draft');
    const draft = reachFirstDraft(e);
    expect(draft.length).toBeGreaterThan(0);
    expect(draft.every((id) => allowed.has(id))).toBe(true);
    expect(draft).not.toContain('devin');
  });

  it('devin 解放後もドラフトは解放セット内に限定される', () => {
    const allowed = new Set(defaultUnlockedCardIds());
    allowed.add('devin');
    const e = new RunEngine({ seed: 'pool-draft-devin' });
    e.setUnlockedContent(allowed, defaultUnlockedRelicIds());
    e.startRun('easy', [], 'pool-draft-devin');
    const draft = reachFirstDraft(e);
    expect(draft.every((id) => allowed.has(id))).toBe(true);
  });

  it('createGame.purchaseMetaUnlock 後の startRun に購入済みカードが反映される', async () => {
    let persisted: MetaState | null = null;
    const storage: MetaStorage = {
      load: async () => persisted,
      save: async (meta) => {
        persisted = meta;
      },
    };

    const game = createGame({
      seed: 'meta-game',
      initialMeta: { ...defaultMeta(), points: 100 },
      metaStorage: storage,
    });
    expect(game.purchaseMetaUnlock('unlock-devin').ok).toBe(true);
    await Promise.resolve();
    expect(persisted?.unlockedCards).toContain('devin');

    game.startRun('easy', [], 'meta-game');
    const draft = reachFirstDraft(game.engine);
    const allowed = new Set(defaultUnlockedCardIds());
    allowed.add('devin');
    expect(draft.every((id) => allowed.has(id))).toBe(true);
  });

  it('永続化接続前のメタ購入を止め、復元値を正として接続する', async () => {
    let persisted: MetaState | null = null;
    const storage: MetaStorage = {
      load: async () => null,
      save: async (meta) => {
        persisted = meta;
      },
    };
    const game = createGame({
      initialMeta: { ...defaultMeta(), points: 100 },
      metaReady: false,
    });

    expect(game.purchaseMetaUnlock('unlock-devin')).toEqual({ ok: false, reason: 'not_ready' });
    game.attachMetaPersistence({ ...defaultMeta(), points: 999 }, storage);
    expect(game.purchaseMetaUnlock('unlock-devin').ok).toBe(true);
    await Promise.resolve();

    expect(game.getMeta().points).toBe(949);
    expect(game.getMeta().unlockedCards).toContain('devin');
    expect(persisted).toEqual(game.getMeta());
  });
});
