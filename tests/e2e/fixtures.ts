/**
 * E2E 共通 fixture（RI-60）。
 *
 * 初回ガイドがアクションバー操作を遮らないよう、明示の `?tutorial=` が無い
 * goto には `tutorial=off` を付与する。チュートリアル専用テストは `1` / `force` /
 * `help` を明示する。
 */
import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { EVENT_DEFS } from '../../src/data/events';
import type { GameHandle } from '../../src/game';
import type { DiagnosisType, DifficultyId, RunState } from '../../src/sim/run/types';
import { ensureTutorialQuery } from '../../src/ui/tutorial';

/** E2E から利用する `window.game` の公開面だけを型として切り出す。 */
export type PublicGameHandle = Pick<
  GameHandle,
  | 'pause'
  | 'getState'
  | 'getDiagnosticInfo'
  | 'startRun'
  | 'beginSetupSprint'
  | 'resolveBeat'
  | 'step'
  | 'dispatch'
  | 'acknowledgeResult'
  | 'chooseCard'
  | 'skipDraft'
  | 'finishEvolution'
  | 'buyShopRelic'
  | 'leaveShop'
  | 'restChoose'
  | 'recruitChoose'
  | 'zoomTo'
  | 'focusDept'
  | 'focusTeam'
  | 'acknowledgeQuarterReview'
  | 'chooseGoalAdjustment'
>;

export type PublicGameWindow = Window & { game?: PublicGameHandle };

/** レリックを直接付与するイベントの、安全側選択肢を公開データから組み立てる。 */
export const RI94_RELIC_CHOICE_BY_EVENT: Readonly<Record<string, number>> = Object.fromEntries(
  EVENT_DEFS.flatMap((def) => {
    const choiceIndex = def.choices.findIndex((choice) => choice.outcome.grantRelic !== undefined);
    return choiceIndex >= 0 ? [[def.id, choiceIndex]] : [];
  }),
);

export interface PublicSprintOptions {
  seed: string;
  difficulty?: DifficultyId;
  renderer?: 'dom' | 'pixi';
}

export interface PublicRunTarget {
  phase: 'setup' | 'result';
  diagnosis?: DiagnosisType;
  relicCount?: number;
}

export interface PublicRunOptions extends PublicSprintOptions {
  target: PublicRunTarget;
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const originalGoto = page.goto.bind(page);
    page.goto = ((url, options) =>
      originalGoto(ensureTutorialQuery(String(url ?? ''), 'off'), options)) as typeof page.goto;
    await use(page);
  },
});

/** タイトルの hydration 完了後に、公開 GameHandle で指定ランを開始する。 */
async function openPublicRun(page: Page, options: PublicSprintOptions): Promise<void> {
  const { seed, difficulty = 'easy', renderer = 'dom' } = options;
  await page.goto(`/?renderer=${renderer}&seed=${seed}`);
  await expect(page.getByTestId('title')).toBeVisible();
  await page.evaluate(
    ({ seed: runSeed, difficulty: runDifficulty }) => {
      const game = (window as PublicGameWindow).game;
      if (!game) throw new Error('window.game が公開されていない');
      game.startRun(runDifficulty, [], runSeed);
      // startRun() は自動的に pause を解除するため、開始後に壁時計進行を止める。
      game.pause();
    },
    { seed, difficulty },
  );
}

/** 初期スプリントを公開 GameHandle だけで開始する。 */
export async function beginPublicSprint(page: Page, options: PublicSprintOptions): Promise<void> {
  await openPublicRun(page, options);
  await page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    game.beginSetupSprint();
    // 画面の lazy 読込や fallback の所有権に左右されず、開始フレームを固定する。
    game.pause();
  });
  await expect(page.getByTestId('board')).toBeVisible();
}

/** setup で停止しているランを次のスプリントへ進める。 */
export async function beginCurrentSetupSprint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    if (game.getState().phase !== 'setup') throw new Error('ランが setup フェーズではない');
    game.beginSetupSprint();
    game.pause();
  });
  await expect(page.getByTestId('board')).toBeVisible();
}

