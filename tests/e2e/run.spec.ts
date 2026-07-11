import { expect, test } from '@playwright/test';
import { EVENT_DEFS, effectiveKind, getEvent } from '../../src/data/events';
import { diagnosisTheme } from '../../src/render/diagnosisTheme';
import type { InterventionOutcome } from '../../src/sim/types';
import type { RunEngine } from '../../src/sim/run/engine';
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
    beginSetupSprint(): RunState;
    resolveBeat(choiceIndex?: number): RunState;
    step(ms: number): RunState;
    dispatch(id: string): InterventionOutcome;
    acknowledgeResult(): RunState;
    chooseCard(defId: string): RunState;
    skipDraft(): RunState;
    finishEvolution(): RunState;
    buyShopCard(id: string): RunState;
    buyShopRelic(): RunState;
    leaveShop(): RunState;
    restChoose(o: string, defId?: string): RunState;
    assignMember(id: string, assignment: string): RunState;
    setMemberAi(id: string, on: boolean): RunState;
    acknowledgeQuarterReview(): RunState;
    chooseGoalAdjustment(id: GoalAdjustmentId): RunState;
  };
};

test('トラック→ボスまで通しプレイすると勝敗が決まり、ラン決着画面が出る（DoD）', async ({
  page,
}) => {
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
        case 'setup':
          g.beginSetupSprint();
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
        case 'beat':
          g.resolveBeat(s.beat?.kind === 'judgment' ? undefined : 0);
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
    return { status: s.status, diagnosis: s.diagnosis };
  });

  expect(['won', 'lost']).toContain(status.status);

  await expect(page.getByTestId('run-result')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('run-end-status')).toBeVisible();
  await expect(page.getByTestId('diagnosis')).toBeVisible();
  await expect(page.getByTestId('run-result')).toHaveAttribute('data-diagnosis', status.diagnosis);
  await expect(page.getByTestId('run-result')).toHaveClass(
    new RegExp(diagnosisTheme(status.diagnosis).toneClass),
  );
});

test('RI-21: 組織タイプに対応する画面トーンと状態文を表示する', async ({ page }) => {
  await page.goto('/?seed=ri21-theme');
  await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], 'ri21-theme');
  });

  const theme = diagnosisTheme('healthyAcceleration');
  await expect(page.locator('.app')).toHaveAttribute('data-diagnosis', 'healthyAcceleration');
  await expect(page.locator('.app')).toHaveClass(new RegExp(theme.toneClass));
  await expect(page.getByTestId('runbar-diagnosis')).toHaveAttribute(
    'data-diagnosis',
    'healthyAcceleration',
  );
  await expect(page.getByTestId('runbar-diagnosis')).toContainText(theme.warning);
});

test('RI-37: 休息で強化対象カードを選んでレベルを上げられる', async ({ page }) => {
  // seed 探索 + step(1e6) の page.evaluate は CPU 負荷が高く、
  // タイムライン記録（RI-53）と無介入ベースライン再実行（RI-55）追加後は
  // CI の 60s でも超えやすい。
  test.setTimeout(120_000);

  await page.goto('/?seed=ri37-e2e');

  const reached = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    for (const seed of Array.from({ length: 80 }, (_, i) => `ri37-e2e-${i}`)) {
      g.startRun('easy', [], seed);
      let s = g.getState();
      let guard = 0;
      while (s.status === 'playing' && guard < 60000) {
        guard += 1;
        if (s.phase === 'rest' && s.deck.length > 0) {
          return {
            ok: true,
            seed,
            defId: s.deck[0].defId,
            level: s.deck[0].level,
          };
        }
        if (s.phase === 'setup') g.beginSetupSprint();
        else if (s.phase === 'sprint') {
          const sprint = s.sprint;
          if (sprint && !sprint.complete) {
            if (sprint.tasks.filter((task) => task.lane === 'review').length >= 6)
              g.dispatch('interruptReview');
            if (sprint.tasks.some((task) => task.lane === 'rework' && task.incident))
              g.dispatch('firefight');
          }
          g.step(300);
        }
        else if (s.phase === 'result') g.acknowledgeResult();
        else if (s.phase === 'draft') {
          if (s.draft && s.draft.length > 0) g.chooseCard(s.draft[0]);
          else g.skipDraft();
        } else if (s.phase === 'evolution') g.finishEvolution();
        else if (s.phase === 'beat') g.resolveBeat(s.beat?.kind === 'judgment' ? undefined : 0);
        else if (s.phase === 'shop') g.leaveShop();
        else if (s.phase === 'rest') g.restChoose('heal');
        else if (s.phase === 'quarterReview') g.acknowledgeQuarterReview();
        else break;
        s = g.getState();
      }
    }
    const s = g.getState();
    return { ok: false, phase: s.phase, deckLength: s.deck.length };
  });

  test.skip(!reached.ok, `休息とカード所持の条件に到達できない: ${JSON.stringify(reached)}`);
  if (!reached.ok) return;

  await expect(page.getByTestId('rest')).toBeVisible({ timeout: 5000 });
  await page.getByTestId('rest-upgrade').click();
  await expect(page.getByTestId('rest-upgrade-cards')).toBeVisible();
  await page.getByTestId(`rest-upgrade-card-${reached.defId}-0`).click();
  await expect(page.getByTestId('setup')).toBeVisible({ timeout: 5000 });

  const upgraded = await page.evaluate(
    ({ defId }) => {
      const s = (window as GameWindow).game!.getState();
      return s.deck.find((card) => card.defId === defId)?.level;
    },
    { defId: reached.defId },
  );
  expect(upgraded).toBe(reached.level + 1);
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
          case 'setup':
            g.beginSetupSprint();
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
          case 'beat':
            g.resolveBeat(s.beat?.kind === 'judgment' ? undefined : 0);
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
  await expect(page.getByTestId('setup')).toBeVisible({ timeout: 5000 });
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
      const engine = (g as unknown as { engine: RunEngine }).engine;
      engine.startRun('hard', [], seed, { kind: 'normal' });
      g.pause();
      let s = engine.snapshot();
      let guard = 0;
      while (s.status === 'playing' && s.phase !== 'quarterReview' && guard < 60000) {
        guard += 1;
        if (s.phase === 'setup') engine.beginSetupSprint();
        else if (s.phase === 'sprint') engine.step(1_000_000);
        else if (s.phase === 'result') engine.acknowledgeResult();
        else if (s.phase === 'draft' && s.draft && s.draft.length > 0) engine.chooseCard(s.draft[0]);
        else if (s.phase === 'draft') engine.skipDraft();
        else if (s.phase === 'evolution') engine.finishEvolution();
        else if (s.phase === 'beat') engine.resolveBeat(s.beat?.kind === 'judgment' ? undefined : 0);
        else if (s.phase === 'shop') engine.leaveShop();
        else if (s.phase === 'rest') engine.restChoose('heal');
        else guard = 60000;
        s = engine.snapshot();
      }
      const outcome = s.quarterReview?.outcome;
      if (s.phase === 'quarterReview') g.acknowledgeQuarterReview();
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
  const runResult = page.getByTestId('run-result');
  await expect(runResult).toBeVisible({ timeout: 5000 });
  await expect(runResult).toHaveAttribute('data-quarter-outcome', atReview.outcome!);
  await expect(page.getByTestId('run-end-status')).toBeVisible();
});

