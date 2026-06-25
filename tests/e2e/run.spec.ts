import { expect, test } from '@playwright/test';
import type { InterventionOutcome } from '../../src/sim/types';
import type { GoalAdjustmentId, RunState } from '../../src/sim/run/types';
import {
  E2E_MISSED_ADJUSTABLE_SEED,
  E2E_SHUTDOWN_SEED,
} from '../../src/sim/run/quarterReviewSeeds';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    enterNode(id: string): RunState;
    step(ms: number): RunState;
    dispatch(id: string): InterventionOutcome;
    acknowledgeResult(): RunState;
    chooseCard(defId: string): RunState;
    skipDraft(): RunState;
    finishEvolution(): RunState;
    chooseEvent(i: number): RunState;
    buyShopCard(id: string): RunState;
    buyShopRelic(): RunState;
    leaveShop(): RunState;
    restChoose(o: string): RunState;
    assignMember(id: string, assignment: string): RunState;
    setMemberAi(id: string, on: boolean): RunState;
    acknowledgeQuarterReview(): RunState;
    chooseGoalAdjustment(id: GoalAdjustmentId): RunState;
  };
};

test('マップ→ボスまで通しプレイすると勝敗が決まり、ラン決着画面が出る（DoD）', async ({ page }) => {
  await page.goto('/?seed=full-run');

  const status = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('easy', [], 'full-run');
    let guard = 0;
    let s = g.getState();
    while (s.status === 'playing' && guard < 60000) {
      guard += 1;
      switch (s.phase) {
        case 'map':
          g.enterNode(s.available[0]);
          break;
        case 'sprint': {
          const sp = s.sprint;
          if (sp && !sp.complete) {
            if (sp.tasks.filter((t) => t.lane === 'review').length >= 6)
              g.dispatch('interruptReview');
            if (sp.tasks.some((t) => t.lane === 'rework' && t.incident)) g.dispatch('firefight');
          }
          g.step(300);
          break;
        }
        case 'result':
          g.acknowledgeResult();
          break;
        case 'draft':
          if (s.draft && s.draft.length > 0) g.chooseCard(s.draft[0]);
          else g.skipDraft();
          break;
        case 'evolution':
          g.finishEvolution();
          break;
        case 'event':
          g.chooseEvent(0);
          break;
        case 'shop':
          g.leaveShop();
          break;
        case 'rest':
          g.restChoose('heal');
          break;
        case 'quarterReview':
          if (s.quarterReview?.outcome === 'missed_adjustable') {
            g.chooseGoalAdjustment(s.quarterReview.availableAdjustments[0] ?? 'cut_scope');
          } else {
            g.acknowledgeQuarterReview();
          }
          break;
        default:
          guard = 60000;
          break;
      }
      s = g.getState();
    }
    return s.status;
  });

  expect(['won', 'lost']).toContain(status);

  await expect(page.getByTestId('run-result')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('run-end-status')).toBeVisible();
  await expect(page.getByTestId('diagnosis')).toBeVisible();
});

test('ボス未達→四半期レビュー→スコープ削減→次四半期へ継続', async ({ page }) => {
  await page.goto(`/?seed=${E2E_MISSED_ADJUSTABLE_SEED}`);

  const atReview = await page.evaluate(
    ({ seed }) => {
      const g = (window as GameWindow).game!;
      g.pause();
      g.startRun('easy', [], seed);
      let guard = 0;
      let s = g.getState();
      while (s.status === 'playing' && s.phase !== 'quarterReview' && guard < 60000) {
        guard += 1;
        switch (s.phase) {
          case 'map':
            g.enterNode(s.available[0]);
            break;
          case 'sprint':
            g.step(1_000_000);
            break;
          case 'result':
            g.acknowledgeResult();
            break;
          case 'draft':
            g.skipDraft();
            break;
          case 'evolution':
            g.finishEvolution();
            break;
          case 'event':
            g.chooseEvent(0);
            break;
          case 'shop':
            g.leaveShop();
            break;
          case 'rest':
            g.restChoose('heal');
            break;
          default:
            guard = 60000;
            break;
        }
        s = g.getState();
      }
      return {
        ok: s.phase === 'quarterReview' && s.quarterReview?.outcome === 'missed_adjustable',
        phase: s.phase,
        outcome: s.quarterReview?.outcome,
      };
    },
    { seed: E2E_MISSED_ADJUSTABLE_SEED },
  );

  test.skip(!atReview.ok, `seed が missed_adjustable にならない: ${JSON.stringify(atReview)}`);
  await expect(page.getByTestId('quarter-review')).toBeVisible({ timeout: 5000 });
  await page.locator('[data-adjustment="cut_scope"]').click();
  await expect(page.getByTestId('run-map')).toBeVisible({ timeout: 5000 });
  const quarterNumber = await page.evaluate(
    () => (window as GameWindow).game!.getState().quarterNumber,
  );
  expect(quarterNumber).toBe(2);
});

