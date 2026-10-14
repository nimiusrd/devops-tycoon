import { expect, test } from './fixtures';

test.describe('非同期エージェント DAT R&D 画面', () => {
  test('通常ゲームを起動せず、非同期の1ターンPR作成とレビュー負荷を確認する', async ({ page }) => {
    await page.goto('/?rd=agent-dat');
    await expect(page.getByTestId('agent-dat-lab')).toBeVisible();
    expect(await page.evaluate(() => 'game' in window)).toBe(false);

    await page.getByRole('radio', { name: '非同期型' }).check();
    await page.getByRole('radio', { name: '事前許可' }).check();
    await expect(
      page.getByTestId('dat-compare').locator('tbody tr[data-selected="true"] th'),
    ).toContainText('（選択中）');
    await expect(page.getByTestId('dat-touches')).toHaveText('0回');
    await page.getByTestId('dat-advance').click();

    await expect(page.getByTestId('dat-pr-created')).toHaveText('PR作成済み');
    await expect(page.getByTestId('dat-task-completed')).toHaveText('タスク未完了');
    await expect(page.getByTestId('dat-author')).toHaveText('6分');
    await expect(page.getByTestId('dat-reviewer')).toHaveText('0分');
    await expect(page.getByTestId('dat-touches')).toHaveText('1回');
    await expect(page.getByTestId('dat-approvals')).toHaveText('0回');
    await expect(page.getByTestId('dat-agent-runtime')).toHaveText('18分');

    await page.getByTestId('dat-advance').click();
    await expect(page.getByTestId('dat-task-completed')).toHaveText('タスク完了');
    await expect(page.getByTestId('dat-reviewer')).toHaveText('16分');
    await expect(page.getByTestId('dat-total')).toHaveText('22分');
    await expect(page.getByTestId('dat-throughput')).toHaveText('2.73件');
    await expect(page.getByTestId('dat-advance')).toBeDisabled();
    await expect(page.getByTestId('dat-events').getByText(/レビュー承認/)).toBeVisible();
  });

  test('伴走型の承認は各工程で必要、変更・再実行で状態がリセットされる', async ({ page }) => {
    await page.goto('/?rd=agent-dat');
    await expect(page.getByTestId('dat-stage')).toHaveText('未着手');
    await page.getByTestId('dat-advance').click();

    for (const step of ['ファイル編集を承認', 'テストを承認', 'PR作成を承認']) {
      await expect(page.getByTestId('dat-advance')).toHaveText(step);
      await page.getByTestId('dat-advance').click();
    }
    await expect(page.getByTestId('dat-pr-created')).toHaveText('PR作成済み');
    await expect(page.getByTestId('dat-author')).toHaveText('18分');
    await expect(page.getByTestId('dat-approvals')).toHaveText('3回');
    await page.getByTestId('dat-advance').click();
    await expect(page.getByTestId('dat-total')).toHaveText('30分');

    await page.getByTestId('dat-reset').click();
    await expect(page.getByTestId('dat-total')).toHaveText('0分');
    await expect(page.getByTestId('dat-pr-created')).toHaveText('PR未作成');

    await page.getByRole('radio', { name: '密結合タスク' }).check();
    await page.getByRole('radio', { name: '非同期型' }).check();
    await page.getByRole('radio', { name: '事前許可' }).check();
    await page.getByTestId('dat-advance').click();
    await page.getByTestId('dat-advance').click();
    await expect(page.getByTestId('dat-stage')).toHaveText('レビュー差戻し・手戻り');
    await expect(page.getByTestId('dat-reworks')).toHaveText('1回');
    await expect(page.getByTestId('dat-task-completed')).toHaveText('タスク未完了');
    await page.getByTestId('dat-advance').click();
    await page.getByTestId('dat-advance').click();
    await expect(page.getByTestId('dat-total')).toHaveText('87分');
    await expect(page.getByTestId('dat-task-completed')).toHaveText('タスク完了');
  });

  test('PR作成数が増えてもReview予算不足なら完了が増えず、予算増で解消する', async ({ page }) => {
    await page.goto('/?rd=agent-dat');
    await expect(
      page.getByTestId('dat-capacity-table').locator('tbody tr[data-selected="true"] th'),
    ).toContainText('（選択中）');
    await expect(page.getByTestId('dat-capacity-created')).toHaveText('6件');
    await expect(page.getByTestId('dat-capacity-completed')).toHaveText('5件');
    await expect(page.getByTestId('dat-capacity-waiting')).toHaveText('1件');

    await page.getByRole('radio', { name: '非同期型' }).check();
    await page.getByRole('radio', { name: '事前許可' }).check();
    await expect(page.getByTestId('dat-capacity-created')).toHaveText('12件');
    await expect(page.getByTestId('dat-capacity-completed')).toHaveText('3件');
    await expect(page.getByTestId('dat-capacity-waiting')).toHaveText('9件');

    const reviewBudget = page.getByTestId('dat-reviewer-budget');
    await reviewBudget.focus();
    await reviewBudget.press('End');
    await expect(page.getByTestId('dat-reviewer-budget-value')).toHaveText('240分');
    await expect(page.getByTestId('dat-capacity-completed')).toHaveText('12件');
    await expect(page.getByTestId('dat-capacity-waiting')).toHaveText('0件');
  });

  for (const viewport of [
    { name: 'phone-se', width: 320, height: 568 },
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop-short', width: 1024, height: 768 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    test(`${viewport.name}: 画面横あふれがなく操作できる`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/?rd=agent-dat');
      await expect(page.getByTestId('agent-dat-lab')).toBeVisible();

      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width).toBeLessThanOrEqual(viewport.width + 1);
      const action = page.getByTestId('dat-advance');
      await action.scrollIntoViewIfNeeded();
      await expect(action).toBeVisible();
      await action.click();
      await expect(page.getByTestId('dat-stage')).toHaveText('実装中・承認待ち');
      const box = await action.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    });
  }
});
