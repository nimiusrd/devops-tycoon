import { expect, test } from './fixtures';
import { TUTORIAL_CONTENT_VERSION, type MetaState } from '../../src/state/meta';
import type { RunState } from '../../src/sim/run/types';
import { seedMeta } from './seedMeta';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    getMeta(): MetaState;
    markTutorialSeen(): void;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    beginSetupSprint(): RunState;
    newRun(seed?: string): RunState;
  };
};

const SEEN_META: MetaState = {
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
  seenTutorialVersion: TUTORIAL_CONTENT_VERSION,
};

test('タイトルから遊び方ヘルプを開ける', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=howto-e2e');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.getByTestId('open-help').click();
  await expect(page.getByTestId('how-to-play')).toBeVisible();
  await expect(page.getByTestId('how-to-play')).toContainText('介入バー');
  await expect(page.getByTestId('how-to-play')).toContainText('シニア体力と燃え尽き');
  await expect(page.getByTestId('how-to-play')).toContainText('緊急対応');

  await page.getByTestId('how-to-play-close').click();
  await expect(page.getByTestId('how-to-play')).not.toBeVisible();
});

test('遊び方ヘルプは Escape で閉じる', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=howto-escape');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.getByTestId('open-help').click();
  await expect(page.getByTestId('how-to-play')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('how-to-play')).not.toBeVisible();
});

test('遊び方ヘルプは背景クリックで閉じ、パネルクリックでは閉じない', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=howto-backdrop');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.getByTestId('open-help').click();
  const dialog = page.getByTestId('how-to-play');
  await expect(dialog).toBeVisible();

  await page.locator('.how-to-play-panel').click();
  await expect(dialog).toBeVisible();

  await page.getByTestId('how-to-play-backdrop').click({ position: { x: 8, y: 8 } });
  await expect(dialog).not.toBeVisible();
});

test('遊び方の背面から別モーダルを開くと遊び方は閉じる', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=howto-exclusive');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.getByTestId('open-help').click();
  await expect(page.getByTestId('how-to-play')).toBeVisible();

  await page.getByTestId('open-replays').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('how-to-play')).not.toBeVisible();
  await expect(page.getByTestId('replay-list')).toBeVisible();
});

test('?tutorial=help でタイトル起動時に遊び方を開く', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=howto-query&tutorial=help');
  await expect(page.getByTestId('how-to-play')).toBeVisible();
});

test('?tutorial=1 で初回ガイドを進め、表示済みフラグが永続化する', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=tutorial-e2e&tutorial=1');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('easy', [], 'tutorial-e2e');
    g.beginSetupSprint();
  });

  await expect(page.getByTestId('tutorial-guide')).toBeVisible();
  await expect(page.getByTestId('tutorial-step-action-bar')).toBeVisible();
  await expect(page.getByTestId('action-bar')).toBeVisible();
  await expect(page.getByTestId('hud-seniorHp')).toBeVisible();
  await expect(page.getByTestId('jam-meter')).toBeVisible();
  await expect(page.getByTestId('combo-gauge')).toBeVisible();

  await page.getByTestId('tutorial-next').click();
  await expect(page.getByTestId('tutorial-step-senior-hp')).toBeVisible();
  await expect(page.getByTestId('tutorial-guide')).toContainText('緊急対応');
  await page.getByTestId('tutorial-next').click();
  await expect(page.getByTestId('tutorial-step-jam-meter')).toBeVisible();
  await page.getByTestId('tutorial-next').click();
  await expect(page.getByTestId('tutorial-step-combo-gauge')).toBeVisible();
  await page.getByTestId('tutorial-next').click();

  await expect(page.getByTestId('tutorial-guide')).not.toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => (window as GameWindow).game!.getMeta().seenTutorial))
    .toBe(true);

  // クエリ無しの再読込ではガイドを出さない
  await page.goto('/?renderer=dom&seed=tutorial-e2e-reload');
  await expect(page.getByTestId('title')).toBeVisible();
  await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('easy', [], 'tutorial-e2e-reload');
    g.beginSetupSprint();
  });
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('tutorial-guide')).not.toBeVisible();
});

test('表示済みでも ?tutorial=force ならガイドを再表示できる', async ({ page }) => {
  await seedMeta(page, SEEN_META);

  await page.goto('/?renderer=dom&seed=tutorial-force&tutorial=force');
  await expect(page.getByTestId('title')).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => (window as GameWindow).game!.getMeta().seenTutorial))
    .toBe(true);

  await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('easy', [], 'tutorial-force');
    g.beginSetupSprint();
  });

  await expect(page.getByTestId('tutorial-guide')).toBeVisible();
  await page.getByTestId('tutorial-skip').click();
  await expect(page.getByTestId('tutorial-guide')).not.toBeVisible();

  // 同一ページで新しいランを始めても force なら再表示（sprintId 再利用に依存しない）
  await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.newRun('tutorial-force-2');
    g.startRun('easy', [], 'tutorial-force-2');
    g.beginSetupSprint();
  });
  await expect(page.getByTestId('tutorial-guide')).toBeVisible();
});
