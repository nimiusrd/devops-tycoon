/** RI-270: 固定仕事を2ビルドで独立操作する試作。通常ラン・保存・報酬へ接続しない。 */
import { BALANCE_RULESET_FINGERPRINT, BALANCE_RULESET_VERSION } from '../data/balance';
import { canonicalizeJson } from '../data/balance/canonical';
import { getCard } from '../data/cards';
import { ALL_ACTION_IDS, applyAction } from '../sim/actions';
import { playCardFromHand, playCost } from '../sim/cards';
import { createOrgState } from '../sim/org';
import { createRng, createRngFromState, getRngState } from '../sim/rng';
import { createSprint, resolveSprintConfig, stepSprint, summarizeSprint } from '../sim/sprint';
import type { ActionId, ActionTarget, CardInstance, Lane } from '../sim/types';

export const BUILD_LAB_LIMITS = {
  tasks: 24,
  ticks: 360,
  ticksPerCommand: 120,
  commandsPerSide: 1024,
  seedCharacters: 128,
  saveBytes: 1_000_000,
} as const;
const SIDES = ['coding', 'verification'] as const;
export type BuildSide = (typeof SIDES)[number];
const BUILDS = { coding: 'claude-code', verification: 'auto-test' } as const;
const LANES: readonly Lane[] = ['backlog', 'coding', 'review', 'rework', 'done'];
const RULESET = {
  prototype: 'ri270-build-laboratory-v1',
  balanceVersion: BALANCE_RULESET_VERSION,
  balanceFingerprint: BALANCE_RULESET_FINGERPRINT,
};
export interface BuildLabConfig {
  seed: string;
  maxTicks: number;
  budget: number;
}
export type BuildLabInput =
  { type: 'start' } | { type: 'intervene'; id: ActionId; target?: ActionTarget };
type Command = BuildLabInput | { type: 'advance'; ticks: number };

function object(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => descriptor.enumerable && 'value' in descriptor,
    )
  );
}
function keys(value: Record<string, unknown>, names: string[]) {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && names.includes(key));
}
function same(a: unknown, b: unknown) {
  return canonicalizeJson(a) === canonicalizeJson(b);
}
function integer(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}
function configOf(value: unknown): BuildLabConfig {
  if (
    !object(value) ||
    !keys(value, ['seed', 'maxTicks', 'budget']) ||
    typeof value.seed !== 'string' ||
    value.seed.length < 1 ||
    value.seed.length > BUILD_LAB_LIMITS.seedCharacters ||
    !integer(value.maxTicks, 1, BUILD_LAB_LIMITS.ticks) ||
    !integer(value.budget, 0, 1000)
  )
    throw new Error('invalid-config');
  return { seed: value.seed, maxTicks: value.maxTicks, budget: value.budget };
}
function validInput(value: unknown): value is BuildLabInput {
  if (!object(value)) return false;
  if (value.type === 'start') return keys(value, ['type']);
  if (
    value.type !== 'intervene' ||
    !keys(value, ['type', 'id', 'target']) ||
    !ALL_ACTION_IDS.includes(value.id as ActionId)
  )
    return false;
  if (!Object.prototype.hasOwnProperty.call(value, 'target')) return true;
  const t = value.target;
  if (
    !['assignTask', 'splitPr'].includes(value.id as string) ||
    !object(t) ||
    !keys(t, ['taskId', 'lane', 'assignee']) ||
    !integer(t.taskId, 0, BUILD_LAB_LIMITS.tasks - 1)
  )
    return false;
  if (value.id === 'splitPr') return keys(t, ['taskId']);
  return (
    (!Object.prototype.hasOwnProperty.call(t, 'lane') ||
      ['backlog', 'coding', 'review'].includes(t.lane as string)) &&
    (!Object.prototype.hasOwnProperty.call(t, 'assignee') ||
      ['ai', 'senior'].includes(t.assignee as string))
  );
}
function laneCounts(tasks: { lane: Lane }[]): Record<Lane, number> {
  return Object.fromEntries(
    LANES.map((lane) => [lane, tasks.filter((t) => t.lane === lane).length]),
  ) as Record<Lane, number>;
}
function entry(config: BuildLabConfig) {
  const org = createOrgState('default', true);
  const rng = createRng(config.seed);
  const sprint = createSprint(
    resolveSprintConfig('default', {
      taskCount: BUILD_LAB_LIMITS.tasks,
      focusMax: 12,
      maxTicks: config.maxTicks,
      minCompleteTick: 0,
    }),
    org,
    rng,
  );
  // 開始fixture。架空の過去履歴ではない。seed間でも仕事のID/種別/価値を固定する。
  for (const task of sprint.tasks) {
    task.kind = (['routine', 'normal', 'complex'] as const)[task.id % 3];
    task.highValue = task.id % 6 === 5;
  }
  const initial = structuredClone({
    org,
    sprint,
    budget: config.budget,
    rngState: getRngState(rng),
  });
  return {
    initial,
    org,
    sprint,
    budget: config.budget,
    rngState: getRngState(rng),
    tick: 0,
    started: false,
    deck: [] as CardInstance[],
    commands: [] as Command[],
    investment: null as null | { card: string; budgetSpent: number; focusSpent: number },
    // 各step直前に観測。純粋な待ち時間や因果寄与の推定ではない。
    occupancy: { backlog: 0, coding: 0, review: 0, rework: 0, done: 0 },
  };
}
type Entry = ReturnType<typeof entry>;

