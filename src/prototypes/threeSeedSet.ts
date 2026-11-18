/** RI-275: storage / GameHandle / メタ精算へ接続しない、実RunEngineの3ランセット。 */
import { ACTION_IDS } from '../data/actionIds';
import {
  BALANCE_RULESET_FINGERPRINT,
  BALANCE_RULESET_VERSION,
  canonicalizeJson,
} from '../data/balance';
import { FIXED_STEP_MS } from '../data/balance/pacing';
import { CARD_DEFS } from '../data/cards';
import { RELIC_DEFS } from '../data/relics';
import { RunEngine } from '../sim/run/engine';
import type { CounterfactualFrame, RunReplayFrame } from '../sim/run/persist';
import type { GoalAdjustmentId, RunState } from '../sim/run/types';
import type { ActionId, OrgState, ScenarioId } from '../sim/types';

const RULESET = {
  prototype: 'ri275-three-seed-v1',
  balanceVersion: BALANCE_RULESET_VERSION,
  balanceFingerprint: BALANCE_RULESET_FINGERPRINT,
};
const CONDITIONS: readonly { seed: string; scenario: ScenarioId }[] = [
  { seed: 'RI-275:standard:1', scenario: 'default' },
  { seed: 'RI-275:copilot:2', scenario: 'copilot' },
  { seed: 'RI-275:devin:3', scenario: 'devin' },
];
const BUILDS = {
  delivery: ['copilot', 'hire-senior', 'review-bot'],
  resilient: ['auto-test', 'docs', 'pr-size-limit'],
  balanced: ['copilot', 'auto-test', 'docs'],
} as const;
export type SetBuild = keyof typeof BUILDS;
export const SET_INPUT_LIMIT = 12_000;
export const SET_SAVE_LIMIT = 4_000_000;
const ACCESS = 'local-prototype-opt-in';

type EngineCommand =
  | {
      type:
        | 'beginSprint'
        | 'ackResult'
        | 'skipDraft'
        | 'mulligan'
        | 'finishEvolution'
        | 'leaveShop'
        | 'ackQuarter';
    }
  | { type: 'step'; ms: number }
  | { type: 'dispatch'; id: ActionId }
  | { type: 'playCard' | 'exchangeCard'; index: number }
  | { type: 'chooseCard' | 'unlockEvolution' | 'buyCard'; id: string }
  | { type: 'beat'; choice: number }
  | { type: 'rest'; option: 'heal' | 'repay' }
  | { type: 'recruit'; option: 'hire' | 'skip' }
  | { type: 'adjust'; id: GoalAdjustmentId };
export type SetCommand =
  EngineCommand | { type: 'start' } | { type: 'pause' } | { type: 'resume' } | { type: 'abandon' };
export interface SetInput {
  revision: number;
  command: SetCommand;
}
type SetPhase = 'ready' | 'running' | 'paused' | 'between' | 'complete' | 'abandoned';
interface Consumption {
  budgetDecreases: number;
  budgetIncreases: number;
  focusSpent: number;
}
export interface SetRunResult {
  index: number;
  seed: string;
  scenario: ScenarioId;
  initialOrg: OrgState;
  initialBudget: number;
  consumption: Consumption;
  /** 実終端からのみ生成。WinTypeや敗因を呼び出し側から受け取らない。 */
  terminal: RunReplayFrame;
}
interface SetCheckpoint {
  kind: 'three-seed-set-prototype';
  version: 1;
  ruleset: typeof RULESET;
  access: typeof ACCESS;
  build: SetBuild;
  phase: SetPhase;
  revision: number;
  results: SetRunResult[];
  current: CounterfactualFrame | null;
  consumption: Consumption;
  inputs: SetInput[];
}
const emptyConsumption = (): Consumption => ({
  budgetDecreases: 0,
  budgetIncreases: 0,
  focusSpent: 0,
});
const isBuild = (build: string): build is SetBuild =>
  Object.prototype.hasOwnProperty.call(BUILDS, build);

