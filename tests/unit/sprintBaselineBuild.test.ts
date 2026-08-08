import { describe, expect, it } from 'vitest';
import type { Member, RosterState } from '../../src/sim/member/types';
import { createOrgState } from '../../src/sim/org';
import {
  BOSS_MAX_TICKS,
  buildSprintBaselineInput,
  type SprintBaselineBuildContext,
} from '../../src/sim/run/sprintBaselineBuild';
import type { SprintModifierDelta } from '../../src/sim/run/types';
import type { SprintConfig } from '../../src/sim/types';

const baseConfig: SprintConfig = {
  taskCount: 10,
  codingSlots: 2,
  maxTicks: 1_000,
  focusMax: 3,
};

function context(overrides: Partial<SprintBaselineBuildContext> = {}): SprintBaselineBuildContext {
  return {
    relics: [],
    evolution: { points: 0, unlocked: {} },
    difficulty: 'normal',
    trials: [],
    bossId: 'big-release',
    pauseAiDebuffQuarter: null,
    quarterNumber: 1,
    baseConfig,
    ...overrides,
  };
}

function member(overrides: Partial<Member> = {}): Member {
  const base: Member = {
    id: 'm0',
    name: 'Builder',
    rank: 'middle',
    level: 1,
    xp: 0,
    stats: { implementation: 69, review: 40, aiMastery: 50 },
    stamina: 85,
    staminaMax: 85,
    traits: [],
    assignment: 'coding',
    aiAssigned: true,
    onLeave: false,
  };
  return { ...base, ...overrides, stats: { ...base.stats, ...overrides.stats } };
}

function roster(members: Member[]): RosterState {
  return { members, nextId: members.length };
}

const balancedRoster = roster([
  member({ id: 'coder', assignment: 'coding', aiAssigned: true }),
  member({
    id: 'senior-reviewer',
    rank: 'senior',
    assignment: 'review',
    aiAssigned: false,
    stats: { implementation: 30, review: 48, aiMastery: 40 },
  }),
]);

function build(
  overrides: {
    ctx?: Partial<SprintBaselineBuildContext>;
    roster?: RosterState;
    kind?: 'normal' | 'elite' | 'boss';
    modifiers?: SprintModifierDelta;
    playedCards?: { defId: string; level: number }[];
    deck?: { defId: string; level: number }[];
  } = {},
) {
  return buildSprintBaselineInput(context(overrides.ctx), {
    deck: overrides.deck ?? [],
    roster: overrides.roster ?? balancedRoster,
    org: createOrgState('default', true),
    kind: overrides.kind ?? 'normal',
    modifiers: overrides.modifiers ?? {},
    seed: 'ri-72-e3',
    playedCards: overrides.playedCards,
  });
}

