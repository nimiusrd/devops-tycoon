import { expect, test } from './fixtures';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
  };
};

test('編成（Setup）画面でメンバーの配置と AI 配布を切り替えてスプリントを開始できる（第12章）', async ({
  page,
}) => {
  await page.goto('/?renderer=dom&seed=formation-smoke');
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-run').click();
  // ラン開始直後は編成（Setup）。
  await expect(page.getByTestId('setup')).toBeVisible();

  // 初期ロスターの3メンバーが表示される（m0/m1/m2）。
  await expect(page.getByTestId('formation-member-m0')).toBeVisible();
  await expect(page.getByTestId('formation-member-m1')).toBeVisible();
  await expect(page.getByTestId('formation-member-m2')).toBeVisible();

  // レビュアー(m2)をコーディングへ移すと、配置ボタンの選択状態が変わる。
  await page.getByTestId('assign-m2-coding').click();
  await expect(page.getByTestId('assign-m2-coding')).toHaveClass(/active/);

  const assignment = await page.evaluate(
    () =>
      (window as GameWindow).game!.getState().roster.members.find((m) => m.id === 'm2')?.assignment,
  );
  expect(assignment).toBe('coding');

  // AI 配布をトグルする（m0）。
  const before = await page.evaluate(
    () =>
      (window as GameWindow).game!.getState().roster.members.find((m) => m.id === 'm0')?.aiAssigned,
  );
  await page.getByTestId('ai-m0').click();
  const after = await page.evaluate(
    () =>
      (window as GameWindow).game!.getState().roster.members.find((m) => m.id === 'm0')?.aiAssigned,
  );
  expect(after).toBe(!before);

  // 編成を確定してスプリントを開始する。
  await page.getByTestId('begin-sprint').click();
  await expect(page.getByTestId('board')).toBeVisible();
});

test('ランバーにメンバーの表情が表示される（表情演出 / 第12.2）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=faces-smoke');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('roster-faces')).toBeVisible();
  // 3メンバー分の表情絵文字が並ぶ。
  await expect(page.getByTestId('roster-faces').locator('span')).toHaveCount(3);
});