function freshEngine(index: number, build: SetBuild): RunEngine {
  const condition = CONDITIONS[index];
  const engine = new RunEngine({
    seed: condition.seed,
    difficulty: 'normal',
    allowedCards: new Set(CARD_DEFS.map((card) => card.id)),
    allowedRelics: new Set(RELIC_DEFS.map((relic) => relic.id)),
  });
  engine.setPreferredCards(BUILDS[build]);
  engine.startRun('normal', [], condition.seed, { scenario: condition.scenario });
  return engine;
}

/** 開始前の公開契約。全ビルドを試作内だけで解放。通常メタの解放を読まない。 */
export function threeSeedSetDefinition() {
  return {
    id: 'RI-275-fixed-three',
    ruleset: { ...RULESET },
    unlock: { requiredAccess: ACCESS, allBuildsAvailable: true, readsMeta: false },
    builds: structuredClone(BUILDS),
    carry: ['preferredCardIds'],
    reset: ['org', 'budget', 'deck', 'relics', 'evolution', 'roster', 'focus', 'track', 'rng'],
    limits: {
      runs: 3,
      inputs: SET_INPUT_LIMIT,
      saveCharacters: SET_SAVE_LIMIT,
      stepMs: [FIXED_STEP_MS, 1000],
    },
    conditions: CONDITIONS.map((condition, index) => {
      const s = freshEngine(index, 'balanced').snapshot();
      return {
        ...condition,
        difficulty: s.difficulty,
        trials: s.trials,
        initialOrg: s.org,
        initialBudget: s.budget,
        initialRoster: s.roster,
        sprintsPerQuarter: s.sprintsPerQuarter,
        quarterGoal: s.quarterGoal,
      };
    }),
    rewardEligible: false,
    metaReward: 0,
    dailyReward: 0,
  };
}

/** 入力境界では型だけを信用しない。未知キー・非有限値・無制限dtを拒否する。 */
function validCommand(value: unknown): value is SetCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  const keys = (...names: string[]) =>
    Object.keys(c).sort().join(',') === ['type', ...names].sort().join(',');
  const index = (v: unknown) =>
    Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) < 1000;
  const id = () => typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 100;
  switch (c.type) {
    case 'start':
    case 'pause':
    case 'resume':
    case 'abandon':
    case 'beginSprint':
    case 'ackResult':
    case 'skipDraft':
    case 'mulligan':
    case 'finishEvolution':
    case 'leaveShop':
    case 'ackQuarter':
      return keys();
    case 'step':
      return (
        keys('ms') &&
        Number.isSafeInteger(c.ms) &&
        (c.ms as number) >= FIXED_STEP_MS &&
        (c.ms as number) <= 1000 &&
        (c.ms as number) % FIXED_STEP_MS === 0
      );
    case 'dispatch':
      return keys('id') && ACTION_IDS.includes(c.id as ActionId);
    case 'playCard':
    case 'exchangeCard':
      return keys('index') && index(c.index);
    case 'chooseCard':
    case 'unlockEvolution':
    case 'buyCard':
    case 'adjust':
      return keys('id') && id();
    case 'beat':
      return keys('choice') && index(c.choice);
    case 'rest':
      return keys('option') && (c.option === 'heal' || c.option === 'repay');
    case 'recruit':
      return keys('option') && (c.option === 'hire' || c.option === 'skip');
    default:
      return false;
  }
}

function execute(engine: RunEngine, c: EngineCommand): void {
  switch (c.type) {
    case 'beginSprint':
      engine.beginSetupSprint();
      break;
    case 'step':
      engine.step(c.ms);
      break;
    case 'dispatch':
      engine.dispatch(c.id);
      break;
    case 'playCard':
      engine.playCard(c.index);
      break;
    case 'exchangeCard':
      engine.exchangeCard(c.index);
      break;
    case 'ackResult':
      engine.acknowledgeResult();
      break;
    case 'chooseCard':
      engine.chooseCard(c.id);
      break;
    case 'skipDraft':
      engine.skipDraft();
      break;
    case 'mulligan':
      engine.mulliganDraft();
      break;
    case 'unlockEvolution':
      engine.unlockEvolution(c.id);
      break;
    case 'finishEvolution':
      engine.finishEvolution();
      break;
    case 'beat':
      engine.resolveBeat(c.choice);
      break;
    case 'buyCard':
      engine.buyShopCard(c.id);
      break;
    case 'leaveShop':
      engine.leaveShop();
      break;
    case 'rest':
      engine.restChoose(c.option);
      break;
    case 'recruit':
      engine.recruitChoose(c.option);
      break;
    case 'ackQuarter':
      engine.acknowledgeQuarterReview();
      break;
    case 'adjust':
      engine.chooseGoalAdjustment(c.id);
      break;
  }
}

