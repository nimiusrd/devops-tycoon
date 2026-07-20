import { expect, test } from '@playwright/test';
import type { GoalAdjustmentId, RunState } from '../../src/sim/run/types';
import type { ReplayBlob } from '../../src/state/replay';
import { REPLAY_SCHEMA_VERSION } from '../../src/state/replay';

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
    importReplay(blob: ReplayBlob): Promise<boolean>;
    engine: {
      exportReplayFrame(): ReplayBlob['keyframes'][number]['frame'] | null;
    };
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

test('レビュー地獄リプレイは専用パネルとバナーで開ける（RI-34‴）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=review-hell-e2e&tutorial=off');
  await expect(page.getByTestId('title')).toBeVisible();

  const imported = await page.evaluate(async (schemaVersion) => {
    const game = (window as ReplayGameWindow).game;
    if (!game) return false;
    game.startRun('easy', [], 'review-hell-e2e');
    const setupFrame = game.engine.exportReplayFrame();
    if (!setupFrame) return false;

    const resultFrame = structuredClone(setupFrame);
    resultFrame.phase = 'result';
    resultFrame.diagnosis = 'reviewHell';
    resultFrame.totals = { ...resultFrame.totals, reviewQueuePeak: 21 };
    resultFrame.lastResult = {
      done: 6,
      delivered: 18,
      maxCombo: 2,
      aiAssistedPct: 55,
      reviewQueueMax: 21,
      rework: 2,
      incidents: 2,
      contained: 0,
      spread: 1,
      seniorHpDelta: -25,
      actionCounts: {},
      grade: 'D',
      title: 'PRを増やす者',
      diagnosis: 'レビュー渋滞',
      timeline: [],
      events: [],
      fireEvents: [
        { tick: 8, kind: 'ignite', taskId: 2, source: 'review' },
        { tick: 14, kind: 'spread', taskId: 2, spreadToTaskId: 3 },
      ],
      focusRemaining: 2,
      focusMax: 8,
      autoContainCount: 0,
    };

    const lostFrame = structuredClone(setupFrame);
    lostFrame.phase = 'lost';
    lostFrame.diagnosis = 'reviewHell';
    lostFrame.totals = { ...lostFrame.totals, reviewQueuePeak: 21 };
    lostFrame.lastResult = resultFrame.lastResult;

    const blob: ReplayBlob = {
      schemaVersion: schemaVersion as typeof REPLAY_SCHEMA_VERSION,
      id: 'review-hell-e2e:1',
      seed: 'review-hell-e2e',
      difficulty: 'easy',
      trials: [],
      finishedAt: Date.now(),
      outcome: {
        status: 'lost',
        loseReason: 'reviewFreeze',
        diagnosis: 'reviewHell',
        score: 7,
      },
      keyframes: [
        { phase: 'setup', frame: setupFrame, label: '編成' },
        { phase: 'result', frame: resultFrame, label: 'Review peak 21' },
        { phase: 'lost', frame: lostFrame, label: 'Review Hell 型' },
      ],
    };
    return game.importReplay(blob);
  }, REPLAY_SCHEMA_VERSION);

  expect(imported).toBe(true);

  // startRun でタイトルを離れているため、IDB 保存済みリプレイをタイトルから開く。
  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(() => page.evaluate(() => (window as ReplayGameWindow).game?.listReplays().length ?? 0))
    .toBeGreaterThan(0);

  await page.getByTestId('open-replays').click();
  await expect(page.getByTestId('replay-list')).toBeVisible();
  await expect(page.getByTestId('replay-review-hell-badge')).toBeVisible();
  await expect(page.getByTestId('replay-review-hell-panel')).toBeVisible();
  await expect(page.getByTestId('replay-review-hell-peak')).toContainText('21');
  await page.getByTestId('replay-review-hell-open').click();

  await expect(page.getByTestId('replay-mode-banner')).toBeVisible();
  await expect(page.getByTestId('replay-mode-banner')).toHaveAttribute('data-review-hell', 'true');
  await expect(page.getByTestId('replay-mode-banner')).toContainText('レビュー地獄リプレイ');
  await expect(page.getByTestId('result-review-hell-summary')).toBeVisible();
  await expect(page.getByTestId('result-review-hell-peak')).toContainText('21');
});
