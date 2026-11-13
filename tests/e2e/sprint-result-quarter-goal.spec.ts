/**
 * スプリント5結果の四半期目標進捗行（#1014）。
 */
import { expect, test, RI94_RELIC_CHOICE_BY_EVENT, type PublicGameWindow } from './fixtures';
import { E2E_QUARTER_GOAL_DANGER_SEED } from '../../src/sim/run/quarterReviewSeeds';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 1280, height: 800 },
] as const;

test('スプリント5結果に四半期目標の危険行が出る', async ({ page }) => {
  test.setTimeout(180_000);

  for (const viewport of VIEWPORTS) {
    await test.step(`${viewport.width}px`, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/?renderer=pixi&seed=${E2E_QUARTER_GOAL_DANGER_SEED}&tutorial=off`);
      await expect(page.getByTestId('title')).toBeVisible();

      await page.evaluate(
        ({ seed, relicChoiceByEvent }) => {
          const game = (window as PublicGameWindow).game;
          if (!game) throw new Error('window.game が公開されていない');
          game.startRun('easy', [], seed);
          game.pause();

          let state = game.getState();
          let guard = 0;
          while (
            guard < 60_000 &&
            !(state.phase === 'result' && state.sprintIndexInQuarter === 5)
          ) {
            guard += 1;
            switch (state.phase) {
              case 'setup':
                game.beginSetupSprint();
                break;
              case 'sprint':
                game.step(1_000_000);
                break;
              case 'result':
                game.acknowledgeResult();
                break;
              case 'draft':
                if (state.draft && state.draft.length > 0) game.chooseCard(state.draft[0]);
                else game.skipDraft();
                break;
              case 'evolution':
                game.finishEvolution();
                break;
              case 'beat': {
                const eventId = state.beat?.eventId;
                const choice = eventId ? relicChoiceByEvent[eventId] : undefined;
                game.resolveBeat(choice);
                break;
              }
              case 'shop':
                game.leaveShop();
                break;
              case 'rest':
                game.restChoose('heal');
                break;
              case 'recruit':
                game.recruitChoose('skip');
                break;
              default:
                throw new Error(`未対応 phase=${state.phase}`);
            }
            state = game.getState();
          }
          if (guard >= 60_000) {
            throw new Error(
              `スプリント5結果へ到達しない: phase=${state.phase} sprint=${state.sprintIndexInQuarter}`,
            );
          }
        },
        { seed: E2E_QUARTER_GOAL_DANGER_SEED, relicChoiceByEvent: RI94_RELIC_CHOICE_BY_EVENT },
      );

      await expect(page.getByTestId('sprint-result')).toBeVisible();
      const line = page.getByTestId('sprint-result-context-line');
      await expect(line).toBeVisible();
      await expect(line).toHaveAttribute('data-tone', 'danger');
      await expect(line).toHaveAttribute('data-kind', 'quarterGoal');
      await expect(line).toContainText('インシデント');
      await expect(line).toContainText('残り1スプリント');
    });
  }
});