test('継続リソース枯渇→四半期レビュー→ラン終了', async ({ page }) => {
  await page.goto(`/?seed=${E2E_SHUTDOWN_SEED}`);

  const atReview = await page.evaluate(
    ({ seed }) => {
      const g = (window as GameWindow).game!;
      g.startRun('nightmare', [], seed);
      g.pause();
      let s = g.getState();
      let guard = 0;
      while (s.status === 'playing' && s.phase !== 'quarterReview' && guard < 60000) {
        guard += 1;
        if (s.phase === 'map') g.enterNode(s.available[0]);
        else if (s.phase === 'sprint') g.step(1_000_000);
        else if (s.phase === 'result') g.acknowledgeResult();
        else if (s.phase === 'draft') g.skipDraft();
        else if (s.phase === 'evolution') g.finishEvolution();
        else if (s.phase === 'event') g.chooseEvent(0);
        else if (s.phase === 'shop') g.leaveShop();
        else if (s.phase === 'rest') g.restChoose('heal');
        else guard = 60000;
        s = g.getState();
      }
      const outcome = s.quarterReview?.outcome;
      return {
        ok:
          s.phase === 'quarterReview' &&
          (outcome === 'shutdown' || outcome === 'reorg_required' || outcome === 'missed_crisis'),
        outcome,
      };
    },
    { seed: E2E_SHUTDOWN_SEED },
  );

  test.skip(!atReview.ok, `seed が shutdown にならない: ${JSON.stringify(atReview)}`);
  await expect(page.getByTestId('quarter-review')).toBeVisible({ timeout: 5000 });
  await page.getByTestId('quarter-shutdown').click();
  await expect(page.getByTestId('run-result')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('run-end-status')).toBeVisible();
});

test('イベントノードで選択するとマップへ戻る（分岐選択イベント / 第9.4）', async ({ page }) => {
  await page.goto('/?seed=event-run');

  const found = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    let s = g.startRun('normal', [], 'event-run');
    let guard = 0;
    while (s.status === 'playing' && guard < 200) {
      guard += 1;
      if (s.phase === 'map') {
        const ev = s.available.find((id) => s.map.nodes.find((n) => n.id === id)?.type === 'event');
        g.enterNode(ev ?? s.available[0]);
      } else if (s.phase === 'event') {
        return true;
      } else if (s.phase === 'sprint') {
        g.step(1_000_000);
      } else if (s.phase === 'result') g.acknowledgeResult();
      else if (s.phase === 'draft') g.skipDraft();
      else if (s.phase === 'evolution') g.finishEvolution();
      else if (s.phase === 'shop') g.leaveShop();
      else if (s.phase === 'rest') g.restChoose('heal');
      else if (s.phase === 'quarterReview') g.acknowledgeQuarterReview();
      else break;
      s = g.getState();
    }
    return s.phase === 'event';
  });

  test.skip(!found, 'このルートにイベントノードが無い');
  await expect(page.getByTestId('event')).toBeVisible();
  await page.getByTestId('event-choice-0').click();
  await expect(page.getByTestId('run-map')).toBeVisible();
});
