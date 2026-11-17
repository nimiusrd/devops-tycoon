import type { Page } from '@playwright/test';
import { expect, test, type PublicGameWindow } from './fixtures';
import type { GameHandle } from '../../src/game';
import type { GrowthOutcome, RunState } from '../../src/sim/run/types';
import type { RunReplayFrame } from '../../src/sim/run/persist';
import { REPLAY_SCHEMA_VERSION, type ReplayBlob } from '../../src/state/replay';

test.setTimeout(60_000);

type FixtureWindow = PublicGameWindow & {
  game: GameHandle & {
    engine: Pick<RunState, 'lastGrowth' | 'roster'> & {
      exportReplayFrame(): RunReplayFrame | null;
    };
  };
};

const PROMOTIONS: GrowthOutcome['promotions'] = [
  { id: 'record-1', name: '昇格時の長い名前'.repeat(6), to: 'middle' },
  { id: 'record-2', name: '青木', to: 'senior' },
  { id: 'record-3', name: '同姓同名', to: 'middle' },
  { id: 'record-4', name: '同姓同名', to: 'senior' },
];

async function resultFixture(page: Page) {
  await page.goto('/?renderer=pixi&seed=ri285-promotion-e2e');
  await expect(page.getByTestId('title')).toBeVisible();
  await page.evaluate(() => {
    const game = (window as PublicGameWindow).game!;
    game.startRun('easy', [], 'ri285-promotion-e2e');
    game.beginSetupSprint();
    game.pause();
  });
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi', {
    timeout: 20_000,
  });
  await expect(page.getByTestId('webgl-status')).toHaveCount(0, { timeout: 20_000 });
  const phase = await page.evaluate(() => (window as PublicGameWindow).game!.step(1_000_000).phase);
  expect(phase).toBe('result');
  await expect(page.getByTestId('sprint-result')).toBeVisible({ timeout: 20_000 });
}

