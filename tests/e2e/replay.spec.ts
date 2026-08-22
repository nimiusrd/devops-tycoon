import { expect, test } from '@playwright/test';
import type { GoalAdjustmentId, RunState } from '../../src/sim/run/types';
import type { RunDiagnosticInfo } from '../../src/state/diagnosticInfo';
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
    getDiagnosticInfo(): RunDiagnosticInfo;
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
  await expect(page.getByTestId('replay-ruleset').first()).toContainText('v');
  await page.getByTestId('replay-keyframe-0').click();

  await expect(page.getByTestId('replay-mode-banner')).toBeVisible();
  await expect(page.getByTestId('replay-recorded-ruleset')).toContainText('v');
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

test('リプレイをJSONファイルで往復し、不正・不一致を拒否して上限を守る', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ri133-replay-file-e2e&tutorial=off');
  await expect(page.getByTestId('title')).toBeVisible();
  await playUntilFinished(page);
  await expect
    .poll(() => page.evaluate(() => (window as ReplayGameWindow).game?.listReplays().length ?? 0))
    .toBeGreaterThan(0);

  await page.getByTestId('new-run').click();
  await expect(page.getByTestId('title')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('open-replays').click();
  await expect(page.getByTestId('replay-list')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('replay-download').click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('replay download path missing');

  await page.getByTestId('replay-file').setInputFiles(downloadPath);
  await expect(page.getByTestId('replay-file-status')).toHaveText('リプレイを読み込みました。');

  const baseReplay = await page.evaluate(() => {
    const replay = (window as ReplayGameWindow).game?.listReplays()[0];
    if (!replay) throw new Error('replay missing');
    return replay;
  });
  const mismatchReplay = JSON.stringify({
    ...baseReplay,
    id: 'ri133-replay-mismatch',
    ruleset: {
      version: baseReplay.ruleset?.version ?? 1,
      fingerprint: 'different-ruleset',
    },
  });
  const countBeforeReject = await page.evaluate(
    () => (window as ReplayGameWindow).game?.listReplays().length ?? 0,
  );

  await page.getByTestId('replay-file').setInputFiles({
    name: 'broken-replay.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{'),
  });
  await expect(page.getByTestId('replay-file-status')).toContainText('JSONを解析できない');

  await page.getByTestId('replay-file').setInputFiles({
    name: 'mismatched-replay.json',
    mimeType: 'application/json',
    buffer: Buffer.from(mismatchReplay),
  });
  await expect(page.getByTestId('replay-file-status')).toContainText('ルールセットが一致しない');
  await expect
    .poll(() => page.evaluate(() => (window as ReplayGameWindow).game?.listReplays().length ?? 0))
    .toBe(countBeforeReject);

  const filePayloads = await page.evaluate(() => {
    const replay = (window as ReplayGameWindow).game?.listReplays()[0];
    if (!replay) throw new Error('replay missing');
    return Array.from({ length: 11 }, (_, index) => {
      const seed = `ri133-replay-file-${index}`;
      return JSON.stringify({
        ...replay,
        id: seed,
        seed,
        finishedAt: replay.finishedAt + 10_000 + index,
        keyframes: replay.keyframes.map((keyframe) => ({
          ...keyframe,
          frame: { ...keyframe.frame, seed },
        })),
      });
    });
  });

  for (const [index, payload] of filePayloads.entries()) {
    await page.getByTestId('replay-file').setInputFiles({
      name: `replay-${index}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(payload),
    });
    await expect(page.getByTestId('replay-file-status')).toHaveText('リプレイを読み込みました。');
    await expect
      .poll(() =>
        page.evaluate(
          (replayId) =>
            (window as ReplayGameWindow).game
              ?.listReplays()
              .some((replay) => replay.id === replayId),
          `ri133-replay-file-${index}`,
        ),
      )
      .toBe(true);
  }

  await expect
    .poll(() => page.evaluate(() => (window as ReplayGameWindow).game?.listReplays().length ?? 0))
    .toBe(10);
  expect(
    await page.evaluate(() =>
      (window as ReplayGameWindow).game
        ?.listReplays()
        .some((replay) => replay.id === 'ri133-replay-file-0'),
    ),
  ).toBe(false);

  await page.getByTestId('replay-keyframe-0').click();
  await expect(page.getByTestId('replay-mode-banner')).toBeVisible();
  await page.getByTestId('exit-replay').click();
  await expect(page.getByTestId('title')).toBeVisible();
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
      ruleset: { version: 1, fingerprint: 'review-hell-e2e-ruleset' },
      contentSnapshot: { cards: [], relics: [] },
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

test('記録時のレリック定義とルールセットを優先して表示する', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=replay-snapshot-e2e&tutorial=off');
  await expect(page.getByTestId('title')).toBeVisible();

  const imported = await page.evaluate(async (schemaVersion) => {
    const game = (window as ReplayGameWindow).game;
    if (!game) return false;
    game.startRun('easy', [], 'replay-snapshot-e2e');
    const frame = game.engine.exportReplayFrame();
    if (!frame) return false;
    frame.deck = [{ defId: 'copilot', level: 1 }];
    frame.relics = ['psych-safety'];

    const blob: ReplayBlob = {
      schemaVersion: schemaVersion as typeof REPLAY_SCHEMA_VERSION,
      id: 'replay-snapshot-e2e:1',
      seed: 'replay-snapshot-e2e',
      difficulty: 'easy',
      trials: [],
      finishedAt: 3_000_001,
      outcome: {
        status: 'won',
        diagnosis: 'healthyAcceleration',
        score: 20,
      },
      keyframes: [{ phase: 'setup', frame, label: '記録時定義' }],
      ruleset: { version: 99, fingerprint: 'recorded-before-current' },
      contentSnapshot: {
        cards: [
          {
            id: 'copilot',
            name: '記録時のCopilot',
            rarity: 'common',
            cost: 1,
            focusCost: 2,
            description: ['保存されたカード定義'],
            base: { codingSpeedMul: 1.01 },
          },
        ],
        relics: [
          {
            id: 'psych-safety',
            name: '記録時の安全性',
            description: '保存されたレリック定義',
          },
        ],
      },
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
  await expect(page.getByTestId('replay-ruleset')).toContainText('v99 / recorded-before-current');
  await page.getByTestId('replay-keyframe-0').click();

  await expect(page.getByTestId('replay-recorded-ruleset')).toContainText(
    'v99 / recorded-before-current',
  );
  expect(
    await page.evaluate(() => (window as ReplayGameWindow).game?.getDiagnosticInfo().ruleset),
  ).toEqual({ version: 99, fingerprint: 'recorded-before-current' });
  await expect(page.getByTestId('deck-card-copilot')).toContainText('記録時のCopilot');
  await expect(page.getByTestId('relics')).toContainText('記録時の安全性');
  expect(
    await page.evaluate(() => (window as ReplayGameWindow).game?.getState().whatIf),
  ).toBeNull();
});

test('旧v1リプレイはルールセット不明と未知コンテンツのまま開ける', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=legacy-replay-e2e&tutorial=off');
  await expect(page.getByTestId('title')).toBeVisible();

  const imported = await page.evaluate(async () => {
    const game = (window as ReplayGameWindow).game;
    if (!game) return false;
    game.startRun('easy', [], 'legacy-replay-e2e');
    const frame = game.engine.exportReplayFrame();
    if (!frame) return false;
    frame.relics = ['removed-relic'];
    const legacy = {
      schemaVersion: 1,
      id: 'legacy-replay-e2e:1',
      seed: 'legacy-replay-e2e',
      difficulty: 'easy',
      trials: [],
      finishedAt: 3_000_002,
      outcome: {
        status: 'won' as const,
        diagnosis: 'healthyAcceleration' as const,
        score: 20,
      },
      keyframes: [{ phase: 'setup' as const, frame }],
    } as unknown as ReplayBlob;
    return game.importReplay(legacy);
  });

  expect(imported).toBe(true);
  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(() => page.evaluate(() => (window as ReplayGameWindow).game?.listReplays().length ?? 0))
    .toBeGreaterThan(0);
  await page.getByTestId('open-replays').click();
  await expect(page.getByTestId('replay-list')).toBeVisible();
  await expect(page.getByTestId('replay-ruleset')).toContainText('ルールセット不明');
  await page.getByTestId('replay-keyframe-0').click();

  await expect(page.getByTestId('replay-recorded-ruleset')).toContainText('ルールセット不明');
  expect(
    await page.evaluate(() => (window as ReplayGameWindow).game?.getDiagnosticInfo().ruleset),
  ).toBeNull();
  await expect(page.getByTestId('relics')).toContainText('不明なレリック（removed-relic）');
});
