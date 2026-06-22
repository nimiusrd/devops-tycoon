import { describe, expect, it, vi } from 'vitest';
import { defaultUnlockedCardIds, defaultUnlockedRelicIds } from '../../src/data/unlocks';
import { createGame } from '../../src/game';
import { RunEngine } from '../../src/sim/run/engine';
import { defaultMeta, saveMeta } from '../../src/state/meta';

function reachFirstDraft(e: RunEngine): string[] {
  let s = e.snapshot();
  let guard = 0;
  while (s.phase !== 'draft' && s.status === 'playing' && guard < 5000) {
    guard += 1;
    switch (s.phase) {
      case 'map':
        e.enterNode(s.available[0]);
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

describe('解放プールのラン反映（phase-7 §7b）', () => {
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

  it('createGame.purchaseMetaUnlock 後の startRun に購入済みカードが反映される', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });
    saveMeta({ ...defaultMeta(), points: 100 }, storage);

    const game = createGame({ seed: 'meta-game' });
    expect(game.purchaseMetaUnlock('unlock-devin').ok).toBe(true);

    game.startRun('easy', [], 'meta-game');
    const draft = reachFirstDraft(game.engine);
    const allowed = new Set(defaultUnlockedCardIds());
    allowed.add('devin');
    expect(draft.every((id) => allowed.has(id))).toBe(true);

    vi.unstubAllGlobals();
  });
});
