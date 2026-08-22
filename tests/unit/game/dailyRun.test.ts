import { describe, expect, it } from 'vitest';
import { createGame } from '../../../src/game';
import {
  DAILY_RUN_DIFFICULTY,
  DAILY_RUN_TRIALS,
  dailyRunKey,
  dailySeed,
  defaultMeta,
} from '../../../src/state/meta';

describe('デイリーラン（spec-mapping §2 M7）', () => {
  it('startDailyRun は固定条件と日付 seed で編成（setup）へ入る', () => {
    const game = createGame({ seed: 'title' });
    const dateStr = '2026-06-20';
    const s = game.startDailyRun(dateStr);

    expect(s.phase).toBe('setup');
    expect(s.runKind).toBe('daily');
    expect(s.dailyDate).toBe(dateStr);
    expect(s.seed).toBe(dailySeed(dateStr));
    expect(s.difficulty).toBe(DAILY_RUN_DIFFICULTY);
    expect(s.trials).toEqual([...DAILY_RUN_TRIALS]);
  });

  it('デイリーでは研修方針を適用せず同一日のドラフトが一致する（RI-34⁗）', () => {
    const dateStr = '2026-07-19';
    const reachDraft = (preferred: string[]): string[] => {
      const game = createGame({
        seed: 'daily-policy',
        initialMeta: { ...defaultMeta(), preferredCardIds: preferred },
      });
      game.startDailyRun(dateStr);
      let s = game.getState();
      let guard = 0;
      while (s.phase !== 'draft' && s.status === 'playing' && guard < 5000) {
        guard += 1;
        switch (s.phase) {
          case 'setup':
            game.beginSetupSprint();
            break;
          case 'sprint':
            game.step(1_000_000);
            break;
          case 'result':
            game.acknowledgeResult();
            break;
          default:
            guard = 5000;
            break;
        }
        s = game.getState();
      }
      expect(s.phase).toBe('draft');
      return s.draft ?? [];
    };

    expect(reachDraft(['docs'])).toEqual(reachDraft([]));
  });

  it('同一日のデイリー再走は points を二重付与しない', () => {
    const game = createGame({ seed: 'daily-farm' });
    const dateStr = '2026-06-22';

    const finishOnce = (): number => {
      game.startDailyRun(dateStr);
      let s = game.getState();
      let guard = 0;
      while (s.status === 'playing' && guard < 5000) {
        guard += 1;
        switch (s.phase) {
          case 'setup':
            game.beginSetupSprint();
            break;
          case 'sprint':
            game.step(1_000_000);
            break;
          case 'result':
            game.acknowledgeResult();
            break;
          case 'draft':
            if (s.draft && s.draft.length > 0) game.chooseCard(s.draft[0]);
            else game.skipDraft();
            break;
          case 'evolution':
            game.finishEvolution();
            break;
          case 'beat':
            game.resolveBeat(s.beat?.kind === 'judgment' ? undefined : 0);
            break;
          case 'shop':
            game.leaveShop();
            break;
          case 'rest':
            game.restChoose('heal');
            break;
          case 'recruit':
            game.recruitChoose('skip');
            break;
          case 'quarterReview':
            if (s.quarterReview?.outcome === 'missed_adjustable') {
              game.chooseGoalAdjustment(s.quarterReview.availableAdjustments[0] ?? 'cut_scope');
            } else {
              game.acknowledgeQuarterReview();
            }
            break;
          default:
            guard = 5000;
            break;
        }
        s = game.getState();
      }
      return game.getMeta().points;
    };

    const pointsAfterFirst = finishOnce();
    expect(pointsAfterFirst).toBeGreaterThan(defaultMeta().points);

    const pointsAfterSecond = finishOnce();
    expect(pointsAfterSecond).toBe(pointsAfterFirst);
    expect(game.getMeta().dailyRuns[dailyRunKey(dateStr)]?.rewardClaimed).toBe(true);
  });
});