export class BuildLaboratory {
  private readonly config: BuildLabConfig;
  private readonly runs: Record<BuildSide, Entry>;

  constructor(config: BuildLabConfig = { seed: 'RI-270', maxTicks: 180, budget: 45 }) {
    this.config = configOf(config);
    this.runs = { coding: entry(this.config), verification: entry(this.config) };
  }

  private gate(side: BuildSide) {
    if (!SIDES.includes(side)) return 'invalid-side';
    const run = this.runs[side];
    if (run.sprint.complete) return 'complete';
    if (run.commands.length >= BUILD_LAB_LIMITS.commandsPerSide) return 'limit';
    return null;
  }

  /** 拒否時は時計・RNG・資源・履歴を一切変更しない。成功時だけコピーをcommitする。 */
  act(side: BuildSide, input: unknown): { ok: boolean; reason?: string } {
    const reason = this.gate(side);
    if (reason) return { ok: false, reason };
    if (!validInput(input)) return { ok: false, reason: 'invalid-input' };
    const run = this.runs[side];
    if (input.type === 'start' && run.started) return { ok: false, reason: 'already-started' };
    if (input.type !== 'start' && !run.started) return { ok: false, reason: 'not-started' };
    const next = structuredClone(run);
    if (input.type === 'start') {
      const card = getCard(BUILDS[side])!;
      if (next.budget < card.cost) return { ok: false, reason: 'budget' };
      next.deck = [{ defId: card.id, level: 1 }];
      next.sprint.cardPiles.hand = [0];
      const outcome = playCardFromHand(next.sprint, next.org, next.deck, 0);
      if (!outcome.ok) return { ok: false, reason: outcome.reason };
      next.budget -= card.cost;
      next.started = true;
      next.investment = { card: card.id, budgetSpent: card.cost, focusSpent: outcome.focusCost! };
    } else {
      const rng = createRngFromState(next.rngState);
      const result = applyAction(input.id, next.sprint, next.org, rng, next.tick, input.target);
      if (!result.ok) return { ok: false, reason: result.reason };
      next.rngState = getRngState(rng);
    }
    next.commands.push(structuredClone(input));
    this.runs[side] = next;
    return { ok: true };
  }

  advance(side: BuildSide, ticks: number): { ok: boolean; reason?: string } {
    const reason = this.gate(side);
    if (reason) return { ok: false, reason };
    if (!integer(ticks, 1, BUILD_LAB_LIMITS.ticksPerCommand))
      return { ok: false, reason: 'invalid-ticks' };
    const run = this.runs[side];
    if (!run.started) return { ok: false, reason: 'not-started' };
    const rng = createRngFromState(run.rngState);
    for (let i = 0; i < ticks && !run.sprint.complete; i++) {
      const counts = laneCounts(run.sprint.tasks);
      for (const lane of LANES) run.occupancy[lane] += counts[lane];
      stepSprint(run.sprint, run.org, rng, ++run.tick);
    }
    run.rngState = getRngState(rng);
    run.commands.push({ type: 'advance', ticks });
    return { ok: true };
  }

  view(side: BuildSide) {
    if (!SIDES.includes(side)) throw new Error('invalid-side');
    return structuredClone(this.runs[side]);
  }

