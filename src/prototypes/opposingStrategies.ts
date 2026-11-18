/** RI-271: 共通開始条件から2社を操作する隔離API。通常の保存・報酬には接続しない。 */
import { BALANCE_RULESET_FINGERPRINT, BALANCE_RULESET_VERSION } from '../data/balance';
import { canonicalizeJson } from '../data/balance/canonical';
import { CARD_DEFS } from '../data/cards';
import { getEvent } from '../data/events';
import { RELIC_DEFS } from '../data/relics';
import { FIXED_STEP_MS } from '../data/balance/pacing';
import { RunEngine } from '../sim/run/engine';
import type { RunState } from '../sim/run/types';
import { parseStartRecipe, type StartRecipe } from '../state/startRecipe';

export type StrategySide = 'ai' | 'human';
export const STRATEGY_SIDES: readonly StrategySide[] = ['ai', 'human'];
const SCHEMA = 1;
export const OPPOSING_LIMITS = {
  commandsPerSide: 4096,
  ticksPerCommand: 120,
  ticksPerSide: 60_000,
  sprintsPerSide: 24,
  saveCharacters: 8_000_000,
} as const;

const POLICIES = {
  ai: { aiAssigned: true, interventions: ['assignTask', 'overtime', 'firefight'] },
  human: { aiAssigned: false, interventions: ['pairReview', 'interruptReview', 'firefight'] },
} as const;

export interface OpposingConfig {
  recipe: StartRecipe;
  /** 試作自身の明示的な解放条件。利用者のメタを読み書きしない。 */
  unlockPool: { cards: string[]; relics: string[] };
}

export type StrategyCommand =
  | {
      type:
        'start' | 'begin' | 'result' | 'skip-draft' | 'finish-evolution' | 'leave-shop' | 'review';
    }
  | { type: 'advance'; ticks: number }
  | {
      type: 'intervene';
      id: 'assignTask' | 'overtime' | 'firefight' | 'pairReview' | 'interruptReview';
    }
  | { type: 'play-card'; index: number }
  | { type: 'choose-card' | 'buy-card' | 'evolve' | 'adjust'; id: string }
  | { type: 'beat'; choice: number }
  | { type: 'rest'; option: 'heal' | 'repay' }
  | { type: 'recruit'; option: 'hire' | 'skip' };

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function same(a: unknown, b: unknown): boolean {
  return canonicalizeJson(a) === canonicalizeJson(b);
}

function validCommand(value: unknown): value is StrategyCommand {
  if (!object(value)) return false;
  const keys = Object.keys(value).sort().join(',');
  switch (value.type) {
    case 'start':
    case 'begin':
    case 'result':
    case 'skip-draft':
    case 'finish-evolution':
    case 'leave-shop':
    case 'review':
      return keys === 'type';
    case 'advance':
      return (
        keys === 'ticks,type' &&
        Number.isInteger(value.ticks) &&
        (value.ticks as number) >= 1 &&
        (value.ticks as number) <= OPPOSING_LIMITS.ticksPerCommand
      );
    case 'intervene':
      return (
        keys === 'id,type' &&
        ['assignTask', 'overtime', 'firefight', 'pairReview', 'interruptReview'].includes(
          value.id as string,
        )
      );
    case 'play-card':
      return keys === 'index,type' && Number.isInteger(value.index) && (value.index as number) >= 0;
    case 'choose-card':
    case 'buy-card':
    case 'evolve':
    case 'adjust':
      return keys === 'id,type' && typeof value.id === 'string' && value.id.length <= 64;
    case 'beat':
      return (
        keys === 'choice,type' && Number.isInteger(value.choice) && (value.choice as number) >= 0
      );
    case 'rest':
      return keys === 'option,type' && ['heal', 'repay'].includes(value.option as string);
    case 'recruit':
      return keys === 'option,type' && ['hire', 'skip'].includes(value.option as string);
    default:
      return false;
  }
}

export function defaultOpposingConfig(seed = 'RI-271'): OpposingConfig {
  return {
    recipe: {
      schemaVersion: 1,
      seed,
      difficulty: 'normal',
      trials: [],
      scenario: 'default',
      preferredCardIds: [],
    },
    unlockPool: { cards: CARD_DEFS.map((c) => c.id), relics: RELIC_DEFS.map((r) => r.id) },
  };
}

