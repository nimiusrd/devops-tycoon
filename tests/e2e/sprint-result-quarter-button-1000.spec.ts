/**
 * 320 幅のボス結果で「四半期レビューへ →」が1行で欠けない（#1000）。
 */
import { expect, test } from './fixtures';
import { EVENT_DEFS } from '../../src/data/events';
import { E2E_MISSED_ADJUSTABLE_SEED } from '../../src/sim/run/quarterReviewSeeds';

const AVOID_CHOICE_FLAGS: Record<string, boolean[]> = Object.fromEntries(
  EVENT_DEFS.map((def) => [
    def.id,
    def.choices.map((choice) => !!choice.outcome.grantRecruit || !!choice.outcome.forceLose),
  ]),
);

async function advanceToSprint6BossResult(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    ({ seed, avoid }) => {
      const game = window.game;
      if (!game) throw new Error('window.game が公開されていない');
      game.startRun('easy', [], seed);
      game.pause();
      let state = game.getState();
      let guard = 0;
      while (state.status === 'playing' && state.sprintsPlayed < 6 && guard < 8_000) {
        guard += 1;
        const playedBefore = state.sprintsPlayed;
        switch (state.phase) {
          case 'setup':
            game.beginSetupSprint();
            break;
          case 'sprint': {
            let cardGuard = 0;
            while (cardGuard < 24 && game.getState().phase === 'sprint') {
              cardGuard += 1;
              const hand = game.getState().sprint?.cardPiles.hand ?? [];
              if (hand.length === 0) break;
              let playedAny = false;
              for (const deckIndex of [...hand]) {
                if (game.playCard(deckIndex).ok) {
                  playedAny = true;
                  break;
                }
              }
              if (!playedAny) break;
            }
            if (game.getState().phase === 'sprint') game.step(1_000_000);
            break;
          }
          case 'result':
            game.acknowledgeResult();
            break;
          case 'draft':
            if (state.draft && state.draft.length > 0) game.chooseCard(state.draft[0]!);
            else game.skipDraft();
            break;
          case 'evolution':
            game.finishEvolution();
            break;
          case 'beat': {
            const beat = state.beat;
            if (!beat || beat.kind === 'judgment') game.resolveBeat(undefined);
            else {
              const flags = avoid[beat.eventId] ?? [];
              const preferred = flags.findIndex((flag) => !flag);
              game.resolveBeat(preferred >= 0 ? preferred : 0);
            }
            break;
          }
          case 'shop':
            game.leaveShop();
            break;
          case 'rest':
            game.restChoose('heal');
            break;
          case 'recruit':
            game.recruitChoose('skip');
            break;
          default:
            throw new Error(`未処理の phase=${state.phase}`);
        }
        state = game.getState();
        if (
          state.sprintsPlayed > playedBefore &&
          state.phase === 'result' &&
          state.sprintsPlayed === 6
        )
          break;
      }
      if (!(state.phase === 'result' && state.sprintsPlayed === 6)) {
        throw new Error(`sprint6 result に到達できない: phase=${state.phase}`);
      }
    },
    { seed: E2E_MISSED_ADJUSTABLE_SEED, avoid: AVOID_CHOICE_FLAGS },
  );
}

test('320 で四半期レビューへボタンのラベルが1行に収まる（#1000）', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`/?seed=issue-1000-quarter-button&tutorial=off`);
  await advanceToSprint6BossResult(page);

  await expect(page.getByTestId('webgl-status')).toHaveCount(0, { timeout: 20_000 });
  const continueButton = page.getByTestId('result-continue');
  await expect(continueButton).toBeVisible();
  await expect(continueButton).toHaveText('四半期レビューへ →');

  const layout = await continueButton.evaluate((btn) => {
    const rect = btn.getBoundingClientRect();
    const cs = getComputedStyle(btn);
    const range = document.createRange();
    range.selectNodeContents(btn);
    const lineRects = range.getClientRects().length;
    const clipped = btn.scrollWidth > rect.width + 1 || btn.scrollHeight > rect.height + 1;
    const actions = btn.closest('.result-actions');
    const actionsStyle = actions ? getComputedStyle(actions) : null;
    return {
      whiteSpace: cs.whiteSpace,
      lineRects,
      clipped,
      width: rect.width,
      height: rect.height,
      bottom: rect.bottom,
      viewportH: window.innerHeight,
      actionsFlexDirection: actionsStyle?.flexDirection ?? null,
    };
  });

  expect(layout.whiteSpace).toBe('nowrap');
  expect(layout.actionsFlexDirection).toBe('column');
  expect(layout.lineRects, '主CTAが複数行に折れている').toBe(1);
  expect(layout.clipped, '主CTAのラベルが欠けている').toBe(false);
  expect(layout.bottom, '主CTAが画面内に収まっていない').toBeLessThanOrEqual(
    layout.viewportH + 0.5,
  );
  expect(layout.height).toBeGreaterThanOrEqual(44);
});
