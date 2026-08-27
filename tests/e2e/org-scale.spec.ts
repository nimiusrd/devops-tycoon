import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import { DESIGN_SPACES } from '../../src/render/visualTokens';
import { dailyRunKey } from '../../src/state/meta';
import { CURRENT_RUN_RULESET } from '../../src/state/runPersistence';
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

const HEALTH_LABEL = {
  healthy: '健全',
  congested: '渋滞',
  reviewHell: '炎上',
} as const;

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
  await expect(page.getByTestId('org-depts')).toBeVisible();
  await expect(page.getByTestId('org-dept-compare')).toBeVisible();
  await expect(page.getByTestId('org-trend-history')).toBeVisible();
  await expect(page.getByTestId('org-trend-history')).toContainText('記録なし');
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
  const alternateRuleset = {
    version: CURRENT_RUN_RULESET.version + 1,
    fingerprint: 'a'.repeat(64),
  };
  await seedMeta(page, {
    points: 0,
    unlockedDifficulties: ['easy', 'normal'],
    defeatedBosses: [],
    achievements: [],
    bestScore: 1200,
    unlockedCards: [],
    unlockedRelics: [],
    dailyRuns: {
      [dailyRunKey('2026-07-09')]: { bestScore: 800, rewardClaimed: true },
      [dailyRunKey('2026-07-10')]: { bestScore: 1200, rewardClaimed: true },
      [dailyRunKey('2026-07-11')]: { bestScore: 1200, rewardClaimed: false },
      [dailyRunKey('2026-07-11', alternateRuleset)]: { bestScore: 1100, rewardClaimed: true },
      '2026-07-08': { bestScore: 700, rewardClaimed: true },
    },
  });
  await startRun(page, 'daily-ranking-e2e');
  await page.evaluate(() => (window as GameWindow).game!.zoomTo('industry'));

  await expect(page.getByTestId('daily-leaderboard')).toBeVisible();
  await expect(page.getByTestId('daily-leaderboard').locator('li')).toHaveCount(5);
  const currentLatest = page.getByTestId(`daily-record-${dailyRunKey('2026-07-11')}`);
  const alternateLatest = page.getByTestId(
    `daily-record-${dailyRunKey('2026-07-11', alternateRuleset)}`,
  );
  const legacy = page.getByTestId('daily-record-2026-07-08');
  await expect(currentLatest).toContainText('#1');
  await expect(currentLatest).toContainText('1,200 pt');
  await expect(currentLatest.getByTestId('daily-record-ruleset')).toContainText('v');
  await expect(page.getByTestId(`daily-record-${dailyRunKey('2026-07-10')}`)).toContainText('#2');
  await expect(alternateLatest).toContainText('#3');
  await expect(alternateLatest.getByTestId('daily-record-ruleset')).toContainText('v');
  await expect(page.getByTestId(`daily-record-${dailyRunKey('2026-07-09')}`)).toContainText('#4');
  await expect(legacy).toContainText('#5');
  await expect(legacy.getByTestId('daily-record-ruleset')).toHaveText('ルールセット不明');
});

test('全社マップに診断・KPIトレンド領域を出し開始直後は記録なしとする（RI-128）', async ({
  page,
}) => {
  await startRun(page, 'ri128-trend-empty');
  await page.evaluate(() => (window as GameWindow).game!.zoomTo('company'));

  await expect(page.getByTestId('org-trend-history')).toBeVisible();
  await expect(page.getByTestId('org-trend-history')).toHaveText('記録なし');

  await page.evaluate(() => (window as GameWindow).game!.zoomTo('industry'));
  await expect(page.getByTestId('industry-self-trend')).toHaveText('→');
});

