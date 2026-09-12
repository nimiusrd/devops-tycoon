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
  await page.goto('/?seed=formation-smoke');
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

const NARROW_SETUP_VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
] as const;

test.describe('narrow setup is a reachable 1-column stack', () => {
  for (const viewport of NARROW_SETUP_VIEWPORTS) {
    test(`${viewport.name} ${viewport.width}x${viewport.height} で配置と開始が1カラムで到達できる`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/?seed=formation-narrow-1col');
      await page.getByTestId('difficulty-normal').click();
      await page.getByTestId('start-run').click();
      await expect(page.getByTestId('setup')).toBeVisible();

      const heading = page.locator('.formation-head .draft-title');
      const begin = page.getByTestId('begin-sprint');
      const headingBox = await heading.boundingBox();
      const beginBox = await begin.boundingBox();
      const panelBox = await page.locator('.formation-panel').boundingBox();
      if (!headingBox || !beginBox || !panelBox) {
        throw new Error('編成見出し / 開始ボタン / パネルの bounding box が取得できない');
      }
      expect(beginBox.y, `${viewport.name} で開始ボタンが見出しと横並びのまま`).toBeGreaterThan(
        headingBox.y + headingBox.height - 1,
      );
      expect(beginBox.width, `${viewport.name} で開始ボタンが全幅になっていない`).toBeGreaterThan(
        panelBox.width * 0.8,
      );

      const firstMember = page.getByTestId('formation-member-m0');
      const secondMember = page.getByTestId('formation-member-m1');
      const firstBox = await firstMember.boundingBox();
      const secondBox = await secondMember.boundingBox();
      if (!firstBox || !secondBox) throw new Error('編成カードの bounding box が取得できない');
      expect(secondBox.y, `${viewport.name} で編成グリッドが1列になっていない`).toBeGreaterThan(
        firstBox.y + firstBox.height - 8,
      );

      await page.getByTestId('assign-m2-coding').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('assign-m2-coding')).toBeInViewport();
      await begin.scrollIntoViewIfNeeded();
      await expect(begin).toBeInViewport();

      const noHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );
      expect(noHorizontalOverflow, `${viewport.name} で横スクロールが発生している`).toBe(true);
    });
  }
});

test('ランバーにメンバーの表情が表示される（表情演出 / 第12.2）', async ({ page }) => {
  await page.goto('/?seed=faces-smoke');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('roster-faces')).toBeVisible();
  // 3メンバー分の表情絵文字が並ぶ。
  await expect(page.getByTestId('roster-faces').locator('span')).toHaveCount(3);
});
