import {
  expect,
  test,
  beginPublicSprint,
  advanceCurrentSprintToReviewQueue,
  openSprintResultDetails,
} from './fixtures';
import { STABILITY_COMBO_CAP, comboMultiplier, deliveryComboMultiplier } from '../../src/sim/model';
import type { InterventionOutcome } from '../../src/sim/types';
import type { RunState } from '../../src/sim/run/types';
import type { RunSave } from '../../src/state/runPersistence';
import { VISUAL_TOKENS } from '../../src/render/visualTokens';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    beginSetupSprint(): RunState;
    step(ms: number): RunState;
    dispatch(id: string): InterventionOutcome;
    acknowledgeResult(): RunState;
    exportRunSaveText(): string | null;
    importRunSaveText(raw: string): Promise<{ ok: boolean }>;
    resumeRun(): RunState | null;
  };
};

test('割り込みレビューを発動すると Review 渋滞が捌ける（第6.1 / DoD）', async ({ page }) => {
  await beginPublicSprint(page, { seed: 'ops', difficulty: 'normal' });
  await advanceCurrentSprintToReviewQueue(page, 4);

  const before = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    const sprint = g.getState().sprint!;
    return {
      queue: sprint.tasks.filter((t) => t.lane === 'review').length,
      focus: sprint.focus,
      count: sprint.metrics.actionCounts.interruptReview ?? 0,
      focusSpent: sprint.metrics.focusSpent,
      seniorHp: g.getState().org.seniorHp,
    };
  });
  expect(before.queue).toBeGreaterThanOrEqual(4);

  // 実際の1クリックが発動経路を通り、集中力と回数を一度だけ更新する。
  await page.clock.install();
  await page.getByTestId('action-interruptReview').click();
  const after = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    const s = g.getState();
    return {
      queue: s.sprint!.tasks.filter((t) => t.lane === 'review').length,
      focus: s.sprint!.focus,
      count: s.sprint!.metrics.actionCounts.interruptReview ?? 0,
      focusSpent: s.sprint!.metrics.focusSpent,
      seniorHp: s.org.seniorHp,
      extraHpCost: s.sprint!.interventionEvents.at(-1)?.effect.hpCost ?? 0,
    };
  });

  expect(after.queue).toBeLessThan(before.queue);
  expect(after.focus).toBe(before.focus - 3);
  expect(after.count).toBe(before.count + 1);
  expect(after.focusSpent).toBe(before.focusSpent + 3);
  const hpSpent = before.seniorHp - after.seniorHp;
  expect(hpSpent, 'Review処理のHP消費も追加コストへ加算される').toBeGreaterThan(after.extraHpCost);
  // 介入自身の点火はサマリーで優先し、実行結果の総消費は保持中の履歴から読む。
  await expect(page.getByTestId('event-ticker')).toHaveAttribute('data-feedback-held', 'true');
  await page.getByTestId('event-ticker-heading').click();
  await expect(page.getByTestId('event-ticker-list')).toContainText(
    `シニアHP -${Math.round(hpSpent * 100) / 100}`,
  );
  await expect(page.getByTestId('event-ticker-list')).toContainText('集中力 -3');
});

test('割り込みレビュー成功時に盤面スイープ演出が出る（RI-50）', async ({ page }) => {
  await page.goto('/?seed=ops');

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
  await expect(page.getByTestId('board')).toHaveAttribute(
    'data-effect-kinds',
    /intervention:reviewSweep/,
  );
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
  await expect(page.getByTestId('event-ticker')).toBeVisible();
  await expect(page.getByTestId('event-ticker-summary')).toBeVisible({ timeout: 3000 });
});

test('スプリント盤面に集中力と介入アクションバーが並ぶ', async ({ page }) => {
  await page.goto('/?seed=bar');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await page.getByTestId('begin-sprint').click();

  await expect(page.getByTestId('action-bar')).toBeVisible();
  await expect(page.getByTestId('manager-portrait')).toBeVisible();
  await expect(page.getByTestId('focus').locator('[data-icon="focus"]')).toBeVisible();
  for (const id of ['interruptReview', 'firefight', 'overtime', 'andon']) {
    await expect(page.getByTestId(`action-${id}`)).toBeVisible();
  }
});

test('コンボと連携ゲージの UI 表示が sim 状態と一致する（RI-36）', async ({ page }) => {
  await page.goto('/?seed=ri36-combo-gauge');

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
    g.pause();
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
  await page.goto('/?seed=ri84-stable-combo');

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
  await page.goto('/?seed=ri357-combo-break');

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
  await page.goto('/?seed=ri357-combo-rebuild');

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
  await page.getByTestId('event-ticker-heading').click();
  await expect(page.getByTestId('event-ticker')).toHaveAttribute('data-expanded', 'true');
  await expect(page.getByTestId('event-ticker-now')).toHaveText('現在 COMBO ×12');
});

