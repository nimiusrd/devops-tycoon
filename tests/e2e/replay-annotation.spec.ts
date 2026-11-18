import { expect, test, type Page } from '@playwright/test';
import type { GameHandle } from '../../src/game';
import type { ReplayBlob } from '../../src/state/replay';

test.setTimeout(90_000);

// 公開GameHandleだけで実ランを記録する。フレーム・結果・勝利種別は手作りしない。
async function recordReplay(page: Page) {
  await page.goto('/?seed=annotation-e2e&tutorial=off&renderer=pixi');
  await expect(page.getByTestId('title')).toBeVisible();
  await page.evaluate(() => {
    const game = window.game as GameHandle;
    game.startRun('easy', [], 'annotation-e2e');
    game.pause();
    game.beginSetupSprint();
  });
  // フェーズ境界リプレイはsprint本体を保持しない。記録元の実WebGLで準備を検証する。
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('webgl-status')).toBeHidden();
  await page.evaluate(async () => {
    const game = window.game as GameHandle;
    for (let i = 0; i < 80000; i++) {
      const state = game.getState();
      if (state.status !== 'playing') break;
      switch (state.phase) {
        case 'setup':
          game.beginSetupSprint();
          break;
        case 'sprint':
          game.step(1000);
          break;
        case 'result':
          game.acknowledgeResult();
          break;
        case 'draft':
          game.skipDraft();
          break;
        case 'evolution':
          game.finishEvolution();
          break;
        case 'beat':
          game.resolveBeat(0);
          break;
        case 'shop':
          game.leaveShop();
          break;
        case 'rest':
          game.restChoose('heal');
          break;
        case 'recruit':
          game.recruitChoose('skip');
          break;
        case 'quarterReview': {
          const review = state.quarterReview;
          if (review?.outcome === 'missed_adjustable')
            game.chooseGoalAdjustment(review.availableAdjustments[0] ?? 'cut_scope');
          else game.acknowledgeQuarterReview();
          break;
        }
        default:
          throw new Error(`unexpected phase: ${state.phase}`);
      }
    }
    if (game.getState().status === 'playing') throw new Error('run did not finish');
  });
  await expect
    .poll(() => page.evaluate(() => window.game?.listReplays().length ?? 0))
    .toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.game!.finishSaveBlocksNewRun())).toBe(false);
  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.game?.listReplays().length ?? 0))
    .toBeGreaterThan(0);
}

async function openList(page: Page) {
  await page.getByTestId('open-replays').click();
  await expect(page.getByTestId('replay-list')).toBeVisible();
  await expect(page.getByTestId('replay-annotation-text')).toBeVisible();
}

const viewports = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
];

