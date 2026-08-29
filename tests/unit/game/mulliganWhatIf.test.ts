import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, type GameHandle } from '../../../src/game';
import type { WhatIfComputeInput } from '../../../src/sim/run/whatIfState';
import type { RunState, WhatIfState } from '../../../src/sim/run/types';

const mockModules = vi.hoisted(() => ({
  requestWhatIfState: vi.fn(),
}));

vi.mock('../../../src/sim/run/whatIfClient', () => ({
  requestWhatIfState: mockModules.requestWhatIfState,
}));

function reachDraft(game: GameHandle): RunState {
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
  return s;
}

function advanceToDraftWithoutGetState(game: GameHandle): void {
  game.startRun('easy', [], 'mulligan-whatif-worker');
  game.beginSetupSprint();
  game.step(1_000_000);
  game.acknowledgeResult();
}

function fakeWhatIf(label: string): WhatIfState {
  return {
    current: {
      trials: 24,
      delivered: { mean: label.length, min: 0, max: label.length },
      spread: { mean: 0, min: 0, max: 0 },
    },
    draftCandidates: {
      [label]: {
        trials: 24,
        delivered: { mean: 1, min: 0, max: 2 },
        spread: { mean: 0, min: 0, max: 0 },
      },
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ドラフト引き直しと what-if 再計算', () => {
  it('引き直し後は候補が入れ替わり介入予測が ready で新しいカードを持つ', () => {
    const game = createGame({ seed: 'mulligan-whatif' });
    game.startRun('easy', [], 'mulligan-whatif');
    const before = reachDraft(game);
    expect(before.whatIfStatus).toBe('ready');
    const oldDraft = [...(before.draft ?? [])];
    expect(oldDraft.length).toBeGreaterThan(0);

    const after = game.mulliganDraft();
    expect(after.phase).toBe('draft');
    expect(after.draftMulliganUsed).toBe(true);
    expect([...(after.draft ?? [])].sort()).not.toEqual([...oldDraft].sort());
    expect(after.whatIfStatus).toBe('ready');
    expect(after.whatIf?.current.trials).toBeGreaterThan(0);
    for (const id of after.draft ?? []) {
      expect(after.whatIf?.draftCandidates[id]).toBeDefined();
    }
    expect(game.getState().whatIfStatus).toBe('ready');
  });
});

describe('ドラフト引き直しの Worker what-if', () => {
  beforeEach(() => {
    mockModules.requestWhatIfState.mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('未完了の旧試算があっても引き直し後の結果だけを採用する', async () => {
    vi.stubGlobal('Worker', class TestWorker {});
    const pending: {
      input: WhatIfComputeInput;
      resolve: (value: WhatIfState | null) => void;
    }[] = [];
    mockModules.requestWhatIfState.mockImplementation((input: WhatIfComputeInput) => {
      return new Promise<WhatIfState | null>((resolve) => {
        pending.push({ input, resolve });
      });
    });

    const game = createGame({ seed: 'mulligan-whatif-worker' });
    advanceToDraftWithoutGetState(game);
    expect(game.getState().phase).toBe('draft');

    const first = game.getState();
    expect(first.whatIfStatus).toBe('computing');
    expect(pending).toHaveLength(1);
    const oldDraft = [...(first.draft ?? [])];

    const after = game.mulliganDraft();
    expect(after.phase).toBe('draft');
    expect(after.draftMulliganUsed).toBe(true);
    expect(after.whatIfStatus).toBe('computing');
    expect([...(after.draft ?? [])].sort()).not.toEqual([...oldDraft].sort());
    expect(pending).toHaveLength(2);

    pending[0]!.resolve(fakeWhatIf('stale'));
    await flushMicrotasks();
    expect(game.getState().whatIfStatus).toBe('computing');
    expect(game.getState().whatIf).toBeNull();

    const fresh = fakeWhatIf('fresh');
    pending[1]!.resolve(fresh);
    await flushMicrotasks();
    const ready = game.getState();
    expect(ready.whatIfStatus).toBe('ready');
    expect(ready.whatIf?.current.delivered.max).toBe('fresh'.length);
    expect(ready.whatIf?.draftCandidates.fresh?.trials).toBe(24);
  });

  it('Worker が失敗しても同期フォールバックで試算中を抜ける', async () => {
    vi.stubGlobal('Worker', class TestWorker {});
    mockModules.requestWhatIfState.mockRejectedValue(new Error('worker down'));

    const game = createGame({ seed: 'mulligan-whatif-fallback' });
    game.startRun('easy', [], 'mulligan-whatif-fallback');
    game.beginSetupSprint();
    game.step(1_000_000);
    game.acknowledgeResult();

    expect(game.getState().whatIfStatus).toBe('computing');
    await flushMicrotasks();
    const before = game.getState();
    expect(before.whatIfStatus).toBe('ready');
    const oldDraft = [...(before.draft ?? [])];

    const after = game.mulliganDraft();
    expect(after.whatIfStatus).toBe('computing');
    await flushMicrotasks();
    const ready = game.getState();
    expect(ready.whatIfStatus).toBe('ready');
    expect([...(ready.draft ?? [])].sort()).not.toEqual([...oldDraft].sort());
    for (const id of ready.draft ?? []) {
      expect(ready.whatIf?.draftCandidates[id]).toBeDefined();
    }
  });
});