test('スプリント終了後のドラフトでは前スプリントの COMBO を出さない（#357）', async ({ page }) => {
  await page.goto('/?seed=devops-tycoon');

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
    if (state.phase === 'result') g.acknowledgeResult();
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
  await page.goto('/?seed=ri51-empty');

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
  await page.goto('/?seed=ops');

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

  await expect(page.getByTestId('action-badge-interruptReview')).toContainText('レビュー待ち');
  await expect(page.getByTestId('action-interruptReview')).toBeEnabled();
});

test('炎上があったリザルトに「なぜ燃えたか」解説を表示する（RI-34′）', async ({ page }) => {
  await page.goto('/?seed=ri34-burn');

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
  await openSprintResultDetails(page);
  await expect(page.getByTestId('result-burn-cause')).toBeVisible();
  await expect(page.getByTestId('result-burn-cause-headline')).toContainText('点火');
  await expect(page.getByTestId('result-burn-cause-entry').first()).toBeVisible();
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test.describe(`介入の成果グラフ ${viewport.width}px`, () => {
    test.use({ viewport, hasTouch: viewport.width === 390 });
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      test(`数値・日本語・強調対象を読み取れる（${reducedMotion} / RI-55 / #910）`, async ({
        page,
      }, testInfo) => {
        await page.emulateMedia({ reducedMotion });
        await page.goto('/?seed=ri55-e2e');

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
        await openSprintResultDetails(page);
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

        const chart = page.getByTestId('result-baseline-chart');
        const svg = chart.getByRole('application', { name: '介入の成果 比較グラフ' });
        await expect(svg).toBeVisible();
        await expect(chart.locator('.result-baseline-bar-label')).toHaveCount(6);
        await page.getByTestId('result-baseline-comparison').screenshot({
          path: testInfo.outputPath('result-chart-default.png'),
        });
        // 0 件も含め、ツールチップに触れる前から全6個の値を読める。
        await expect(chart.locator('.result-baseline-bar-label')).toHaveText([
          `${result.baseline!.delivered} pt`,
          `${result.baseline!.spread} 件`,
          `x${result.baseline!.maxCombo}`,
          `${result.delivered} pt`,
          `${result.spread} 件`,
          `x${result.maxCombo}`,
        ]);
        await expect(chart.locator('.result-baseline-bar-label tspan')).toHaveCount(0);
        const labelLayout = await chart
          .locator('.result-baseline-bar-label')
          .evaluateAll((labels) => {
            const bounds = labels.map((label) => ({
              text: label.textContent,
              box: label.getBoundingClientRect(),
            }));
            return bounds.flatMap((label, index) =>
              bounds
                .slice(index + 1)
                .flatMap((other) =>
                  label.box.left < other.box.right &&
                  other.box.left < label.box.right &&
                  label.box.top < other.box.bottom &&
                  other.box.top < label.box.bottom
                    ? [`${label.text} / ${other.text}`]
                    : [],
                ),
            );
          });
        expect(labelLayout, '数値ラベル同士が重ならない').toEqual([]);
        await expect(chart.locator('.result-baseline-axis-label')).toHaveText([
          '出荷',
          '延焼',
          '最大コンボ',
        ]);
        await expect(chart.locator('.result-baseline-axis-label tspan')).toHaveCount(0);
        await expect(chart.locator('.recharts-legend-wrapper')).toContainText('介入なし');
        await expect(chart.locator('.recharts-legend-wrapper')).toContainText('実績');

        await chart.locator('.recharts-bar-rectangle').first().hover();
        const cursor = chart.locator('.recharts-tooltip-cursor');
        await expect(cursor).toBeVisible();
        await expect(chart.locator('.recharts-tooltip-wrapper')).toContainText(
          `介入なし: ${result.baseline!.delivered} pt`,
        );
        await expect(chart.locator('.recharts-tooltip-wrapper')).toContainText(
          `実績: ${result.delivered} pt`,
        );
        for (const bar of await chart.locator('[data-row="出荷"]').all()) {
          await expect(bar).toHaveAttribute('fill-opacity', '1');
        }
        for (const bar of await chart.locator('[data-row="最大コンボ"]').all()) {
          await expect(bar).toHaveAttribute('fill-opacity', '0.45');
        }
        await page.getByTestId('result-baseline-comparison').screenshot({
          path: testInfo.outputPath('result-chart-hover.png'),
        });
        await expect(cursor).toHaveAttribute('fill', VISUAL_TOKENS.colors.chart.hoverBand);

        // キーボードでも同じ項目・数値を示し、選択中の棒と強調を一致させる。
        await page.mouse.move(0, 0);
        await svg.focus();
        // Recharts の縦配置では左キーが次のカテゴリへ進む。
        await page.keyboard.press('ArrowLeft');
        await expect(chart.locator('.result-baseline-tooltip-label')).toHaveText('延焼');
        await page.keyboard.press('ArrowLeft');
        await expect(chart.locator('.result-baseline-tooltip-label')).toHaveText('最大コンボ');
        await expect(chart.locator('.result-baseline-tooltip')).toContainText(
          `実績: x${result.maxCombo}`,
        );
        for (const bar of await chart.locator('[data-row="最大コンボ"]').all()) {
          await expect(bar).toHaveAttribute('fill-opacity', '1');
        }
        for (const bar of await chart.locator('[data-row="出荷"]').all()) {
          await expect(bar).toHaveAttribute('fill-opacity', '0.45');
        }

        if (viewport.width === 390) {
          // タッチでも hover に頼らず、表示済みの数値と対象項目を確認できる。
          const deliveryBar = chart.locator('[data-row="出荷"]').first();
          await deliveryBar.tap();
          await expect(chart.locator('.result-baseline-tooltip-label')).toHaveText('出荷');
          await expect(chart.locator('.result-baseline-tooltip')).toContainText(
            `実績: ${result.delivered} pt`,
          );
        }
      });
    }
  });
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`5桁の比較グラフは${viewport.width}pxでも数値がSVG内に収まる`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await beginPublicSprint(page, { seed: 'ri55-e2e' });
    const originalSave = await page.evaluate(() => {
      const game = (window as GameWindow).game!;
      const outcome = game.dispatch('overtime');
      const state = game.step(1_000_000);
      const raw = game.exportRunSaveText();
      if (!outcome.ok || !raw || state.phase !== 'result')
        throw new Error('比較用リザルトを保存できない');
      return raw;
    });
    const originalResult = (JSON.parse(originalSave) as RunSave).state.lastResult!;

    for (const [baseline, actual] of [
      [9000, 10000],
      [18000, 20000],
      [89999, 99999],
    ]) {
      // 公開の保存・取り込み経路で大きい表示値を用意し、内部engineへは書き込まない。
      await page.evaluate(
        async ({ raw, baseline, actual }) => {
          const game = (window as GameWindow).game!;
          const save = JSON.parse(raw) as RunSave;
          const result = save.state.lastResult;
          if (!result?.baseline) throw new Error('介入なしとの比較が保存されていない');
          result.baseline.delivered = baseline;
          result.delivered = actual;
          const imported = await game.importRunSaveText(JSON.stringify(save));
          if (!imported.ok || game.resumeRun()?.phase !== 'result')
            throw new Error('大きい表示値のリザルトを再開できない');
        },
        { raw: originalSave, baseline, actual },
      );
      await expect(page.getByTestId('sprint-result')).toBeVisible();
      await openSprintResultDetails(page);
      const chart = page.getByTestId('result-baseline-chart');
      const labels = chart.locator('.result-baseline-bar-label');
      await expect(labels).toHaveText([
        `${baseline} pt`,
        `${originalResult.baseline!.spread} 件`,
        `x${originalResult.baseline!.maxCombo}`,
        `${actual} pt`,
        `${originalResult.spread} 件`,
        `x${originalResult.maxCombo}`,
      ]);
      await chart.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      const bounds = await labels.evaluateAll((elements) =>
        elements.map((label) => {
          const rect = label.getBoundingClientRect();
          const svg = label.closest('svg')!.getBoundingClientRect();
          return {
            text: label.textContent,
            width: rect.width,
            left: rect.left - svg.left,
            right: svg.right - rect.right,
            top: rect.top - svg.top,
            bottom: svg.bottom - rect.bottom,
          };
        }),
      );
      await chart.screenshot({ path: testInfo.outputPath(`比較グラフ-${actual}pt.png`) });
      for (const bound of bounds) {
        expect(bound.width, `${bound.text} が描画されている`).toBeGreaterThan(0);
        for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
          expect(bound[edge], `${bound.text} がSVGの${edge}端で欠けない`).toBeGreaterThanOrEqual(
            -0.5,
          );
        }
      }
    }
  });
}
