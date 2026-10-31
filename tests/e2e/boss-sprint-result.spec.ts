/**
 * スプリント 6 の終了後、結果画面が 1 回だけ出てから四半期レビューへ進む（#989）。
 */
import { expect, test } from './fixtures';
import { EVENT_DEFS } from '../../src/data/events';
import { E2E_MISSED_ADJUSTABLE_SEED } from '../../src/sim/run/quarterReviewSeeds';
import type { RunState } from '../../src/sim/run/types';

const AVOID_CHOICE_FLAGS: Record<string, boolean[]> = Object.fromEntries(
  EVENT_DEFS.map((def) => [
    def.id,
    def.choices.map((choice) => !!choice.outcome.grantRecruit || !!choice.outcome.forceLose),
  ]),
);

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;

interface SprintEnd {
  sprint: number;
  phase: string;
  kind: string | null;
}

test('スプリント6は結果を1回出してから四半期レビューへ進む', async ({ page }) => {
  test.setTimeout(120_000);

  for (const viewport of VIEWPORTS) {
    await test.step(`${viewport.width}×${viewport.height}`, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/?seed=issue-989-boss-result&tutorial=off`);
      await expect(page.getByTestId('title')).toBeVisible();

      const trace = await page.evaluate(
        ({ seed, avoid }) => {
          const game = (
            window as Window & {
              game?: {
                pause(): void;
                getState(): RunState;
                startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
                beginSetupSprint(): RunState;
                resolveBeat(choiceIndex?: number): RunState;
                step(ms: number): RunState;
                playCard(deckIndex: number): { ok: boolean };
                acknowledgeResult(): RunState;
                chooseCard(defId: string): RunState;
                skipDraft(): RunState;
                finishEvolution(): RunState;
                leaveShop(): RunState;
                restChoose(option: string): RunState;
                recruitChoose(option: 'hire' | 'skip'): RunState;
              };
            }
          ).game;
          if (!game) throw new Error('window.game が公開されていない');
          game.startRun('easy', [], seed);
          game.pause();

          const ends: SprintEnd[] = [];
          let state = game.getState();
          let guard = 0;
          while (state.status === 'playing' && ends.length < 6 && guard < 8_000) {
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
                return {
                  ok: false as const,
                  reason: `未処理の phase=${state.phase}`,
                  ends,
                  phase: state.phase,
                  status: state.status,
                  sprintsPlayed: state.sprintsPlayed,
                };
            }
            state = game.getState();
            if (state.sprintsPlayed > playedBefore && state.phase !== 'sprint') {
              ends.push({
                sprint: state.sprintsPlayed,
                phase: state.phase,
                kind: state.currentSprintKind,
              });
              if (state.phase === 'result' && state.sprintsPlayed === 6) break;
            }
          }

          return {
            ok: state.phase === 'result' && state.sprintsPlayed === 6 && ends.length === 6,
            reason: state.phase === 'result' ? '' : `phase=${state.phase} status=${state.status}`,
            ends,
            phase: state.phase,
            status: state.status,
            sprintsPlayed: state.sprintsPlayed,
            quarterNumber: state.quarterNumber,
          };
        },
        { seed: E2E_MISSED_ADJUSTABLE_SEED, avoid: AVOID_CHOICE_FLAGS },
      );

      expect(trace.reason, `${viewport.width}px ends=${JSON.stringify(trace.ends)}`).toBe('');
      expect(trace.ok).toBe(true);
      expect(trace.ends.slice(0, 5).map((end) => end.phase)).toEqual([
        'result',
        'result',
        'result',
        'result',
        'result',
      ]);
      expect(trace.ends.slice(0, 5).every((end) => end.kind !== 'boss')).toBe(true);
      expect(trace.ends[5]).toEqual({ sprint: 6, phase: 'result', kind: 'boss' });

      await expect(page.getByTestId('webgl-status')).toHaveCount(0, { timeout: 20_000 });
      const result = page.getByTestId('sprint-result');
      await expect(result).toHaveCount(1);
      await expect(result).toBeVisible();
      await expect(page.getByTestId('quarter-review')).toHaveCount(0);
      const continueButton = page.getByTestId('result-continue');
      await expect(continueButton).toHaveText('四半期レビューへ →');

      await page.evaluate(() => {
        const game = (window as { game?: { step(ms: number): void } }).game;
        game?.step(100_000);
      });
      await expect(result).toHaveCount(1);
      await expect(page.getByTestId('quarter-review')).toHaveCount(0);

      await continueButton.scrollIntoViewIfNeeded();
      await continueButton.click();
      const review = page.getByTestId('quarter-review');
      await expect(review).toHaveCount(1);
      await expect(review).toBeVisible();
      await expect(review).toContainText('Q1');
      await expect(result).toHaveCount(0);

      await page.evaluate(() => {
        const game = (window as { game?: { step(ms: number): void } }).game;
        game?.step(100_000);
      });
      await expect(result).toHaveCount(0);
      await expect(review).toHaveCount(1);
    });
  }
});
