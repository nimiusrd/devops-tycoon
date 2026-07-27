import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WhatIfState } from '../../src/sim/run/types';
import type { WhatIfComputeInput } from '../../src/sim/run/whatIfState';
import { requestWhatIfState, resetWhatIfClientForTests } from '../../src/sim/run/whatIfClient';

const mockModules = vi.hoisted(() => ({
  fallbackResult: null as WhatIfState | null,
  workerDefaultAccesses: 0,
  workerDefaultThrows: false,
  workerInstance: { kind: 'default-worker' },
  computeWhatIfState: vi.fn(),
  WorkerConstructor: vi.fn(),
  wrap: vi.fn(),
}));

vi.mock('../../src/sim/run/whatIfState', () => ({
  computeWhatIfState: mockModules.computeWhatIfState,
}));

vi.mock('comlink', () => ({
  wrap: mockModules.wrap,
}));

vi.mock('../../src/sim/run/whatIf.worker.ts?worker', () => ({
  get default() {
    mockModules.workerDefaultAccesses += 1;
    if (mockModules.workerDefaultThrows) throw new Error('worker module unavailable');
    return mockModules.WorkerConstructor;
  },
}));

function createInput(seed: string): WhatIfComputeInput {
  return { phase: 'setup', seed } as WhatIfComputeInput;
}

function createState(label: string): WhatIfState {
  return {
    current: {
      trials: 1,
      delivered: { mean: label.length, min: label.length, max: label.length },
      spread: { mean: 0, min: 0, max: 0 },
    },
    draftCandidates: {},
  } as WhatIfState;
}

function mockFallback(result: WhatIfState | null) {
  mockModules.fallbackResult = result;
  return mockModules.computeWhatIfState;
}

function enableWorkerGlobal(): void {
  vi.stubGlobal('Worker', class TestWorker {});
}

function resetMocks(): void {
  mockModules.fallbackResult = null;
  mockModules.workerDefaultAccesses = 0;
  mockModules.workerDefaultThrows = false;
  mockModules.workerInstance = { kind: 'default-worker' };
  mockModules.computeWhatIfState.mockReset();
  mockModules.computeWhatIfState.mockImplementation(() => mockModules.fallbackResult);
  mockModules.WorkerConstructor.mockReset();
  mockModules.WorkerConstructor.mockImplementation(function WorkerConstructor() {
    return mockModules.workerInstance;
  });
  mockModules.wrap.mockReset();
}

beforeEach(() => {
  resetWhatIfClientForTests();
  vi.unstubAllGlobals();
  resetMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('whatIfClient', () => {
  it('Comlink remote が成功したら Worker 経由の結果を返し remote を再利用する', async () => {
    enableWorkerGlobal();
    const remoteResult = createState('remote');
    const fallback = mockFallback(createState('fallback'));
    const workerInstance = { kind: 'what-if-worker' };
    mockModules.workerInstance = workerInstance;
    const remoteCompute = vi.fn(async () => remoteResult);
    const remote = { computeWhatIfState: remoteCompute };
    mockModules.wrap.mockReturnValue(remote);
    const firstInput = createInput('success-1');
    const secondInput = createInput('success-2');

    await expect(requestWhatIfState(firstInput)).resolves.toBe(remoteResult);
    await expect(requestWhatIfState(secondInput)).resolves.toBe(remoteResult);

    expect(mockModules.WorkerConstructor).toHaveBeenCalledTimes(1);
    expect(mockModules.workerDefaultAccesses).toBe(1);
    expect(mockModules.wrap).toHaveBeenCalledOnce();
    expect(mockModules.wrap).toHaveBeenCalledWith(workerInstance);
    expect(remoteCompute).toHaveBeenNthCalledWith(1, firstInput);
    expect(remoteCompute).toHaveBeenNthCalledWith(2, secondInput);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('Worker module の import に失敗したら同期 fallback に切り替える', async () => {
    enableWorkerGlobal();
    const fallbackResult = createState('module-fallback');
    const fallback = mockFallback(fallbackResult);
    mockModules.workerDefaultThrows = true;
    const input = createInput('module-failure');

    await expect(requestWhatIfState(input)).resolves.toBe(fallbackResult);

    expect(mockModules.workerDefaultAccesses).toBe(1);
    expect(mockModules.WorkerConstructor).not.toHaveBeenCalled();
    expect(mockModules.wrap).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledWith(input);
  });

  it('remote が例外を投げたら fallback し、次回以降は Worker を再試行しない', async () => {
    enableWorkerGlobal();
    const fallbackResult = createState('remote-fallback');
    const fallback = mockFallback(fallbackResult);
    mockModules.workerInstance = { kind: 'failing-worker' };
    const remoteCompute = vi.fn(async () => {
      throw new Error('remote failed');
    });
    const remote = { computeWhatIfState: remoteCompute };
    mockModules.wrap.mockReturnValue(remote);
    const firstInput = createInput('remote-failure-1');
    const secondInput = createInput('remote-failure-2');

    await expect(requestWhatIfState(firstInput)).resolves.toBe(fallbackResult);
    await expect(requestWhatIfState(secondInput)).resolves.toBe(fallbackResult);

    expect(mockModules.WorkerConstructor).toHaveBeenCalledOnce();
    expect(mockModules.workerDefaultAccesses).toBe(1);
    expect(mockModules.wrap).toHaveBeenCalledOnce();
    expect(remoteCompute).toHaveBeenCalledOnce();
    expect(remoteCompute).toHaveBeenCalledWith(firstInput);
    expect(fallback).toHaveBeenNthCalledWith(1, firstInput);
    expect(fallback).toHaveBeenNthCalledWith(2, secondInput);
  });

  it('resetWhatIfClientForTests は singleton と Worker 無効化をリセットして再初期化させる', async () => {
    enableWorkerGlobal();
    const fallback = mockFallback(createState('unused-fallback'));
    const firstRemoteResult = createState('remote-one');
    const secondRemoteResult = createState('remote-two');
    const workerInstances = [{ kind: 'reset-worker-1' }, { kind: 'reset-worker-2' }];
    mockModules.WorkerConstructor.mockImplementation(function WorkerConstructor() {
      return workerInstances.shift()!;
    });
    const firstRemote = { computeWhatIfState: vi.fn(async () => firstRemoteResult) };
    const secondRemote = { computeWhatIfState: vi.fn(async () => secondRemoteResult) };
    mockModules.wrap.mockReturnValueOnce(firstRemote).mockReturnValueOnce(secondRemote);
    const firstInput = createInput('before-reset');
    const secondInput = createInput('after-reset');

    await expect(requestWhatIfState(firstInput)).resolves.toBe(firstRemoteResult);
    resetWhatIfClientForTests();
    await expect(requestWhatIfState(secondInput)).resolves.toBe(secondRemoteResult);

    expect(mockModules.WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(mockModules.workerDefaultAccesses).toBe(2);
    expect(mockModules.wrap).toHaveBeenCalledTimes(2);
    expect(firstRemote.computeWhatIfState).toHaveBeenCalledWith(firstInput);
    expect(secondRemote.computeWhatIfState).toHaveBeenCalledWith(secondInput);
    expect(fallback).not.toHaveBeenCalled();
  });
});
