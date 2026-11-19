/** RI-272: 前任者から引き継いだ固定会社を、四半期末まで比較する隔離試作。 */
import { BALANCE_RULESET_FINGERPRINT, BALANCE_RULESET_VERSION } from '../data/balance';
import { combineEffects } from '../sim/cards';
import { getRngState } from '../sim/rng';
import { toEffects } from '../sim/run/effects';
import { createSprintFromBaselineInput } from '../sim/run/sprintBaseline';
import { stepSprint } from '../sim/sprint';
import type { OrgState, SprintConfig } from '../sim/types';

const SCENARIO_ID = 'ri272-billing-team';
const CHECKPOINT_KIND = 'inherited-company-checkpoint';
const CHECKPOINT_VERSION = 1;
const RULESET = `ri272-v1:${BALANCE_RULESET_VERSION}:${BALANCE_RULESET_FINGERPRINT}`;
const DEFAULT_SEED = 'RI-272:1';
const QUARTER = { number: 2, completedSprints: 4, totalSprints: 6 } as const;
const PREDECESSOR_NOTE =
  '請求チームは納期に間に合わせるため、自律実装の範囲を広げた。レビュー待ちが積み上がり、自動レビューを導入した。';

const INITIAL_ORG: Readonly<OrgState> = {
  aiEnabled: true,
  aiDependency: 48,
  aiLiteracy: 44,
  testCoverage: 43,
  documentation: 42,
  quality: 58,
  securityLevel: 60,
  morale: 65,
  seniorHp: 68,
  techDebt: 32,
  deliveryScore: 560,
};
const INITIAL_BUDGET = 26;
const SPRINT_CONFIG: Readonly<SprintConfig> = {
  taskCount: 34,
  codingSlots: 5,
  focusMax: 12,
  maxTicks: 95,
};
const AI_ADOPTION_SHARE = 0.7;
const AI_MASTERY_NORM = 0.4;
const BASE_EFFECTS = { seniorHpCostMul: 0.8 };
const REVIEW_AUTOMATION = { reviewEfficiencyMul: 1.2 };
const AUTONOMOUS_CODING = { codingSpeedMul: 1.25, reworkRateAdd: 0.06 };
const MIGRATION_COSTS = {
  maintain: { budget: 0, firstSprintCodingSlots: 0 },
  remove: { budget: 10, firstSprintCodingSlots: 1 },
} as const;

export type InheritedCompanyDecision = 'maintain' | 'remove';

export function previewInheritedCompany() {
  return {
    scenarioId: SCENARIO_ID,
    defaultSeed: DEFAULT_SEED,
    currentState: {
      quarter: {
        ...QUARTER,
        remainingSprints: QUARTER.totalSprints - QUARTER.completedSprints,
      },
      org: { ...INITIAL_ORG },
      budget: INITIAL_BUDGET,
      sprintConfig: { ...SPRINT_CONFIG },
      aiAdoptionShare: AI_ADOPTION_SHARE,
      aiMasteryNorm: AI_MASTERY_NORM,
      baseEffects: { ...BASE_EFFECTS },
      activePolicies: {
        reviewAutomation: { ...REVIEW_AUTOMATION },
        autonomousCoding: { ...AUTONOMOUS_CODING },
      },
    },
    fictionalHistory: PREDECESSOR_NOTE,
    decisions: {
      maintain: { ...MIGRATION_COSTS.maintain },
      remove: { ...MIGRATION_COSTS.remove },
    },
  };
}

function isDecision(value: unknown): value is InheritedCompanyDecision {
  return value === 'maintain' || value === 'remove';
}

function validSeed(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && value.trim().length > 0;
}

interface SprintOutcome {
  number: number;
  seed: string;
  config: SprintConfig;
  effects: ReturnType<typeof toEffects>;
  startOrg: OrgState;
  endOrg: OrgState;
  ticks: number;
  rngState: number;
  delivered: number;
  done: number;
  rework: number;
  incidents: number;
  spread: number;
  reviewQueuePeak: number;
  timedOut: boolean;
}

/** 独立した新規開始・再開 API。通常ランの状態や保存先を受け取らない。 */
export class InheritedCompanyRun {
  private readonly outcomes: SprintOutcome[] = [];
  private readonly budget: number;
  private readonly migrationCost: (typeof MIGRATION_COSTS)[InheritedCompanyDecision];

