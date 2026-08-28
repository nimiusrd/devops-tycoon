import { expect, test } from './fixtures';
import { defaultUnlockedCardIds } from '../../src/data/unlocks';
import type { MetaState } from '../../src/state/meta';
import type { RunState } from '../../src/sim/run/types';
import { seedMeta } from './seedMeta';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    getMeta(): MetaState;
    purchaseMetaUnlock(unlockId: string): { ok: boolean; reason?: string };
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    beginSetupSprint(): RunState;
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
  achievements: ['review-exceeded'],
  collectedWinTypes: [],
  collectedDiagnoses: [],
  bestScore: 0,
  unlockedCards: [],
  unlockedRelics: [],
  preferredCardIds: [],
  dailyRuns: {},
  soundMuted: false,
  seenTutorial: true,
};

test('メタショップ購入が次ランのドラフトプールへ反映される', async ({ page }) => {
  await seedMeta(page, DEFAULT_META);

  await page.goto('/?renderer=dom&seed=meta-shop-e2e');
  await expect(page.getByTestId('title')).toBeVisible();

  const allowedDraft = [...defaultUnlockedCardIds(), 'devin'];
  const result = await page.evaluate(async (allowed) => {
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
        case 'setup':
          g.beginSetupSprint();
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

    const onlyUnlocked = s.draft.every((id) => allowed.includes(id));

    return { ok: onlyUnlocked, draft: s.draft, points: meta.points };
  }, allowedDraft);

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`meta shop e2e failed at ${result.step}: ${JSON.stringify(result)}`);
  }
});

test('タイトルからメタショップを開いて購入できる', async ({ page }) => {
  await seedMeta(page, DEFAULT_META);

  await page.goto('/?renderer=dom&seed=meta-shop-ui');

  await page.getByTestId('open-meta-shop').click();
  await expect(page.getByTestId('meta-shop')).toBeVisible();
  await expect(page.getByTestId('meta-shop-points')).toHaveText('100');

  await page.getByTestId('meta-unlock-unlock-devin').click();
  await expect(page.getByTestId('meta-shop-points')).toHaveText('50');
  await expect(page.getByTestId('meta-unlock-unlock-devin')).toBeDisabled();
});

test('メタショップの初回 lazy 読込後も Tab はダイアログ内から始まる', async ({ page }) => {
  await seedMeta(page, DEFAULT_META);
  await page.route(/MetaShopScreen/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });

  await page.goto('/?renderer=dom&seed=meta-shop-lazy-focus');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.getByTestId('open-meta-shop').click();
  await expect(page.getByTestId('title-modal-loading')).toBeVisible();
  await expect(page.getByTestId('meta-shop')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('title-modal-loading')).toHaveCount(0);
  await expect(page.getByTestId('title')).toHaveAttribute('inert', '');

  const afterLoad = await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="meta-shop"]');
    const active = document.activeElement;
    const testId = active instanceof HTMLElement ? (active.dataset.testid ?? active.tagName) : '';
    const inside =
      overlay instanceof HTMLElement && (active === overlay || overlay.contains(active));
    return { inside, testId };
  });
  expect(afterLoad.inside, `読込後のフォーカスがメタショップ外 (${afterLoad.testId})`).toBe(true);

  await page.keyboard.press('Tab');
  const afterTab = await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="meta-shop"]');
    const active = document.activeElement;
    const testId = active instanceof HTMLElement ? (active.dataset.testid ?? active.tagName) : '';
    const inside =
      overlay instanceof HTMLElement && (active === overlay || overlay.contains(active));
    return { inside, testId };
  });
  expect(afterTab.inside, `Tab でタイトル背面へ抜けた (${afterTab.testId})`).toBe(true);
  expect(['open-help', 'open-replays', 'open-meta-shop', 'title']).not.toContain(afterTab.testId);
});