export class ThreeSeedSet {
  private engine: RunEngine | null = null;
  private phase: SetPhase = 'ready';
  private results: SetRunResult[] = [];
  private consumption = emptyConsumption();
  private inputs: SetInput[] = [];
  private readonly build: SetBuild;

  constructor(build: SetBuild, access: string) {
    if (typeof build !== 'string' || !isBuild(build) || access !== ACCESS)
      throw new Error('invalid set access/build');
    this.build = build;
  }

  /** 複製のみ公開。完了済ランを再開/再精算するAPIは持たない。 */
  view() {
    return {
      phase: this.phase,
      revision: this.inputs.length,
      runIndex: this.results.length,
      build: this.build,
      results: structuredClone(this.results),
      current: this.engine?.snapshot() ?? null,
      consumption: { ...this.consumption },
      rewardEligible: false as const,
      metaReward: 0 as const,
      dailyReward: 0 as const,
    };
  }

  /** 同じrevisionを二度適用しない。無効入力はログ・乱数・費用も不変。 */
  apply(input: SetInput): boolean {
    if (
      !input ||
      typeof input !== 'object' ||
      Object.keys(input).sort().join(',') !== 'command,revision' ||
      !Number.isSafeInteger(input.revision) ||
      input.revision !== this.inputs.length ||
      !validCommand(input.command)
    )
      return false;
    if (
      (this.inputs.length >= SET_INPUT_LIMIT - 1 && input.command.type !== 'abandon') ||
      this.inputs.length >= SET_INPUT_LIMIT ||
      this.phase === 'complete' ||
      this.phase === 'abandoned'
    )
      return false;
    const c = input.command;
    if (c.type === 'start') {
      if (this.phase !== 'ready' && this.phase !== 'between') return false;
      this.engine = freshEngine(this.results.length, this.build);
      this.consumption = emptyConsumption();
      this.phase = 'running';
    } else if (c.type === 'pause') {
      if (this.phase !== 'running') return false;
      this.phase = 'paused';
    } else if (c.type === 'resume') {
      if (this.phase !== 'paused') return false;
      this.phase = 'running';
    } else if (c.type === 'abandon') {
      this.phase = 'abandoned';
      // 部分ランを終端結果として捏造しない。中断ランは検査/保存できる。
    } else {
      if (this.phase !== 'running' || !this.engine) return false;
      const before = this.engine.exportCounterfactualFrame()!;
      const beforeJson = JSON.stringify(before);
      execute(this.engine, c);
      const after = this.engine.exportCounterfactualFrame();
      if (after && JSON.stringify(after) === beforeJson) return false;
      const s = this.engine.snapshot();
      this.consumption.budgetDecreases += Math.max(0, before.persist.budget - s.budget);
      this.consumption.budgetIncreases += Math.max(0, s.budget - before.persist.budget);
      if (before.persist.currentSprintId === s.currentSprintId && s.sprint)
        this.consumption.focusSpent += Math.max(
          0,
          s.sprint.metrics.focusSpent - (before.sprint?.metrics.focusSpent ?? 0),
        );
      if (s.status !== 'playing') {
        const terminal = this.engine.exportReplayFrame()!;
        const initial = freshEngine(this.results.length, this.build).snapshot();
        this.results.push({
          index: this.results.length,
          seed: s.seed,
          scenario: s.scenario!,
          initialOrg: initial.org,
          initialBudget: initial.budget,
          consumption: { ...this.consumption },
          terminal,
        });
        this.engine = null;
        this.phase = this.results.length === CONDITIONS.length ? 'complete' : 'between';
      }
    }
    this.inputs.push(structuredClone({ revision: input.revision, command: c }));
    return true;
  }

