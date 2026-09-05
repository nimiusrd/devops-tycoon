import type { Page } from '@playwright/test';
import type { RunState } from '../../src/sim/run/types';
import {
  advanceCurrentSprintToResult,
  beginCurrentSetupSprint,
  expect,
  RI94_RELIC_CHOICE_BY_EVENT,
  test,
  type PublicGameWindow,
} from './fixtures';

async function openSetupRun(page: Page): Promise<void> {
  await page.goto('/?seed=devops-tycoon');
  await expect(page.getByTestId('title')).toBeVisible();
  await page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    game.startRun('easy', [], 'devops-tycoon');
    game.pause();
  });
  await expect(page.getByTestId('setup')).toBeVisible();
}

/** 直近スプリントのリザルトから、次スプリントの編成まで公開 API だけで進める。 */
async function advanceResultToNextSetup(page: Page): Promise<RunState> {
  return page.evaluate((relicChoiceByEvent) => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    let state = game.getState();
    let guard = 0;
    if (state.phase !== 'result') {
      throw new Error(`result から開始できない: phase=${state.phase}`);
    }
    while (state.phase !== 'setup' && state.status === 'playing' && guard < 60_000) {
      guard += 1;
      switch (state.phase) {
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
          game.resolveBeat(eventId ? relicChoiceByEvent[eventId] : undefined);
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
          throw new Error(`次の編成へ進めない phase=${state.phase}`);
      }
      state = game.getState();
    }
    if (state.phase !== 'setup') {
      throw new Error(`次の編成へ到達しない: phase=${state.phase} guard=${guard}`);
    }
    return state;
  }, RI94_RELIC_CHOICE_BY_EVENT);
}

test('Sprint 1 終了後の HUD スプリント番号は編成導線の次スプリントと一致する', async ({ page }) => {
  await openSetupRun(page);
  await expect(page.getByTestId('sprint-no')).toContainText('1/6');
  await expect(page.getByTestId('setup-next-sprint')).toHaveText('次: スプリント 1 / 6');

  await beginCurrentSetupSprint(page);
  await expect(page.getByTestId('sprint-no')).toContainText('1/6');

  await advanceCurrentSprintToResult(page);
  await expect(page.getByTestId('sprint-no')).toContainText('2/6');

  await advanceResultToNextSetup(page);
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('sprint-no')).toContainText('2/6');
  await expect(page.getByTestId('setup-next-sprint')).toHaveText('次: スプリント 2 / 6');
});
