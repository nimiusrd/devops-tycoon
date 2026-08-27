import { expect, test } from './fixtures';
import { STABILITY_COMBO_CAP, comboMultiplier, deliveryComboMultiplier } from '../../src/sim/model';
import type { InterventionOutcome } from '../../src/sim/types';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    beginSetupSprint(): RunState;
    step(ms: number): RunState;
    dispatch(id: string): InterventionOutcome;
    acknowledgeResult(): RunState;
  };
};

test('割り込みレビューを発動すると Review 渋滞が捌ける（第6.1 / DoD）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ops');

  const before = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], 'ops');
    g.beginSetupSprint();
    let guard = 0;
    let s = g.getState();
    while (guard < 4000) {
      s = g.step(100);
      if (!s.sprint || s.sprint.complete) break;
      const q = s.sprint.tasks.filter((t) => t.lane === 'review').length;
      if (q >= 4) return { queue: q, focus: s.sprint.focus };
      guard += 1;
    }
    const q = s.sprint ? s.sprint.tasks.filter((t) => t.lane === 'review').length : 0;
    return { queue: q, focus: s.sprint?.focus ?? 0 };
  });
  expect(before.queue).toBeGreaterThanOrEqual(4);

  const after = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    const outcome = g.dispatch('interruptReview');
    const s = g.getState();
    return {
      ok: outcome.ok,
      queue: s.sprint!.tasks.filter((t) => t.lane === 'review').length,
      focus: s.sprint!.focus,
    };
  });

  expect(after.ok).toBe(true);
  expect(after.queue).toBeLessThan(before.queue);
  expect(after.focus).toBe(before.focus - 3);
});

test('割り込みレビュー成功時に盤面スイープ演出が出る（RI-50）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ops');

  await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], 'ops');
    g.beginSetupSprint();
    let guard = 0;
    while (guard < 4000) {
      const s = g.step(100);
      if (!s.sprint || s.sprint.complete) break;
      const q = s.sprint.tasks.filter((t) => t.lane === 'review').length;
      if (q >= 4) return;
      guard += 1;
    }
  });

  await page.getByTestId('action-interruptReview').click();
  await expect(page.locator('[data-testid^="intervention-effect-sweep-"]').first()).toBeVisible({
    timeout: 3000,
  });
  await expect(page.getByTestId('intervention-effect-sweep-burst')).toBeVisible({
    timeout: 3000,
  });
  await expect(page.getByTestId('event-ticker')).toBeVisible();
  await expect(page.locator('[data-testid^="event-ticker-row-"]').first()).toBeVisible({
    timeout: 3000,
  });
});

test('スプリント盤面に集中力と介入アクションバーが並ぶ', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=bar');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await page.getByTestId('begin-sprint').click();

  await expect(page.getByTestId('action-bar')).toBeVisible();
  await expect(page.getByTestId('manager-portrait')).toBeVisible();
  await expect(page.getByTestId('focus')).toContainText('⚡');
  for (const id of ['interruptReview', 'firefight', 'overtime', 'andon']) {
    await expect(page.getByTestId(`action-${id}`)).toBeVisible();
  }
});

test('コンボと連携ゲージの UI 表示が sim 状態と一致する（RI-36）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ri36-combo-gauge');

  const gauge = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], 'ri36-combo-gauge');
    g.beginSetupSprint();
    const outcome = g.dispatch('overtime');
    const sprint = g.getState().sprint!;
    return {
      ok: outcome.ok,
      effectGain: outcome.effect?.gaugeGain,
      simValue: sprint.comboGauge,
    };
  });

  expect(gauge.ok).toBe(true);
  expect(gauge.effectGain).toBeGreaterThan(0);
  const gaugeElement = page.getByTestId('combo-gauge');
  await expect(gaugeElement).toHaveAttribute('data-gauge', String(gauge.simValue));
  await expect(gaugeElement.locator('i')).toHaveAttribute(
    'style',
    `width: ${Math.round(gauge.simValue * 100)}%;`,
  );

  const combo = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    let state = g.getState();
    let guard = 0;
    while (guard < 4000 && state.sprint && !state.sprint.complete) {
      state = g.step(100);
      if ((state.sprint?.metrics.combo ?? 0) >= 2) break;
      guard += 1;
    }
    return state.sprint?.metrics.combo ?? 0;
  });

  expect(combo).toBeGreaterThanOrEqual(2);
  const comboElement = page.getByTestId('combo');
  await expect(comboElement).toHaveAttribute('data-combo', String(combo));
  await expect(comboElement).toContainText(`COMBO ×${combo}`);
  await expect(comboElement).toContainText(`出荷倍率 ${comboMultiplier(combo).toFixed(1)}x`);
});