test('全社マップで部門のAI依存・負債・士気・健全度を横並び比較できる（RI-125）', async ({
  page,
}) => {
  await startRun(page, 'ri125-dept-compare');
  await page.evaluate(() => (window as GameWindow).game!.zoomTo('company'));

  await expect(page.getByTestId('org-depts')).toBeVisible();
  await expect(page.getByTestId('dept-chip-product')).toContainText('出荷');
  await expect(page.getByTestId('org-dept-compare')).toBeVisible();
  await expect(page.getByTestId('org-dept-compare')).not.toContainText('出荷');
  await expect(page.getByTestId('org-dept-compare')).not.toContainText('耐性');

  const departments = await page.evaluate(() => {
    const org = (window as GameWindow).game!.getState().orgScale;
    if (!org) throw new Error('orgScale が無い');
    return org.departments.map((d) => ({
      id: d.def.id,
      name: d.def.name,
      aiDependency: d.aiDependency,
      techDebt: d.techDebt,
      morale: d.morale,
      health: d.health,
    }));
  });
  expect(departments.length).toBeGreaterThanOrEqual(3);

  for (const dept of departments) {
    await expect(page.getByTestId(`dept-chip-${dept.id}`)).toBeVisible();
    await expect(page.getByTestId(`org-dept-row-${dept.id}`)).toContainText(dept.name);
    await expect(page.getByTestId(`org-dept-${dept.id}-aiDependency`)).toHaveText(
      String(dept.aiDependency),
    );
    await expect(page.getByTestId(`org-dept-${dept.id}-techDebt`)).toHaveText(
      String(dept.techDebt),
    );
    await expect(page.getByTestId(`org-dept-${dept.id}-morale`)).toHaveText(String(dept.morale));
    await expect(page.getByTestId(`org-dept-${dept.id}-health`)).toHaveText(
      HEALTH_LABEL[dept.health],
    );
  }

  await page.getByTestId('org-dept-focus-product').click();
  await expect(page.getByTestId('dept-screen')).toBeVisible();
  await expect(page.getByTestId('dept-board')).toBeVisible();
});

test('部門・チームと比較指標を切り替えてチーム状態へドリルダウンできる（RI-135）', async ({
  page,
}) => {
  await startRun(page, 'ri135-team-comparison');
  await page.evaluate(() => (window as GameWindow).game!.zoomTo('company'));

  await expect(page.getByTestId('org-compare-unit-department')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('org-compare-metric-all')).toHaveAttribute('aria-selected', 'true');

  const target = await page.evaluate(() => {
    const state = (window as GameWindow).game!.getState();
    const teams = state.orgScale?.departments.flatMap((dept) => dept.teams) ?? [];
    const team = teams.find((candidate) => candidate.id !== state.activeTeamId) ?? teams[0];
    if (!team) throw new Error('比較対象チームが無い');
    return {
      id: team.id,
      name: team.name,
      shipping: team.shipping,
      reviewQueue: team.reviewQueue,
      incidents: team.incidents,
      aiDependency: team.aiDependency,
      techDebt: team.techDebt,
      morale: team.morale,
      health: team.health,
    };
  });

  await page.getByTestId('org-compare-unit-team').click();
  await expect(page.getByTestId('org-compare-unit-team')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId(`org-team-row-${target.id}`)).toContainText(target.name);
  await expect(page.getByTestId(`org-team-${target.id}-shipping`)).toHaveText(
    String(target.shipping),
  );
  await expect(page.getByTestId(`org-team-${target.id}-reviewQueue`)).toHaveText(
    String(target.reviewQueue),
  );
  await expect(page.getByTestId(`org-team-${target.id}-incidents`)).toHaveText(
    String(target.incidents),
  );
  await expect(page.getByTestId(`org-team-${target.id}-aiDependency`)).toHaveText(
    String(target.aiDependency),
  );
  await expect(page.getByTestId(`org-team-${target.id}-techDebt`)).toHaveText(
    String(target.techDebt),
  );
  await expect(page.getByTestId(`org-team-${target.id}-morale`)).toHaveText(String(target.morale));
  await expect(page.getByTestId(`org-team-${target.id}-health`)).toHaveText(
    HEALTH_LABEL[target.health],
  );

  await page.getByTestId('org-compare-metric-reviewQueue').click();
  await expect(page.getByTestId('org-compare-metric-reviewQueue')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId(`org-team-${target.id}-reviewQueue`)).toBeVisible();
  await expect(page.getByTestId(`org-team-${target.id}-shipping`)).toHaveCount(0);

  await page.getByTestId('org-compare-metric-shipping').click();
  await page.getByTestId('org-compare-unit-department').click();
  await expect(page.getByTestId('org-compare-metric-all')).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('org-compare-unit-team').click();
  await page.getByTestId(`org-team-focus-${target.id}`).click();
  await expect(page.getByTestId('dept-screen')).toBeVisible();
  await expect(page.getByTestId('dept-team-panel')).toContainText(target.name);
});

