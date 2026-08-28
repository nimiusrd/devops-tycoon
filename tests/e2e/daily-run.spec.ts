import { expect, test } from './fixtures';
import { dailySeed } from '../../src/state/meta';

test('タイトルからデイリーランを開始できる', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=daily-e2e');

  await expect(page.getByTestId('daily-run-section')).toBeVisible();
  await page.getByTestId('start-daily-run').click();

  await expect(page.getByTestId('setup')).toBeVisible({ timeout: 5000 });

  const info = await page.evaluate(() => {
    const g = window.game!;
    const s = g.getState();
    return {
      runKind: s.runKind,
      dailyDate: s.dailyDate,
      seed: s.seed,
      phase: s.phase,
      diagnostic: g.getDiagnosticInfo(),
    };
  });

  expect(info.phase).toBe('setup');
  expect(info.runKind).toBe('daily');
  expect(info.dailyDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(info.seed).toBe(dailySeed(info.dailyDate!));
  expect(info.diagnostic).toMatchObject({
    schemaVersion: 1,
    seed: info.seed,
    runKind: 'daily',
    dailyDate: info.dailyDate,
    ruleset: {
      version: expect.any(Number),
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
  });
});

test('Daily無介入 Sprint 1 は評価 B でも危機の読みと内訳が見える', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=daily-2026-08-27');

  await page.evaluate(() => {
    const g = window.game!;
    g.pause();
    g.startDailyRun('2026-08-27');
    g.beginSetupSprint();
    let s = g.getState();
    let guard = 0;
    while (s.phase === 'sprint' && guard < 8000) {
      guard += 1;
      s = g.step(1_000_000);
    }
    if (s.phase !== 'result' || !s.lastResult) {
      throw new Error(`スプリントリザルトへ到達できませんでした: ${s.phase}`);
    }
  });

  await expect(page.getByTestId('sprint-result')).toBeVisible();
  await expect(page.getByTestId('result-grade')).toHaveText('B');
  await expect(page.getByTestId('result-grade-caption')).toContainText(
    '大きな危機を出しつつ出荷した',
  );
  await expect(page.getByTestId('result-grade-breakdown')).toBeVisible();
  await expect(page.getByTestId('result-grade-tip')).toContainText('出荷点を母数');
  await expect(page.getByTestId('result-diagnosis-text')).toContainText('燃え尽き寸前');
  await expect(page.getByTestId('result-title')).toContainText('シニア過労メーカー');
});

test('デイリー後の通常ランは起動 seed を使い daily seed を引き継がない', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=pending-seed-e2e');
  await expect(page.getByTestId('seed')).toContainText('pending-seed-e2e');

  await page.getByTestId('start-daily-run').click();
  await expect(page.getByTestId('setup')).toBeVisible({ timeout: 5000 });

  await page.evaluate(() => {
    window.game!.newRun();
  });
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('seed')).toContainText('pending-seed-e2e');
  await expect(page.getByTestId('seed')).not.toContainText(/daily-\d{4}-\d{2}-\d{2}/);

  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('setup')).toBeVisible({ timeout: 5000 });

  const started = await page.evaluate(() => {
    const s = window.game!.getState();
    return { seed: s.seed, runKind: s.runKind, dailyDate: s.dailyDate ?? null };
  });
  expect(started.seed).toBe('pending-seed-e2e');
  expect(started.runKind).toBe('normal');
  expect(started.dailyDate).toBeNull();
});