for (const viewport of viewports) {
  test(`${viewport.name}: 注釈を編集・JSON往復・閲覧しキーボードで戻れる`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({
      reducedMotion: viewport.name === 'desktop' ? 'no-preference' : 'reduce',
    });
    await recordReplay(page);
    await openList(page);
    const recorded = await page.evaluate(async () => {
      const replay = window.game!.listReplays()[0];
      const first = replay.keyframes[0].frame;
      return {
        seed: replay.seed,
        difficulty: replay.difficulty,
        trials: replay.trials,
        ruleset: replay.ruleset,
        initial: { budget: first.budget, org: first.org },
        outcome: replay.outcome,
        keyframes: replay.keyframes.length,
      };
    });
    const sceneIndex = await page.evaluate(() =>
      window.game!.listReplays()[0].keyframes.findIndex((frame) => frame.phase === 'result'),
    );
    expect(sceneIndex).toBeGreaterThan(0);
    await page.getByTestId('replay-annotation-scene').selectOption(String(sceneIndex));
    const note =
      '<img src=x onerror="window.annotationXss=true">\n短期出荷を譲り、レビューの余力を残した。' +
      '長い理由。'.repeat(80);
    await page.getByTestId('replay-annotation-text').fill(note);
    await expect(page.getByTestId('replay-annotation-text')).toHaveAttribute('maxlength', '1000');
    await page.getByTestId('replay-annotation-text').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('replay-annotation-save')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('replay-annotation-text')).toBeFocused();
    await page.keyboard.press('Tab');
    const focus = await page
      .getByTestId('replay-annotation-save')
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(focus).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('replay-annotation-status')).toHaveText('注釈を保存しました。');
    expect(
      await page.getByTestId('replay-list').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await page.getByTestId('replay-annotation-save').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-editor.png`) });
    const download = page.waitForEvent('download');
    await page.getByTestId('replay-download').click();
    const file = await download;
    const path = await file.path();
    expect(path).toBeTruthy();
    await file.saveAs(testInfo.outputPath('annotated-replay.json'));
    // ファイル取込みも製品のinputを使う。
    await page.getByTestId('replay-file').setInputFiles(path!);
    await expect(page.getByTestId('replay-share-status')).toHaveText('リプレイを読み込みました。');
    await page.reload();
    await expect(page.getByTestId('title')).toBeVisible();
    await openList(page);
    await expect(page.getByTestId('replay-annotation-text')).toHaveValue(note);
    expect(await page.evaluate(() => window.game!.listReplays()[0].outcome)).toEqual(
      recorded.outcome,
    );
    await testInfo.attach('annotation-evidence', {
      body: JSON.stringify(
        { ...recorded, viewport, annotationCharacters: note.length, outcomeUnchanged: true },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await page.getByTestId('replay-keyframe-0').click();
    await expect(page.getByTestId('replay-annotation-view')).toHaveCount(0);
    await page.getByTestId('exit-replay').click();
    await expect(page.getByTestId('title')).toBeVisible();
    await openList(page);
    await page.getByTestId(`replay-keyframe-${sceneIndex}`).click();
    await expect(page.getByTestId('sprint-result')).toBeVisible();
    await expect(page.getByTestId('webgl-status')).toBeHidden();
    const view = page.getByTestId('replay-annotation-view');
    await expect(view.locator('summary')).toHaveText('作者の理由（記録値とは別のメモ）');
    await view.locator('summary').focus();
    await page.keyboard.press('Space');
    await expect(view.locator('p')).toHaveText(note);
    await page.keyboard.press('Tab');
    await expect(view.locator('p')).toBeFocused();
    await page.keyboard.press('End');
    await expect.poll(() => view.locator('p').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('Home');
    await expect(view.locator('img')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as Window & { annotationXss?: boolean }).annotationXss),
    ).toBeUndefined();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-viewer.png`) });
    await page.getByTestId('result-restart').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('title')).toBeVisible();
    await openList(page);
    await page.getByTestId('replay-annotation-text').fill('');
    await page.getByTestId('replay-annotation-save').click();
    await expect(page.getByTestId('replay-annotation-status')).toHaveText('注釈を保存しました。');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('replay-list')).toBeHidden();
    await expect(page.getByTestId('open-replays')).toBeFocused();
  });
}

test('保存失敗で下書きを維持し、別タブの新しい注釈を上書きしない', async ({ page, context }) => {
  await recordReplay(page);
  await openList(page);
  await page.getByTestId('replay-annotation-text').fill('未保存の理由');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let failed = false;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'replays' && !failed) {
        failed = true;
        throw new DOMException('full', 'QuotaExceededError');
      }
      return put.apply(this, args);
    };
  });
  await page.getByTestId('replay-annotation-save').click();
  await expect(page.getByTestId('replay-annotation-status')).toContainText('保存できませんでした');
  await expect(page.getByTestId('replay-annotation-text')).toHaveValue('未保存の理由');
  expect(await page.evaluate(() => window.game?.listReplays()[0].annotation)).toBeUndefined();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('replay-list')).toBeHidden();
  await openList(page);
  await expect(page.getByTestId('replay-annotation-text')).toHaveValue('未保存の理由');
  await page.getByTestId('replay-annotation-text').fill('再試行中も残す新しい下書き');
  await page.getByTestId('persistence-retry').click();
  await expect
    .poll(() => page.evaluate(() => window.game?.listReplays()[0].annotation?.text))
    .toBe('未保存の理由');
  await expect(page.getByTestId('replay-annotation-text')).toHaveValue(
    '再試行中も残す新しい下書き',
  );
  await expect(page.getByTestId('replay-annotation-status')).toHaveText('未保存の変更があります。');
  await page.getByTestId('replay-annotation-save').click();
  await expect(page.getByTestId('replay-annotation-status')).toHaveText('注釈を保存しました。');
  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
  await openList(page);
  const other = await context.newPage();
  await other.goto('/?tutorial=off');
  await expect(other.getByTestId('title')).toBeVisible();
  await openList(other);
  await other.getByTestId('replay-annotation-text').fill('別タブの古い下書き');
  await page.getByTestId('replay-annotation-text').fill('先に保存した理由');
  await page.getByTestId('replay-annotation-save').click();
  await expect(page.getByTestId('replay-annotation-status')).toHaveText('注釈を保存しました。');
  await other.getByTestId('replay-annotation-save').click();
  await expect(other.getByTestId('tab-conflict-overlay')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
  await openList(page);
  await expect(page.getByTestId('replay-annotation-text')).toHaveValue('先に保存した理由');
  const saved = await page.evaluate(() => window.game?.listReplays()[0] as ReplayBlob);
  expect(saved.annotation?.text).toBe('先に保存した理由');
});
