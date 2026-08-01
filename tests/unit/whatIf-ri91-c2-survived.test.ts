/**
 * RI-91-C2: src/sim/run/whatIfState.ts / whatIfClient.ts の Survived mutation を潰す。
 * 共有の whatIf / whatIfClient テストは触らず、単位専用ファイルで exact 断言する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosterState } from '../../src/sim/member/types';
import type { WhatIfState } from '../../src/sim/run/types';
import { whatIfCacheKey, type WhatIfComputeInput } from '../../src/sim/run/whatIfState';
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

vi.mock('../../src/sim/run/whatIfState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/sim/run/whatIfState')>();
  return {
    ...actual,
    computeWhatIfState: mockModules.computeWhatIfState,
  };
});

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

const directRoster: RosterState = {
  members: [
    {
      id: 'm1',
      name: 'Direct Coder',
      rank: 'senior',
      level: 2,
      xp: 0,
      stats: { implementation: 60, review: 80, aiMastery: 40 },
      stamina: 10,
      staminaMax: 10,
      traits: [],
      assignment: 'coding',
      aiAssigned: true,
      onLeave: false,
    },
    {
      id: 'm2',
      name: 'Direct Reviewer',
      rank: 'middle',
      level: 1,
      xp: 0,
      stats: { implementation: 35, review: 70, aiMastery: 20 },
      stamina: 9,
      staminaMax: 9,
      traits: [],
      assignment: 'review',
      aiAssigned: false,
      onLeave: false,
    },
  ],
  nextId: 2,
};

function emptyRunTotals() {
  return {
    delivered: 0,
    done: 0,
    rework: 0,
    incidents: 0,
    contained: 0,
    spread: 0,
    aiAssisted: 0,
    completed: 0,
    reviewQueuePeak: 0,
    maxCombo: 0,
    consecutiveIncidentSprints: 0,
  };
}

function directWhatIfInput(overrides: Partial<WhatIfComputeInput> = {}): WhatIfComputeInput {
  const base: WhatIfComputeInput = {
    phase: 'draft',
    seed: 'what-if-direct',
    quarterNumber: 2,
    sprintIndexInQuarter: 1,
    sprintsPerQuarter: 4,
    pendingSprintKind: 'elite',
    pendingSprintModifiers: {
      reviewLoadAdd: 2,
      reworkRateAdd: 0.15,
      taskCountMul: 1.5,
      focusMaxAdd: -1,
    },
    deck: [
      { defId: 'docs', level: 1 },
      { defId: 'auto-test', level: 2 },
    ],
    draft: ['copilot', 'auto-test'],
    roster: structuredClone(directRoster),
    org: {
      aiEnabled: true,
      aiDependency: 22,
      aiLiteracy: 30,
      testCoverage: 45,
      documentation: 35,
      quality: 50,
      morale: 55,
      seniorHp: 40,
      techDebt: 6,
      deliveryScore: 0,
    },
    budget: 30,
    totals: emptyRunTotals(),
    relics: [],
    evolution: { points: 0, unlocked: {} },
    difficulty: 'normal',
    trials: [],
    bossId: 'legacy-monolith',
    pauseAiDebuffQuarter: null,
    baseConfig: {
      taskCount: 4,
      codingSlots: 1,
      focusMax: 3,
      maxTicks: 1_000,
    },
    teamReviewQueue: 4,
    teamIncidents: 2,
  };
  return {
    ...base,
    ...overrides,
    pendingSprintModifiers: overrides.pendingSprintModifiers ?? { ...base.pendingSprintModifiers },
    deck: overrides.deck ?? base.deck.map((card) => ({ ...card })),
    draft: overrides.draft === undefined ? [...base.draft!] : overrides.draft,
    roster: overrides.roster ?? structuredClone(base.roster),
    org: overrides.org ?? { ...base.org },
    totals: overrides.totals ?? { ...base.totals },
    relics: overrides.relics ?? [...base.relics],
    evolution: overrides.evolution ?? {
      points: base.evolution.points,
      unlocked: { ...base.evolution.unlocked },
    },
    trials: overrides.trials ?? [...base.trials],
    baseConfig: overrides.baseConfig ?? { ...base.baseConfig },
  };
}

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
