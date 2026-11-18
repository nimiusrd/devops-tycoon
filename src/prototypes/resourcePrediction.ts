/** RI-277: 実RunEngineの最初の1スプリントを使う、通常UI/保存から隔離した練習API。 */
import { ACTION_IDS } from '../data/actionIds';
import {
  BALANCE_RULESET_FINGERPRINT,
  BALANCE_RULESET_VERSION,
  canonicalizeJson,
} from '../data/balance';
import { FIXED_STEP_MS } from '../data/balance/pacing';
import { RunEngine } from '../sim/run/engine';
import type { CounterfactualFrame } from '../sim/run/persist';
import type { RunState } from '../sim/run/types';
import type { ActionId } from '../sim/types';
import { createRngFromState, getRngState } from '../sim/rng';
import { stepSprint } from '../sim/sprint';

const RULESET = {
  prototype: 'ri277-resource-prediction-v1',
  balanceVersion: BALANCE_RULESET_VERSION,
  balanceFingerprint: BALANCE_RULESET_FINGERPRINT,
};
export const RESOURCE_PREDICTION_LIMITS = {
  inputs: 2048,
  observations: 2048,
  ticks: 1600,
  tasks: 1000,
  seedCharacters: 80,
  jsonCharacters: 2_000_000,
  depth: 48,
  nodes: 250_000,
  arrayItems: 5000,
  stringCharacters: 16_000,
} as const;
const THRESHOLDS = {
  reviewQueueAtLeast: 8,
  seniorHpAtMost: 35,
  deliveryAtTick: 60,
  deliveryBelow: 100,
};
const CHOICES = ['reviewQueue', 'seniorHp', 'deliveryLag', 'none'] as const;
export type ResourcePrediction = (typeof CHOICES)[number];
export type PredictionSource = 'self' | 'system-what-if' | 'unknown';
export type ResourceCommand =
  | { type: 'predict' | 'change'; choice: ResourcePrediction; source: PredictionSource }
  | { type: 'skip' }
  | { type: 'begin' }
  | { type: 'step' }
  | { type: 'intervene'; id: ActionId };
export interface ResourceInput {
  revision: number;
  command: ResourceCommand;
}
export interface ResourceObservation {
  index: number;
  revision: number;
  /** 処理済みtick数。最初のstepSprint(tick=0)の直後は1。 */
  tick: number;
  cause: 'begin' | 'step' | 'intervene';
  budget: number;
  focus: number;
  seniorHp: number;
  morale: number;
  techDebt: number;
  aiDependency: number;
  reviewQueue: number;
  delivered: number;
  focusSpent: number;
  complete: boolean;
}
interface Decision {
  choice: ResourcePrediction | 'skip';
  source: PredictionSource | null;
  revision: number;
  tick: number | null;
  observationIndex: number | null;
}

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) =>
  Object.keys(v).length === names.length &&
  names.every((name) => Object.prototype.hasOwnProperty.call(v, name));
const seedValid = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= RESOURCE_PREDICTION_LIMITS.seedCharacters;

function validCommand(v: unknown): v is ResourceCommand {
  if (!object(v)) return false;
  switch (v.type) {
    case 'predict':
    case 'change':
      return (
        keys(v, ['type', 'choice', 'source']) &&
        CHOICES.some((choice) => choice === v.choice) &&
        ['self', 'system-what-if', 'unknown'].some((source) => source === v.source)
      );
    case 'skip':
    case 'begin':
    case 'step':
      return keys(v, ['type']);
    case 'intervene':
      return keys(v, ['type', 'id']) && ACTION_IDS.some((id) => id === v.id);
    default:
      return false;
  }
}

function dangers(sample: ResourceObservation): Exclude<ResourcePrediction, 'none'>[] {
  const result: Exclude<ResourcePrediction, 'none'>[] = [];
  if (sample.reviewQueue >= THRESHOLDS.reviewQueueAtLeast) result.push('reviewQueue');
  if (sample.seniorHp <= THRESHOLDS.seniorHpAtMost) result.push('seniorHp');
  if (sample.tick >= THRESHOLDS.deliveryAtTick && sample.delivered < THRESHOLDS.deliveryBelow)
    result.push('deliveryLag');
  return result;
}

/** 観測事実だけの集計。最小の観測indexが同じ指標を同時成立として返す。 */
export function summarizeResourceObservations(samples: readonly ResourceObservation[]) {
  const first = {
    reviewQueue: null as { tick: number; observationIndex: number } | null,
    seniorHp: null as { tick: number; observationIndex: number } | null,
    deliveryLag: null as { tick: number; observationIndex: number } | null,
  };
  for (const sample of samples) {
    for (const metric of dangers(sample))
      first[metric] ??= { tick: sample.tick, observationIndex: sample.index };
  }
  const earliestIndex = Math.min(
    ...Object.values(first).map((x) => x?.observationIndex ?? Infinity),
  );
  const earliest = (Object.keys(first) as (keyof typeof first)[]).filter(
    (metric) => first[metric]?.observationIndex === earliestIndex,
  );
  return { first, earliest, noCrisis: earliest.length === 0 };
}