function validateConfig(value: unknown): OpposingConfig {
  if (!object(value) || !object(value.recipe) || !object(value.unlockPool))
    throw new Error('invalid-config');
  const parsed = parseStartRecipe(JSON.stringify(value.recipe));
  if (!parsed.ok || parsed.recipe.seed.length > 128) throw new Error('invalid-recipe');
  const pool = value.unlockPool;
  for (const [key, known] of [
    ['cards', CARD_DEFS],
    ['relics', RELIC_DEFS],
  ] as const) {
    const ids = pool[key];
    if (
      !Array.isArray(ids) ||
      ids.length > known.length ||
      new Set(ids).size !== ids.length ||
      !ids.every((id) => typeof id === 'string' && known.some((def) => def.id === id))
    )
      throw new Error('invalid-pool');
  }
  const cards = [...(pool.cards as string[])].sort();
  if (!parsed.recipe.preferredCardIds.every((id) => cards.includes(id)))
    throw new Error('locked-preference');
  return {
    recipe: parsed.recipe,
    unlockPool: { cards, relics: [...(pool.relics as string[])].sort() },
  };
}

function newEngine(config: OpposingConfig): RunEngine {
  return new RunEngine({
    seed: config.recipe.seed,
    difficulty: config.recipe.difficulty,
    trials: [...config.recipe.trials],
    allowedCards: new Set(config.unlockPool.cards),
    allowedRelics: new Set(config.unlockPool.relics),
  });
}

function metrics(state: RunState) {
  return {
    sprints: state.sprintsPlayed,
    delivered: state.totals.delivered,
    reviewQueuePeak: state.totals.reviewQueuePeak,
    incidents: state.totals.incidents,
    budget: state.budget,
    seniorHp: state.org.seniorHp,
    morale: state.org.morale,
    techDebt: state.org.techDebt,
    aiDependency: state.org.aiDependency,
  };
}

function entry(config: OpposingConfig) {
  return {
    engine: newEngine(config),
    started: false,
    commands: [] as StrategyCommand[],
    ticks: 0,
    initial: null as ReturnType<typeof startIdentity> | null,
    costs: { focusSpent: 0, budgetDebits: 0, budgetCredits: 0, evolutionSpent: 0 },
    boundaries: [] as ReturnType<typeof metrics>[],
  };
}
type Entry = ReturnType<typeof entry>;

function startIdentity(engine: RunEngine) {
  const frame = engine.exportReplayFrame()!;
  return {
    seed: frame.seed,
    difficulty: frame.difficulty,
    trials: [...frame.trials].sort(),
    scenario: frame.scenario,
    runKind: frame.runKind,
    unlockPool: {
      cards: [...frame.extras.allowedCards].sort(),
      relics: [...frame.extras.allowedRelics].sort(),
    },
    preferredCardIds: [...(frame.extras.preferredCardIds ?? [])].sort(),
    ruleset: { version: BALANCE_RULESET_VERSION, fingerprint: BALANCE_RULESET_FINGERPRINT },
    resources: {
      org: frame.org,
      budget: frame.budget,
      roster: frame.roster,
      deck: frame.deck,
      relics: frame.relics,
      evolution: frame.evolution,
    },
  };
}

function checkpoint(run: Entry) {
  if (!run.started) return null;
  return run.engine.exportCounterfactualFrame() ?? run.engine.exportReplayFrame();
}

function limited(run: Entry) {
  return (
    run.commands.length >= OPPOSING_LIMITS.commandsPerSide ||
    run.ticks >= OPPOSING_LIMITS.ticksPerSide ||
    (run.engine.currentPhase() === 'setup' &&
      run.engine.snapshot().sprintsPlayed >= OPPOSING_LIMITS.sprintsPerSide)
  );
}

/** 方針制約はAI配属と使用可能な介入。カード・イベント・投資は操作者が選ぶ。 */
export class OpposingStrategies {
  private readonly config: OpposingConfig;
  private readonly runs: Record<StrategySide, Entry>;