describe('buildSprintBaselineInput（RI-72-E3）', () => {
  it('スプリント種別の差分でタスク量とボス効果が変わる', () => {
    const normal = build({ kind: 'normal' });
    const elite = build({ kind: 'elite' });
    const boss = build({ kind: 'boss' });
    const incidentBoss = build({ kind: 'boss', ctx: { bossId: 'major-incident' } });

    // 通常は床、elite は床×eliteTaskMul(normal)=1.12。
    expect(normal.config.taskCount).toBe(50);
    expect(elite.config.taskCount).toBe(56);
    expect(boss.config.taskCount).toBe(58); // bossTaskFloor(normal)
    expect(incidentBoss.config.taskCount).toBe(58);
    const nightmareNormal = build({ kind: 'normal', ctx: { difficulty: 'nightmare' } });
    const nightmareElite = build({ kind: 'elite', ctx: { difficulty: 'nightmare' } });
    expect(nightmareNormal.config.taskCount).toBe(32);
    expect(nightmareElite.config.taskCount).toBe(37); // 32 * eliteTaskMul(nightmare)
    expect(boss.config.maxTicks).toBe(BOSS_MAX_TICKS);
    expect(normal.config.maxTicks).toBe(1_000);
    expect(normal.cardEffects.incidentRateMul).toBe(1);
    expect(incidentBoss.cardEffects.incidentRateMul).toBe(1.1);
  });

  it('一時 modifier の差分でタスク量・集中力・手戻り・初期レビュー負荷が変わる', () => {
    const unchanged = build();
    const modified = build({
      modifiers: {
        taskCountMul: 1.2,
        focusMaxAdd: -7,
        reworkRateAdd: 0.07,
        reviewLoadAdd: 3,
      },
    });
    const rested = build({ modifiers: { taskCountMul: 0.7 } });
    const restedBoss = build({ kind: 'boss', modifiers: { taskCountMul: 0.7 } });

    expect(unchanged.config.taskCount).toBe(50); // normalTaskFloor
    // 床の後に一時 mul を掛ける（休息の出荷機会放棄が床に吸収されない）。
    expect(modified.config.taskCount).toBe(60);
    expect(rested.config.taskCount).toBe(35);
    // ボスは休息 mul でもボス床を割り込まず、通常床より長い山場を残す。
    expect(restedBoss.config.taskCount).toBe(58);
    expect(restedBoss.config.taskCount).toBeGreaterThan(unchanged.config.taskCount);
    expect(unchanged.config.focusMax).toBe(4);
    expect(modified.config.focusMax).toBe(1);
    expect(unchanged.cardEffects.reworkRateAdd).toBe(0);
    expect(modified.cardEffects.reworkRateAdd).toBeCloseTo(0.07);
    expect(unchanged.reviewLoadAdd).toBeUndefined();
    expect(modified.reviewLoadAdd).toBe(3);
  });

  it('編成入力の差分で Coding 枠・速度・AI 採用率が変わる', () => {
    const singleCoder = build();
    const twoCoders = build({
      roster: roster([
        ...balancedRoster.members,
        member({ id: 'second-coder', assignment: 'coding', aiAssigned: false }),
      ]),
    });
    const noCoder = build({
      roster: roster([
        member({
          id: 'review-only',
          rank: 'senior',
          assignment: 'review',
          aiAssigned: false,
          stats: { implementation: 30, review: 48, aiMastery: 40 },
        }),
      ]),
    });

    expect(singleCoder.config.focusMax).toBe(4);
    expect(singleCoder.config.codingSlots).toBe(2);
    expect(singleCoder.cardEffects.codingSpeedMul).toBe(1);
    expect(singleCoder.cardEffects.reviewEfficiencyMul).toBe(1);
    expect(singleCoder.cardEffects.reviewCapacityMul).toBeCloseTo(0.98);
    expect(singleCoder.aiAdoptionShare).toBe(1);

    expect(twoCoders.config.codingSlots).toBe(3);
    expect(twoCoders.cardEffects.codingSpeedMul).toBeCloseTo(1.3);
    expect(twoCoders.aiAdoptionShare).toBe(0.5);

    expect(noCoder.config.codingSlots).toBe(0);
    expect(noCoder.cardEffects.codingSpeedMul).toBe(0.15);
    expect(noCoder.aiAdoptionShare).toBe(0);
  });

  it('発動カードだけを反映し、未発動の deck 差分では結果を変えない', () => {
    const noCards = build();
    const deckOnly = build({ deck: [{ defId: 'copilot', level: 2 }] });
    const played = build({ playedCards: [{ defId: 'copilot', level: 2 }] });

    expect(deckOnly.cardEffects).toEqual(noCards.cardEffects);
    expect(played.cardEffects.codingSpeedMul).toBeCloseTo(1.225);
    expect(played.cardEffects.routineSpeedMul).toBeCloseTo(1.45);
    expect(played.cardEffects.aiDependencyAdd).toBeCloseTo(7.5);
  });

  it('run context の差分でパッシブ・試練・進化の結果が変わる', () => {
    const base = build();
    const withContext = build({
      ctx: {
        difficulty: 'hard',
        trials: ['low-focus', 'flammable'],
        relics: ['small-pr'],
        evolution: { points: 0, unlocked: { 'culture-1': true, 'dev-2': true } },
      },
    });

    expect(base.config.focusMax).toBe(4);
    expect(withContext.config.focusMax).toBe(5);
    expect(base.config.codingSlots).toBe(2);
    expect(withContext.config.codingSlots).toBe(3);
    expect(withContext.cardEffects.reworkRateAdd).toBeCloseTo(0.05);
    expect(withContext.cardEffects.reviewEfficiencyMul).toBeCloseTo(1.058);
    expect(withContext.cardEffects.incidentRateMul).toBeCloseTo(1.3);
  });

  it('AI 一時停止デバフの四半期が一致すると Coding と routine 速度だけを下げる', () => {
    const inactive = build({ ctx: { pauseAiDebuffQuarter: 2, quarterNumber: 1 } });
    const active = build({ ctx: { pauseAiDebuffQuarter: 1, quarterNumber: 1 } });

    expect(inactive.cardEffects.codingSpeedMul).toBe(1);
    expect(inactive.cardEffects.routineSpeedMul).toBe(1);
    expect(active.cardEffects.codingSpeedMul).toBe(0.85);
    // routine には pause 倍率を載せない（定型で coding×routine の二重減算を避ける）。
    expect(active.cardEffects.routineSpeedMul).toBe(1);
    // RI-83: pause_ai は安定化サイドも乗る。
    expect(active.cardEffects.reworkRateAdd).toBeCloseTo(-0.1);
    expect(active.cardEffects.incidentRateMul).toBeCloseTo(0.7);
  });

  it('RI-83: goalCarryover は一致四半期だけ効き、IDごとに物理が分岐する', () => {
    const inactive = build({
      ctx: {
        goalCarryoverQuarter: 2,
        goalCarryoverId: 'quality_pivot',
        quarterNumber: 1,
      },
    });
    const request = build({
      ctx: {
        goalCarryoverQuarter: 1,
        goalCarryoverId: 'request_budget',
        quarterNumber: 1,
      },
    });
    const quality = build({
      ctx: {
        goalCarryoverQuarter: 1,
        goalCarryoverId: 'quality_pivot',
        quarterNumber: 1,
      },
    });

    expect(inactive.cardEffects.codingSpeedMul).toBe(request.cardEffects.codingSpeedMul / 1.08);
    expect(request.cardEffects.codingSpeedMul / inactive.cardEffects.codingSpeedMul).toBeCloseTo(
      1.08,
    );
    expect(
      request.cardEffects.reviewCapacityMul / inactive.cardEffects.reviewCapacityMul,
    ).toBeCloseTo(1.15);
    expect(quality.cardEffects.codingSpeedMul / inactive.cardEffects.codingSpeedMul).toBeCloseTo(
      0.92,
    );
    expect(quality.cardEffects.incidentRateMul / inactive.cardEffects.incidentRateMul).toBeCloseTo(
      0.75,
    );
    // qualityAdd は CardEffects ではなく org tick で適用する。
    expect(quality.cardEffects.qualityAdd).toBe(inactive.cardEffects.qualityAdd);
  });
});