  compare() {
    const summary = (side: BuildSide) => {
      const run = this.runs[side];
      const result = summarizeSprint(run.sprint, run.org);
      const remaining = laneCounts(run.sprint.tasks);
      return {
        phase: !run.started ? 'ready' : run.sprint.complete ? 'completed' : 'running',
        tick: run.tick,
        delivered: result.delivered,
        done: result.done,
        timedOut: result.timedOut ?? false,
        remaining,
        unfinished: run.sprint.tasks.length - result.done,
        observedTaskTicks: { ...run.occupancy },
        reviewQueuePeak: result.reviewQueueMax,
        rework: result.rework,
        incidents: result.incidents,
        costs: {
          investment: structuredClone(run.investment),
          focusSpent: run.sprint.metrics.focusSpent,
          budgetRemaining: run.budget,
          focusRemaining: run.sprint.focus,
          // 回復・clamp・各処理内の相殺を含む純差分。総HP消費と呼ばない。
          seniorHpNetChange: run.org.seniorHp - run.initial.org.seniorHp,
          moraleNetChange: run.org.morale - run.initial.org.morale,
          debtNetChange: run.org.techDebt - run.initial.org.techDebt,
        },
        org: structuredClone(run.org),
        rngState: run.rngState,
      };
    };
    return {
      source: 'live-sprint-sim' as const,
      config: { ...this.config },
      ruleset: { ...RULESET },
      initial: structuredClone(this.runs.coding.initial),
      identity: {
        tasks: same(
          this.runs.coding.initial.sprint.tasks,
          this.runs.verification.initial.sprint.tasks,
        ),
        resources:
          same(this.runs.coding.initial.org, this.runs.verification.initial.org) &&
          this.runs.coding.initial.budget === this.runs.verification.initial.budget &&
          this.runs.coding.initial.sprint.focus === this.runs.verification.initial.sprint.focus,
        rng: this.runs.coding.initial.rngState === this.runs.verification.initial.rngState,
        period: same(
          this.runs.coding.initial.sprint.config,
          this.runs.verification.initial.sprint.config,
        ),
      },
      policies: Object.fromEntries(
        SIDES.map((side) => {
          const card = getCard(BUILDS[side])!;
          return [
            side,
            {
              card: card.id,
              level: 1,
              acquisitionCost: card.cost,
              playFocusCost: playCost(card.focusCost, 1),
              effects: { ...card.base },
            },
          ];
        }),
      ),
      complete: SIDES.every((side) => this.runs[side].sprint.complete),
      coding: summary('coding'),
      verification: summary('verification'),
    };
  }

  serialize(): string {
    const raw = JSON.stringify({
      schema: 1,
      ruleset: RULESET,
      config: this.config,
      runs: this.runs,
    });
    if (new TextEncoder().encode(raw).length > BUILD_LAB_LIMITS.saveBytes)
      throw new Error('save-limit');
    return raw;
  }
}

/** 成功入力列を再実行し、両側の全状態・RNG位置・観測積算を照合してから復帰する。 */
export function restoreBuildLaboratory(raw: string): BuildLaboratory {
  if (
    typeof raw !== 'string' ||
    raw.length > BUILD_LAB_LIMITS.saveBytes ||
    new TextEncoder().encode(raw).length > BUILD_LAB_LIMITS.saveBytes
  )
    throw new Error('save-limit');
  const value: unknown = JSON.parse(raw);
  if (!object(value) || value.schema !== 1 || !same(value.ruleset, RULESET) || !object(value.runs))
    throw new Error('invalid-save');
  const lab = new BuildLaboratory(configOf(value.config));
  for (const side of SIDES) {
    const saved = value.runs[side];
    if (
      !object(saved) ||
      !Array.isArray(saved.commands) ||
      saved.commands.length > BUILD_LAB_LIMITS.commandsPerSide
    )
      throw new Error('invalid-history');
    for (const command of saved.commands) {
      const result =
        object(command) &&
        command.type === 'advance' &&
        Object.keys(command).sort().join(',') === 'ticks,type'
          ? lab.advance(side, command.ticks as number)
          : lab.act(side, command);
      if (!result.ok) throw new Error('invalid-history');
    }
  }
  if (!same(value, JSON.parse(lab.serialize()))) throw new Error('checkpoint-mismatch');
  return lab;
}
