import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import { DESIGN_SPACES } from '../../src/render/visualTokens';
import type { RunState } from '../../src/sim/run/types';
import { seedMeta } from './seedMeta';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    zoomTo(level: string): RunState;
    focusDept(id: string): RunState;
    focusTeam(id: string): RunState;
    enterTeam(id: string): RunState;
    setRankingKind(kind: string): RunState;
    applyOrgLever(leverId: string, deptId?: string, teamId?: string): RunState;
  };
};

/** タイトルからランを開始し、現場（team）まで進める。 */
async function startRun(page: import('@playwright/test').Page, seed: string) {
  await page.goto(`/?renderer=dom&seed=${seed}`);
  await page.evaluate((s) => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], s);
  }, seed);
}

type Box = { x: number; y: number; width: number; height: number };

async function readBox(locator: Locator, label: string): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} の bounding box が取得できない`);
  return box;
}

async function assertAspectStage(
  stage: Locator,
  board: Locator,
  ratio: number,
  label: string,
): Promise<void> {
  const content = stage.getByTestId('aspect-stage-content');
  await expect(board, `${label} の盤面が表示されない`).toBeVisible();
  await expect
    .poll(async () => (await content.boundingBox())?.height ?? 0, `${label} のステージが未計算`)
    .toBeGreaterThan(0);

  const [stageBox, contentBox, boardBox] = await Promise.all([
    readBox(stage, `${label} スロット`),
    readBox(content, `${label} 実ステージ`),
    readBox(board, `${label} 盤面`),
  ]);
  const ratioError = Math.abs(contentBox.width / contentBox.height / ratio - 1);
  expect(ratioError, `${label} の設計比率が崩れている`).toBeLessThanOrEqual(0.01);

  expect(
    Math.abs(boardBox.x - contentBox.x),
    `${label} の盤面X位置がずれている`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boardBox.y - contentBox.y),
    `${label} の盤面Y位置がずれている`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boardBox.width - contentBox.width),
    `${label} の盤面幅がステージと一致しない`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boardBox.height - contentBox.height),
    `${label} の盤面高がステージと一致しない`,
  ).toBeLessThanOrEqual(1);

  expect(contentBox.x, `${label} がスロット左外へはみ出している`).toBeGreaterThanOrEqual(
    stageBox.x - 1,
  );
  expect(contentBox.y, `${label} がスロット上外へはみ出している`).toBeGreaterThanOrEqual(
    stageBox.y - 1,
  );
  expect(
    contentBox.x + contentBox.width,
    `${label} がスロット右外へはみ出している`,
  ).toBeLessThanOrEqual(stageBox.x + stageBox.width + 1);
  expect(
    contentBox.y + contentBox.height,
    `${label} がスロット下外へはみ出している`,
  ).toBeLessThanOrEqual(stageBox.y + stageBox.height + 1);
}

async function assertDesktopStageUsesAvailableHeight(stage: Locator, label: string): Promise<void> {
  await expect
    .poll(
      async () => (await stage.getByTestId('aspect-stage-content').boundingBox())?.height ?? 0,
      `${label} のステージ高が最小値に留まっている`,
    )
    .toBeGreaterThan(300);
}

test('全社・部署・業界の盤面がAspectStageで設計比率とcontain範囲を維持する（RI-100）', async ({
  page,
}) => {
  const viewports = [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1440, height: 900 },
  ] as const;

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startRun(page, `ri100-aspect-stage-${viewport.name}`);

    await page.evaluate(() => (window as GameWindow).game!.zoomTo('company'));
    await assertAspectStage(
      page.getByTestId('org-field'),
      page.getByTestId('org-board'),
      DESIGN_SPACES.organization.w / DESIGN_SPACES.organization.h,
      `${viewport.name} 全社`,
    );
    if (viewport.name === 'desktop') {
      await assertDesktopStageUsesAvailableHeight(page.getByTestId('org-field'), 'desktop 全社');
    }

    await page.getByTestId('crumb-industry').click();
    await assertAspectStage(
      page.getByTestId('industry-skyline-stage'),
      page.locator('.industry-skyline.iso-industry'),
      DESIGN_SPACES.industry.w / DESIGN_SPACES.industry.h,
      `${viewport.name} 業界`,
    );

    if (viewport.name === 'phone') {
      const overlay = page.getByTestId('zoom-overlay');
      const scrollMetrics = await overlay.evaluate((element) => {
        const scrollable = element as HTMLElement;
        return { scrollHeight: scrollable.scrollHeight, clientHeight: scrollable.clientHeight };
      });
      expect(
        scrollMetrics.scrollHeight,
        '業界画面のオーバーレイがスクロール可能でない',
      ).toBeGreaterThan(scrollMetrics.clientHeight);
      await overlay.evaluate((element) => {
        const scrollable = element as HTMLElement;
        scrollable.scrollTop = scrollable.scrollHeight;
      });
      await expect
        .poll(async () => overlay.evaluate((element) => (element as HTMLElement).scrollTop))
        .toBeGreaterThan(0);
    }

    await page.getByTestId('crumb-department').click();
    await assertAspectStage(
      page.getByTestId('dept-field'),
      page.getByTestId('dept-board'),
      DESIGN_SPACES.department.w / DESIGN_SPACES.department.h,
      `${viewport.name} 部署`,
    );
    if (viewport.name === 'desktop') {
      await assertDesktopStageUsesAvailableHeight(page.getByTestId('dept-field'), 'desktop 部署');
    }
  }
});

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
  await expect(page.getByTestId('industry-skyline')).toBeVisible();
  await expect(page.getByTestId('industry-hq-crown')).toBeVisible();
  await expect(page.getByTestId('industry-hq-self')).toBeVisible();
  await expect(page.getByTestId('industry-self-row')).toBeVisible();

  // ランキング種別タブを切り替える。
  await page.getByTestId('rank-tab-healthy').click();
  await expect(page.getByTestId('rank-tab-healthy')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('industry-skyline')).toBeVisible();
  await expect(page.getByTestId('industry-hq-self')).toBeVisible();

  // パンくずで部署ビューへ。
  await page.getByTestId('crumb-department').click();
  await expect(page.getByTestId('dept-screen')).toBeVisible();
  await expect(page.getByTestId('dept-board')).toBeVisible();
});

test('業界画面で保存済みデイリー記録を順位付きで表示する（RI-23）', async ({ page }) => {
  await seedMeta(page, {
    points: 0,
    unlockedDifficulties: ['easy', 'normal'],
    defeatedBosses: [],
    achievements: [],
    bestScore: 1200,
    unlockedCards: [],
    unlockedRelics: [],
    dailyRuns: {
      '2026-07-09': { bestScore: 800, rewardClaimed: true },
      '2026-07-10': { bestScore: 1200, rewardClaimed: true },
      '2026-07-11': { bestScore: 1200, rewardClaimed: false },
    },
  });
  await startRun(page, 'daily-ranking-e2e');
  await page.evaluate(() => (window as GameWindow).game!.zoomTo('industry'));

  await expect(page.getByTestId('daily-leaderboard')).toBeVisible();
  await expect(page.getByTestId('daily-record-2026-07-11')).toContainText('#1');
  await expect(page.getByTestId('daily-record-2026-07-11')).toContainText('1,200 pt');
  await expect(page.getByTestId('daily-record-2026-07-10')).toContainText('#2');
  await expect(page.getByTestId('daily-record-2026-07-09')).toContainText('#3');
});

test('ホームチーム島をタップすると現場へドリルダウンしてオーバーレイが閉じる（第4.11）', async ({
  page,
}) => {
  await startRun(page, 'drill-e2e');
  await page.evaluate(() => (window as GameWindow).game!.zoomTo('company'));

  const player = page.getByTestId('team-product-t0');
  await expect(player).toBeVisible();
  await player.click();

  // 選択中ホームは focusTeam で現場へ着地 → オーバーレイは消える。
  await expect(page.getByTestId('zoom-overlay')).toHaveCount(0);
  const teamId = await page.evaluate(() => (window as GameWindow).game!.getState().zoom.teamId);
  expect(teamId).toBe('product-t0');
});

test('他チームは状態確認後に入り込みで現場へ着地できる（RI-64）', async ({ page }) => {
  await startRun(page, 'enter-team-e2e');
  await page.evaluate(() => (window as GameWindow).game!.zoomTo('company'));

  await page.getByTestId('team-platform-t1').click();
  await expect(page.getByTestId('dept-screen')).toBeVisible();
  await expect(page.getByTestId('dept-team-panel')).toBeVisible();
  await page.getByTestId('enter-team').click();

  await expect(page.getByTestId('zoom-overlay')).toHaveCount(0);
  const state = await page.evaluate(() => {
    const s = (window as GameWindow).game!.getState();
    return { active: s.activeTeamId, level: s.zoom.level, lock: s.teamLockUntilSprint };
  });
  expect(state.active).toBe('platform-t1');
  expect(state.level).toBe('team');
  expect(state.lock).toBe(1);
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
