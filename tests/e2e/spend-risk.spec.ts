import { RECRUIT_COST } from '../../src/sim/member';
import { recruitCandidateView } from '../../src/render/recruitCandidateView';
import { expect, test, type Page } from './fixtures';

const PHONE_SE = { width: 320, height: 568 } as const;

interface SpendTarget {
  seed: string;
  screen: 'shop' | 'recruit' | 'rest';
  controlTestId: string;
  budget: number;
}

async function openExactSpend(page: Page, screen: SpendTarget['screen']): Promise<SpendTarget> {
  await page.goto('/?seed=spend-risk&renderer=pixi');
  await expect(page.getByTestId('title')).toBeVisible();
  const found = await page.evaluate(
    ({ recruitCost, screen }) => {
      const game = window.game;
      if (!game) throw new Error('window.game が公開されていない');
      const interesting = new Set(['shop-offer', 'rest-offer', 'recruit-offer']);
      for (let seedIndex = 0; seedIndex < 24; seedIndex += 1) {
        const seed = `spend-risk-${seedIndex}`;
        game.startRun('nightmare', [], seed);
        game.pause();
        let guard = 0;
        while (guard < 80) {
          guard += 1;
          const state = game.getState();
          if (state.status === 'lost' || state.phase === 'lost') break;
          if (state.phase === 'setup') {
            game.beginSetupSprint();
            game.pause();
            continue;
          }
          if (state.phase === 'sprint') {
            game.step(180000);
            continue;
          }
          if (state.phase === 'result') {
            game.acknowledgeResult();
            continue;
          }
          if (state.phase === 'draft') {
            game.skipDraft();
            continue;
          }
          if (state.phase === 'evolution') {
            game.finishEvolution();
            continue;
          }
          if (state.phase === 'beat') {
            const eventId = state.beat?.eventId;
            if (eventId && interesting.has(eventId)) {
              game.resolveBeat(0);
              const opened = game.getState();
              if (screen === 'shop' && opened.phase === 'shop' && opened.shop) {
                const card = opened.shop.cards.find(
                  (offer) => !offer.bought && offer.cost === opened.budget,
                );
                if (card) {
                  return {
                    seed,
                    screen: 'shop' as const,
                    controlTestId: `shop-card-${card.defId}`,
                    budget: opened.budget,
                  };
                }
                if (
                  opened.shop.relic &&
                  !opened.shop.relic.bought &&
                  opened.shop.relic.cost === opened.budget
                ) {
                  return {
                    seed,
                    screen: 'shop' as const,
                    controlTestId: `shop-relic-${opened.shop.relic.id}`,
                    budget: opened.budget,
                  };
                }
                if (
                  opened.shop.recruit &&
                  !opened.shop.recruit.bought &&
                  opened.shop.recruit.cost === opened.budget
                ) {
                  return {
                    seed,
                    screen: 'shop' as const,
                    controlTestId: 'shop-recruit',
                    budget: opened.budget,
                  };
                }
              }
              if (
                screen === 'recruit' &&
                opened.phase === 'recruit' &&
                opened.budget === recruitCost
              ) {
                return {
                  seed,
                  screen: 'recruit' as const,
                  controlTestId: 'recruit-hire',
                  budget: opened.budget,
                };
              }
              if (screen === 'rest' && opened.phase === 'rest' && opened.budget === recruitCost) {
                return {
                  seed,
                  screen: 'rest' as const,
                  controlTestId: 'rest-recruit',
                  budget: opened.budget,
                };
              }
              if (opened.phase === 'shop') game.leaveShop();
              else if (opened.phase === 'rest') game.restChoose('heal');
              else if (opened.phase === 'recruit') game.recruitChoose('skip');
              continue;
            }
            game.resolveBeat(state.beat?.kind === 'judgment' ? undefined : 0);
            continue;
          }
          break;
        }
      }
      return null;
    },
    { recruitCost: RECRUIT_COST, screen },
  );
  expect(found, `${screen} で予算ちょうどでの支払いに到達できる`).not.toBeNull();
  return found!;
}