/** 現在のスプリントを公開 `step()` だけでスプリント結果まで進める。 */
export async function advanceCurrentSprintToResult(page: Page): Promise<RunState> {
  const state = await page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    let current = game.getState();
    let guard = 0;
    if (current.phase !== 'sprint')
      throw new Error(`ランが sprint フェーズではない: ${current.phase}`);
    while (current.phase === 'sprint' && guard < 60_000) {
      guard += 1;
      game.step(300);
      current = game.getState();
    }
    if (current.phase !== 'result') {
      throw new Error(`スプリント結果へ到達しない: phase=${current.phase} guard=${guard}`);
    }
    return current;
  });
  await expect(page.getByTestId('sprint-result')).toBeVisible();
  return state;
}

/**
 * 実時間待機を使わず、公開 GameHandle.step() だけで決定論的にランを進める。
 * イベントの選択肢は本番の宣言データから生成した表だけを渡し、engine は参照しない。
 */
export async function advancePublicRun(page: Page, options: PublicRunOptions): Promise<RunState> {
  await openPublicRun(page, options);
  return page.evaluate(
    ({ target, relicChoiceByEvent, seed }) => {
      const game = (window as PublicGameWindow).game;
      if (!game) throw new Error('window.game が公開されていない');

      let state = game.getState();
      let guard = 0;
      const targetReached = (candidate: RunState): boolean =>
        candidate.phase === target.phase &&
        (target.diagnosis === undefined || candidate.diagnosis === target.diagnosis) &&
        (target.relicCount === undefined || candidate.relics.length >= target.relicCount);

      while (!targetReached(state) && guard < 60_000) {
        guard += 1;
        switch (state.phase) {
          case 'setup':
            game.beginSetupSprint();
            break;
          case 'sprint': {
            const sprint = state.sprint;
            if (sprint && !sprint.complete) {
              if (sprint.tasks.filter((task) => task.lane === 'review').length >= 6) {
                game.dispatch('interruptReview');
              }
              // RI-73 / F-1: 余裕のある先消しは高コストなので、緊急時だけ鎮火する。
              const burning = sprint.tasks.filter((task) => task.incident);
              const minBurnTicksLeft = burning.reduce(
                (min, task) => Math.min(min, task.burnTicksLeft ?? Number.POSITIVE_INFINITY),
                Number.POSITIVE_INFINITY,
              );
              if (burning.length >= 2 || (burning.length >= 1 && minBurnTicksLeft <= 15)) {
                game.dispatch('firefight');
              }
            }
            game.step(300);
            break;
          }
          case 'result':
            game.acknowledgeResult();
            break;
          case 'draft':
            if (state.draft && state.draft.length > 0) game.chooseCard(state.draft[0]);
            else game.skipDraft();
            break;
          case 'evolution':
            game.finishEvolution();
            break;
          case 'beat': {
            const eventId = state.beat?.eventId;
            game.resolveBeat(eventId ? relicChoiceByEvent[eventId] : undefined);
            break;
          }
          case 'shop': {
            const relic = state.shop?.relic;
            if (relic && !relic.bought && state.budget >= relic.cost) game.buyShopRelic();
            game.leaveShop();
            break;
          }
          case 'rest':
            game.restChoose('heal');
            break;
          case 'recruit':
            game.recruitChoose('skip');
            break;
          case 'quarterReview':
            if (state.quarterReview?.outcome === 'missed_adjustable') {
              game.chooseGoalAdjustment(state.quarterReview.availableAdjustments[0] ?? 'cut_scope');
            } else {
              game.acknowledgeQuarterReview();
            }
            break;
          default:
            throw new Error(`RI-94 fixture が処理できない phase=${state.phase} seed=${seed}`);
        }
        state = game.getState();
      }

      if (!targetReached(state)) {
        throw new Error(
          `RI-94 fixture が目標へ到達しない: phase=${state.phase} diagnosis=${state.diagnosis} relics=${state.relics.length} guard=${guard} seed=${seed}`,
        );
      }
      return state;
    },
    {
      target: options.target,
      relicChoiceByEvent: RI94_RELIC_CHOICE_BY_EVENT,
      seed: options.seed,
    },
  );
}

export { expect };