  constructor(config: OpposingConfig = defaultOpposingConfig()) {
    this.config = validateConfig(config);
    this.runs = { ai: entry(this.config), human: entry(this.config) };
  }

  state(side: StrategySide): RunState {
    // RunEngine.snapshot のネストも共有しない。
    return structuredClone(this.runs[side].engine.snapshot());
  }

  command(side: StrategySide, input: unknown): { ok: boolean; reason?: string } {
    if (!STRATEGY_SIDES.includes(side) || !validCommand(input))
      return { ok: false, reason: 'invalid-input' };
    const run = this.runs[side];
    const before = run.engine.snapshot();
    if (before.status !== 'playing') return { ok: false, reason: 'terminal' };
    if (limited(run)) return { ok: false, reason: 'limit' };
    if (input.type !== 'start' && !run.started) return { ok: false, reason: 'not-started' };
    if (input.type === 'start' && run.started) return { ok: false, reason: 'already-started' };
    if (input.type === 'advance' && run.ticks + input.ticks > OPPOSING_LIMITS.ticksPerSide)
      return { ok: false, reason: 'limit' };
    if (
      input.type === 'intervene' &&
      !(POLICIES[side].interventions as readonly string[]).includes(input.id)
    )
      return { ok: false, reason: 'policy' };
    const previous = checkpoint(run);
    if (!this.apply(run, side, input)) return { ok: false, reason: 'unavailable' };
    const after = run.engine.snapshot();
    if (input.type !== 'start' && same(previous, checkpoint(run)))
      return { ok: false, reason: 'unavailable' };
    run.commands.push(structuredClone(input));
    if (input.type === 'advance') run.ticks += input.ticks;
    run.costs.budgetDebits += Math.max(0, before.budget - after.budget);
    run.costs.budgetCredits += Math.max(0, after.budget - before.budget);
    run.costs.evolutionSpent += Math.max(0, before.evolution.points - after.evolution.points);
    if (input.type === 'intervene' || input.type === 'play-card')
      run.costs.focusSpent += Math.max(
        0,
        (after.sprint?.metrics.focusSpent ?? 0) - (before.sprint?.metrics.focusSpent ?? 0),
      );
    if (after.sprintsPlayed > before.sprintsPlayed) run.boundaries.push(metrics(after));
    return { ok: true };
  }

  private apply(run: Entry, side: StrategySide, command: StrategyCommand): boolean {
    const e = run.engine;
    const s = e.snapshot();
    switch (command.type) {
      case 'start':
        e.setPreferredCards(this.config.recipe.preferredCardIds);
        e.startRun(
          this.config.recipe.difficulty,
          [...this.config.recipe.trials],
          this.config.recipe.seed,
          { scenario: this.config.recipe.scenario },
        );
        run.started = true;
        run.initial = startIdentity(e);
        return true;
      case 'begin':
        if (s.phase !== 'setup') return false;
        for (const member of s.roster.members) e.setMemberAi(member.id, POLICIES[side].aiAssigned);
        e.beginSetupSprint();
        return true;
      case 'advance':
        if (s.phase !== 'sprint') return false;
        e.step(FIXED_STEP_MS * command.ticks);
        return true;
      case 'intervene':
        return e.dispatch(command.id).ok;
      case 'play-card':
        return e.playCard(command.index).ok;
      case 'result':
        e.acknowledgeResult();
        return true;
      case 'choose-card':
        e.chooseCard(command.id);
        return true;
      case 'skip-draft':
        e.skipDraft();
        return true;
      case 'evolve':
        e.unlockEvolution(command.id);
        return true;
      case 'finish-evolution':
        e.finishEvolution();
        return true;
      case 'beat':
        if (
          s.phase !== 'beat' ||
          !s.beat ||
          !getEvent(s.beat.eventId)?.choices[command.choice] ||
          (s.beat.kind === 'judgment' && command.choice !== 0)
        )
          return false;
        e.resolveBeat(command.choice);
        return true;
      case 'buy-card':
        e.buyShopCard(command.id);
        return true;
      case 'leave-shop':
        e.leaveShop();
        return true;
      case 'rest':
        e.restChoose(command.option);
        return true;
      case 'recruit':
        e.recruitChoose(command.option);
        return true;
      case 'review':
        e.acknowledgeQuarterReview();
        return true;
      case 'adjust':
        if (
          s.phase !== 'quarterReview' ||
          !s.quarterReview?.availableAdjustments.some((id) => id === command.id)
        )
          return false;
        e.chooseGoalAdjustment(command.id as Parameters<RunEngine['chooseGoalAdjustment']>[0]);
        return true;
    }
  }

