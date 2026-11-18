/** 緊急対応の実鎮火IDと、HTMLティッカー・実WebGL盤面の整合（#682）。 */
import type { SprintState } from '../../src/sim/types';
import {
  FIREFIGHT_STABILITY_BURN_TICKS,
  FIREFIGHT_STABILITY_MIN_BURNING,
} from '../../src/sim/actions';
import {
  advanceCurrentSprintToBurning,
  beginPublicSprint,
  expandSprintInterventionsIfCollapsed,
  expect,
  test,
  type PublicGameWindow,
} from './fixtures';

const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

type InjectedGameWindow = PublicGameWindow & {
  game: NonNullable<PublicGameWindow['game']> & { engine: { sprint: SprintState } };
};

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}/${reducedMotion}: 緊急対応の実対象と直接結果を1回読み上げる（#682）`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion });
      await beginPublicSprint(page, { seed: 'ri34-burn', difficulty: 'hard' });
      await advanceCurrentSprintToBurning(page);
      const burning = await page.evaluate(
        ({ ticks, count }) => {
          const game = (window as PublicGameWindow).game!;
          for (let guard = 0; guard < 2000; guard += 1) {
            const state = game.getState();
            if (state.phase !== 'sprint') break;
            const fires = state.sprint!.tasks.filter(
              (task) => task.lane === 'rework' && task.incident,
            );
            if (
              fires.length >= count ||
              fires.some((task) => (task.burnTicksLeft ?? Infinity) <= ticks)
            ) {
              return fires.map((task) => task.id);
            }
            game.step(100);
          }
          throw new Error('緊急鎮火の条件へ到達しない');
        },
        { ticks: FIREFIGHT_STABILITY_BURN_TICKS, count: FIREFIGHT_STABILITY_MIN_BURNING },
      );
      await expandSprintInterventionsIfCollapsed(page);
      await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
      await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
      const before = await page.evaluate(() => (window as PublicGameWindow).game!.getState());
      await page.getByTestId('action-firefight').click();
      const after = await page.evaluate(() => (window as PublicGameWindow).game!.getState());
      const event = after.sprint!.events.findLast(
        (entry) => entry.kind === 'intervention' && entry.effect.actionId === 'firefight',
      );
      if (event?.kind !== 'intervention' || event.effect.containedTaskId == null) {
        throw new Error('実際の鎮火結果が記録されていない');
      }
      const taskId = event.effect.containedTaskId;
      expect(burning).toContain(taskId);
      expect(after.sprint!.tasks.find((task) => task.id === taskId)).toMatchObject({
        lane: 'review',
        incident: false,
      });
      expect(after.sprint!.metrics.contained - before.sprint!.metrics.contained).toBe(1);
      expect(after.sprint!.metrics.delivered).toBe(before.sprint!.metrics.delivered);
      const result = `PR #${taskId} を鎮火 → レビュー待ち`;
      const ticker = page.getByTestId('event-ticker');
      const summary = page.getByTestId('event-ticker-summary');
      await expect(ticker).toHaveAttribute('data-feedback-held', 'true');
      await expect(summary).toContainText(result);
      await expect(summary).not.toContainText(/出荷|納品|期限|機能|実行完了/);
      await expect(summary).toContainText('シニアHP -');
      const focusChange = after.sprint!.focus - before.sprint!.focus;
      expect(focusChange).toBeLessThan(0);
      await expect(summary).toContainText(`集中力 ${focusChange}`);
      await expect(page.getByRole('status').filter({ hasText: result })).toHaveCount(1);
      await summary.scrollIntoViewIfNeeded();
      const layout = await summary.evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
        height: element.clientHeight,
        scrollHeight: element.scrollHeight,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
      expect(layout.scrollHeight).toBeLessThanOrEqual(layout.height + 1);
      expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
      await ticker.screenshot({ path: testInfo.outputPath('firefight-result.png') });
      await page.getByTestId('event-ticker-heading').click();
      await expect(page.getByTestId('event-ticker-list')).toContainText(result);
      await expect(page.getByRole('status').filter({ hasText: result })).toHaveCount(1);
      await page.clock.runFor(2600);
      await expect(ticker).toHaveAttribute('data-feedback-held', 'false');
      await expect(page.getByTestId('event-ticker-list')).toContainText(result);
    });
  }
}

test('実行直前に対象が消えた緊急対応は成功を表示しない（#682）', async ({ page }) => {
  test.setTimeout(120_000);
  await beginPublicSprint(page, { seed: 'ri34-burn', difficulty: 'hard' });
  await advanceCurrentSprintToBurning(page);
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await expect(page.getByTestId('action-firefight')).toBeEnabled();
  // Ready描画後・dispatch前の競合だけを合成し、実際の失敗判定と表示を通す。
  await page.evaluate(() => {
    for (const task of (window as InjectedGameWindow).game.engine.sprint.tasks) {
      task.incident = false;
    }
  });
  await page.getByTestId('action-firefight').click();
  const summary = page.getByTestId('event-ticker-summary');
  await expect(summary).toContainText('緊急対応: 炎上なし');
  await expect(summary).not.toContainText(/PR #|鎮火 →|レビュー待ち|実行完了/);
});
