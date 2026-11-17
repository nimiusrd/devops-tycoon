import { expect, test, type PublicGameWindow } from './fixtures';
import type { RunState } from '../../src/sim/run/types';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test(`現場・顧客の声と既存レビュー操作が収まる ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    if (viewport.width === 390) await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?renderer=pixi&seed=ri244-voices-e2e');
    await expect(page.getByTestId('title')).toBeVisible();
    await page.evaluate(() => {
      const game = (window as PublicGameWindow).game!;
      game.startRun('easy', [], 'ri244-voices-e2e');
      game.beginSetupSprint();
      game.pause();
    });
    // 初回チャンクと実WebGLの準備を待ち、準備前に表示fixtureへ進まない。
    await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('webgl-status')).toHaveCount(0, { timeout: 20_000 });

    for (const outcome of ['met', 'missed_adjustable', 'shutdown'] as const) {
      await test.step(outcome, async () => {
        const before = await page.evaluate((outcome) => {
          const game = (window as PublicGameWindow).game!;
          const engine = (
            game as unknown as {
              engine: Pick<
                RunState,
                'phase' | 'quarterReview' | 'roster' | 'lastGrowth' | 'reviewHistory'
              >;
            }
          ).engine;
          const state = game.getState();
          engine.phase = 'quarterReview';
          engine.reviewHistory = [];
          engine.roster = structuredClone(state.roster);
          if (outcome === 'shutdown') engine.roster.members = [];
          const member = engine.roster.members[0];
          if (member) member.name = '長い名前のメンバー'.repeat(8);
          engine.lastGrowth =
            member && outcome === 'met'
              ? { promotions: [], leveledUp: [member.id], wentOnLeave: [], docGain: 0 }
              : null;
          engine.quarterReview = {
            goal: state.quarterGoal,
            outcome,
            trust: { management: 50, customers: outcome === 'shutdown' ? 0 : 60, team: 50 },
            progress: [
              {
                id: 'delivery',
                label: 'Delivery',
                actual: outcome === 'met' ? 100 : 0,
                target: 100,
                status: outcome === 'met' ? 'met' : 'missed',
              },
              {
                id: 'quality',
                label: 'Quality',
                actual: outcome === 'met' ? 60 : 20,
                target: 50,
                status: outcome === 'met' ? 'met' : 'missed',
              },
            ],
            missedReasons: outcome === 'met' ? [] : ['出荷未達・品質が目標を下回っています'],
            availableAdjustments: outcome === 'missed_adjustable' ? ['cut_scope'] : [],
            bossCleared: outcome === 'met',
          };
          game.pause();
          game.step(0);
          const current = game.getState();
          return JSON.stringify({
            review: current.quarterReview,
            trust: current.stakeholderTrust,
            budget: current.budget,
            reward: current.bossRelicReward,
            status: current.status,
          });
        }, outcome);

        const review = page.getByTestId('quarter-review');
        await expect(review).toBeVisible();
        await expect(review).toHaveAttribute('data-outcome', outcome);
        const details = page.getByTestId('quarter-voices');
        const summary = details.locator('summary');
        // 同じ画面の状態更新でも閉じてから比較する。
        if (await details.evaluate((el) => (el as HTMLDetailsElement).open)) await summary.click();
        await expect(details).not.toHaveAttribute('open');
        const collapsed = await details.boundingBox();
        expect(collapsed!.height).toBeLessThanOrEqual(48);
        await summary.focus();
        await expect(summary).toBeFocused();
        expect(await summary.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
        await page.keyboard.press('Enter');
        await expect(details).toHaveAttribute('open', '');
        await expect(details).toContainText('顧客の声（抽象的な要約）');
        if (outcome === 'met') {
          await expect(details).toContainText('直近スプリントでレベルが上がりました');
          await expect(details).toContainText('出荷と品質の目標達成を評価します');
        } else {
          await expect(details).toContainText('出荷も品質も目標に届きませんでした');
          await expect(details).not.toContainText('目標達成を評価します');
        }
        if (outcome === 'shutdown') {
          await expect(details).toContainText('発言できるメンバーの記録がありません');
          await expect(details).toContainText('顧客信頼 0 / 100');
        }
        const bounds = await details.evaluate((el) => ({
          width: el.clientWidth,
          content: el.scrollWidth,
          page: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
        }));
        expect(bounds.content).toBeLessThanOrEqual(bounds.width + 1);
        expect(bounds.page).toBeLessThanOrEqual(bounds.viewport);
        if (viewport.width === 320 || viewport.width === 1280) {
          await summary.scrollIntoViewIfNeeded();
          await testInfo.attach(`${outcome}-${viewport.width}`, {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
        }
        await page.keyboard.press('Space');
        await expect(details).not.toHaveAttribute('open');
        const after = await page.evaluate(() => {
          const state = (window as PublicGameWindow).game!.getState();
          return JSON.stringify({
            review: state.quarterReview,
            trust: state.stakeholderTrust,
            budget: state.budget,
            reward: state.bossRelicReward,
            status: state.status,
          });
        });
        expect(after).toBe(before);
        await expect(page.getByTestId('quarter-kpi')).toBeVisible();
        const action =
          outcome === 'met'
            ? page.getByTestId('quarter-acknowledge')
            : outcome === 'shutdown'
              ? page.getByTestId('quarter-shutdown')
              : page.locator('button[data-adjustment="cut_scope"]');
        await action.scrollIntoViewIfNeeded();
        await expect(action).toBeEnabled();
        await expect(action).toBeInViewport();
      });
    }
  });
}
