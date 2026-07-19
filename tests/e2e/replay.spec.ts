import { expect, test } from '@playwright/test';
import type { GoalAdjustmentId, RunState } from '../../src/sim/run/types';
import type { ReplayBlob } from '../../src/state/replay';

type ReplayGameWindow = Window & {
  game?: {
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    beginSetupSprint(): RunState;
    step(ms: number): RunState;
    isSprintRunning(): boolean;
    acknowledgeResult(): RunState;
    skipDraft(): RunState;
    finishEvolution(): RunState;
    resolveBeat(choiceIndex?: number): RunState;
    leaveShop(): RunState;
    restChoose(option: 'heal' | 'repay' | 'upgrade' | 'recruit'): RunState;
    recruitChoose(option: 'hire' | 'skip'): RunState;
    acknowledgeQuarterReview(): RunState;
    chooseGoalAdjustment(id: GoalAdjustmentId): RunState;
    getState(): RunState;
    phase(): string;
    listReplays(): ReplayBlob[];
    isReplayMode(): boolean;
    dispatch(id: string): { ok: boolean; reason?: string };
  };
};

async function playUntilFinished(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as ReplayGameWindow).game;
    if (!game) return;
    game.startRun('easy', [], 'replay-e2e');
    for (let i = 0; i < 80_000; i += 1) {
      const phase = game.phase();
      if (phase === 'won' || phase === 'lost') return;
      if (phase === 'setup') game.beginSetupSprint();
      else if (phase === 'sprint') {
        while (game.isSprintRunning()) game.step(100);
      } else if (phase === 'result') game.acknowledgeResult();
      else if (phase === 'draft') game.skipDraft();
      else if (phase === 'evolution') game.finishEvolution();
      else if (phase === 'beat') game.resolveBeat(0);
      else if (phase === 'shop') game.leaveShop();
      else if (phase === 'rest') game.restChoose('heal');
      else if (phase === 'recruit') game.recruitChoose('skip');
      else if (phase === 'quarterReview') {
        const review = game.getState().quarterReview;
        if (review?.outcome === 'missed_adjustable') {
          game.chooseGoalAdjustment(review.availableAdjustments[0] ?? 'cut_scope');
        } else {
          game.acknowledgeQuarterReview();
        }
      } else return;
    }
  });
}

test('ラン完了後にリプレイ一覧からキーフレームを read-only で開ける', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=replay-e2e&tutorial=off');
  await expect(page.getByTestId('title')).toBeVisible();

  await playUntilFinished(page);
  await expect
    .poll(() => page.evaluate(() => (window as ReplayGameWindow).game?.phase()))
    .toMatch(/won|lost/);

  await expect
    .poll(() => page.evaluate(() => (window as ReplayGameWindow).game?.listReplays().length ?? 0))
    .toBeGreaterThan(0);

  await page.getByTestId('new-run').click();
  await expect(page.getByTestId('title')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('open-replays').click();
  await expect(page.getByTestId('replay-list')).toBeVisible();
  await page.getByTestId('replay-keyframe-0').click();

  await expect(page.getByTestId('replay-mode-banner')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as ReplayGameWindow).game?.isReplayMode()))
    .toBe(true);
  expect(
    await page.evaluate(() => (window as ReplayGameWindow).game?.dispatch('pairReview')),
  ).toEqual({ ok: false, reason: 'complete' });

  // setup キーフレームでは操作部が disabled になること。
  if ((await page.getByTestId('setup').count()) > 0) {
    await expect(page.getByTestId('begin-sprint')).toBeDisabled();
    await expect(page.getByTestId('open-formation')).toBeDisabled();
    await expect(page.getByTestId('open-org')).toBeDisabled();
  }

  await page.getByTestId('exit-replay').click();
  await expect(page.getByTestId('title')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as ReplayGameWindow).game?.isReplayMode()))
    .toBe(false);
});
