import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WhatIfState } from '../../../src/sim/run/types';
import { type WhatIfComputeInput, whatIfCacheKey } from '../../../src/sim/run/whatIfState';
import { requestWhatIfState, resetWhatIfClientForTests } from '../../../src/sim/run/whatIfClient';
import { directRoster, directWhatIfInput } from '../helpers/whatIfFixtures';

const mockModules = vi.hoisted(() => ({
  fallbackResult: null as WhatIfState | null,
  workerDefaultAccesses: 0,
  workerDefaultThrows: false,
  workerInstance: { kind: 'default-worker' },
  computeWhatIfState: vi.fn(),
  WorkerConstructor: vi.fn(),
  wrap: vi.fn(),
}));

vi.mock('../../../src/sim/run/whatIfState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/sim/run/whatIfState')>();
  return {
    ...actual,
    computeWhatIfState: mockModules.computeWhatIfState,
  };
});

vi.mock('comlink', () => ({
  wrap: mockModules.wrap,
}));

vi.mock('../../../src/sim/run/whatIf.worker.ts?worker', () => ({
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

function withMember(
  base: WhatIfComputeInput,
  patch: Partial<(typeof directRoster.members)[0]> & {
    stats?: Partial<(typeof directRoster.members)[0]['stats']>;
  },
): WhatIfComputeInput {
  const member = base.roster.members[0]!;
  return {
    ...base,
    roster: {
      ...base.roster,
      members: [
        {
          ...member,
          ...patch,
          stats: { ...member.stats, ...patch.stats },
          traits: patch.traits ? [...patch.traits] : [...member.traits],
        },
        ...base.roster.members.slice(1),
      ],
    },
  };
}

describe('RI-91-C2 whatIfCacheKey / whatIfClient survived mutants', () => {
  describe('whatIfCacheKey 1フィールド差分', () => {
    const base = directWhatIfInput();
    const baseKey = whatIfCacheKey(base);

    it.each([
      {
        label: 'phase',
        input: directWhatIfInput({ phase: 'setup' }),
      },
      {
        label: 'seed',
        input: directWhatIfInput({ seed: 'what-if-direct-b' }),
      },
      {
        label: 'quarterNumber',
        input: directWhatIfInput({ quarterNumber: base.quarterNumber + 1 }),
      },
      {
        label: 'sprintIndexInQuarter',
        input: directWhatIfInput({ sprintIndexInQuarter: base.sprintIndexInQuarter + 1 }),
      },
      {
        label: 'pendingSprintKind',
        input: directWhatIfInput({ pendingSprintKind: 'normal' }),
      },
      {
        label: 'deck.defId',
        input: directWhatIfInput({
          deck: [
            { defId: 'hire-senior', level: 1 },
            { defId: 'auto-test', level: 2 },
          ],
        }),
      },
      {
        label: 'deck.level',
        input: directWhatIfInput({
          deck: [
            { defId: 'docs', level: 2 },
            { defId: 'auto-test', level: 2 },
          ],
        }),
      },
      {
        label: 'draft.order',
        input: directWhatIfInput({ draft: ['auto-test', 'copilot'] }),
      },
      {
        label: 'draft.item',
        input: directWhatIfInput({ draft: ['copilot', 'docs'] }),
      },
      {
        label: 'draft.null',
        input: directWhatIfInput({ draft: null }),
      },
      {
        label: 'roster.id',
        input: withMember(base, { id: 'm1-alt' }),
      },
      {
        label: 'roster.assignment',
        input: withMember(base, { assignment: 'bench' }),
      },
      {
        label: 'roster.aiAssigned',
        input: withMember(base, { aiAssigned: false }),
      },
      {
        label: 'roster.onLeave',
        input: withMember(base, { onLeave: true }),
      },
      {
        label: 'roster.rank',
        input: withMember(base, { rank: 'middle' }),
      },
      {
        label: 'roster.level',
        input: withMember(base, { level: base.roster.members[0]!.level + 1 }),
      },
      {
        label: 'roster.stats.implementation',
        input: withMember(base, {
          stats: { implementation: base.roster.members[0]!.stats.implementation + 1 },
        }),
      },
      {
        label: 'roster.stats.review',
        input: withMember(base, {
          stats: { review: base.roster.members[0]!.stats.review + 1 },
        }),
      },
      {
        label: 'roster.stats.aiMastery',
        input: withMember(base, {
          stats: { aiMastery: base.roster.members[0]!.stats.aiMastery + 1 },
        }),
      },
      {
        // 複数トレイトでないと join('+') → join('') が生き残る。
        label: 'roster.traits',
        input: withMember(base, { traits: ['aiArtisan', 'juniorStar'] }),
      },
      {
        label: 'org.seniorHp',
        input: directWhatIfInput({ org: { ...base.org, seniorHp: base.org.seniorHp + 1 } }),
      },
      {
        label: 'org.aiDependency',
        input: directWhatIfInput({
          org: { ...base.org, aiDependency: base.org.aiDependency + 1 },
        }),
      },
      {
        label: 'org.morale',
        input: directWhatIfInput({ org: { ...base.org, morale: base.org.morale + 1 } }),
      },
      {
        label: 'org.techDebt',
        input: directWhatIfInput({ org: { ...base.org, techDebt: base.org.techDebt + 1 } }),
      },
      {
        label: 'org.quality',
        input: directWhatIfInput({ org: { ...base.org, quality: base.org.quality + 1 } }),
      },
      {
        label: 'org.testCoverage',
        input: directWhatIfInput({
          org: { ...base.org, testCoverage: base.org.testCoverage + 1 },
        }),
      },
      {
        label: 'org.aiLiteracy',
        input: directWhatIfInput({
          org: { ...base.org, aiLiteracy: base.org.aiLiteracy + 1 },
        }),
      },
      {
        label: 'org.documentation',
        input: directWhatIfInput({
          org: { ...base.org, documentation: base.org.documentation + 1 },
        }),
      },
      {
        label: 'org.aiEnabled',
        input: directWhatIfInput({ org: { ...base.org, aiEnabled: false } }),
      },
      {
        label: 'budget',
        input: directWhatIfInput({ budget: base.budget + 1 }),
      },
      {
        label: 'mod.reviewLoadAdd',
        input: directWhatIfInput({
          pendingSprintModifiers: { ...base.pendingSprintModifiers, reviewLoadAdd: 3 },
        }),
      },
      {
        label: 'mod.reworkRateAdd',
        input: directWhatIfInput({
          pendingSprintModifiers: { ...base.pendingSprintModifiers, reworkRateAdd: 0.2 },
        }),
      },
      {
        label: 'mod.taskCountMul',
        input: directWhatIfInput({
          pendingSprintModifiers: { ...base.pendingSprintModifiers, taskCountMul: 1.6 },
        }),
      },
      {
        label: 'mod.focusMaxAdd',
        input: directWhatIfInput({
          pendingSprintModifiers: { ...base.pendingSprintModifiers, focusMaxAdd: -2 },
        }),
      },
      {
        label: 'teamReviewQueue',
        input: directWhatIfInput({ teamReviewQueue: base.teamReviewQueue! + 1 }),
      },
      {
        label: 'teamIncidents',
        input: directWhatIfInput({ teamIncidents: base.teamIncidents! + 1 }),
      },
    ] as const)('1つ変えるとキーが変わる: $label', ({ input }) => {
      expect(whatIfCacheKey(input)).not.toBe(baseKey);
    });

    it('modifier / team の ?? デフォルトは undefined と明示値を同一キーにする', () => {
      // ?? 0 / ?? 1 を外すと "undefined" と "0"/"1" が分岐するため、同値を断言して殺す。
      const defaultsKey = whatIfCacheKey(
        directWhatIfInput({
          pendingSprintModifiers: {},
          teamReviewQueue: undefined,
          teamIncidents: undefined,
        }),
      );
      const explicitKey = whatIfCacheKey(
        directWhatIfInput({
          pendingSprintModifiers: {
            reviewLoadAdd: 0,
            reworkRateAdd: 0,
            taskCountMul: 1,
            focusMaxAdd: 0,
          },
          teamReviewQueue: 0,
          teamIncidents: 0,
        }),
      );
      expect(defaultsKey).toBe(explicitKey);
    });

    it('draft null と空配列はどちらも空 draftKey になる', () => {
      expect(whatIfCacheKey(directWhatIfInput({ draft: null }))).toBe(
        whatIfCacheKey(directWhatIfInput({ draft: [] })),
      );
    });

    it('traits は + 区切りで指紋に載る（空文字 join を殺す）', () => {
      const key = whatIfCacheKey(withMember(base, { traits: ['aiArtisan', 'juniorStar'] }));
      expect(key).toContain('aiArtisan+juniorStar');
      expect(key).not.toContain('aiArtisanjuniorStar');
    });
  });

  describe('whatIfClient 並行 initPromise 共有', () => {
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

    it('初期化中の並行 request は同一 initPromise を共有する', async () => {
      enableWorkerGlobal();
      const remoteResult = createState('shared-init');
      mockModules.fallbackResult = createState('fallback');
      const workerInstance = { kind: 'shared-init-worker' };
      mockModules.workerInstance = workerInstance;
      const remoteCompute = vi.fn(async () => remoteResult);
      mockModules.wrap.mockImplementation((worker: unknown) => {
        expect(worker).toBe(workerInstance);
        return { computeWhatIfState: remoteCompute };
      });

      const firstInput = createInput('concurrent-1');
      const secondInput = createInput('concurrent-2');

      // 1件目が await import で yield した直後に 2件目が同じ initPromise を掴む。
      // if (!initPromise) を外すと Worker / wrap が 2 回走る。
      await expect(
        Promise.all([requestWhatIfState(firstInput), requestWhatIfState(secondInput)]),
      ).resolves.toEqual([remoteResult, remoteResult]);

      expect(mockModules.WorkerConstructor).toHaveBeenCalledTimes(1);
      expect(mockModules.workerDefaultAccesses).toBe(1);
      expect(mockModules.wrap).toHaveBeenCalledTimes(1);
      expect(remoteCompute).toHaveBeenNthCalledWith(1, firstInput);
      expect(remoteCompute).toHaveBeenNthCalledWith(2, secondInput);
      expect(mockModules.computeWhatIfState).not.toHaveBeenCalled();
    });
  });
});
