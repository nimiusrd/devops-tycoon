import { expect, test } from '@playwright/test';
import type { MetaState } from '../../src/state/meta';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    getMeta(): MetaState;
    purchaseMetaUnlock(unlockId: string): { ok: boolean; reason?: string };
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    enterNode(id: string): RunState;
    step(ms: number): RunState;
    acknowledgeResult(): RunState;
    chooseCard(defId: string): RunState;
    skipDraft(): RunState;
    finishEvolution(): RunState;
    revision(): number;
  };
};

const DEFAULT_META: MetaState = {
  points: 100,
  unlockedDifficulties: ['easy', 'normal'],
  defeatedBosses: [],
  achievements: [],
  bestScore: 0,
  unlockedCards: [],
  unlockedRelics: [],
  unlockedPresets: [],
};

test('メタショップ購入が次ランのドラフトプールへ反映される', async ({ page }) => {
  await page.addInitScript((meta) => {
    localStorage.setItem('devops-tycoon:meta:v1', JSON.stringify(meta));
  }, DEFAULT_META);

  await page.goto('/?seed=meta-shop-e2e');

  const result = await page.evaluate(async () => {
    const g = (window as GameWindow).game!;
    g.pause();

    const before = g.purchaseMetaUnlock('unlock-devin');
    if (!before.ok) return { ok: false, step: 'purchase', reason: before.reason };

    const meta = g.getMeta();
    if (!meta.unlockedCards.includes('devin')) return { ok: false, step: 'meta' };

    g.startRun('easy', [], 'meta-shop-e2e');

    let s = g.getState();
    let guard = 0;
    while (s.phase !== 'draft' && s.status === 'playing' && guard < 5000) {
      guard += 1;
      switch (s.phase) {
        case 'map':
          g.enterNode(s.available[0]);
          break;
        case 'sprint':
          g.step(1_000_000);
          break;
        case 'result':
          g.acknowledgeResult();
          break;
        default:
          guard = 5000;
          break;
      }
      s = g.getState();
    }

    if (s.phase !== 'draft' || !s.draft) return { ok: false, step: 'draft-phase' };

    const onlyUnlocked = s.draft.every((id) => {
      const defaults = ['copilot', 'auto-test', 'pr-size-limit', 'ai-guideline', 'docs', 'devin'];
      return defaults.includes(id);
    });

    return { ok: onlyUnlocked, draft: s.draft, points: meta.points };
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`meta shop e2e failed at ${result.step}: ${JSON.stringify(result)}`);
  }
});

test('タイトルからメタショップを開いて購入できる', async ({ page }) => {
  await page.addInitScript((meta) => {
    localStorage.setItem('devops-tycoon:meta:v1', JSON.stringify(meta));
  }, DEFAULT_META);

  await page.goto('/?seed=meta-shop-ui');

  await page.getByTestId('open-meta-shop').click();
  await expect(page.getByTestId('meta-shop')).toBeVisible();
  await expect(page.getByTestId('meta-shop-points')).toHaveText('100');

  await page.getByTestId('meta-unlock-unlock-devin').click();
  await expect(page.getByTestId('meta-shop-points')).toHaveText('50');
  await expect(page.getByTestId('meta-unlock-unlock-devin')).toBeDisabled();
});