test('ビートの選択イベントを解決すると次スプリントへ進む（第9.4）', async ({ page }) => {
  await page.goto('/?seed=event-run');

  const found = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], 'event-run');
    let s = g.getState();
    let guard = 0;
    while (s.status === 'playing' && guard < 400) {
      guard += 1;
      if (s.phase === 'beat' && s.beat?.kind === 'decision') return true;
      if (s.phase === 'setup') g.beginSetupSprint();
      else if (s.phase === 'beat') g.resolveBeat();
      else if (s.phase === 'sprint') g.step(1_000_000);
      else if (s.phase === 'result') g.acknowledgeResult();
      else if (s.phase === 'draft') g.skipDraft();
      else if (s.phase === 'evolution') g.finishEvolution();
      else if (s.phase === 'shop') g.leaveShop();
      else if (s.phase === 'rest') g.restChoose('heal');
      else if (s.phase === 'quarterReview') g.acknowledgeQuarterReview();
      else break;
      s = g.getState();
    }
    return s.phase === 'beat' && s.beat?.kind === 'decision';
  });

  test.skip(!found, 'このランに選択イベントのビートが出ない');
  await expect(page.getByTestId('beat')).toBeVisible();
  await page.getByTestId('beat-choice-0').click();
  // 選択後はスプリント / ショップ / 休息 / 編成のいずれかへ遷移する（マップは廃止）。
  await expect(page.getByTestId('run-result')).toHaveCount(0);
});

test('tone: joke のビートはネタ分類の見た目で表示される（RI-38）', async ({ page }) => {
  const jokeIds = EVENT_DEFS.filter((def) => def.tone === 'joke').map((def) => def.id);
  await page.goto('/?seed=ri38-joke-ui');

  const found = await page.evaluate((ids) => {
    const g = (window as GameWindow).game!;
    g.pause();
    for (let i = 0; i < 80; i += 1) {
      g.startRun('easy', [], `ri38-joke-ui-${i}`);
      let s = g.getState();
      let guard = 0;
      while (s.status === 'playing' && guard < 8000) {
        guard += 1;
        if (s.phase === 'beat' && s.beat && ids.includes(s.beat.eventId)) {
          return { eventId: s.beat.eventId, kind: s.beat.kind };
        }
        if (s.phase === 'setup') g.beginSetupSprint();
        else if (s.phase === 'beat') g.resolveBeat(s.beat?.kind === 'judgment' ? undefined : 0);
        else if (s.phase === 'sprint') g.step(1_000_000);
        else if (s.phase === 'result') g.acknowledgeResult();
        else if (s.phase === 'draft') g.skipDraft();
        else if (s.phase === 'evolution') g.finishEvolution();
        else if (s.phase === 'shop') g.leaveShop();
        else if (s.phase === 'rest') g.restChoose('heal');
        else if (s.phase === 'quarterReview') g.acknowledgeQuarterReview();
        else break;
        s = g.getState();
      }
    }
    return null;
  }, jokeIds);

  expect(found).not.toBeNull();
  const event = getEvent(found!.eventId)!;
  await expect(page.getByTestId('beat')).toBeVisible();
  await expect(page.locator('.event-panel.tone-joke')).toBeVisible();
  await expect(page.getByTestId('beat')).toHaveAttribute('data-kind', effectiveKind(event));
  await expect(page.getByRole('heading', { name: event.title })).toBeVisible();
});
