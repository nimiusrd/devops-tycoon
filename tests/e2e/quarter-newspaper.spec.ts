import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import type { GameHandle } from '../../src/game';
import type { QuarterTrendSnapshot } from '../../src/sim/run/types';
import type { RunSave } from '../../src/state/runPersistence';
import { REPLAY_SCHEMA_VERSION, type ReplayBlob } from '../../src/state/replay';

type GameWindow = Window & { game: GameHandle };
type Scenario = 'mixed' | 'morale-only' | 'missed' | 'missing-history' | 'missing-kpi';

/** 同じseed・資源の表示用fixture。戦略や面白さの評価には使わない。 */
async function reviewFixture(page: Page, scenario: Scenario): Promise<RunSave> {
  const raw = await page.evaluate(() => {
    const game = (window as GameWindow).game;
    game.startRun('easy', [], 'ri287-newspaper');
    game.pause();
    return game.exportRunSaveText();
  });
  expect(raw).not.toBeNull();
  const save = JSON.parse(raw!) as RunSave;
  save.state.phase = save.summary.phase = 'quarterReview';
  save.state.quarterNumber = save.summary.quarterNumber = 2;
  const snapshot: QuarterTrendSnapshot = {
    quarterNumber: 2,
    diagnosis: 'healthyAcceleration',
    kpis: [
      {
        id: 'delivery',
        label: 'Delivery',
        target: 100,
        actual: scenario === 'mixed' ? 120 : 0,
        status: scenario === 'mixed' ? 'met' : 'missed',
      },
      {
        id: 'morale',
        label: 'Morale',
        target: 40,
        actual: scenario === 'morale-only' ? 60 : 30,
        status: scenario === 'morale-only' ? 'met' : 'missed',
      },
    ],
    company: {
      shipping: 99999,
      morale: 99,
      aiDependency: 0,
      techDebt: 0,
      onFire: 0,
      healthRank: 'A',
      selfRank: 1,
    },
    departments: [],
  };
  save.state.quarterReview = {
    goal: save.state.quarterGoal,
    outcome: 'missed_adjustable',
    trust: save.state.stakeholderTrust,
    // 新聞はこの現行レビューや別期の値で欠損を埋めない。
    progress: [{ id: 'delivery', label: 'Delivery', actual: 777, target: 1, status: 'exceeded' }],
    missedReasons: ['目標未達'],
    availableAdjustments: ['cut_scope'],
    bossCleared: false,
  };
  save.state.trendHistory = [
    { ...structuredClone(snapshot), quarterNumber: 1 },
    ...(scenario === 'missing-history' ? [] : [snapshot]),
  ];
  if (scenario === 'missing-kpi') snapshot.kpis = snapshot.kpis.slice(0, 1);
  save.replayKeyframes = [];
  const result = await page.evaluate(async (text) => {
    const game = (window as GameWindow).game;
    const imported = await game.importRunSaveText(text);
    return imported.ok && game.resumeRun()?.phase === 'quarterReview';
  }, JSON.stringify(save));
  expect(result).toBe(true);
  await expect(page.getByTestId('quarter-review')).toBeVisible();
  return save;
}

