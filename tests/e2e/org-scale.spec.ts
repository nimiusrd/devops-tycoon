import { expect, test } from '@playwright/test';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    zoomTo(level: string): RunState;
    focusDept(id: string): RunState;
    focusTeam(id: string): RunState;
    setRankingKind(kind: string): RunState;
    applyOrgLever(leverId: string, deptId?: string): RunState;
  };
};

/** タイトルからランを開始し、現場（team）まで進める。 */
async function startRun(page: import('@playwright/test').Page, seed: string) {
  await page.goto(`/?seed=${seed}`);
  await page.evaluate((s) => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], s);
  }, seed);
}

test('現場→全社→部署→業界をパンくずで地続きにズームできる（DoD）', async ({ page }) => {
  await startRun(page, 'zoom-e2e');

  // 全社マップへズームアウト。
  await page.evaluate(() => (window as GameWindow).game!.zoomTo('company'));
  await expect(page.getByTestId('zoom-overlay')).toHaveAttribute('data-level', 'company');
  await expect(page.getByTestId('org-screen')).toBeVisible();
  await expect(page.getByTestId('org-hud')).toBeVisible();
  await expect(page.getByTestId('org-board')).toBeVisible();
  await expect(page.getByTestId('org-infra-hub')).toBeVisible();

  // パンくずで業界ランキングへ。
  await page.getByTestId('crumb-industry').click();
  await expect(page.getByTestId('industry-screen')).toBeVisible();
  await expect(page.getByTestId('industry-self-row')).toBeVisible();

  // ランキング種別タブを切り替える。
  await page.getByTestId('rank-tab-healthy').click();
  await expect(page.getByTestId('rank-tab-healthy')).toHaveAttribute('aria-selected', 'true');

  // パンくずで部署ビューへ。
  await page.getByTestId('crumb-department').click();
  await expect(page.getByTestId('dept-screen')).toBeVisible();
  await expect(page.getByTestId('dept-board')).toBeVisible();
});

test('チーム島をタップすると現場へドリルダウンしてオーバーレイが閉じる（第4.11）', async ({
  page,
}) => {
  await startRun(page, 'drill-e2e');
  await page.evaluate(() => (window as GameWindow).game!.zoomTo('company'));

  const player = page.getByTestId('team-product-t0');
  await expect(player).toBeVisible();
  await player.click();

  // 現場へ着地 → オーバーレイは消える。
  await expect(page.getByTestId('zoom-overlay')).toHaveCount(0);
  const teamId = await page.evaluate(() => (window as GameWindow).game!.getState().zoom.teamId);
  expect(teamId).toBe('product-t0');
});

test('全社レバーで四半期予算が減り、全社AI依存度が下がる（第4.8）', async ({ page }) => {
  await startRun(page, 'lever-e2e');
  await page.evaluate(() => (window as GameWindow).game!.zoomTo('company'));

  const before = await page.evaluate(() => {
    const s = (window as GameWindow).game!.getState();
    return { budget: s.budget, aiDep: s.orgScale!.aiDependency };
  });

  await page.getByTestId('lever-aiGuideline').click();

  await expect
    .poll(async () => page.evaluate(() => (window as GameWindow).game!.getState().budget))
    .toBeLessThan(before.budget);
  const aiDepAfter = await page.evaluate(
    () => (window as GameWindow).game!.getState().orgScale!.aiDependency,
  );
  expect(aiDepAfter).toBeLessThanOrEqual(before.aiDep);
});
