import { expect, test } from './fixtures';
import { CARD_DEFS } from '../../src/data/cards';
import { defaultUnlockedCardIds } from '../../src/data/unlocks';
import type { MetaState } from '../../src/state/meta';
import { seedMeta } from './seedMeta';

type GameWindow = Window & {
  game?: {
    getMeta(): MetaState;
  };
};

const BASE_META: MetaState = {
  points: 0,
  unlockedDifficulties: ['easy', 'normal'],
  defeatedBosses: [],
  achievements: [],
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

const defaultUnlocked = defaultUnlockedCardIds();
const lockedCardId = CARD_DEFS.find((def) => !defaultUnlocked.has(def.id))!.id;
const unlockedCardId = CARD_DEFS.find((def) => defaultUnlocked.has(def.id))!.id;

test('タイトルからカードコレクションを開き、一覧・詳細・フィルターを操作できる（RI-65）', async ({
  page,
}) => {
  await seedMeta(page, BASE_META);

  await page.goto('/?renderer=dom&seed=card-collection-e2e');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.getByTestId('open-card-collection').click();
  await expect(page.getByTestId('card-collection')).toBeVisible();
  await expect(page.getByTestId('card-collection-count')).toHaveText(
    `${defaultUnlocked.size}/${CARD_DEFS.length}`,
  );

  for (const def of CARD_DEFS) {
    const item = page.getByTestId(`card-collection-item-${def.id}`);
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute(
      'data-unlocked',
      defaultUnlocked.has(def.id) ? 'true' : 'false',
    );
  }

  await page.getByTestId(`card-collection-item-${unlockedCardId}`).click();
  await expect(page.getByTestId('card-collection-detail')).toBeVisible();
  await expect(page.getByTestId(`card-effect-tags-${unlockedCardId}`)).toBeVisible();
  await expect(page.getByTestId('card-collection-prefer')).toBeVisible();

  await page.getByTestId(`card-collection-item-${lockedCardId}`).click();
  await expect(page.getByTestId('card-collection-unlock-condition')).toContainText('解放条件');
  await expect(page.getByTestId('card-collection-unlock-condition')).toContainText('pt');

  await page.getByTestId('card-collection-filter-rare').click();
  await expect(page.getByTestId('card-collection-filter-rare')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const def of CARD_DEFS) {
    const item = page.getByTestId(`card-collection-item-${def.id}`);
    if (def.rarity === 'rare') {
      await expect(item).toBeVisible();
    } else {
      await expect(item).toHaveCount(0);
    }
  }

  await page.getByTestId('card-collection-filter-all').click();
  await page.getByTestId(`card-collection-item-${unlockedCardId}`).click();
  await page.getByTestId('card-collection-prefer').click();
  await expect(page.getByTestId('card-collection-prefer-count')).toHaveText('優先 1 / 2');
  await expect(page.getByTestId(`card-collection-item-${unlockedCardId}`)).toHaveClass(/preferred/);

  const meta = await page.evaluate(() => (window as GameWindow).game!.getMeta());
  expect(meta.preferredCardIds).toEqual([unlockedCardId]);

  await page.getByTestId('card-collection-close').click();
  await expect(page.getByTestId('card-collection')).toHaveCount(0);
});

test('カードコレクションはキーボード操作と狭い画面に対応する（RI-65）', async ({ page }) => {
  await seedMeta(page, BASE_META);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?renderer=dom&seed=card-collection-keyboard');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.getByTestId('open-card-collection').click();
  await expect(page.getByTestId('card-collection')).toBeVisible();
  await expect(page.getByTestId('card-collection-list')).toBeVisible();
  await expect(page.getByTestId('card-collection-detail')).toBeVisible();

  // 画面上の並びはレアリティ順（common → rare → legendary）。
  const rarityOrder = { common: 0, rare: 1, legendary: 2 } as const;
  const orderedIds = [...CARD_DEFS]
    .sort((a, b) => rarityOrder[a.rarity] - rarityOrder[b.rarity])
    .map((def) => def.id);
  const firstId = orderedIds[0]!;
  const secondId = orderedIds[1]!;
  await page.getByTestId(`card-collection-item-${firstId}`).click();
  await expect(page.getByTestId(`card-collection-item-${firstId}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId(`card-collection-item-${secondId}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  if (defaultUnlocked.has(secondId)) {
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('card-collection-prefer-count')).toHaveText('優先 1 / 2');
  }

  // 閉じるボタンにフォーカスした Enter は方針トグルではなく閉じる操作になる。
  await page.getByTestId('card-collection-close').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('card-collection')).toHaveCount(0);
});

test('カードコレクションは Escape で閉じ、起点ボタンへフォーカスが戻る', async ({ page }) => {
  await seedMeta(page, BASE_META);

  await page.goto('/?renderer=dom&seed=card-collection-escape');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.getByTestId('open-card-collection').click();
  await expect(page.getByTestId('card-collection')).toBeVisible();
  await expect(page.getByTestId('title')).toHaveAttribute('inert', '');

  await page.getByTestId('card-collection-close').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('card-collection')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid')))
    .toBe('open-card-collection');
});

test('カードコレクションは背景クリックで閉じ、パネルクリックでは閉じない', async ({ page }) => {
  await seedMeta(page, BASE_META);

  await page.goto('/?renderer=dom&seed=card-collection-backdrop');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.getByTestId('open-card-collection').click();
  const dialog = page.getByTestId('card-collection');
  await expect(dialog).toBeVisible();

  await page.locator('.card-collection-panel').click();
  await expect(dialog).toBeVisible();

  await page.getByTestId('card-collection-backdrop').click({ position: { x: 8, y: 8 } });
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid')))
    .toBe('open-card-collection');
});

test('カードコレクション読込中の Escape は開く操作を取り消す', async ({ page }) => {
  await seedMeta(page, BASE_META);
  await page.route(/CardCollectionScreen/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });

  await page.goto('/?renderer=dom&seed=card-collection-lazy-escape');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.getByTestId('open-card-collection').click();
  await expect(page.getByTestId('title-modal-loading')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('title-modal-loading')).toHaveCount(0);
  await expect(page.getByTestId('card-collection')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid')))
    .toBe('open-card-collection');
});
