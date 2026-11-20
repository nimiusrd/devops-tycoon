/** PR 分割後の粒強調と読み上げが同じ ID を指す（#1020）。 */
import type { Page } from '@playwright/test';
import { advanceCurrentSprintToReviewQueue, beginPublicSprint, expect, test } from './fixtures';
import { designToClient, readBoardCanvasFrame } from './boardCanvasPoint';
import { planBoardScene } from '../../src/render/boardScene';
import { presentBoardDots } from '../../src/render/boardPixiView';
import { splitPrCandidates } from '../../src/sim/assignTask';
import {
  formatSplitPrConfirmAnnouncement,
  splitPrConfirmDurationMs,
} from '../../src/render/splitPrConfirmView';

type GameWindow = Window & {
  splitPrConfirmationObserved?: boolean;
  splitPrTouchObservation?: {
    announcements: string[];
    duration: number | null;
    timerDelays: number[];
    feedbackHeld: boolean;
    before: number[];
    during: number[] | null;
    after: number[] | null;
  };
  game?: {
    getState(): {
      sprint?: {
        focus: number;
        tasks: { id: number; split: boolean; lane: string }[];
        events: { kind: string; effect?: { affectedTaskIds?: number[] } }[];
      };
    };
    step(n: number): void;
  };
};

async function waitForBoardReady(page: Page): Promise<void> {
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
}

async function advanceUntil(page: Page, mode: 'split'): Promise<number> {
  for (let step = 0; step < 400; step += 1) {
    await page.evaluate((n) => (window as GameWindow).game!.step(n), 5);
    const found = await page.evaluate((target) => {
      const sprint = (window as GameWindow).game!.getState().sprint;
      if (!sprint) return null;
      if (target === 'split') {
        const task = sprint.tasks.find(
          (t) => !t.split && (t.lane === 'review' || t.lane === 'coding'),
        );
        if (task && sprint.focus >= 2) return task.id;
      }
      return null;
    }, mode);
    if (found != null) return found;
  }
  throw new Error(`advanceUntil(${mode}) がタイムアウト`);
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`390px・${reducedMotion}: 分割した粒 ID と読み上げ文が一致する（#1020） @pixi`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion });
    await beginPublicSprint(page, { seed: 'ri146-split-keyboard', renderer: 'pixi' });
    await waitForBoardReady(page);
    const taskId = await advanceUntil(page, 'split');

    await page.getByTestId('action-splitPr').click();
    await expect(page.getByTestId('action-target-picker')).toBeVisible();
    const option = page.getByTestId(`action-target-option-${taskId}`);
    await expect(option).toBeEnabled();

    const announce = formatSplitPrConfirmAnnouncement(taskId);
    // 通常の強調は175msだけなので、通信を挟まず同じDOM更新で3値を観測する。
    // 操作後のpollだけではCI負荷で演出の寿命を過ぎ、表示済みの一致を見逃す。
    await page.evaluate(
      ({ expectedId, announcement }) => {
        (window as GameWindow).splitPrConfirmationObserved = false;
        const observer = new MutationObserver(() => {
          const boardId = document
            .querySelector('[data-testid="board"]')
            ?.getAttribute('data-split-confirm-task-id');
          const pixiId = document
            .querySelector('[data-testid="board-pixi-mount"]')
            ?.getAttribute('data-split-confirm-task-id');
          const spoken = document
            .querySelector('[data-testid="split-pr-confirm-announce"]')
            ?.textContent?.trim();
          if (boardId === expectedId && pixiId === expectedId && spoken === announcement) {
            (window as GameWindow).splitPrConfirmationObserved = true;
            observer.disconnect();
          }
        });
        observer.observe(document.body, {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true,
        });
      },
      { expectedId: String(taskId), announcement: announce },
    );
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('action-target-picker')).toHaveCount(0);

    // 通信が演出より遅くても、寿命内に観測した一致をあとから確認できる。
    await page.waitForTimeout(splitPrConfirmDurationMs() + 40);
    await expect
      .poll(() => page.evaluate(() => (window as GameWindow).splitPrConfirmationObserved), {
        timeout: splitPrConfirmDurationMs() + 3_000,
        intervals: [16, 32, 48, 64, 96],
      })
      .toBe(true);

    const event = await page.evaluate(() => {
      const sprint = (window as GameWindow).game!.getState().sprint;
      const entry = sprint?.events.findLast((e) => e.kind === 'intervention');
      return entry?.kind === 'intervention' ? entry.effect?.affectedTaskIds?.[0] : null;
    });
    expect(event).toBe(taskId);

    await expect(page.getByTestId('board')).not.toHaveAttribute('data-split-confirm-task-id');
    await expect(page.getByTestId('board-pixi-mount')).not.toHaveAttribute(
      'data-split-confirm-task-id',
    );
    await expect(page.getByTestId('split-pr-confirm-announce')).toHaveText(announce);
  });
}

