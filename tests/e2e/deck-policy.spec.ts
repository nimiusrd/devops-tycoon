import { expect, test } from './fixtures';
import type { MetaState } from '../../src/state/meta';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    getMeta(): MetaState;
    setPreferredCardIds(cardIds: readonly string[]): void;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
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

test('タイトルから研修方針を選び、再オープンで選択が維持される（RI-34‴）', async ({ page }) => {
  await page.addInitScript((meta) => {
    localStorage.setItem('devops-tycoon:meta:v1', JSON.stringify(meta));
  }, BASE_META);

  await page.goto('/?renderer=dom&seed=deck-policy-e2e');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.getByTestId('open-deck-policy').click();
  await expect(page.getByTestId('deck-policy')).toBeVisible();
  await expect(page.getByTestId('deck-policy-count')).toHaveText('0');

  await page.getByTestId('deck-policy-docs').click();
  await page.getByTestId('deck-policy-copilot').click();
  await expect(page.getByTestId('deck-policy-count')).toHaveText('2');
  await expect(page.getByTestId('deck-policy-auto-test')).toBeDisabled();

  await page.getByTestId('deck-policy-close').click();
  await expect(page.getByTestId('deck-policy')).toHaveCount(0);
  await expect(page.getByTestId('open-deck-policy')).toContainText('（2）');

  await page.getByTestId('open-deck-policy').click();
  await expect(page.getByTestId('deck-policy-docs')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('deck-policy-copilot')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('deck-policy-close').click();

  const meta = await page.evaluate(() => (window as GameWindow).game!.getMeta());
  expect(meta.preferredCardIds).toEqual(['docs', 'copilot']);
});

test('研修方針を選んでもラン開始時デッキは空のまま（RI-30 回帰）', async ({ page }) => {
  await page.addInitScript(
    (meta) => {
      localStorage.setItem('devops-tycoon:meta:v1', JSON.stringify(meta));
    },
    { ...BASE_META, preferredCardIds: ['docs', 'copilot'] },
  );

  await page.goto('/?renderer=dom&seed=deck-policy-empty');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('easy', [], 'deck-policy-empty');
  });

  await expect(page.getByTestId('setup')).toBeVisible();
  const deck = await page.evaluate(() => (window as GameWindow).game!.getState().deck);
  expect(deck).toEqual([]);
});
