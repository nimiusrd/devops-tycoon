import { describe, expect, it } from 'vitest';
import { getCard } from '../../../src/data/cards';
import { dealHand, scaleEffects } from '../../../src/sim/cards';
import { AI_DEPENDENCY_CAP, AI_LITERACY_UNSAFE_CAP, TECH_DEBT_CAP } from '../../../src/sim/outcome';
import { createRng } from '../../../src/sim/rng';
import { RunEngine } from '../../../src/sim/run/engine';
import { previewNextSprint } from '../../../src/sim/run/whatIf';
import {
  computeWhatIfState,
  whatIfCacheKey,
  type WhatIfComputeInput,
} from '../../../src/sim/run/whatIfState';
import type { SprintBaselineInput } from '../../../src/sim/run/sprintBaseline';
import { directWhatIfInput } from '../helpers/whatIfFixtures';

const input: SprintBaselineInput = {
  seed: 'what-if-unit',
  config: {
    taskCount: 12,
    codingSlots: 2,
    focusMax: 3,
    maxTicks: 1_000,
  },
  org: {
    aiEnabled: true,
    aiDependency: 20,
    aiLiteracy: 45,
    testCoverage: 45,
    documentation: 35,
    quality: 50,
    securityLevel: 60,
    morale: 60,
    seniorHp: 80,
    techDebt: 10,
    deliveryScore: 0,
  },
  cardEffects: {
    codingSpeedMul: 1,
    routineSpeedMul: 1,
    reviewEfficiencyMul: 1,
    reviewCapacityMul: 1,
    seniorHpCostMul: 1,
    reviewHpCostMul: 1,
    reworkRateAdd: 0,
    incidentRateMul: 1,
    aiLiteracyAdd: 0,
    aiDependencyAdd: 0,
    qualityAdd: 0,
    testCoverageAdd: 0,
    securityAdd: 0,
    infraCostMul: 1,
  },
  aiAdoptionShare: 0.5,
};