async function setGrowth(page: Page, promotions: GrowthOutcome['promotions'] | null) {
  return page.evaluate((promotions) => {
    const game = (window as FixtureWindow).game;
    game.engine.lastGrowth = promotions
      ? {
          promotions,
          leveledUp: [],
          wentOnLeave: [{ id: 'leave', name: '休職した人' }],
          docGain: 0,
        }
      : null;
    // 現在の人物名やランクを過去の発言へ補わない。
    game.engine.roster.members.forEach((member) => {
      member.name = '現在のロスター名';
    });
    game.step(0);
    return JSON.stringify(game.getState());
  }, promotions);
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`昇格の一言・再閲覧・継続 ${viewport.width}px ${reducedMotion}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion });
      await resultFixture(page);
      for (const growth of [null, []]) {
        await setGrowth(page, growth);
        await expect(page.getByTestId('promotion-voices')).toHaveCount(0);
      }
      await setGrowth(page, PROMOTIONS.slice(0, 1));
      const details = page.getByTestId('promotion-voices');
      const summary = details.locator('summary');
      await summary.click();
      await expect(details.getByTestId('promotion-voice')).toHaveCount(1);
      await expect(details.getByRole('navigation')).toHaveCount(0);

      const before = await setGrowth(page, PROMOTIONS);
      await expect(details).not.toHaveAttribute('open');
      expect((await details.boundingBox())!.height).toBeLessThanOrEqual(48);
      await summary.scrollIntoViewIfNeeded();
      await testInfo.attach('collapsed', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await page.keyboard.press('Tab');
      await summary.focus();
      expect(await summary.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
      await page.keyboard.press('Enter');
      await expect(details).toHaveAttribute('open', '');
      const voices = details.getByTestId('promotion-voice');
      await expect(voices).toHaveCount(3);
      await expect(voices.first()).toHaveAttribute('data-member-id', 'record-1');
      await expect(voices.first()).toContainText(`${PROMOTIONS[0].name}（ミドル）`);
      await expect(voices.nth(1)).toContainText('青木（シニア）');
      await expect(details).not.toContainText('現在のロスター名');
      const prev = details.getByRole('button', { name: '前の3人' });
      const next = details.getByRole('button', { name: '次の3人' });
      await expect(prev).toBeDisabled();
      await next.click();
      await expect(voices).toHaveCount(1);
      await expect(voices.first()).toHaveAttribute('data-member-id', 'record-4');
      await expect(voices.first()).toContainText('同姓同名（シニア）');
      await expect(next).toBeDisabled();
      await summary.focus();
      await page.keyboard.press('Space');
      await expect(details).not.toHaveAttribute('open');
      await page.keyboard.press('Enter');
      await expect(voices.first()).toHaveAttribute('data-member-id', 'record-4');
      await prev.click();
      await summary.scrollIntoViewIfNeeded();
      await testInfo.attach('expanded', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      const bounds = await details.evaluate((el) => ({
        content: el.scrollWidth,
        width: el.clientWidth,
        page: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }));
      expect(bounds.content).toBeLessThanOrEqual(bounds.width + 1);
      expect(bounds.page).toBeLessThanOrEqual(bounds.viewport);
      await expect(page.getByTestId('result-growth')).toContainText('休職した人 が休職に入った');
      const analysis = page.getByTestId('result-intervention-analysis');
      await analysis.scrollIntoViewIfNeeded();
      await expect(analysis).toBeInViewport();
      expect(
        await page.evaluate(() => JSON.stringify((window as PublicGameWindow).game!.getState())),
      ).toBe(before);
      const continueButton = page.getByTestId('result-continue');
      await expect(continueButton).toBeInViewport();
      await continueButton.click();
      await expect(page.getByTestId('draft')).toBeVisible();
    });
  }
}

test('保存済みリプレイは当時の昇格だけを表示し、旧記録に一言を補わない', async ({ page }) => {
  await resultFixture(page);
  await setGrowth(page, PROMOTIONS);
  const recorded = await page.evaluate(async (schemaVersion) => {
    const game = (window as FixtureWindow).game;
    const frame = game.engine.exportReplayFrame()!;
    const oldFrame = structuredClone(frame);
    delete (oldFrame as Partial<RunReplayFrame>).lastGrowth;
    const blob: ReplayBlob = {
      schemaVersion: schemaVersion as typeof REPLAY_SCHEMA_VERSION,
      id: 'ri285-promotion-replay',
      seed: frame.seed,
      difficulty: 'easy',
      trials: [],
      finishedAt: 1000,
      outcome: { status: 'won', diagnosis: 'healthyAcceleration', score: 0 },
      keyframes: [
        { phase: 'result', frame, label: '記録あり' },
        { phase: 'result', frame: oldFrame, label: '旧記録' },
      ],
      ruleset: null,
      contentSnapshot: null,
    };
    if (!(await game.importReplay(JSON.parse(JSON.stringify(blob))))) return false;
    game.openReplay(blob.id, 0);
    return true;
  }, REPLAY_SCHEMA_VERSION);
  expect(recorded).toBe(true);
  const details = page.getByTestId('promotion-voices');
  await details.locator('summary').click();
  await expect(details.getByTestId('promotion-voice').first()).toContainText(PROMOTIONS[0].name);
  await expect(page.getByTestId('result-continue')).toBeDisabled();
  await expect(page.getByTestId('result-continue-hint')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
  await page.getByTestId('open-replays').click();
  await page.getByTestId('replay-keyframe-0').click();
  await page.getByTestId('promotion-voices').locator('summary').click();
  await expect(page.getByTestId('promotion-voice').first()).toContainText(PROMOTIONS[0].name);
  await page.evaluate(() => (window as FixtureWindow).game.openReplay('ri285-promotion-replay', 1));
  await expect(page.getByTestId('sprint-result')).toBeVisible();
  await expect(page.getByTestId('promotion-voices')).toHaveCount(0);
  await expect(page.getByTestId('result-continue')).toBeDisabled();
});
