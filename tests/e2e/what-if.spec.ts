import { expect, test } from './fixtures';
import { EVENT_DEFS } from '../../src/data/events';
import type { GameHandle } from '../../src/game';

type GameWindow = Window & {
  game?: GameHandle;
  __e2eBeatChoice?: (
    beat: { eventId: string; kind: 'judgment' | 'decision' } | null | undefined,
  ) => number | undefined;
};

const AVOID_CHOICE_FLAGS: Record<string, boolean[]> = Object.fromEntries(
  EVENT_DEFS.map((def) => [
    def.id,
    def.choices.map((c) => !!c.outcome.grantRecruit || !!c.outcome.forceLose),
  ]),
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript((flags) => {
    (window as GameWindow).__e2eBeatChoice = (beat) => {
      if (!beat || beat.kind === 'judgment') return undefined;
      const list = flags[beat.eventId] ?? [];
      const preferred = list.findIndex((flag) => !flag);
      if (preferred >= 0) return preferred;
      return 0;
    };
  }, AVOID_CHOICE_FLAGS);
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

test('引き直し後は候補が入れ替わり介入予測が試算中から抜ける', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=mulligan-whatif-e2e');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();

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
  const before = [...(draft.draft ?? [])];
  expect(before.length).toBeGreaterThan(0);
  await expect(page.getByTestId('draft-mulligan')).toBeEnabled();
  await expect(page.getByTestId('what-if-draft-skip')).toContainText('24回試算');

  await page.getByTestId('draft-mulligan').click();

  await expect
    .poll(async () => {
      const next = await page.evaluate(() =>
        [...((window as GameWindow).game!.getState().draft ?? [])].sort(),
      );
      return next;
    })
    .not.toEqual([...before].sort());

  await expect(page.getByTestId('what-if-draft-skip')).toContainText('24回試算', {
    timeout: 15_000,
  });
  const afterDraft = await page.evaluate(() => (window as GameWindow).game!.getState().draft ?? []);
  for (const cardId of afterDraft) {
    await expect(page.getByTestId(`what-if-card-${cardId}`)).toContainText('24回試算', {
      timeout: 15_000,
    });
  }
  await expect(page.locator('[data-what-if-status="computing"]')).toHaveCount(0);
});