test('運用安定中のコンボ表示は実際の出荷倍率を示す（RI-84）', async ({ page }) => {
  const stableCombo = STABILITY_COMBO_CAP + 1;
  await page.goto('/?renderer=dom&seed=ri84-stable-combo');

  await page.evaluate((combo) => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], 'ri84-stable-combo');
    g.beginSetupSprint();
    const engine = (
      g as unknown as {
        engine: { sprint: NonNullable<RunState['sprint']>; sprintTick: number };
      }
    ).engine;
    const sprint = engine.sprint;
    sprint.metrics.combo = combo;
    sprint.modifiers.stabilityUntilTick = engine.sprintTick + 1;
    // 状態を進めずに revision だけ更新し、UI へ合成状態を反映する。
    g.step(0);
  }, stableCombo);

  const comboElement = page.getByTestId('combo');
  await expect(comboElement).toHaveAttribute('data-combo', String(stableCombo));
  await expect(comboElement).toContainText(`COMBO ×${stableCombo}`);
  await expect(comboElement).toContainText(
    `出荷倍率 ${deliveryComboMultiplier(stableCombo, true).toFixed(1)}x`,
  );
});

test('コンボ途切れ直後の HUD は現在値 0 で、履歴ログだけが途切れを残す（#357）', async ({
  page,
}) => {
  await page.goto('/?renderer=dom&seed=ri357-combo-break');

  await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('easy', [], 'ri357-combo-break');
    g.beginSetupSprint();
    const engine = (g as unknown as { engine: { sprint: NonNullable<RunState['sprint']> } }).engine;
    const sprint = engine.sprint;
    sprint.metrics.combo = 0;
    sprint.events.push({
      tick: 10,
      kind: 'combo-break',
      reason: 'auto-contain',
      taskId: 1,
    });
    g.step(0);
  });

  const combo = page.getByTestId('combo');
  await expect(combo).toHaveAttribute('data-combo', '0');
  await expect(combo).not.toContainText('COMBO');
  await expect(page.getByTestId('event-ticker')).toContainText('コンボ途切れ: 自動鎮火');
  await expect(page.getByTestId('event-ticker-now')).toHaveCount(0);
});

test('途切れ履歴のあとコンボが伸び直したら現在値を履歴と併記する（#357）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ri357-combo-rebuild');

  await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('easy', [], 'ri357-combo-rebuild');
    g.beginSetupSprint();
    const engine = (g as unknown as { engine: { sprint: NonNullable<RunState['sprint']> } }).engine;
    const sprint = engine.sprint;
    sprint.metrics.combo = 12;
    sprint.events.push({
      tick: 10,
      kind: 'combo-break',
      reason: 'auto-contain',
      taskId: 1,
    });
    g.step(0);
  });

  const combo = page.getByTestId('combo');
  await expect(combo).toHaveAttribute('data-combo', '12');
  await expect(combo).toContainText('COMBO ×12');
  await expect(page.getByTestId('event-ticker')).toContainText('コンボ途切れ: 自動鎮火');
  await expect(page.getByTestId('event-ticker-now')).toHaveText('現在 COMBO ×12');
});

