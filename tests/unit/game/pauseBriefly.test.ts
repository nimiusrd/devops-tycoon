import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, pauseBriefly } from '../../../src/game';

describe('pauseBriefly（RI-10）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('未 pause なら一時停止し、時間経過後に resume する', () => {
    const game = createGame({ seed: 'ri10-pause-briefly' });
    expect(game.isPaused()).toBe(false);

    pauseBriefly(game, 1_200);
    expect(game.isPaused()).toBe(true);
    const epoch = game.getPauseEpoch();

    vi.advanceTimersByTime(1_199);
    expect(game.isPaused()).toBe(true);
    expect(game.getPauseEpoch()).toBe(epoch);

    vi.advanceTimersByTime(1);
    expect(game.isPaused()).toBe(false);
    expect(game.getPauseEpoch()).toBe(epoch);
  });

  it('既に pause 済みなら触らない', () => {
    const game = createGame({ seed: 'ri10-pause-owned' });
    game.pause();
    const epoch = game.getPauseEpoch();

    pauseBriefly(game, 1_200);
    expect(game.isPaused()).toBe(true);
    expect(game.getPauseEpoch()).toBe(epoch);

    vi.advanceTimersByTime(1_200);
    expect(game.isPaused()).toBe(true);
    expect(game.getPauseEpoch()).toBe(epoch);
  });

  it('待機中に外部が再 pause したら resume しない', () => {
    const game = createGame({ seed: 'ri10-pause-reowned' });
    pauseBriefly(game, 1_200);
    expect(game.isPaused()).toBe(true);

    game.pause();
    const externalEpoch = game.getPauseEpoch();

    vi.advanceTimersByTime(1_200);
    expect(game.isPaused()).toBe(true);
    expect(game.getPauseEpoch()).toBe(externalEpoch);
  });

  it('clear でタイマーをキャンセルし、所有 epoch なら resume する', () => {
    const game = createGame({ seed: 'ri10-pause-clear' });
    const clear = pauseBriefly(game, 1_200);
    expect(game.isPaused()).toBe(true);

    clear();
    expect(game.isPaused()).toBe(false);

    vi.advanceTimersByTime(1_200);
    expect(game.isPaused()).toBe(false);
  });

  it('clear 時に外部が再 pause 済みなら resume しない', () => {
    const game = createGame({ seed: 'ri10-pause-clear-reowned' });
    const clear = pauseBriefly(game, 1_200);
    game.pause();
    const externalEpoch = game.getPauseEpoch();

    clear();
    expect(game.isPaused()).toBe(true);
    expect(game.getPauseEpoch()).toBe(externalEpoch);
  });

  it('RI-62: プレイヤー再生速度は game.pause を使わず、pauseBriefly と独立', () => {
    // プレイヤー Pause は useRun の playbackSpeed=0（UI 状態）。ここでは
    // game.pause を触らないまま pauseBriefly の epoch 契約が保たれることを確認する。
    const game = createGame({ seed: 'ri62-player-speed-independent' });
    expect(game.isPaused()).toBe(false);

    const clear = pauseBriefly(game, 1_200);
    expect(game.isPaused()).toBe(true);
    const epoch = game.getPauseEpoch();

    // プレイヤー側の「再開」相当（playbackSpeed を戻す）は game.resume を呼ばない想定。
    // pauseBriefly のタイマーだけが所有 epoch を resume する。
    vi.advanceTimersByTime(1_200);
    expect(game.isPaused()).toBe(false);
    expect(game.getPauseEpoch()).toBe(epoch);
    clear();
  });
});
