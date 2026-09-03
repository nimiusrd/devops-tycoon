import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { defaultUnlockedCardIds, UNLOCK_DEFS } from '../../src/data/unlocks';
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

const META_SHOP_VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568, columns: 1 },
  { name: 'issue-438', width: 375, height: 812, columns: 1 },
  { name: 'phone', width: 390, height: 844, columns: 1 },
  { name: 'desktop', width: 1440, height: 900, columns: 2 },
] as const;

async function expectMetaShopLayout(
  page: Page,
  viewport: (typeof META_SHOP_VIEWPORTS)[number],
): Promise<void> {
  const dialog = page.getByTestId('meta-shop');
  const grid = dialog.locator('.meta-shop-grid');
  const items = grid.locator('.meta-shop-item');
  await expect(items).toHaveCount(UNLOCK_DEFS.length);

  const boxes = await items.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
  );
  const first = boxes[0];
  const second = boxes[1];
  expect(first).toBeDefined();
  expect(second).toBeDefined();

  if (viewport.columns === 1) {
    expect(
      Math.abs(second!.x - first!.x),
      `${viewport.name} で商品が1列になっていない`,
    ).toBeLessThanOrEqual(1);
    expect(second!.y, `${viewport.name} で商品が縦に並んでいない`).toBeGreaterThanOrEqual(
      first!.y + first!.height - 1,
    );
  } else {
    expect(
      Math.abs(second!.y - first!.y),
      `${viewport.name} で商品が2列になっていない`,
    ).toBeLessThanOrEqual(1);
    expect(second!.x, `${viewport.name} で2列目が横に並んでいない`).toBeGreaterThanOrEqual(
      first!.x + first!.width - 1,
    );
  }

  const overflowed = await items.evaluateAll((elements) =>
    elements.flatMap((item, itemIndex) =>
      Array.from(
        item.querySelectorAll<HTMLElement>(
          '.meta-shop-name, .meta-shop-target, .meta-shop-desc, .meta-shop-status',
        ),
      )
        .filter(
          (element) =>
            element.scrollWidth > element.clientWidth + 1 ||
            element.scrollHeight > element.clientHeight + 1,
        )
        .map((element) => `${itemIndex}:${element.className}`),
    ),
  );
  expect(overflowed, `${viewport.name} で商品情報が切れている`).toEqual([]);

  const pageWidth = await page.evaluate(() => ({
    viewport: window.innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(
    pageWidth.content,
    `${viewport.name} でページに横スクロールが発生している`,
  ).toBeLessThanOrEqual(pageWidth.viewport);

  const lastItem = items.last();
  await lastItem.scrollIntoViewIfNeeded();
  const lastItemReachable = await lastItem.evaluate((element) => {
    const body = element.closest('.result-overlay-body');
    if (!(body instanceof HTMLElement)) return false;
    const itemRect = element.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    return itemRect.top >= bodyRect.top - 1 && itemRect.bottom <= bodyRect.bottom + 1;
  });
  expect(lastItemReachable, `${viewport.name} で最後の商品へ到達できない`).toBe(true);

  const closeBox = await page.getByTestId('meta-shop-close').boundingBox();
  expect(closeBox).not.toBeNull();
  expect(closeBox!.y, `${viewport.name} で閉じるボタンの上端が画面外`).toBeGreaterThanOrEqual(0);
  expect(
    closeBox!.y + closeBox!.height,
    `${viewport.name} で閉じるボタンの下端が画面外`,
  ).toBeLessThanOrEqual(viewport.height + 1);
}

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

for (const viewport of META_SHOP_VIEWPORTS) {
  test(`メタショップは ${viewport.name} で商品情報を読める列数にする`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedMeta(page, { ...DEFAULT_META, points: 0, achievements: [] });
    await page.goto(`/?renderer=dom&seed=meta-shop-${viewport.name}`);

    await page.getByTestId('open-meta-shop').click();
    await expect(page.getByTestId('meta-shop')).toBeVisible();
    await expectMetaShopLayout(page, viewport);
  });
}

test('メタショップは Escape で閉じ、起点ボタンへフォーカスが戻る', async ({ page }) => {
  await seedMeta(page, DEFAULT_META);

  await page.goto('/?renderer=dom&seed=meta-shop-escape');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.getByTestId('open-meta-shop').click();
  await expect(page.getByTestId('meta-shop')).toBeVisible();
  await expect(page.getByTestId('title')).toHaveAttribute('inert', '');

  await page.getByTestId('meta-shop-close').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('meta-shop')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid')))
    .toBe('open-meta-shop');
});

test('メタショップは背景クリックで閉じ、パネルクリックでは閉じない', async ({ page }) => {
  await seedMeta(page, DEFAULT_META);

  await page.goto('/?renderer=dom&seed=meta-shop-backdrop');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.getByTestId('open-meta-shop').click();
  const dialog = page.getByTestId('meta-shop');
  await expect(dialog).toBeVisible();

  await page.locator('.meta-shop-panel').click();
  await expect(dialog).toBeVisible();

  await page.getByTestId('meta-shop-backdrop').click({ position: { x: 8, y: 8 } });
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid')))
    .toBe('open-meta-shop');
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

async function hangTitleModalChunk(page: Page, chunk: RegExp): Promise<void> {
  await page.route(chunk, () => new Promise(() => {}));
}

async function expectHungTitleModalDismissesToOpener(
  page: Page,
  options: {
    seed: string;
    chunk: RegExp;
    openTestId: string;
    dismiss: 'escape' | 'backdrop';
  },
): Promise<void> {
  await seedMeta(page, DEFAULT_META);
  await hangTitleModalChunk(page, options.chunk);
  await page.goto(`/?renderer=dom&seed=${options.seed}`);
  await expect(page.getByTestId('title')).toBeVisible();

  await page.getByTestId(options.openTestId).click();
  await expect(page.getByTestId('title-modal-loading')).toBeVisible();
  await expect(page.getByTestId('title')).toHaveAttribute('inert', '');

  if (options.dismiss === 'escape') {
    await page.keyboard.press('Escape');
  } else {
    await page.getByTestId('title-modal-loading-dismiss').click({ position: { x: 8, y: 8 } });
  }

  await expect(page.getByTestId('title-modal-loading')).toHaveCount(0);
  await expect(page.getByTestId('title')).not.toHaveAttribute('inert');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid')))
    .toBe(options.openTestId);
}

test('メタショップの lazy 読込が止まっても Escape で起点へ戻る', async ({ page }) => {
  await expectHungTitleModalDismissesToOpener(page, {
    seed: 'meta-shop-lazy-escape',
    chunk: /MetaShopScreen/,
    openTestId: 'open-meta-shop',
    dismiss: 'escape',
  });
});

test('メタショップの lazy 読込が止まっても背景クリックで起点へ戻る', async ({ page }) => {
  await expectHungTitleModalDismissesToOpener(page, {
    seed: 'meta-shop-lazy-backdrop',
    chunk: /MetaShopScreen/,
    openTestId: 'open-meta-shop',
    dismiss: 'backdrop',
  });
});

test('カードコレクションの lazy 読込が止まっても Escape で起点へ戻る', async ({ page }) => {
  await expectHungTitleModalDismissesToOpener(page, {
    seed: 'card-collection-lazy-escape',
    chunk: /CardCollectionScreen/,
    openTestId: 'open-card-collection',
    dismiss: 'escape',
  });
});
