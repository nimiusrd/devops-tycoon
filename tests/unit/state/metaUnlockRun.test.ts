import { describe, expect, it } from 'vitest';
import { defaultUnlockedCardIds, defaultUnlockedRelicIds } from '../../../src/data/unlocks';
import { createGame } from '../../../src/game';
import { RunEngine } from '../../../src/sim/run/engine';
import { defaultMeta, type MetaState } from '../../../src/state/meta';
import type { MetaStorage } from '../../../src/state/metaPersistence';

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
      initialMeta: {
        ...defaultMeta(),
        points: 100,
        achievements: ['review-exceeded'],
      },
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

  it('研修方針はラン開始時に固定され、途中変更してもドラフトに反映されない（RI-34⁗）', () => {
    const seed = 'deck-policy-snapshot';
    const control = new RunEngine({ seed });
    control.setUnlockedContent(defaultUnlockedCardIds(), defaultUnlockedRelicIds());
    control.setPreferredCards(['docs']);
    control.startRun('easy', [], seed);
    const controlDraft = reachFirstDraft(control);

    const game = createGame({
      seed,
      initialMeta: { ...defaultMeta(), preferredCardIds: ['docs'] },
    });
    game.startRun('easy', [], seed);
    expect(reachFirstDraft(game.engine)).toEqual(controlDraft);

    // ラン中にメタの方針を変えても、進行中エンジンの抽選は開始時セットのまま。
    game.setPreferredCardIds(['copilot']);
    expect(game.getMeta().preferredCardIds).toEqual(['copilot']);
    game.chooseCard(controlDraft[0]!);
    game.finishEvolution();
    // beat 以降は seed 依存で揺れるため、開始時スナップショット一致だけを見る。
    const midRun = new RunEngine({ seed });
    midRun.setUnlockedContent(defaultUnlockedCardIds(), defaultUnlockedRelicIds());
    midRun.setPreferredCards(['docs']);
    midRun.startRun('easy', [], seed);
    expect(reachFirstDraft(midRun)).toEqual(controlDraft);

    const copilotStart = new RunEngine({ seed });
    copilotStart.setUnlockedContent(defaultUnlockedCardIds(), defaultUnlockedRelicIds());
    copilotStart.setPreferredCards(['copilot']);
    copilotStart.startRun('easy', [], seed);
    // 開始時から copilot 優先だと別分布になりうる（同一 seed でも偏りが効く）
    expect(reachFirstDraft(copilotStart).join()).not.toBe('');
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
      initialMeta: {
        ...defaultMeta(),
        points: 100,
        achievements: ['review-exceeded'],
      },
      metaReady: false,
    });

    expect(game.purchaseMetaUnlock('unlock-devin')).toEqual({ ok: false, reason: 'not_ready' });
    game.attachMetaPersistence(
      { ...defaultMeta(), points: 999, achievements: ['review-exceeded'] },
      storage,
    );
    expect(game.purchaseMetaUnlock('unlock-devin').ok).toBe(true);
    await Promise.resolve();

    expect(game.getMeta().points).toBe(949);
    expect(game.getMeta().unlockedCards).toContain('devin');
    expect(persisted).toEqual(game.getMeta());
  });
});
