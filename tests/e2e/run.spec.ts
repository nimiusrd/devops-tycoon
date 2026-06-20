import { expect, test } from '@playwright/test';
import type { InterventionOutcome } from '../../src/sim/types';
import type { RunState } from '../../src/sim/run/types';

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
  };
};

test('マップ→ボスまで通しプレイすると勝敗が決まり、ラン決着画面が出る（DoD）', async ({ page }) => {
  await page.goto('/?seed=full-run');

  // window.game で 1 ラン分を駆動（決定論・一時停止つき）。
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
        default:
          guard = 60000;
          break;
      }
      s = g.getState();
    }
    return s.status;
  });

  expect(['won', 'lost']).toContain(status);

  // React がラン決着画面へ遷移する（ポーリングで同期）。
  await expect(page.getByTestId('run-result')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('run-end-status')).toBeVisible();
  await expect(page.getByTestId('diagnosis')).toBeVisible();
});

test('イベントノードで選択するとマップへ戻る（分岐選択イベント / 第9.4）', async ({ page }) => {
  await page.goto('/?seed=event-run');

  const found = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    let s = g.startRun('normal', [], 'event-run');
    // イベントノードへ到達するまでマップを進める（スプリントは即解決）。
    let guard = 0;
    while (s.status === 'playing' && guard < 200) {
      guard += 1;
      if (s.phase === 'map') {
        // イベントノードがあれば優先して入る。
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
      else break;
      s = g.getState();
    }
    return s.phase === 'event';
  });

  // このランの分岐にイベントノードが含まれない場合はスキップ扱い。
  test.skip(!found, 'このルートにイベントノードが無い');
  await expect(page.getByTestId('event')).toBeVisible();
  await page.getByTestId('event-choice-0').click();
  await expect(page.getByTestId('run-map')).toBeVisible();
});