test.describe('盤面の粒をタッチしてPRを分割する', () => {
  test.use({ hasTouch: true });

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`390px・${reducedMotion}: 実タッチの分割結果を一度通知し、盤面を動かさない（#1020） @pixi`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion });
      await beginPublicSprint(page, { seed: 'qa-seed-1030', renderer: 'pixi' });
      await advanceCurrentSprintToReviewQueue(page, 3, 5);
      const board = page.getByTestId('board');
      const mount = page.getByTestId('board-pixi-mount');
      await expect(mount).toHaveAttribute('data-board-assets', '5');
      await page.getByTestId('action-splitPr').tap();
      await expect(board).toHaveAttribute('data-armed', 'splitPr');
      await board.scrollIntoViewIfNeeded();

      const frame = await readBoardCanvasFrame(page);
      const sprint = await page.evaluate(() => window.game!.getState().sprint!);
      const candidates = new Set(splitPrCandidates(sprint).map((task) => task.id));
      const points = presentBoardDots(planBoardScene(sprint.tasks).dots, frame.fit.scale)
        .filter((dot) => dot.lane === 'review' && !dot.motion && candidates.has(dot.id))
        .map((dot) => ({ id: dot.id, ...designToClient(frame, dot) }));
      const target = await page.evaluate((points) => {
        return points.findLast(({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          return (
            hit?.closest('[data-testid="board"]') &&
            !hit.closest('.st-label, .bubble, .board-legend, .pile-overflow')
          );
        });
      }, points);
      expect(target, 'タッチ可能なレビュー中の粒がある').toBeDefined();

      const cdp = await page.context().newCDPSession(page);
      const point = { x: target!.x, y: target!.y, id: 1 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
      await expect(board).toHaveAttribute('data-preview-task-id', String(target!.id));

      const announcement = formatSplitPrConfirmAnnouncement(target!.id);
      await page.evaluate(
        ({ id, expectedDelay }) => {
          const board = document.querySelector<HTMLElement>('[data-testid="board"]')!;
          const mount = document.querySelector('[data-testid="board-pixi-mount"]')!;
          const layout = document.querySelector('[data-testid="sprint-layout"]')!;
          const live = document.querySelector('[data-testid="split-pr-confirm-announce"]')!;
          const ticker = document.querySelector('[data-testid="event-ticker"]')!;
          const readFrame = () => {
            const { x, y, width, height } = board.getBoundingClientRect();
            return [x + window.scrollX, y + window.scrollY + layout.scrollTop, width, height];
          };
          const observation = {
            announcements: [] as string[],
            duration: null as number | null,
            timerDelays: [] as number[],
            feedbackHeld: false,
            before: readFrame(),
            during: null as number[] | null,
            after: null as number[] | null,
          };
          (window as GameWindow).splitPrTouchObservation = observation;
          // 実ブラウザの描画待ちと、アプリが要求する強調時間を分けて確かめる。
          const setTimeout = window.setTimeout;
          window.setTimeout = new Proxy(setTimeout, {
            apply(target, receiver, args) {
              if (args[1] === expectedDelay) observation.timerDelays.push(args[1]);
              return Reflect.apply(target, receiver, args);
            },
          });
          let start: number | null = null;
          let previousText = live.textContent;
          const observer = new MutationObserver(() => {
            if (live.textContent !== previousText) {
              observation.announcements.push(live.textContent ?? '');
              previousText = live.textContent;
            }
            if (start === null && mount.getAttribute('data-split-confirm-task-id') === id) {
              start = performance.now();
              observation.during = readFrame();
              observation.feedbackHeld = ticker.getAttribute('data-feedback-held') === 'true';
            }
            if (
              start !== null &&
              observation.duration === null &&
              !board.hasAttribute('data-split-confirm-task-id') &&
              !mount.hasAttribute('data-split-confirm-task-id')
            ) {
              observation.duration = performance.now() - start;
              observation.after = readFrame();
              window.setTimeout = setTimeout;
            }
          });
          observer.observe(board, {
            attributes: true,
            attributeFilter: ['data-split-confirm-task-id'],
          });
          observer.observe(mount, {
            attributes: true,
            attributeFilter: ['data-split-confirm-task-id'],
          });
          observer.observe(live, { childList: true, characterData: true, subtree: true });
        },
        { id: String(target!.id), expectedDelay: splitPrConfirmDurationMs() },
      );
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();

      const ticker = page.getByTestId('event-ticker');
      const live = page.getByTestId('split-pr-confirm-announce');
      await expect(live).toHaveText(announcement);
      await expect(ticker).toHaveAttribute('data-feedback-held', 'false');
      const { observation, affected } = await page.evaluate(() => ({
        observation: (window as GameWindow).splitPrTouchObservation!,
        affected: window.game!.getState().sprint?.events.findLast((e) => e.kind === 'intervention')
          ?.effect?.affectedTaskIds,
      }));
      expect(affected).toEqual([target!.id]);
      expect(observation.announcements).toEqual([announcement]);
      expect(observation.feedbackHeld).toBe(true);
      expect(observation.during).toEqual(observation.before);
      expect(observation.after).toEqual(observation.before);
      expect(observation.duration).not.toBeNull();
      expect(observation.timerDelays).toEqual([splitPrConfirmDurationMs()]);
      await expect(live).toHaveText(announcement);
      await ticker.getByTestId('event-ticker-heading').click();
      await expect(ticker.getByTestId('event-ticker-list')).toContainText('PR分割');
    });
  }
});