export function resourcePredictionDefinition() {
  return {
    id: 'RI-277-first-normal-sprint',
    ruleset: { ...RULESET },
    difficulty: 'normal',
    scenario: 'default',
    trials: [],
    thresholds: { ...THRESHOLDS },
    choices: [...CHOICES],
    stepMs: FIXED_STEP_MS,
    limits: { ...RESOURCE_PREDICTION_LIMITS },
    rewardEligible: false,
    learningEvidence: false,
  };
}

export class ResourcePredictionPractice {
  private readonly engine: RunEngine;
  private readonly initial: RunState;
  private phase: 'ready' | 'running' | 'complete' = 'ready';
  private inputs: ResourceInput[] = [];
  private original: Decision | null = null;
  private changes: Decision[] = [];
  private observations: ResourceObservation[] = [];
  /** 終端exportがRNGを落とす場合も、最後の生存フレームを明示して保持する。 */
  private lastLiveFrame: CounterfactualFrame;
  private sprintRngState: number;

  constructor(private readonly seed: string) {
    if (!seedValid(seed)) throw new Error('invalid seed');
    this.engine = new RunEngine({ seed, difficulty: 'normal' });
    this.engine.startRun();
    this.initial = this.engine.snapshot();
    this.lastLiveFrame = this.engine.exportCounterfactualFrame()!;
    this.sprintRngState = this.lastLiveFrame.sprintRngState;
  }

  view() {
    return structuredClone({
      phase: this.phase,
      revision: this.inputs.length,
      definition: resourcePredictionDefinition(),
      initial: this.initial,
      state: this.engine.snapshot(),
      original: this.original,
      changes: this.changes,
      observations: this.observations,
      // 途中の観測は読めるが、答え合わせはスプリントの実終了後だけ。
      comparison: this.phase === 'complete' ? this.comparison() : null,
    });
  }

  private comparison() {
    const result = summarizeResourceObservations(this.observations);
    const correct = (decision: Decision | null) =>
      !decision || decision.choice === 'skip'
        ? null
        : decision.choice === 'none'
          ? result.noCrisis
          : result.earliest.includes(decision.choice);
    return {
      ...result,
      originalCorrect: correct(this.original),
      latestCorrect: correct(this.changes[this.changes.length - 1] ?? this.original),
      /** 自己申告のsourceも学習効果の実証にはしない。 */
      learningEvidence: false,
    };
  }

  apply(input: unknown): boolean {
    if (
      !object(input) ||
      !keys(input, ['revision', 'command']) ||
      input.revision !== this.inputs.length ||
      !validCommand(input.command) ||
      this.inputs.length >= RESOURCE_PREDICTION_LIMITS.inputs ||
      this.phase === 'complete'
    )
      return false;
    const command = structuredClone(input.command);
    const revision = this.inputs.length;
    const state = this.engine.snapshot();
    if (command.type === 'predict' || command.type === 'skip' || command.type === 'change') {
      if (command.type === 'change' ? !this.original : this.phase !== 'ready' || this.original)
        return false;
      const decision: Decision = {
        choice: command.type === 'skip' ? 'skip' : command.choice,
        source: command.type === 'skip' ? null : command.source,
        revision,
        tick: this.phase === 'ready' ? null : state.sprintTick,
        observationIndex: this.observations[this.observations.length - 1]?.index ?? null,
      };
      const latest = this.changes[this.changes.length - 1] ?? this.original;
      if (latest?.choice === decision.choice && latest.source === decision.source) return false;
      if (command.type === 'change') this.changes.push(decision);
      else this.original = decision;
    } else {
      if (this.observations.length >= RESOURCE_PREDICTION_LIMITS.observations) return false;
      if (command.type === 'begin') {
        if (this.phase !== 'ready' || !this.original) return false;
        this.engine.beginSetupSprint();
        this.phase = 'running';
        const sprint = this.engine.snapshot().sprint!;
        // 固定盤面の契約。BALANCE更新で外れる場合は試作rulesetを見直す。
        if (
          sprint.tasks.length > RESOURCE_PREDICTION_LIMITS.tasks ||
          sprint.config.maxTicks + 1 > RESOURCE_PREDICTION_LIMITS.ticks
        )
          throw new Error('fixed exercise exceeds limits');
      } else {
        if (this.phase !== 'running') return false;
        switch (command.type) {
          case 'step':
            if (state.sprintTick >= RESOURCE_PREDICTION_LIMITS.ticks) return false;
            this.engine.step(FIXED_STEP_MS);
            break;
          case 'intervene':
            if (!this.engine.dispatch(command.id).ok) return false;
            break;
        }
      }
      const after = this.engine.snapshot();
      const sprint = after.sprint!;
      this.observations.push({
        index: this.observations.length,
        revision,
        tick: after.sprintTick,
        cause: command.type,
        budget: after.budget,
        focus: sprint.focus,
        seniorHp: after.org.seniorHp,
        morale: after.org.morale,
        techDebt: after.org.techDebt,
        aiDependency: after.org.aiDependency,
        reviewQueue: sprint.tasks.filter((task) => task.lane === 'review').length,
        delivered: sprint.metrics.delivered,
        focusSpent: sprint.metrics.focusSpent,
        complete: sprint.complete,
      });
      if (after.phase !== 'sprint' || after.status !== 'playing') this.phase = 'complete';
      const liveFrame = this.engine.exportCounterfactualFrame();
      if (liveFrame) {
        this.lastLiveFrame = liveFrame;
        this.sprintRngState = liveFrame.sprintRngState;
      } else if (command.type === 'step') {
        // RunEngineはlostでcounterfactual exportを止める。直前の実フレームから
        // 最後の1tickだけ実simで再実行し、終端で失われるRNG位置を観測する。
        const frame = this.lastLiveFrame;
        const rng = createRngFromState(frame.sprintRngState);
        const copy = structuredClone(frame.sprint!);
        stepSprint(copy, structuredClone(frame.persist.org), rng, frame.sprintTick);
        if (canonicalizeJson(copy) !== canonicalizeJson(after.sprint))
          throw new Error('terminal tick mismatch');
        this.sprintRngState = getRngState(rng);
      }
    }
    this.inputs.push({ revision, command });
    return true;
  }