test('スプリント終了後のドラフトでは前スプリントの COMBO を出さない（#357）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=devops-tycoon');

  const reached = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('easy', [], 'devops-tycoon');
    g.beginSetupSprint();
    let state = g.getState();
    let guard = 0;
    while (state.phase === 'sprint' && guard < 60_000) {
      state = g.step(1_000);
      guard += 1;
    }
    if (state.phase === 'result') state = g.acknowledgeResult();
    const engine = (g as unknown as { engine: { sprint: NonNullable<RunState['sprint']> } }).engine;
    engine.sprint.metrics.combo = 12;
    g.step(0);
    return {
      phase: g.getState().phase,
      complete: engine.sprint.complete,
      storedCombo: engine.sprint.metrics.combo,
    };
  });

  expect(reached.phase).toBe('draft');
  expect(reached.complete).toBe(true);
  expect(reached.storedCombo).toBe(12);

  await expect(page.getByTestId('draft')).toBeVisible();
  const combo = page.getByTestId('combo');
  await expect(combo).toHaveAttribute('data-combo', '0');
  await expect(combo).not.toContainText('COMBO');
  await expect(page.getByTestId('event-ticker-now')).toHaveCount(0);
});

test('Review が空のとき割り込みレビューは無効＋理由表示（RI-51）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ri51-empty');

  await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], 'ri51-empty');
    g.beginSetupSprint();
  });

  const btn = page.getByTestId('action-interruptReview');
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveAttribute('data-block-reason', 'no-target');
  await expect(page.getByTestId('action-reason-interruptReview')).toContainText('Review が空');
});

test('Review に対象があるとき対象数バッジを表示する（RI-51）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ops');

  await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], 'ops');
    g.beginSetupSprint();
    let guard = 0;
    while (guard < 4000) {
      const s = g.step(100);
      if (!s.sprint || s.sprint.complete) break;
      const q = s.sprint.tasks.filter((t) => t.lane === 'review').length;
      if (q >= 4) return;
      guard += 1;
    }
  });

  await expect(page.getByTestId('action-badge-interruptReview')).toContainText('PR');
  await expect(page.getByTestId('action-interruptReview')).toBeEnabled();
});

test('炎上があったリザルトに「なぜ燃えたか」解説を表示する（RI-34′）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ri34-burn');

  const summary = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('hard', [], 'ri34-burn');
    g.beginSetupSprint();
    let guard = 0;
    while (guard < 8000) {
      const s = g.step(100);
      if (!s.sprint || s.sprint.complete) break;
      // 鎮火せず炎上を育てる（解説ログの材料を残す）。
      guard += 1;
    }
    const state = g.getState();
    if (state.phase !== 'result' || !state.lastResult) {
      throw new Error('スプリントリザルトへ到達できませんでした');
    }
    return {
      incidents: state.lastResult.incidents,
      fireEvents: state.lastResult.fireEvents.length,
    };
  });

  expect(summary.incidents).toBeGreaterThan(0);
  expect(summary.fireEvents).toBeGreaterThan(0);
  await expect(page.getByTestId('sprint-result')).toBeVisible();
  await expect(page.getByTestId('result-burn-cause')).toBeVisible();
  await expect(page.getByTestId('result-burn-cause-headline')).toContainText('点火');
  await expect(page.getByTestId('result-burn-cause-entry').first()).toBeVisible();
});

test('介入ありのリザルトに無介入ベースライン比較を表示する（RI-55）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ri55-e2e');

  const result = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('easy', [], 'ri55-e2e');
    g.beginSetupSprint();
    const outcome = g.dispatch('overtime');
    const state = g.step(1_000_000);
    if (!outcome.ok || state.phase !== 'result' || !state.lastResult?.baseline) {
      throw new Error('RI-55 の比較対象リザルトを生成できませんでした');
    }
    return state.lastResult;
  });

  await expect(page.getByTestId('sprint-result')).toBeVisible();
  await expect(page.getByTestId('result-baseline-comparison')).toBeVisible();
  await expect(page.getByTestId('result-baseline-row-delivered')).toContainText(
    `${result.baseline!.delivered} pt → ${result.delivered} pt`,
  );
  await expect(page.getByTestId('result-baseline-row-spread')).toContainText(
    `${result.baseline!.spread} 件 → ${result.spread} 件`,
  );
  await expect(page.getByTestId('result-baseline-row-maxCombo')).toContainText(
    `x${result.baseline!.maxCombo} → x${result.maxCombo}`,
  );
  await expect(page.getByTestId('result-baseline-disclaimer')).toContainText(
    '厳密な同一世界線ではありません',
  );
});