describe('RI-46 次スプリント what-if 試算', () => {
  it('同じ入力は期待値・観測レンジを決定論的に返す', () => {
    expect(previewNextSprint(input, 12)).toEqual(previewNextSprint(input, 12));
  });

  it('カード効果を加えた候補は別の試算結果になる', () => {
    const card = getCard('auto-test');
    expect(card).toBeDefined();
    const withCard = {
      ...input,
      cardEffects: { ...input.cardEffects, ...scaleEffects(card!.base, 1) },
    };

    expect(previewNextSprint(withCard, 24)).not.toEqual(previewNextSprint(input, 24));
  });

  it('不正な試行数を拒否する', () => {
    expect(() => previewNextSprint(input, 0)).toThrow('trials は 1 以上の整数');
  });

  it('ドラフト候補の試算は実ラン状態を変更せず、候補別に公開する', () => {
    const engine = new RunEngine({ seed: 'what-if-engine', difficulty: 'normal' });
    engine.startRun();
    const internals = engine as unknown as { phase: string; draft: string[] | null };
    internals.phase = 'draft';
    internals.draft = ['copilot', 'auto-test'];

    const beforeEngine = engine as unknown as { org: unknown; deck: unknown; roster: unknown };
    const before = {
      org: structuredClone(beforeEngine.org),
      deck: structuredClone(beforeEngine.deck),
      roster: structuredClone(beforeEngine.roster),
    };
    const whatIf = engine.whatIfPreview();
    const after = engine as unknown as { org: unknown; deck: unknown; roster: unknown };

    expect(engine.snapshot().whatIf).toBeNull();
    expect(whatIf?.current.trials).toBe(24);
    expect(whatIf?.draftCandidates.copilot).toBeDefined();
    expect(whatIf?.draftCandidates['auto-test']).toBeDefined();
    expect(after.org).toEqual(before.org);
    expect(after.deck).toEqual(before.deck);
    expect(after.roster).toEqual(before.roster);
  });

  it('ドラフト試算は入り込みの集中力ペナルティを modifiers として引き継ぐ', () => {
    const engine = new RunEngine({ seed: 'what-if-focus-penalty', difficulty: 'normal' });
    engine.startRun();
    const internals = engine as unknown as {
      phase: string;
      draft: string[] | null;
      pendingSprintModifiers: { focusMaxAdd?: number };
    };
    internals.phase = 'draft';
    internals.draft = ['copilot'];
    internals.pendingSprintModifiers = { focusMaxAdd: -2 };
    const draftInput = engine.whatIfComputeInput();
    expect(draftInput?.phase).toBe('draft');
    expect(draftInput?.pendingSprintModifiers.focusMaxAdd).toBe(-2);
    // キャッシュ指紋にも focusMaxAdd を含め、試算条件の取りこぼしを防ぐ。
    const withPenalty = whatIfCacheKey(draftInput!);
    const without = whatIfCacheKey({ ...draftInput!, pendingSprintModifiers: {} });
    expect(withPenalty).not.toBe(without);
  });

  it('what-if 入力に選択中チームの行列・炎上を含めキャッシュ指紋にも載せる', () => {
    const engine = new RunEngine({ seed: 'what-if-board-pressure', difficulty: 'normal' });
    engine.startRun();
    const persist = engine.exportPersistState()!;
    const teams = persist.extras.teams!.map((t) =>
      t.id === persist.extras.activeTeamId ? { ...t, reviewQueue: 7, incidents: 3 } : t,
    );
    persist.extras.teams = teams;
    engine.hydratePersistState(persist);
    const internals = engine as unknown as { phase: string };
    internals.phase = 'setup';
    const input = engine.whatIfComputeInput();
    expect(input?.teamReviewQueue).toBe(7);
    expect(input?.teamIncidents).toBe(3);
    const keyed = whatIfCacheKey(input!);
    const cleared = whatIfCacheKey({ ...input!, teamReviewQueue: 0, teamIncidents: 0 });
    expect(keyed).not.toBe(cleared);
  });

  it('what-if キャッシュ指紋はチーム固有の org / 編成能力も区別する', () => {
    const engine = new RunEngine({ seed: 'what-if-team-fingerprint', difficulty: 'normal' });
    engine.startRun();
    const internals = engine as unknown as { phase: string };
    internals.phase = 'setup';
    const base = engine.whatIfComputeInput()!;
    const orgKey = whatIfCacheKey({
      ...base,
      org: { ...base.org, testCoverage: base.org.testCoverage + 12, aiLiteracy: 10 },
    });
    expect(orgKey).not.toBe(whatIfCacheKey(base));
    const member = base.roster.members[0]!;
    const rosterKey = whatIfCacheKey({
      ...base,
      roster: {
        ...base.roster,
        members: [
          {
            ...member,
            stats: {
              ...member.stats,
              implementation: member.stats.implementation + 5,
            },
          },
          ...base.roster.members.slice(1),
        ],
      },
    });
    expect(rosterKey).not.toBe(whatIfCacheKey(base));
  });

  it('発動すると敗北するドラフト候補は loseOnPlay で警告する（獲得時は即時敗北にしない）', () => {
    const engine = new RunEngine({ seed: 'what-if-lose', difficulty: 'nightmare' });
    engine.startRun();
    const internals = engine as unknown as {
      phase: string;
      draft: string[] | null;
      org: { aiDependency: number; aiLiteracy: number };
    };
    internals.org.aiDependency = AI_DEPENDENCY_CAP - 5;
    internals.org.aiLiteracy = AI_LITERACY_UNSAFE_CAP;
    internals.phase = 'draft';
    internals.draft = ['copilot', 'auto-test'];

    const whatIf = engine.whatIfPreview();
    expect(whatIf?.draftCandidates.copilot?.loseOnPlay).toBe('aiDependency');
    expect(whatIf?.draftCandidates.copilot?.immediateLose).toBeUndefined();
    expect(whatIf?.draftCandidates.copilot?.trials).toBe(0);
    expect(whatIf?.draftCandidates['auto-test']?.loseOnPlay).toBeUndefined();
    expect(whatIf?.draftCandidates['auto-test']?.trials).toBe(24);
  });

  it('RI-83: loseOnPlay 判定にも目標修正の org キャリーオーバーを含める', () => {
    // Tech Debt が CAP ちょうどのとき、quality_pivot の -4/スプリント無しだと
    // 手札入り候補が誤って loseOnPlay: techDebt になる。
    const engine = new RunEngine({ seed: 'what-if-goal-carry-lose', difficulty: 'easy' });
    engine.startRun();
    const internals = engine as unknown as {
      phase: string;
      draft: string[] | null;
      org: { techDebt: number };
      quarterNumber: number;
      goalCarryoverQuarter: number | null;
      goalCarryoverId: string | null;
    };
    internals.org.techDebt = TECH_DEBT_CAP;
    internals.goalCarryoverQuarter = internals.quarterNumber;
    internals.goalCarryoverId = 'quality_pivot';
    internals.phase = 'draft';
    internals.draft = ['docs'];

    const whatIf = engine.whatIfPreview();
    expect(whatIf?.current.immediateLose).toBeUndefined();
    expect(whatIf?.draftCandidates.docs?.loseOnPlay).toBeUndefined();
    expect(whatIf?.draftCandidates.docs?.trials).toBeGreaterThan(0);
  });

  it('loseOnPlay は試練の開始時ドリフト後に判定する', () => {
    // Copilot +5 だけでは CAP 未満だが、frontier-dependency の +5 ドリフト後に発動すると超える。
    const engine = new RunEngine({
      seed: 'what-if-drift',
      difficulty: 'normal',
      trials: ['frontier-dependency'],
    });
    engine.startRun();
    const internals = engine as unknown as {
      phase: string;
      draft: string[] | null;
      org: { aiDependency: number; aiLiteracy: number };
    };
    internals.org.aiDependency = AI_DEPENDENCY_CAP - 9; // 86: +5 ドリフト → 91、+5 カード → 96
    internals.org.aiLiteracy = AI_LITERACY_UNSAFE_CAP;
    internals.phase = 'draft';
    internals.draft = ['copilot', 'docs'];

    const whatIf = engine.whatIfPreview();
    expect(whatIf?.draftCandidates.copilot?.loseOnPlay).toBe('aiDependency');
    // docs は依存加算なしなので、ドリフト後でも CAP 未満なら警告なし。
    expect(whatIf?.draftCandidates.docs?.loseOnPlay).toBeUndefined();
    expect(whatIf?.draftCandidates.docs?.trials).toBe(24);
  });

  it('試練コストだけで予算が尽きる場合は immediateLose で警告する', () => {
    const engine = new RunEngine({
      seed: 'what-if-budget-pressure',
      difficulty: 'nightmare',
      trials: ['frontier-dependency'],
    });
    engine.startRun();
    const internals = engine as unknown as {
      phase: string;
      draft: string[] | null;
      budget: number;
      org: { aiDependency: number; aiLiteracy: number };
      teams: Array<{ aiDependency: number }>;
    };
    // 選択中 30・他チーム 25 → 全社平均 ≈26、毎スプ上乗せ ceil(26 * 0.04)=2 で予算尽き。
    internals.budget = 2;
    internals.org.aiDependency = 25;
    for (const t of internals.teams) t.aiDependency = 25;
    internals.org.aiLiteracy = 40;
    internals.phase = 'draft';
    internals.draft = ['docs'];

    const whatIf = engine.whatIfPreview();
    expect(whatIf?.current.immediateLose).toBe('budgetExhausted');
    expect(whatIf?.draftCandidates.docs?.immediateLose).toBe('budgetExhausted');
    expect(whatIf?.draftCandidates.docs?.loseOnPlay).toBeUndefined();
  });

  it('予算だけ変わっても what-if キャッシュは再計算される', () => {
    const engine = new RunEngine({
      seed: 'what-if-budget-cache',
      difficulty: 'nightmare',
      trials: ['frontier-dependency'],
    });
    engine.startRun();
    const internals = engine as unknown as {
      phase: string;
      draft: string[] | null;
      budget: number;
      org: { aiDependency: number; aiLiteracy: number };
      teams: Array<{ aiDependency: number }>;
    };
    internals.org.aiDependency = 25;
    for (const t of internals.teams) t.aiDependency = 25;
    internals.org.aiLiteracy = 40;
    internals.phase = 'draft';
    internals.draft = ['docs'];
    internals.budget = 10;

    expect(engine.whatIfPreview()?.draftCandidates.docs?.immediateLose).toBeUndefined();

    internals.budget = 2;
    expect(engine.whatIfPreview()?.draftCandidates.docs?.immediateLose).toBe('budgetExhausted');
  });

  it('RI-88: what-if のインフラ課金は選択中ではなく全社平均依存度を使う', () => {
    const engine = new RunEngine({
      seed: 'what-if-company-infra',
      difficulty: 'easy',
      trials: ['frontier-dependency'],
    });
    engine.startRun();
    const internals = engine as unknown as {
      phase: string;
      draft: string[] | null;
      budget: number;
      org: { aiDependency: number };
      teams: Array<{ id: string; aiDependency: number }>;
      activeTeamId: string;
    };
    // 選択中だけ低依存でも、他チームが高依存なら全社課金で即死する。
    internals.org.aiDependency = 0;
    for (const t of internals.teams) {
      t.aiDependency = t.id === internals.activeTeamId ? 0 : 100;
    }
    internals.budget = 2;
    internals.phase = 'draft';
    internals.draft = ['docs'];

    const whatIf = engine.whatIfPreview();
    expect(whatIf?.current.immediateLose).toBe('budgetExhausted');

    // 他チームも低依存なら全社平均が下がり、同じ予算で継続可能。
    for (const t of internals.teams) t.aiDependency = 0;
    internals.org.aiDependency = 0;
    expect(engine.whatIfPreview()?.current.immediateLose).toBeUndefined();
  });

  it('手札に入らないドラフト候補は発動仮定（loseOnPlay）を付けない', () => {
    const engine = new RunEngine({ seed: 'what-if-hand-miss', difficulty: 'nightmare' });
    engine.startRun();
    const internals = engine as unknown as {
      phase: string;
      draft: string[] | null;
      deck: Array<{ defId: string; level: number }>;
      org: { aiDependency: number; aiLiteracy: number };
      sprintIndexInQuarter: number;
      quarterNumber: number;
      seed: string;
    };
    internals.org.aiDependency = AI_DEPENDENCY_CAP - 5;
    internals.org.aiLiteracy = AI_LITERACY_UNSAFE_CAP;
    // HAND_SIZE=3。既存 8 枚なら新カードが手札に入らない確率が高い。
    internals.deck = Array.from({ length: 8 }, (_, i) => ({
      defId: i % 2 === 0 ? 'docs' : 'hire-senior',
      level: 1,
    }));
    internals.phase = 'draft';
    internals.draft = ['copilot'];

    // 手札に入らない seed を探す（deal と what-if は同じ式）。
    let found = false;
    for (let i = 0; i < 40; i++) {
      internals.seed = `what-if-hand-miss-${i}`;
      internals.sprintIndexInQuarter = 1;
      internals.quarterNumber = 1;
      const nextSprintId = `q1-s2`;
      const piles = dealHand(9, createRng(`${internals.seed}:deal:${nextSprintId}`));
      if (piles.hand.includes(8)) continue;
      // キャッシュを無効化するため whatIfPreview 前にキーが変わるよう seed を反映済み。
      const whatIf = engine.whatIfPreview();
      expect(whatIf?.draftCandidates.copilot?.loseOnPlay).toBeUndefined();
      expect(whatIf?.draftCandidates.copilot?.trials).toBe(24);
      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('編成変更後の setup 試算を公開する', () => {
    const engine = new RunEngine({ seed: 'what-if-formation', difficulty: 'normal' });
    engine.startRun();
    const before = engine.whatIfPreview();
    engine.assignMember('m2', 'coding');
    const after = engine.whatIfPreview();

    expect(before?.current.trials).toBe(24);
    expect(after?.current.trials).toBe(24);
    expect(after).not.toEqual(before);
  });

  it('返却した what-if を変更してもキャッシュは汚れない', () => {
    const engine = new RunEngine({ seed: 'what-if-copy', difficulty: 'normal' });
    engine.startRun();
    const first = engine.whatIfPreview();
    expect(first).not.toBeNull();
    first!.current.trials = 1;
    first!.current.delivered.max = -1;

    const second = engine.whatIfPreview();
    expect(second?.current.trials).toBe(24);
    expect(second?.current.delivered.max).toBeGreaterThanOrEqual(0);
    expect(second).not.toBe(first);
  });
});

describe('RI-72-A2 whatIfState の cache key と state 構築', () => {
  it('cache key は draft join と modifier default を含む全入力指紋を固定する', () => {
    expect(whatIfCacheKey(directWhatIfInput())).toBe(
      [
        'draft',
        'what-if-direct',
        2,
        1,
        'elite',
        'docs:1,auto-test:2',
        'copilot,auto-test',
        'm1:coding:1:0:senior:2:60:80:40:,m2:review:0:0:middle:1:35:70:20:',
        40,
        22,
        55,
        6,
        50,
        45,
        30,
        35,
        60,
        1,
        30,
        2,
        0.15,
        1.5,
        -1,
        4,
        2,
        '',
        '',
        '',
        '',
      ].join('|'),
    );

    expect(
      whatIfCacheKey(
        directWhatIfInput({
          draft: null,
          pendingSprintModifiers: {},
          teamReviewQueue: undefined,
          teamIncidents: undefined,
        }),
      ),
    ).toBe(
      [
        'draft',
        'what-if-direct',
        2,
        1,
        'elite',
        'docs:1,auto-test:2',
        '',
        'm1:coding:1:0:senior:2:60:80:40:,m2:review:0:0:middle:1:35:70:20:',
        40,
        22,
        55,
        6,
        50,
        45,
        30,
        35,
        60,
        1,
        30,
        0,
        0,
        1,
        0,
        0,
        0,
        '',
        '',
        '',
        '',
      ].join('|'),
    );
  });

  it('cache key は編成・deck・org・budget・draft 順序の差分を区別する', () => {
    const base = directWhatIfInput();
    const baseKey = whatIfCacheKey(base);
    const member = base.roster.members[0]!;

    const changedInputs: WhatIfComputeInput[] = [
      directWhatIfInput({ deck: [{ defId: 'docs', level: 2 }] }),
      directWhatIfInput({ draft: ['auto-test', 'copilot'] }),
      directWhatIfInput({ org: { ...base.org, aiEnabled: false } }),
      directWhatIfInput({ org: { ...base.org, seniorHp: 41 } }),
      directWhatIfInput({ budget: base.budget + 1 }),
      directWhatIfInput({
        roster: {
          ...base.roster,
          members: [
            {
              ...member,
              assignment: 'bench',
              aiAssigned: false,
              onLeave: true,
              rank: 'middle',
              level: member.level + 1,
              stats: {
                implementation: member.stats.implementation + 1,
                review: member.stats.review + 1,
                aiMastery: member.stats.aiMastery + 1,
              },
              traits: ['aiArtisan'],
            },
            ...base.roster.members.slice(1),
          ],
        },
      }),
    ];

    for (const changed of changedInputs) {
      expect(whatIfCacheKey(changed)).not.toBe(baseKey);
    }
  });

  it('setup では draft があっても候補を作らず、draft null でも安全に空候補を返す', () => {
    const setupState = computeWhatIfState(directWhatIfInput({ phase: 'setup' }));
    expect(setupState?.current.trials).toBe(24);
    expect(setupState?.draftCandidates).toEqual({});

    const draftlessState = computeWhatIfState(directWhatIfInput({ draft: null }));
    expect(draftlessState?.current.trials).toBe(24);
    expect(draftlessState?.draftCandidates).toEqual({});

    expect(
      computeWhatIfState(directWhatIfInput({ phase: 'sprint' as WhatIfComputeInput['phase'] })),
    ).toBeNull();
  });

  it('draft 候補は有効カードだけを評価し、獲得候補ごとの結果を公開する', () => {
    const state = computeWhatIfState(directWhatIfInput({ draft: ['missing-card', 'docs'] }));

    expect(Object.keys(state!.draftCandidates)).toEqual(['docs']);
    expect(state!.draftCandidates.docs!.trials).toBe(24);
    expect(state!.draftCandidates.docs!.delivered.mean).not.toBe(state!.current.delivered.mean);
    expect(state!.draftCandidates.docs!.loseOnPlay).toBeUndefined();
  });

  it('modifier とチーム滞留は state 構築結果に反映される', () => {
    const plain = computeWhatIfState(
      directWhatIfInput({
        pendingSprintModifiers: {},
        teamReviewQueue: 0,
        teamIncidents: 0,
      }),
    )!;
    const pressured = computeWhatIfState(directWhatIfInput())!;

    expect(pressured.current.trials).toBe(24);
    // RI-134: AI依存モデル係数確定後の golden（決定論）。securityLevel 60 で RI-87 は無効果帯。
    expect(pressured.current.delivered).toEqual({ mean: 770.25, min: 657, max: 862 });
    expect(pressured.current.spread).toEqual({
      mean: 36.458333333333336,
      min: 0,
      max: 86,
    });
    expect(pressured.current.delivered).not.toEqual(plain.current.delivered);
  });

  it('開始時敗北では current と draft 候補をゼロ試行の immediateLose にそろえる', () => {
    const state = computeWhatIfState(
      directWhatIfInput({
        draft: ['copilot', 'docs'],
        org: { ...directWhatIfInput().org, seniorHp: -98 },
      }),
    )!;

    expect(state.current).toEqual({
      trials: 0,
      delivered: { mean: 0, min: 0, max: 0 },
      spread: { mean: 0, min: 0, max: 0 },
      immediateLose: 'seniorBurnout',
    });
    expect(state.draftCandidates).toEqual({
      copilot: state.current,
      docs: state.current,
    });

    expect(
      computeWhatIfState(
        directWhatIfInput({
          draft: ['copilot'],
          org: { ...directWhatIfInput().org, seniorHp: -96 },
        }),
      )!.current.immediateLose,
    ).toBeUndefined();
  });
});