test('比較操作後も主要viewportで全社画面の横はみ出しを発生させない（RI-135）', async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await startRun(page, `ri135-layout-${viewport.width}`);
    await page.evaluate(() => (window as GameWindow).game!.zoomTo('company'));
    await page.getByTestId('org-compare-unit-team').click();

    await expect(page.getByTestId('org-compare-unit-tabs')).toBeVisible();
    await expect(page.getByTestId('org-compare-metric-tabs')).toBeVisible();
    await expect(page.getByTestId('org-dept-compare')).toBeVisible();
    const viewportWidth = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(viewportWidth.scroll).toBeLessThanOrEqual(viewportWidth.client);
  }
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

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test('全社マップの部門ラベルがチームカードと重ならない（#380）', async ({ page }) => {
  const viewports = [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop-short', width: 1024, height: 768 },
    { name: 'desktop', width: 1440, height: 900 },
  ] as const;

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startRun(page, `org-label-clear-${viewport.name}`);
    await page.evaluate(() => (window as GameWindow).game!.zoomTo('company'));
    const board = page.getByTestId('org-board');
    await expect(board, `${viewport.name} の全社盤面が表示されない`).toBeVisible();
    await board.scrollIntoViewIfNeeded();

    const labelLocators = page.locator('.org-zone-label');
    const badgeLocators = page.locator('.org-island-badge');
    await expect(labelLocators).toHaveCount(3);
    await expect.poll(async () => badgeLocators.count()).toBeGreaterThan(0);

    const labels = await labelLocators.all();
    const badges = await badgeLocators.all();
    const visibleLabelBoxes: Box[] = [];
    for (const label of labels) {
      if (!(await label.isVisible())) continue;
      const labelBox = await label.boundingBox();
      if (!labelBox) continue;
      visibleLabelBoxes.push(labelBox);
      expect(labelBox.width, `${viewport.name} の部門ラベル幅が 0`).toBeGreaterThan(0);
      expect(labelBox.height, `${viewport.name} の部門ラベル高が 0`).toBeGreaterThan(0);
      for (const badge of badges) {
        const badgeBox = await readBox(badge, `${viewport.name} チームカード`);
        expect(
          boxesOverlap(labelBox, badgeBox),
          `${viewport.name} で部門ラベルとチームカードが重なっている`,
        ).toBe(false);
      }
    }
    if (viewport.name !== 'phone') {
      expect(
        visibleLabelBoxes.length,
        `${viewport.name} で部門ラベルが見えない`,
      ).toBeGreaterThanOrEqual(3);
    }

    const hub = page.getByTestId('org-infra-hub');
    if (await hub.isVisible()) {
      const hubBox = await hub.boundingBox();
      if (hubBox) {
        for (const badge of badges) {
          const badgeBox = await readBox(badge, `${viewport.name} チームカード`);
          expect(
            boxesOverlap(hubBox, badgeBox),
            `${viewport.name} でハブラベルとチームカードが重なっている`,
          ).toBe(false);
        }
      }
    }
  }
});