for (const [width, height] of [
  [320, 568],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1440, 900],
]) {
  test(`社内新聞の根拠と次期操作が収まる ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    if (width === 390) await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?renderer=pixi&seed=ri287-newspaper');
    await expect(page.getByTestId('title')).toBeVisible();
    await page.evaluate(() => {
      const game = (window as GameWindow).game;
      game.startRun('easy', [], 'ri287-newspaper');
      game.beginSetupSprint();
      game.pause();
    });
    // 表示fixtureへ移る前に、実WebGLの初期化完了を明示的に待つ。
    await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('webgl-status')).toHaveCount(0, { timeout: 30_000 });
    for (const scenario of [
      'mixed',
      'morale-only',
      'missed',
      'missing-history',
      'missing-kpi',
    ] as const) {
      await reviewFixture(page, scenario);
      const newspaper = page.getByTestId('quarter-newspaper');
      const summary = newspaper.locator('summary');
      await expect(newspaper).not.toHaveAttribute('open');
      expect((await newspaper.boundingBox())!.height).toBeLessThanOrEqual(48);
      const before = await page.evaluate(() =>
        JSON.stringify((window as GameWindow).game.getState()),
      );
      await summary.focus();
      await expect(summary).toBeFocused();
      expect(await summary.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
      await page.keyboard.press('Enter');
      await expect(newspaper).toHaveAttribute('open', '');
      await expect(newspaper.getByTestId('quarter-newspaper-article')).toHaveCount(2);
      if (scenario === 'missing-history') {
        await expect(newspaper).toContainText('Q2 の四半期履歴がない');
      } else {
        await expect(newspaper).toContainText(
          `Q2 出荷 — 実績 ${scenario === 'mixed' ? 120 : 0} / 目標 100`,
        );
        await expect(newspaper).toContainText(
          scenario === 'mixed' ? '出荷目標を達成' : '出荷目標に届かず',
        );
        await expect(newspaper).toContainText(
          scenario === 'missing-kpi'
            ? '保存履歴に士気KPIがない'
            : scenario === 'morale-only'
              ? '士気目標を達成'
              : '士気が目標を下回る',
        );
      }
      await expect(newspaper).not.toContainText('777');
      await expect(newspaper).not.toContainText('99999');
      expect(await newspaper.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(
        1,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(0);
      if (scenario === 'mixed' && (width === 320 || width === 1440)) {
        await newspaper.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`newspaper-${width}.png`) });
      }
      await summary.focus();
      await page.keyboard.press('Space');
      await expect(newspaper).not.toHaveAttribute('open');
      expect(
        await page.evaluate(() => JSON.stringify((window as GameWindow).game.getState())),
      ).toBe(before);
      const action = page.locator('button[data-adjustment="cut_scope"]');
      await action.focus();
      await expect(action).toBeEnabled();
      await expect(action).toBeInViewport();
      await expect(page.getByTestId('quarter-voices')).toBeVisible();
    }
  });
}

test('保存・リロード再開とリプレイ閲覧で同じ期の記事を保つ', async ({ page }) => {
  await page.goto('/?seed=ri287-newspaper');
  await expect(page.getByTestId('title')).toBeVisible();
  const save = await reviewFixture(page, 'mixed');
  const newspaper = page.getByTestId('quarter-newspaper');
  await newspaper.locator('summary').click();
  const expected = await newspaper.innerText();
  await page.reload();
  await page.getByTestId('resume-run').click();
  await expect(page.getByTestId('quarter-review')).toBeVisible();
  await newspaper.locator('summary').click();
  expect(await newspaper.innerText()).toBe(expected);

  const replay: ReplayBlob = {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id: 'ri287-newspaper:1',
    seed: save.summary.seed,
    difficulty: 'easy',
    trials: [],
    finishedAt: Date.now(),
    outcome: { status: 'lost', diagnosis: 'healthyAcceleration', score: 0 },
    keyframes: [{ phase: 'quarterReview', label: '四半期レビュー', frame: save.state }],
    ruleset: save.ruleset!,
    contentSnapshot: { cards: [], relics: [] },
  };
  expect(
    await page.evaluate(async (text) => {
      const game = (window as GameWindow).game;
      const result = await game.importReplayText(text);
      return result.ok && game.openReplay('ri287-newspaper:1', 0)?.phase === 'quarterReview';
    }, JSON.stringify(replay)),
  ).toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as GameWindow).game.isReplayMode()))
    .toBe(true);
  // 再利用されたdetailsの開閉状態に依存させない。
  if (!(await newspaper.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await newspaper.locator('summary').click();
  }
  expect(await newspaper.innerText()).toBe(expected);
});
