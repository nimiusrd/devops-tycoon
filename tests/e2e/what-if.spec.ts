import { expect, test } from '@playwright/test';
import { EVENT_DEFS } from '../../src/data/events';
import type { GameHandle } from '../../src/game';

type GameWindow = Window & {
  game?: GameHandle;
  __e2eBeatChoice?: (
    beat: { eventId: string; kind: 'judgment' | 'decision' } | null | undefined,
  ) => number | undefined;
};

const GRANT_RECRUIT_FLAGS: Record<string, boolean[]> = Object.fromEntries(
  EVENT_DEFS.map((def) => [def.id, def.choices.map((c) => !!c.outcome.grantRecruit)]),
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript((flags) => {
    (window as GameWindow).__e2eBeatChoice = (beat) => {
      if (!beat || beat.kind === 'judgment') return undefined;
      const list = flags[beat.eventId] ?? [];
      if (list[0]) {
        const alt = list.findIndex((flag) => !flag);
        if (alt >= 0) return alt;
      }
      return 0;
    };
  }, GRANT_RECRUIT_FLAGS);
});

test('RI-46: 編成とドラフトで次スプリントのリスク幅を表示する', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=what-if-e2e');
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-run').click();

  await expect(page.getByTestId('what-if-formation')).toContainText('24回試算');
  const before = await page.getByTestId('what-if-formation').textContent();
  await page.getByTestId('assign-m0-bench').click();
  await expect(page.getByTestId('what-if-formation')).not.toHaveText(before!);

  const draft = await page.evaluate(() => {
    const game = (window as GameWindow).game!;
    game.pause();
    let state = game.getState();
    let guard = 0;
    while (state.phase !== 'draft' && state.status === 'playing' && guard < 10_000) {
      switch (state.phase) {
        case 'setup':
          state = game.beginSetupSprint();
          break;
        case 'sprint':
          state = game.step(10_000);
          break;
        case 'result':
          state = game.acknowledgeResult();
          break;
        case 'evolution':
          state = game.finishEvolution();
          break;
        case 'beat':
          state = game.resolveBeat((window as GameWindow).__e2eBeatChoice!(state.beat));
          break;
        case 'shop':
          state = game.leaveShop();
          break;
        case 'rest':
          state = game.restChoose('heal');
          break;
        case 'recruit':
          state = game.recruitChoose('skip');
          break;
        default:
          guard = 10_000;
          break;
      }
      guard += 1;
    }
    return state;
  });

  expect(draft.phase).toBe('draft');
  expect(draft.draft?.length).toBeGreaterThan(0);
  await expect(page.getByTestId('what-if-draft-skip')).toContainText('24回試算');
  for (const cardId of draft.draft ?? []) {
    await expect(page.getByTestId(`what-if-card-${cardId}`)).toContainText('24回試算');
  }
});