  view() {
    const identity =
      this.runs.ai.initial && this.runs.human.initial
        ? Object.keys(this.runs.ai.initial).map((field) => ({
            field,
            status: same(
              this.runs.ai.initial![field as keyof NonNullable<Entry['initial']>],
              this.runs.human.initial![field as keyof NonNullable<Entry['initial']>],
            )
              ? 'match'
              : 'mismatch',
          }))
        : null;
    const summary = (side: StrategySide) => {
      const run = this.runs[side];
      const s = run.engine.snapshot();
      return {
        progress: !run.started
          ? 'not-started'
          : s.status !== 'playing'
            ? s.status
            : limited(run)
              ? 'limited'
              : 'playing',
        phase: s.phase,
        metrics: metrics(s),
        costs: { ...run.costs },
        terminal:
          s.status === 'playing'
            ? null
            : { status: s.status, winType: s.winType ?? null, loseReason: s.loseReason ?? null },
        boundaries: structuredClone(run.boundaries),
        commands: run.commands.length,
        requestedTicks: run.ticks,
      };
    };
    const ai = summary('ai');
    const human = summary('human');
    return {
      source: 'live-run-engine' as const,
      config: structuredClone(this.config),
      policies: structuredClone(POLICIES),
      shared: structuredClone(this.runs.ai.initial ?? this.runs.human.initial),
      identity,
      comparable: identity?.every((row) => row.status === 'match') ?? false,
      complete: !!ai.terminal && !!human.terminal,
      ai,
      human,
      // 異なる長さの累計値を総合点にしない。共通スプリント境界と片側区間を公開する。
      commonSprints: Math.min(ai.boundaries.length, human.boundaries.length),
      onlyAi: ai.boundaries.slice(human.boundaries.length),
      onlyHuman: human.boundaries.slice(ai.boundaries.length),
    };
  }

  serialize(): string {
    const raw = JSON.stringify({
      schema: SCHEMA,
      ruleset: { version: BALANCE_RULESET_VERSION, fingerprint: BALANCE_RULESET_FINGERPRINT },
      config: this.config,
      runs: Object.fromEntries(
        STRATEGY_SIDES.map((side) => [
          side,
          { commands: this.runs[side].commands, checkpoint: checkpoint(this.runs[side]) },
        ]),
      ),
    });
    if (raw.length > OPPOSING_LIMITS.saveCharacters) throw new Error('save-limit');
    return raw;
  }
}

/** 入力列を再実行してRNG位置を含むcheckpointを照合。外部の結果・状態を信用しない。 */
export function restoreOpposingStrategies(raw: string): OpposingStrategies {
  if (raw.length > OPPOSING_LIMITS.saveCharacters) throw new Error('save-limit');
  const value: unknown = JSON.parse(raw);
  if (!object(value) || value.schema !== SCHEMA || !object(value.runs))
    throw new Error('invalid-save');
  if (
    !same(value.ruleset, {
      version: BALANCE_RULESET_VERSION,
      fingerprint: BALANCE_RULESET_FINGERPRINT,
    })
  )
    throw new Error('ruleset-mismatch');
  const challenge = new OpposingStrategies(validateConfig(value.config));
  for (const side of STRATEGY_SIDES) {
    const saved = value.runs[side];
    if (
      !object(saved) ||
      !Array.isArray(saved.commands) ||
      saved.commands.length > OPPOSING_LIMITS.commandsPerSide
    )
      throw new Error('invalid-history');
    for (const command of saved.commands)
      if (!challenge.command(side, command).ok) throw new Error('invalid-history');
  }
  // 余分なフィールド、架空の終端結果、状態/RNGの改変も拒否する。
  if (!same(value, JSON.parse(challenge.serialize()))) throw new Error('checkpoint-mismatch');
  return challenge;
}