  /** 署名/真正性証明ではない。入力列から再実行して全観測・資源・RNGを照合する。 */
  save(): string {
    const json = JSON.stringify({
      kind: 'resource-prediction-prototype',
      version: 1,
      ruleset: RULESET,
      seed: this.seed,
      inputs: this.inputs,
      checkpoint: {
        phase: this.phase,
        original: this.original,
        changes: this.changes,
        observations: this.observations,
        frame: this.engine.exportCounterfactualFrame() ?? this.engine.exportReplayFrame(),
        lastLiveFrame: this.lastLiveFrame,
        sprintRngState: this.sprintRngState,
        state: this.engine.snapshot(),
        comparison: this.phase === 'complete' ? this.comparison() : null,
      },
    });
    if (json.length > RESOURCE_PREDICTION_LIMITS.jsonCharacters) throw new Error('save limit');
    return json;
  }

  static restore(json: unknown): ResourcePredictionPractice | null {
    try {
      if (typeof json !== 'string' || json.length > RESOURCE_PREDICTION_LIMITS.jsonCharacters)
        return null;
      const raw: unknown = JSON.parse(json);
      if (
        !bounded(raw) ||
        !object(raw) ||
        !keys(raw, ['kind', 'version', 'ruleset', 'seed', 'inputs', 'checkpoint']) ||
        raw.kind !== 'resource-prediction-prototype' ||
        raw.version !== 1 ||
        canonicalizeJson(raw.ruleset) !== canonicalizeJson(RULESET) ||
        !seedValid(raw.seed) ||
        !Array.isArray(raw.inputs) ||
        raw.inputs.length > RESOURCE_PREDICTION_LIMITS.inputs
      )
        return null;
      const practice = new ResourcePredictionPractice(raw.seed);
      for (const input of raw.inputs) if (!practice.apply(input)) return null;
      return canonicalizeJson(JSON.parse(practice.save())) === canonicalizeJson(raw)
        ? practice
        : null;
    } catch {
      return null;
    }
  }
}

function bounded(
  v: unknown,
  depth = 0,
  budget = { remaining: RESOURCE_PREDICTION_LIMITS.nodes as number },
): boolean {
  if (depth > RESOURCE_PREDICTION_LIMITS.depth || --budget.remaining < 0) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length <= RESOURCE_PREDICTION_LIMITS.stringCharacters;
  if (Array.isArray(v))
    return (
      v.length <= RESOURCE_PREDICTION_LIMITS.arrayItems &&
      v.every((x) => bounded(x, depth + 1, budget))
    );
  if (object(v))
    return Object.entries(v).every(
      ([k, x]) =>
        (k !== 'tasks' || !Array.isArray(x) || x.length <= RESOURCE_PREDICTION_LIMITS.tasks) &&
        (k !== 'observations' ||
          !Array.isArray(x) ||
          x.length <= RESOURCE_PREDICTION_LIMITS.observations) &&
        bounded(k, depth + 1, budget) &&
        bounded(x, depth + 1, budget),
    );
  return true;
}
