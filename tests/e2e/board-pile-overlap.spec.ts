/**
 * Review 山が他工程の粒と重ならないことと、候補粒のヒット判定（#995）。
 *
 * 盤面プレビュー属性は React の同期に依存するため、本番と同じ `planBoardScene` +
 * `hitTestBoardDot` を Node 側で検証し、武装後は代表点のみブラウザでタップする。
 */
import type { Page } from '@playwright/test';
import { beginPublicSprint, expect, test, type PublicGameWindow } from './fixtures';
import { readBoardCanvasFrame } from './boardCanvasPoint';
import { planBoardScene } from '../../src/render/boardScene';
import { countReviewCrossStationOverlaps } from '../../src/render/boardPileLayout';
import {
  presentBoardDots,
  presentedDotRadius,
  hitTestBoardDot,
} from '../../src/render/boardPixiView';
import { splitPrCandidates } from '../../src/sim/assignTask';
import type { SprintState } from '../../src/sim/types';

async function advanceToSplitCandidates(page: Page, target: number): Promise<void> {
  await page.evaluate((wanted) => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    const count = () => {
      const sprint = game.getState().sprint;
      if (!sprint) return 0;
      return sprint.tasks.filter(
        (task) => (task.lane === 'review' || task.lane === 'coding') && !task.split,
      ).length;
    };
    let guard = 0;
    let stepMs = 80;
    while (game.getState().phase === 'sprint' && guard < 8_000) {
      const current = count();
      if (current >= wanted) {
        game.pause();
        return;
      }
      if (wanted - current <= 3) stepMs = 10;
      guard += 1;
      game.step(stepMs);
    }
    game.pause();
    throw new Error(`PR分割候補が ${wanted} 件に到達しない`);
  }, target);
}

function assertDotsSelectable(sprint: SprintState, cssScale: number): void {
  const scene = planBoardScene(sprint.tasks);
  expect(countReviewCrossStationOverlaps(scene.dots)).toBe(0);
  const candidates = new Set(splitPrCandidates(sprint).map((task) => task.id));
  const presented = presentBoardDots(scene.dots, cssScale).filter((dot) => candidates.has(dot.id));
  const ids = new Set(presented.map((dot) => dot.id));
  expect(presented.length).toBeGreaterThan(0);
  for (const dot of presented) {
    const radius = presentedDotRadius(dot.size, cssScale);
    for (const [dx, dy] of [
      [0, 0],
      [0.3, 0],
      [0, -0.28],
      [0.22, 0.22],
    ] as const) {
      const point = { x: dot.x + dx * radius, y: dot.y + dy * radius };
      expect(hitTestBoardDot(point, scene.dots, ids, { x: cssScale, y: cssScale })).toBe(dot.id);
    }
  }
}

for (const viewport of [
  { width: 320, height: 568, name: '320' },
  { width: 390, height: 844, name: '390' },
] as const) {
  test(`${viewport.name}px・WebKit 含む: 候補粒を描画内で選べる（#995） @pixi`, async ({
    page,
    browserName,
  }) => {
    test.info().annotations.push({ type: 'browser', description: browserName });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await beginPublicSprint(page, { seed: 'devops-tycoon' });
    await advanceToSplitCandidates(page, 12);
    await expect(page.getByTestId('board')).toBeVisible();

    const sprint = await page.evaluate(() => (window as PublicGameWindow).game?.getState().sprint);
    const frame = await readBoardCanvasFrame(page);
    if (!sprint) throw new Error('スプリントがない');

    assertDotsSelectable(sprint, frame.fit.scale);
  });
}
