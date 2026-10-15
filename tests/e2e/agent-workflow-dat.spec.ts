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
    await expect(page.getByTestId('dat-reviewer-budget-value')).toHaveText('480分');
    await expect(page.getByTestId('dat-capacity-completed')).toHaveText('12件');
    await expect(page.getByTestId('dat-capacity-waiting')).toHaveText('0件');
  });

  test('AIレビューは定型PRのReview渋滞を改善するが最終確認と誤検知対応を残す', async ({ page }) => {
    await page.goto('/?rd=agent-dat');
    await page.getByRole('radio', { name: '非同期型' }).check();
    await page.getByRole('radio', { name: '事前許可' }).check();
    await expect(page.getByTestId('dat-capacity-created')).toHaveText('12件');
    await expect(page.getByTestId('dat-capacity-completed')).toHaveText('3件');

    await expect(page.getByTestId('dat-triage-setup')).toHaveText('―（対象外）');
    await expect(page.getByTestId('dat-triage-screened')).toHaveText('―（対象外）');
    await expect(page.getByTestId('dat-triage-false-positive')).toHaveText('―（対象外）');
    await expect(page.getByTestId('dat-capacity-caption')).toContainText(
      '非同期型・事前許可・人間レビューのみ',
    );

    await page.getByRole('radio', { name: 'AI事前トリアージ' }).check();
    await expect(page.getByTestId('dat-capacity-created')).toHaveText('12件');
    await expect(page.getByTestId('dat-capacity-completed')).toHaveText('5件');
    await expect(page.getByTestId('dat-capacity-waiting')).toHaveText('7件');
    await expect(page.getByTestId('dat-triage-review-minutes')).toHaveText('54分');
    await expect(page.getByTestId('dat-triage-setup')).toHaveText('6分');
    await expect(page.getByTestId('dat-triage-screened')).toHaveText('5件');
    await expect(page.getByTestId('dat-triage-false-positive')).toHaveText('1件');
    await expect(page.getByTestId('dat-triage-difference')).toContainText('人間のみより+2件');
    await expect(page.getByTestId('dat-capacity-caption')).toContainText(
      '非同期型・事前許可・AI事前トリアージ',
    );

    await page.getByRole('radio', { name: '密結合タスク' }).check();
    await expect(page.getByTestId('dat-capacity-completed')).toHaveText('0件');
    await expect(page.getByTestId('dat-triage-review-minutes')).toHaveText('42分');
    await expect(page.getByTestId('dat-triage-difference')).toContainText('人間のみと同じ');
  });

  test('作業途中の条件変更で破棄したDATを通知し、未着手の変更は通知しない', async ({ page }) => {
    await page.goto('/?rd=agent-dat');
    await page.getByRole('radio', { name: '非同期型' }).check();
    await expect(page.getByTestId('dat-reset-notice')).toHaveCount(0);
    await page.getByRole('radio', { name: '伴走型' }).check();
    await page.getByTestId('dat-advance').click();
    await page.getByTestId('dat-advance').click();
    await expect(page.getByTestId('dat-author')).toHaveText('10分');
    await page.getByRole('radio', { name: '非同期型' }).check();
    const notice = page.getByTestId('dat-reset-notice');
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(notice).toContainText('完了工程 1/3');
    await expect(notice).toContainText('Author DAT 10分・Reviewer DAT 0分 → 0分');
    await expect(page.getByTestId('dat-author')).toHaveText('0分');
    await expect(page.getByTestId('dat-stage')).toHaveText('未着手');
    await expect(notice).toBeVisible();
    // 新しい実験が未着手なら複数の条件を選んでも、破棄したDATの通知は残る。
    await page.getByRole('radio', { name: '事前許可' }).check();
    await expect(notice).toContainText('Author DAT 10分');
    await page.getByRole('radio', { name: '密結合タスク' }).check();
    await expect(notice).toContainText('Author DAT 10分');
    // 改めて進行した後は新たな破棄内容へ更新する。
    await page.getByTestId('dat-advance').click();
    await expect(page.getByTestId('dat-author')).toHaveText('6分');
    await page.getByRole('radio', { name: '伴走型' }).check();
    await expect(notice).toContainText('Author DAT 6分');
    await expect(page.getByTestId('dat-author')).toHaveText('0分');
  });

  test('投入タスクを減らすと密結合の再レビューが通り、AIレビューの負の差を確認できる', async ({
    page,
  }) => {
    await page.goto('/?rd=agent-dat');
    await page.getByRole('radio', { name: '密結合タスク' }).check();
    await page.getByRole('radio', { name: '非同期型' }).check();
    await page.getByRole('radio', { name: '事前許可' }).check();
    await page.getByRole('radio', { name: 'AI事前トリアージ' }).check();

    const count = page.getByTestId('dat-task-count');
    await count.focus();
    await count.press('Home');
    await expect(page.getByTestId('dat-task-count-value')).toHaveText('1件');
    await expect(page.getByTestId('dat-capacity-caption')).toContainText('1タスクの比較');

    const reviewer = page.getByTestId('dat-reviewer-budget');
    await reviewer.focus();
    await reviewer.press('ArrowLeft');
    await expect(page.getByTestId('dat-reviewer-budget-value')).toHaveText('48分');
    await expect(page.getByTestId('dat-capacity-created')).toHaveText('1件');
    await expect(page.getByTestId('dat-capacity-completed')).toHaveText('0件');
    await expect(page.getByTestId('dat-triage-difference')).toContainText('人間のみより−1件');

    await page.getByRole('radio', { name: '人間レビューのみ' }).check();
    await expect(page.getByTestId('dat-capacity-completed')).toHaveText('1件');
    await expect(page.getByTestId('dat-capacity-waiting')).toHaveText('0件');

    await count.focus();
    await count.press('End');
    await expect(page.getByTestId('dat-task-count-value')).toHaveText('12件');
    await expect(page.getByTestId('dat-capacity-created')).toHaveText('12件');
    await expect(page.getByTestId('dat-capacity-completed')).toHaveText('0件');
    await expect(page.getByTestId('dat-capacity-bottleneck-hint')).toBeVisible();
  });

  test('Coding途中を表示し、Reviewer増強で密結合12件も完了へ進められる', async ({ page }) => {
    await page.goto('/?rd=agent-dat');
    const authorBudget = page.getByTestId('dat-author-budget');
    await authorBudget.focus();
    await authorBudget.press('Home');
    await expect(page.getByTestId('dat-capacity-coding')).toHaveText('0件');
    await expect(page.getByTestId('dat-capacity-unstarted')).toHaveText('12件');

    await authorBudget.press('ArrowRight');
    await expect(page.getByTestId('dat-author-budget-value')).toHaveText('6分');
    await expect(page.getByTestId('dat-capacity-coding')).toHaveText('1件');
    await expect(page.getByTestId('dat-capacity-unstarted')).toHaveText('11件');
    const selectedRow = page
      .getByTestId('dat-capacity-table')
      .locator('tbody tr[data-selected="true"]');
    await expect(selectedRow.locator('td').nth(5)).toHaveText('1');
    await expect(selectedRow.locator('td').nth(6)).toHaveText('11');

    await authorBudget.press('End');
    await page.getByRole('radio', { name: '密結合タスク' }).check();
    await page.getByRole('radio', { name: '非同期型' }).check();
    await page.getByRole('radio', { name: '事前許可' }).check();
    const reviewerBudget = page.getByTestId('dat-reviewer-budget');
    await reviewerBudget.focus();
    await reviewerBudget.press('End');
    await expect(page.getByTestId('dat-reviewer-budget-value')).toHaveText('480分');
    await expect(page.getByTestId('dat-capacity-created')).toHaveText('12件');
    await expect(page.getByTestId('dat-capacity-completed')).toHaveText('4件');
  });

  test('手戻り待ちならAuthor、レビュー待ちならReviewer予算を読み上げて案内する', async ({ page }) => {
    await page.goto('/?rd=agent-dat');
    await page.getByRole('radio', { name: '密結合タスク' }).check();
    await page.getByRole('radio', { name: '非同期型' }).check();
    await page.getByRole('radio', { name: '事前許可' }).check();

    const count = page.getByTestId('dat-task-count');
    await count.focus();
    await count.press('Home');
    const author = page.getByTestId('dat-author-budget');
    await author.focus();
    await author.press('Home');
    await author.press('ArrowRight');

    await expect(page.getByTestId('dat-capacity-created')).toHaveText('1件');
    await expect(page.getByTestId('dat-capacity-completed')).toHaveText('0件');
    await expect(page.getByTestId('dat-capacity-rework')).toHaveText('1件');
    await expect(page.getByTestId('dat-capacity-waiting')).toHaveText('0件');

    const hint = page.getByTestId('dat-capacity-bottleneck-hint');
    await expect(hint).toContainText('Author作業予算を増やしてください');
    await expect(hint).not.toContainText('Reviewer作業予算');
    await expect(hint.locator('xpath=..')).toHaveAttribute('role', 'status');
    await expect(hint.locator('xpath=..')).toHaveAttribute('aria-live', 'polite');

    await author.press('End');
    await expect(page.getByTestId('dat-capacity-completed')).toHaveText('1件');
    await expect(hint).toHaveCount(0);

    await author.press('Home');
    await author.press('ArrowRight');
    const reviewer = page.getByTestId('dat-reviewer-budget');
    await reviewer.focus();
    await reviewer.press('Home');
    await expect(page.getByTestId('dat-capacity-waiting')).toHaveText('1件');
    await expect(page.getByTestId('dat-capacity-rework')).toHaveText('0件');
    await expect(hint).toContainText('Reviewer作業予算');
    await expect(hint).not.toContainText('Author作業予算');
  });

  test('390/320幅で選択中のレビュー方式を省略せず表示し、表の名前にも使う', async ({ page }) => {
      for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/?rd=agent-dat');
      await page.getByRole('radio', { name: '非同期型' }).check();
      await page.getByRole('radio', { name: '事前許可' }).check();
      await page.getByRole('radio', { name: 'AI事前トリアージ' }).check();
      const caption = page.getByTestId('dat-capacity-caption');
      await caption.scrollIntoViewIfNeeded();
      await expect(caption).toContainText('非同期型・事前許可・AI事前トリアージ');
      await expect(page.getByTestId('dat-capacity-table')).toHaveAttribute(
        'aria-labelledby',
        'dat-capacity-comparison-label',
      );
      const layout = await caption.evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
        whiteSpace: getComputedStyle(element).whiteSpace,
      }));
      expect(layout.whiteSpace).toBe('normal');
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
      const captionBox = await caption.boundingBox();
      expect(captionBox).not.toBeNull();
      expect(captionBox!.x).toBeGreaterThanOrEqual(-1);
      expect(captionBox!.x + captionBox!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(await page.getByTestId('dat-capacity-table').locator('caption').count()).toBe(0);
    }
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
