import { expect, test, type Page } from '@playwright/test';
import type { GameHandle } from '../../src/game';
import type { RunSave } from '../../src/state/runPersistence';

type GameWindow = Window & { game: GameHandle };
type EndingType = 'happiness' | 'chaos';

/** 固定した決着直前の表示用fixture。通常プレイでの勝ち筋・面白さの評価には使わない。 */
async function finishFixture(page: Page, type: EndingType) {
  await page.goto('/?renderer=pixi&tutorial=off&seed=ri288-ending');
  await expect(page.getByTestId('title')).toBeVisible();
  const raw = await page.evaluate(() => {
    const game = (window as GameWindow).game;
    game.startRun('easy', [], 'ri288-ending');
    game.pause();
    return game.exportRunSaveText();
  });
  expect(raw).not.toBeNull();
  const save = JSON.parse(raw!) as RunSave;
  save.state.phase = save.summary.phase = 'quarterReview';
  Object.assign(save.state.org, {
    quality: 50,
    securityLevel: type === 'happiness' ? 55 : 20,
    morale: type === 'happiness' ? 92 : 43,
    seniorHp: type === 'happiness' ? 88 : 36,
    documentation: 20,
    testCoverage: 30,
  });
  save.state.extras.winEvalOrg = structuredClone(save.state.org);
  Object.assign(save.state.totals, {
    delivered: 1234,
    incidents: 35,
    spread: 2,
    done: 100,
    completed: 100,
    aiAssisted: 0,
    rework: 0,
    reviewQueuePeak: 3,
  });
  save.state.usedHeavyActions = true;
  save.state.quarterReview = {
    goal: save.state.quarterGoal,
    outcome: 'met',
    trust: save.state.stakeholderTrust,
    progress: [],
    missedReasons: [],
    availableAdjustments: [],
    bossCleared: true,
  };
  save.replayKeyframes = [];
  expect(
    await page.evaluate(async (text) => {
      const game = (window as GameWindow).game;
      const imported = await game.importRunSaveText(text);
      if (!imported.ok) return false;
      game.resumeRun();
      game.acknowledgeQuarterReview();
      return true;
    }, JSON.stringify(save)),
  ).toBe(true);
  await expect(page.getByTestId('run-ending')).toHaveAttribute('data-ending', type);
  await expect
    .poll(() => page.evaluate(() => (window as GameWindow).game.listReplays().length))
    .toBe(1);
}

async function assertDetailsAndReturn(page: Page, screenshotPath: string) {
  const ending = page.getByTestId('run-ending');
  await ending.scrollIntoViewIfNeeded();
  await expect(ending).toContainText('累計出荷1234 pt');
  await ending.screenshot({ path: screenshotPath, animations: 'disabled' });
  await page.getByTestId('run-win-title').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('run-win-title')).toBeVisible();
  await page.getByTestId('diagnosis').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('diagnosis')).toBeVisible();
  await page.screenshot({
    path: screenshotPath.replace(/\.png$/, '-details.png'),
    animations: 'disabled',
  });
  await page.getByTestId('run-delivered').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('run-delivered')).toHaveText('1234 pt');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
  const next = page.getByTestId('new-run');
  await next.focus();
  await expect(next).toBeInViewport();
  await expect(next).toBeFocused();
  await page.screenshot({
    path: screenshotPath.replace(/\.png$/, '-actions.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('title')).toBeVisible();
}

for (const [name, width, height] of [
  ['phone-se', 320, 568],
  ['phone', 390, 844],
  ['tablet', 768, 1024],
  ['desktop-short', 1024, 768],
  ['desktop', 1440, 900],
] as const) {
  for (const type of ['happiness', 'chaos'] as const) {
    test(`${name} ${type}: 初見・再閲覧・旧記録と次の操作（実WebGL）`, async ({ page }, info) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await finishFixture(page, type);
      const first = (await page.getByTestId('run-ending').textContent())!;
      const diagnosis = await page.getByTestId('diagnosis').innerText();
      await expect(page.getByTestId('run-ending')).toContainText(
        type === 'happiness' ? '士気92 / 100' : '累計障害35 件',
      );
      const replay = await page.evaluate(() => (window as GameWindow).game.listReplays()[0]);
      await assertDetailsAndReturn(page, info.outputPath('first.png'));

      await page.reload();
      await expect(page.getByTestId('title')).toBeVisible();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByTestId('open-replays').click();
      await page.getByTestId(`replay-keyframe-${replay.keyframes.length - 1}`).click();
      await expect(page.getByTestId('run-ending')).toHaveText(first);
      await expect(page.getByTestId('diagnosis')).toHaveText(diagnosis);
      await assertDetailsAndReturn(page, info.outputPath('revisited-reduced.png'));

      // v1では表示用snapshotなし。記録フレームに無い値は現行値で補わない。
      const old = JSON.parse(JSON.stringify(replay));
      old.schemaVersion = 1;
      old.id = 'ri288-ending:legacy';
      delete old.ruleset;
      delete old.contentSnapshot;
      const frame = old.keyframes.at(-1).frame;
      delete frame.org.seniorHp;
      // summary診断ではなく、表示中の結果フレームの診断を正本にする。
      frame.diagnosis = 'seniorSacrifice';
      old.outcome.diagnosis = 'reviewHell';
      expect(
        // 共有JSONの必須フィールド検査ではなく、保存済み旧記録の正規化経路を通す。
        await page.evaluate(async (blob) => (window as GameWindow).game.importReplay(blob), old),
      ).toBe(true);
      await page.getByTestId('open-replays').click();
      // finishedAtが同じなのでIDで開く。公開APIもUIと同じ結果画面を使う。
      await page.evaluate((id) => (window as GameWindow).game.openReplay(id), old.id);
      await expect(page.getByTestId('run-ending')).toHaveAttribute('data-ending', type);
      await expect(page.getByTestId('run-ending')).toContainText('シニア体力記録なし');
      await expect(page.getByTestId('diagnosis')).toContainText('Senior Sacrifice');
      await assertDetailsAndReturn(page, info.outputPath('legacy-reduced.png'));
    });
  }
}