  /** 独自JSONのみ。通常セーブ/デイリー/リプレイのenvelopeへ変換しない。 */
  save(): string {
    const checkpoint: SetCheckpoint = {
      kind: 'three-seed-set-prototype',
      version: 1,
      ruleset: { ...RULESET },
      access: ACCESS,
      build: this.build,
      phase: this.phase,
      revision: this.inputs.length,
      results: this.results,
      current: this.engine?.exportCounterfactualFrame() ?? null,
      consumption: this.consumption,
      inputs: this.inputs,
    };
    const json = JSON.stringify(checkpoint);
    if (json.length > SET_SAVE_LIMIT) throw new Error('set save limit');
    return json;
  }

  /** 最大12,000入力を再生し、進捗・実結果・RNGを含む全チェックポイントを照合する。 */
  static restore(json: string): ThreeSeedSet | null {
    try {
      if (typeof json !== 'string' || json.length > SET_SAVE_LIMIT) return null;
      const s = JSON.parse(json) as SetCheckpoint;
      if (
        !s ||
        s.kind !== 'three-seed-set-prototype' ||
        s.version !== 1 ||
        canonicalizeJson(s.ruleset) !== canonicalizeJson(RULESET) ||
        !Array.isArray(s.inputs) ||
        s.inputs.length > SET_INPUT_LIMIT
      )
        return null;
      const restored = new ThreeSeedSet(s.build, s.access);
      for (const input of s.inputs) if (!restored.apply(input)) return null;
      return canonicalizeJson(JSON.parse(restored.save())) === canonicalizeJson(s)
        ? restored
        : null;
    } catch {
      return null;
    }
  }
}

/** 固定方針比較用。人間の適応操作/最適戦略ではない。各commandは通常の操作APIを通す。 */
export function nextSetPolicyCommand(
  state: RunState,
  build: SetBuild,
  active = true,
): EngineCommand[] {
  switch (state.phase) {
    case 'setup':
      return [{ type: 'beginSprint' }];
    case 'sprint':
      return [
        ...(active
          ? (state.sprint?.cardPiles.hand ?? []).map((index) => ({
              type: 'playCard' as const,
              index,
            }))
          : []),
        ...(active
          ? [
              { type: 'dispatch' as const, id: 'pairReview' as const },
              { type: 'dispatch' as const, id: 'firefight' as const },
              { type: 'dispatch' as const, id: 'interruptReview' as const },
            ]
          : []),
        { type: 'step', ms: 1000 },
      ];
    case 'result':
      return [{ type: 'ackResult' }];
    case 'draft':
      return state.draft?.length
        ? [
            {
              type: 'chooseCard',
              id: BUILDS[build].find((id) => state.draft!.includes(id)) ?? state.draft[0],
            },
          ]
        : [{ type: 'skipDraft' }];
    case 'evolution':
      return [{ type: 'unlockEvolution', id: 'review-1' }, { type: 'finishEvolution' }];
    case 'beat':
      return [{ type: 'beat', choice: 0 }];
    case 'shop':
      return [{ type: 'leaveShop' }];
    case 'rest':
      return [{ type: 'rest', option: 'heal' }];
    case 'recruit':
      return [{ type: 'recruit', option: 'skip' }];
    case 'quarterReview':
      return state.quarterReview?.outcome === 'missed_adjustable'
        ? [{ type: 'adjust', id: state.quarterReview.availableAdjustments[0] ?? 'cut_scope' }]
        : [{ type: 'ackQuarter' }];
    default:
      return [];
  }
}

export function runSetPolicy(session: ThreeSeedSet, active = true): ThreeSeedSet {
  for (let guard = 0; guard < SET_INPUT_LIMIT; guard += 1) {
    const view = session.view();
    if (view.phase === 'complete' || view.phase === 'abandoned' || view.phase === 'paused')
      return session;
    const commands: SetCommand[] = view.current
      ? nextSetPolicyCommand(view.current, view.build, active)
      : [{ type: 'start' }];
    let progressed = false;
    for (const command of commands)
      progressed = session.apply({ revision: session.view().revision, command }) || progressed;
    if (!progressed) throw new Error('set policy cannot progress');
  }
  throw new Error('set policy input limit');
}