test.describe('予算枯渇になる購入と採用', () => {
  test.use({ viewport: PHONE_SE });

  for (const screen of ['shop', 'rest', 'recruit'] as const) {
    test(`${screen} は確定前にランが終わらず、取消後は元の操作へ戻る`, async ({ page }) => {
      const target = await openExactSpend(page, screen);
      const candidate =
        screen === 'recruit'
          ? recruitCandidateView(await page.evaluate(() => window.game!.getState()))
          : null;
      const dialog = page.getByTestId(target.screen === 'shop' ? 'shop' : target.screen);
      await expect(dialog).toBeVisible();
      const control = page.getByTestId(target.controlTestId);
      await expect(control).toContainText('支払後の残高');
      await expect(control).toContainText('予算枯渇でランが終了する');
      const shopState =
        screen === 'shop' ? await page.evaluate(() => window.game!.getState()) : null;

      await control.click();
      const confirm = page.getByTestId('spend-confirm');
      await expect(confirm).toBeVisible();
      if (candidate) await expect(confirm).toContainText(`${candidate.member.name}の採用`);
      await expect(page.getByTestId('spend-confirm-cancel')).toBeFocused();

      const viewport = page.viewportSize() ?? PHONE_SE;
      for (const id of ['spend-confirm-cancel', 'spend-confirm-accept'] as const) {
        const button = page.getByTestId(id);
        await button.scrollIntoViewIfNeeded();
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(24);
        expect(box!.height).toBeGreaterThanOrEqual(24);
        expect(box!.x).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box!.y).toBeGreaterThanOrEqual(-1);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
      }

      if (shopState) {
        const modal = page.getByRole('dialog', { name: '予算枯渇の確認', exact: true });
        await expect(page.locator('.app')).toHaveJSProperty('inert', true);
        await expect(modal).toHaveAttribute('aria-modal', 'true');
        await expect(page.locator('[aria-label="予算枯渇の確認"]')).toHaveCount(1);
        await expect(page.getByTestId('shop-leave')).toBeDisabled();
        await page.keyboard.press('Shift+Tab');
        await expect(confirm.getByTestId('spend-confirm-accept')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(confirm.getByTestId('spend-confirm-cancel')).toBeFocused();

        // 商品一覧の余白を押してから Shift+Tab すると、修正前は背面のメニューへ移れた。
        const outside = await modal.evaluate((overlay) => {
          const rect = overlay.getBoundingClientRect();
          const point = { x: rect.left + 6, y: rect.top + 6 };
          return document.elementFromPoint(point.x, point.y) === overlay ? point : null;
        });
        expect(outside).not.toBeNull();
        await page.mouse.click(outside!.x, outside!.y);
        await expect(confirm).toHaveCount(0);
        await expect(page.locator('.app')).toHaveJSProperty('inert', false);
        await expect(control).toBeFocused();
        expect(await page.evaluate(() => window.game!.getState())).toEqual(shopState);

        await control.click();
        await expect(confirm.getByTestId('spend-confirm-cancel')).toBeFocused();
      }

      await page.keyboard.press('Escape');
      await expect(confirm).toHaveCount(0);
      await expect(control).toBeFocused();
      const afterCancel = await page.evaluate(() => {
        const state = window.game?.getState();
        return { phase: state?.phase, budget: state?.budget, status: state?.status };
      });
      expect(afterCancel).toEqual({
        phase: target.screen,
        budget: target.budget,
        status: 'playing',
      });
      if (shopState) {
        await expect(page.locator('.app')).toHaveJSProperty('inert', false);
        expect(await page.evaluate(() => window.game!.getState())).toEqual(shopState);
      }

      await control.click();
      await page.getByTestId('spend-confirm-accept').click();
      await expect
        .poll(async () => page.evaluate(() => window.game?.getState().loseReason ?? null))
        .toBe('budgetExhausted');
    });
  }
});