  private constructor(
    private readonly decision: InheritedCompanyDecision,
    private readonly seed: string,
  ) {
    this.migrationCost = MIGRATION_COSTS[decision];
    this.budget = INITIAL_BUDGET - this.migrationCost.budget;
  }

  static start(decision: InheritedCompanyDecision, seed = DEFAULT_SEED): InheritedCompanyRun {
    if (!isDecision(decision) || !validSeed(seed)) throw new Error('RI-272: invalid start input');
    return new InheritedCompanyRun(decision, seed);
  }

  advanceSprint(): boolean {
    const completed = this.outcomes.length;
    const number = QUARTER.completedSprints + completed + 1;
    if (number > QUARTER.totalSprints) return false;

    const startOrg = { ...(this.outcomes[completed - 1]?.endOrg ?? INITIAL_ORG) };
    const org = { ...startOrg };
    const seed = `${this.seed}:q${QUARTER.number}:s${number}`;
    const config = { ...SPRINT_CONFIG };
    if (completed === 0) config.codingSlots -= this.migrationCost.firstSprintCodingSlots;
    const commonEffects = combineEffects(toEffects(BASE_EFFECTS), toEffects(REVIEW_AUTOMATION));
    const effects =
      this.decision === 'maintain'
        ? combineEffects(commonEffects, toEffects(AUTONOMOUS_CODING))
        : commonEffects;
    const { sprint, rng } = createSprintFromBaselineInput(
      {
        seed,
        config,
        org,
        cardEffects: effects,
        aiAdoptionShare: AI_ADOPTION_SHARE,
        aiMasteryNorm: AI_MASTERY_NORM,
      },
      org,
    );
    let tick = 0;
    while (!sprint.complete && tick <= config.maxTicks) {
      stepSprint(sprint, org, rng, tick);
      tick += 1;
    }
    if (!sprint.complete) throw new Error('RI-272: sprint exceeded its deadline');
    const metrics = sprint.metrics;
    this.outcomes.push({
      number,
      seed,
      config,
      effects,
      startOrg,
      endOrg: org,
      ticks: tick,
      rngState: getRngState(rng),
      delivered: metrics.delivered,
      done: metrics.doneCount,
      rework: metrics.reworkCount,
      incidents: metrics.incidentCount,
      spread: metrics.spread,
      reviewQueuePeak: metrics.reviewQueueMax,
      timedOut: metrics.timedOut ?? false,
    });
    return true;
  }

  snapshot() {
    return {
      scenarioId: SCENARIO_ID,
      decision: this.decision,
      seed: this.seed,
      budget: this.budget,
      migrationCost: { ...this.migrationCost },
      rewardsEligible: false as const,
      outcomes: structuredClone(this.outcomes),
    };
  }

  /** 保存するのは入力と進行位置。任意の会社状態は取り込まない。 */
  checkpoint(): string {
    return JSON.stringify({
      kind: CHECKPOINT_KIND,
      version: CHECKPOINT_VERSION,
      ruleset: RULESET,
      scenarioId: SCENARIO_ID,
      seed: this.seed,
      decision: this.decision,
      completedSprints: this.outcomes.length,
    });
  }

  static resume(raw: string): InheritedCompanyRun | null {
    if (typeof raw !== 'string' || raw.length > 1024) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const { kind, version, ruleset, scenarioId, seed, decision, completedSprints } =
      parsed as Record<string, unknown>;
    if (
      Object.keys(parsed).length !== 7 ||
      kind !== CHECKPOINT_KIND ||
      version !== CHECKPOINT_VERSION ||
      ruleset !== RULESET ||
      scenarioId !== SCENARIO_ID ||
      !validSeed(seed) ||
      !isDecision(decision) ||
      typeof completedSprints !== 'number' ||
      !Number.isInteger(completedSprints) ||
      completedSprints < 0 ||
      completedSprints > QUARTER.totalSprints - QUARTER.completedSprints
    )
      return null;
    const run = InheritedCompanyRun.start(decision, seed);
    for (let i = 0; i < completedSprints; i++) run.advanceSprint();
    return run;
  }
}
