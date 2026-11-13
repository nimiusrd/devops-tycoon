import { expect, test } from './fixtures';
import type { PublicGameWindow } from './fixtures';
import { SPRINT_PADDING_GATE_MESSAGES } from '../../src/render/sprintPaddingGateView';

const STALL_REASON = SPRINT_PADDING_GATE_MESSAGES.stalled;

async function enterNoCoderStall(page: import('@playwright/test').Page) {
  await page.goto('/?renderer=pixi&tutorial=off&seed=devops-tycoon');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('setup')).toBeVisible();

  const memberIds = await page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    game.pause();
    return game.getState().roster.members.map((member) => member.id);
  });
  for (const id of memberIds) {
    await page.getByTestId(`assign-${id}-review`).click();
  }

  await page.getByTestId('begin-sprint').click();
  await page.getByTestId('setup-no-coder-begin').click();
  await expect(page.getByTestId('board')).toBeVisible();

  await page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    game.pause();
    for (let i = 0; i < 8; i += 1) game.step(100);
    game.pause();
  });
}

test.describe('コーダー不在の停滞 UI (#972)', () => {
  test('320 幅で介入・組織レバーが無効表示と理由を持つ', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await enterNoCoderStall(page);

    const action = page.getByTestId('action-pairReview');
    await expect(action).toBeDisabled();
    await expect(action).toHaveAttribute('aria-disabled', 'true');
    await expect(action.getByTestId('action-reason-pairReview')).toHaveText(STALL_REASON);
    const reasonFont = await action
      .getByTestId('action-reason-pairReview')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(reasonFont).toBeGreaterThanOrEqual(11);

    const openOrg = page.getByTestId('open-org');
    await expect(openOrg).toHaveAttribute('aria-disabled', 'true');
    await expect(openOrg).toHaveAttribute('data-padding-gated', 'true');
    await expect(page.getByTestId('open-org-block-reason')).toHaveText(STALL_REASON);
    await expect(page.getByTestId('zoom-overlay')).toHaveCount(0);
  });

  test('停滞理由表示で盤面の位置が動かない', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await enterNoCoderStall(page);

    const boardYBefore = await page.getByTestId('board-stage').evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.y;
    });
    await expect(page.getByTestId('action-reason-interruptReview')).toHaveText(STALL_REASON);
    const boardYAfter = await page.getByTestId('board-stage').evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.y;
    });
    expect(boardYAfter).toBe(boardYBefore);
  });
});
