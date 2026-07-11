import { describe, expect, it } from 'vitest';
import { getCard } from '../../src/data/cards';
import { scaleEffects } from '../../src/sim/cards';
import { AI_DEPENDENCY_CAP, AI_LITERACY_UNSAFE_CAP } from '../../src/sim/outcome';
import { RunEngine } from '../../src/sim/run/engine';
import { previewNextSprint } from '../../src/sim/run/whatIf';
import type { SprintBaselineInput } from '../../src/sim/run/sprintBaseline';

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
    reworkRateAdd: 0,
    incidentRateMul: 1,
    aiLiteracyAdd: 0,
    aiDependencyAdd: 0,
    qualityAdd: 0,
    testCoverageAdd: 0,
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

  it('即時敗北になるドラフト候補は次スプリント試算を出さない', () => {
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
    expect(whatIf?.draftCandidates.copilot?.immediateLose).toBe('aiDependency');
    expect(whatIf?.draftCandidates.copilot?.trials).toBe(0);
    expect(whatIf?.draftCandidates['auto-test']?.immediateLose).toBeUndefined();
    expect(whatIf?.draftCandidates['auto-test']?.trials).toBe(24);
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
});
