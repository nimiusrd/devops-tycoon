/**
 * リプレイのボス結果から四半期レビューへのジャンプ（#1000）。
 */
import { expect, test } from '@playwright/test';
import type { RunState } from '../../src/sim/run/types';
import type { ReplayBlob } from '../../src/state/replay';
import { REPLAY_SCHEMA_VERSION } from '../../src/state/replay';
import { REPLAY_QUARTER_REVIEW_MISSING_HINT } from '../../src/state/replayJump';

type ReplayGameWindow = Window & {
  game?: {
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    importReplay(blob: ReplayBlob): Promise<boolean>;
    listReplays(): ReplayBlob[];
    isReplayMode(): boolean;
    engine: {
      exportReplayFrame(): ReplayBlob['keyframes'][number]['frame'] | null;
    };
  };
};

test('ボス結果のリプレイで記録済み四半期レビューへジャンプできる', async ({ page }) => {
  await page.goto('/?seed=replay-quarter-jump-e2e&tutorial=off');
  await expect(page.getByTestId('title')).toBeVisible();

  const imported = await page.evaluate(async (schemaVersion) => {
    const game = (window as ReplayGameWindow).game;
    if (!game) return false;
    game.startRun('easy', [], 'replay-quarter-jump-e2e');
    const setupFrame = game.engine.exportReplayFrame();
    if (!setupFrame) return false;

    const resultFrame = structuredClone(setupFrame);
    resultFrame.phase = 'result';
    resultFrame.sprintsPlayed = 6;
    resultFrame.currentSprintKind = 'boss';
    resultFrame.lastResult = {
      done: 6,
      delivered: 18,
      maxCombo: 2,
      aiAssistedPct: 55,
      reviewQueueMax: 4,
      rework: 1,
      incidents: 0,
      contained: 0,
      spread: 0,
      seniorHpDelta: -4,
      actionCounts: {},
      grade: 'C',
      title: 'PRを増やす者',
      diagnosis: 'レビュー渋滞',
      timeline: [],
      events: [],
      fireEvents: [],
      focusRemaining: 2,
      focusMax: 8,
      autoContainCount: 0,
    };
    resultFrame.quarterReview = {
      goal: resultFrame.quarterGoal,
      outcome: 'missed_adjustable',
      trust: resultFrame.stakeholderTrust,
      progress: [],
      missedReasons: [],
      availableAdjustments: ['cut_scope'],
      bossCleared: true,
    };

    const reviewFrame = structuredClone(resultFrame);
    reviewFrame.phase = 'quarterReview';

    const blob: ReplayBlob = {
      schemaVersion: schemaVersion as typeof REPLAY_SCHEMA_VERSION,
      id: 'replay-quarter-jump-e2e:1',
      seed: 'replay-quarter-jump-e2e',
      difficulty: 'easy',
      trials: [],
      finishedAt: Date.now(),
      outcome: {
        status: 'won',
        diagnosis: 'healthyAcceleration',
        score: 18,
      },
      keyframes: [
        { phase: 'setup', frame: setupFrame, label: '編成' },
        { phase: 'result', frame: resultFrame, label: 'ボス結果' },
        { phase: 'quarterReview', frame: reviewFrame, label: '四半期レビュー' },
      ],
      ruleset: { version: 1, fingerprint: 'replay-quarter-jump-e2e' },
      contentSnapshot: { cards: [], relics: [] },
    };
    return game.importReplay(blob);
  }, REPLAY_SCHEMA_VERSION);

  expect(imported).toBe(true);
  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(() => page.evaluate(() => (window as ReplayGameWindow).game?.listReplays().length ?? 0))
    .toBeGreaterThan(0);

  await page.getByTestId('open-replays').click();
  await expect(page.getByTestId('replay-list')).toBeVisible();
  await page.getByTestId('replay-keyframe-1').click();

  await expect(page.getByTestId('sprint-result')).toBeVisible();
  await expect(page.getByTestId('result-continue')).toBeEnabled();
  await expect(page.getByTestId('result-continue')).toHaveText('四半期レビューへ →');
  await page.getByTestId('result-continue').click();

  await expect(page.getByTestId('quarter-review')).toBeVisible();
  await expect(page.getByTestId('sprint-result')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as ReplayGameWindow).game?.isReplayMode()))
    .toBe(true);
});

test('四半期レビューキーフレームが無いボス結果では続行が無効になる', async ({ page }) => {
  await page.goto('/?seed=replay-quarter-missing-e2e&tutorial=off');
  await expect(page.getByTestId('title')).toBeVisible();

  const imported = await page.evaluate(async (schemaVersion) => {
    const game = (window as ReplayGameWindow).game;
    if (!game) return false;
    game.startRun('easy', [], 'replay-quarter-missing-e2e');
    const setupFrame = game.engine.exportReplayFrame();
    if (!setupFrame) return false;

    const resultFrame = structuredClone(setupFrame);
    resultFrame.phase = 'result';
    resultFrame.sprintsPlayed = 6;
    resultFrame.currentSprintKind = 'boss';
    resultFrame.lastResult = {
      done: 6,
      delivered: 18,
      maxCombo: 2,
      aiAssistedPct: 55,
      reviewQueueMax: 4,
      rework: 1,
      incidents: 0,
      contained: 0,
      spread: 0,
      seniorHpDelta: -4,
      actionCounts: {},
      grade: 'C',
      title: 'PRを増やす者',
      diagnosis: 'レビュー渋滞',
      timeline: [],
      events: [],
      fireEvents: [],
      focusRemaining: 2,
      focusMax: 8,
      autoContainCount: 0,
    };
    resultFrame.quarterReview = {
      goal: resultFrame.quarterGoal,
      outcome: 'missed_adjustable',
      trust: resultFrame.stakeholderTrust,
      progress: [],
      missedReasons: [],
      availableAdjustments: ['cut_scope'],
      bossCleared: true,
    };

    const blob: ReplayBlob = {
      schemaVersion: schemaVersion as typeof REPLAY_SCHEMA_VERSION,
      id: 'replay-quarter-missing-e2e:1',
      seed: 'replay-quarter-missing-e2e',
      difficulty: 'easy',
      trials: [],
      finishedAt: Date.now(),
      outcome: {
        status: 'won',
        diagnosis: 'healthyAcceleration',
        score: 18,
      },
      keyframes: [
        { phase: 'setup', frame: setupFrame, label: '編成' },
        { phase: 'result', frame: resultFrame, label: 'ボス結果' },
      ],
      ruleset: { version: 1, fingerprint: 'replay-quarter-missing-e2e' },
      contentSnapshot: { cards: [], relics: [] },
    };
    return game.importReplay(blob);
  }, REPLAY_SCHEMA_VERSION);

  expect(imported).toBe(true);
  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('open-replays').click();
  await page.getByTestId('replay-keyframe-1').click();

  await expect(page.getByTestId('sprint-result')).toBeVisible();
  await expect(page.getByTestId('result-continue')).toBeDisabled();
  await expect(page.getByTestId('result-continue-hint')).toContainText(
    REPLAY_QUARTER_REVIEW_MISSING_HINT,
  );
});
