import { BOSS_DEFS } from '../data/bosses';
import { activeIncidents, applyAction, isFirefightUrgent, tasksInLane } from '../sim/actions';
import { applyDeckBaseline, deckEffects } from '../sim/cards';
import { createOrgState } from '../sim/org';
import { evaluateBoss, evaluateLose } from '../sim/outcome';
import { createRng, createRngFromState, getRngState } from '../sim/rng';
import { withBossEffects } from '../sim/run/effects';
import { computeInfraCost } from '../sim/run/sprintBaselineBuild';
import type { RunTotals } from '../sim/run/types';
import { createSprint, resolveSprintConfig, stepSprint, summarizeSprint } from '../sim/sprint';
import type { CardInstance, OrgState, SprintState } from '../sim/types';

/** RI-267: 通常ラン・四半期・メタ保存とは接続しない固定2戦の実sim試作。 */
export const GAUNTLET_RULESET = 'ri267-sim-v1';
export const GAUNTLET_ORDER = ['big-release', 'security-audit'] as const;
export type GauntletBuild = 'speed' | 'resilient';
export interface GauntletImport {
  version: 1;
  build: GauntletBuild;
  org: OrgState;
  policies: CardInstance[];
  budgetCents: number;
  reserveUses: 1;
  recoveryUses: 1;
}
export interface GauntletRules {
  taskCount: number;
  maxTicks: number;
  tickCostCents: number;
  recoveryCostCents: number;
  recoveryHp: number;
}
export const GAUNTLET_RULES: Readonly<GauntletRules> = {
  taskCount: 36,
  maxTicks: 180,
  tickCostCents: 5,
  recoveryCostCents: 800,
  recoveryHp: 20,
};
export type GauntletInput =
  'tick' | 'interruptReview' | 'firefight' | 'reserve' | 'recover' | 'skip';
export interface GauntletBattle {
  boss: (typeof GAUNTLET_ORDER)[number];
  cleared: boolean;
  reason: string | null;
  ticks: number;
  delivered: number;
  done: number;
  rework: number;
  incidents: number;
  spread: number;
  focusSpent: number;
  focusRemaining: number;
  costCents: number;
  before: OrgState;
  after: OrgState;
}
export interface GauntletState {
  mode: 'boss-gauntlet-prototype';
  version: 1;
  ruleset: typeof GAUNTLET_RULESET;
  seed: string;
  build: GauntletBuild;
  rules: GauntletRules;
  phase: 'battle' | 'between' | 'won' | 'lost';
  stage: number;
  org: OrgState;
  budgetCents: number;
  reserveUsed: boolean;
  recoveryUsed: boolean;
  recoveryCostCents: number;
  sprint: SprintState;
  tick: number;
  rngState: number;
  battleStart: OrgState;
  battleStartBudgetCents: number;
  battles: GauntletBattle[];
  inputs: GauntletInput[];
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(',')}}`;
}

/** 必要項目を全て明示。恒久加算は完成ビルドへ一度だけ適用済みとする。 */
export function gauntletPreset(build: GauntletBuild): GauntletImport {
  if (build !== 'speed' && build !== 'resilient') throw new Error('unknown build');
  const policies = (
    build === 'speed'
      ? ['copilot', 'hire-senior', 'review-bot']
      : ['auto-test', 'docs', 'pr-size-limit']
  ).map((defId) => ({ defId, level: 2, baselineAppliedLevel: 2 }));
  const org = {
    ...createOrgState('default', true),
    aiDependency: 40,
    aiLiteracy: 65,
    testCoverage: 40,
    documentation: 40,
    quality: 45,
    securityLevel: 50,
    morale: 65,
    seniorHp: 70,
    techDebt: 22,
  };
  applyDeckBaseline(org, deckEffects(policies));
  return { version: 1, build, org, policies, budgetCents: 6000, reserveUses: 1, recoveryUses: 1 };
}

export function validateGauntletImport(value: unknown): value is GauntletImport {
  if (!value || typeof value !== 'object' || !('build' in value)) return false;
  if (value.build !== 'speed' && value.build !== 'resilient') return false;
  return canonical(value) === canonical(gauntletPreset(value.build));
}

function validateRules(rules: GauntletRules): boolean {
  return (
    canonical(Object.keys(rules).sort()) === canonical(Object.keys(GAUNTLET_RULES).sort()) &&
    Object.values(rules).every(Number.isSafeInteger) &&
    rules.taskCount >= 1 &&
    rules.taskCount <= 100 &&
    rules.maxTicks >= 1 &&
    rules.maxTicks <= 360 &&
    rules.tickCostCents >= 0 &&
    rules.tickCostCents <= 1000 &&
    rules.recoveryCostCents >= 0 &&
    rules.recoveryCostCents <= 6000 &&
    rules.recoveryHp >= 0 &&
    rules.recoveryHp <= 100
  );
}

function startBattle(
  state: Pick<GauntletState, 'seed' | 'build' | 'stage' | 'org' | 'budgetCents' | 'rules'>,
) {
  const battleStart = structuredClone(state.org);
  const battleStartBudgetCents = state.budgetCents;
  const effects = withBossEffects(
    deckEffects(gauntletPreset(state.build).policies),
    GAUNTLET_ORDER[state.stage],
  );
  // 試作の給与費に加え、既存の依存度比例インフラ費を各戦の開始で一度だけ課金。
  const budgetCents =
    state.budgetCents - 100 * computeInfraCost(state.org.aiDependency, 0.1, effects.infraCostMul);
  const boss = BOSS_DEFS.find((entry) => entry.id === GAUNTLET_ORDER[state.stage])!;
  const rng = createRng(`${state.seed}:battle:${state.stage}`);
  const sprint = createSprint(
    resolveSprintConfig('default', {
      taskCount: Math.max(1, Math.round(state.rules.taskCount * boss.taskCountMul)),
      codingSlots: 4,
      maxTicks: state.rules.maxTicks,
      minCompleteTick: 0,
      focusMax: 8,
    }),
    state.org,
    rng,
    effects,
  );
  return {
    battleStart,
    battleStartBudgetCents,
    budgetCents,
    sprint,
    tick: 0,
    rngState: getRngState(rng),
    phase: 'battle' as const,
  };
}

export function createBossGauntlet(
  imported: unknown,
  seed: string,
  rules: GauntletRules = { ...GAUNTLET_RULES },
): GauntletState {
  if (!validateGauntletImport(imported)) throw new Error('invalid fixed build import');
  if (typeof seed !== 'string' || !seed.length || seed.length > 100 || !validateRules(rules))
    throw new Error('invalid setup');
  const setup = {
    seed,
    build: imported.build,
    stage: 0,
    org: structuredClone(imported.org),
    budgetCents: imported.budgetCents,
    rules: structuredClone(rules),
  };
  const state: GauntletState = {
    ...setup,
    ...startBattle(setup),
    mode: 'boss-gauntlet-prototype',
    version: 1,
    ruleset: GAUNTLET_RULESET,
    reserveUsed: false,
    recoveryUsed: false,
    recoveryCostCents: 0,
    battles: [],
    inputs: [],
  };
  return state;
}

function lossReason(state: GauntletState) {
  const result = summarizeSprint(state.sprint, state.org);
  const totals: RunTotals = {
    delivered: result.delivered,
    done: result.done,
    rework: result.rework,
    incidents: result.incidents,
    contained: result.contained,
    spread: result.spread,
    aiAssisted: state.sprint.metrics.aiAssistedCompleted,
    completed: result.done,
    reviewQueuePeak: result.reviewQueueMax,
    maxCombo: result.maxCombo,
  };
  return evaluateLose(state.org, totals, state.budgetCents / 100);
}

function finishBattle(state: GauntletState): void {
  const result = summarizeSprint(state.sprint, state.org);
  const reason = lossReason(state);
  const boss = BOSS_DEFS.find((entry) => entry.id === GAUNTLET_ORDER[state.stage])!;
  const cleared = !reason && evaluateBoss({ boss, result, org: state.org, bossTargetMul: 1 });
  state.battles.push({
    boss: GAUNTLET_ORDER[state.stage],
    cleared,
    reason: reason ?? (cleared ? null : result.timedOut ? 'timedOut' : 'bossFailed'),
    ticks: state.tick,
    delivered: result.delivered,
    done: result.done,
    rework: result.rework,
    incidents: result.incidents,
    spread: result.spread,
    focusSpent: state.sprint.metrics.focusSpent,
    focusRemaining: state.sprint.focus,
    costCents: state.battleStartBudgetCents - state.budgetCents,
    before: structuredClone(state.battleStart),
    after: structuredClone(state.org),
  });
  state.phase = cleared ? (state.stage === 1 ? 'won' : 'between') : 'lost';
}

/** 無効入力は状態・乱数・ログ・費用を変えない。敗北/勝利からの続行や再報酬はない。 */
export function applyGauntletInput(state: GauntletState, input: GauntletInput): GauntletState {
  if (state.phase === 'won' || state.phase === 'lost') return state;
  const next = structuredClone(state);
  if (state.phase === 'between') {
    if (input !== 'recover' && input !== 'skip') return state;
    if (input === 'recover') {
      if (state.recoveryUsed || state.budgetCents <= state.rules.recoveryCostCents) return state;
      next.org.seniorHp = Math.min(100, next.org.seniorHp + next.rules.recoveryHp);
      next.budgetCents -= next.rules.recoveryCostCents;
      next.recoveryUsed = true;
      next.recoveryCostCents += next.rules.recoveryCostCents;
    }
    next.stage += 1;
    Object.assign(next, startBattle(next));
  } else {
    if (
      input !== 'tick' &&
      input !== 'interruptReview' &&
      input !== 'firefight' &&
      input !== 'reserve'
    )
      return state;
    const rng = createRngFromState(state.rngState);
    if (input !== 'tick') {
      if (input === 'reserve' && state.reserveUsed) return state;
      const action = input === 'reserve' ? 'overtime' : input;
      const result = applyAction(action, next.sprint, next.org, rng, next.tick);
      if (!result.ok) return state;
      if (input === 'reserve') next.reserveUsed = true;
    } else {
      next.tick += 1;
      next.budgetCents -= next.rules.tickCostCents;
      stepSprint(next.sprint, next.org, rng, next.tick);
      if (next.sprint.complete) finishBattle(next);
    }
    next.rngState = getRngState(rng);
  }
  // HPなどは既存RunEngineと同じ戦末判定。資金枯渇だけは赤字で続行しない。
  if (next.phase === 'battle' && next.budgetCents <= 0) finishBattle(next);
  next.inputs.push(input);
  return next;
}

/** 明示的に報酬非対象。通常run/replay/persist/meta APIへ渡すアダプターは設けない。 */
export function summarizeGauntlet(state: GauntletState) {
  return {
    phase: state.phase,
    battles: structuredClone(state.battles),
    totalCostCents: gauntletPreset(state.build).budgetCents - state.budgetCents,
    recoveryCostCents: state.recoveryCostCents,
    budgetCents: state.budgetCents,
    reserveUsed: state.reserveUsed,
    recoveryUsed: state.recoveryUsed,
    rewardEligible: false as const,
    metaReward: 0 as const,
    dailyReward: 0 as const,
  };
}

/** 全状態とRNGをチェックポイントとして保存し、復元時に入力再実行結果と照合する。 */
export function saveBossGauntlet(state: GauntletState): string {
  return JSON.stringify(state);
}
export function restoreBossGauntlet(json: string): GauntletState | null {
  try {
    if (json.length > 1_000_000) return null;
    const saved = JSON.parse(json) as GauntletState;
    if (
      !saved ||
      saved.mode !== 'boss-gauntlet-prototype' ||
      saved.version !== 1 ||
      saved.ruleset !== GAUNTLET_RULESET ||
      !Array.isArray(saved.inputs) ||
      saved.inputs.length > 2000
    )
      return null;
    let state = createBossGauntlet(gauntletPreset(saved.build), saved.seed, saved.rules);
    for (const input of saved.inputs) {
      const next = applyGauntletInput(state, input);
      if (next === state) return null;
      state = next;
    }
    return canonical(state) === canonical(saved) ? state : null;
  } catch {
    return null;
  }
}

export interface GauntletPolicy {
  reserve: 'first' | 'second' | 'never';
  recovery: 'recover' | 'skip';
}
/** 固定の共通判断。最適化・人間の適応行動ではない。入力列は全てstateへ残る。 */
export function runGauntletPolicy(state: GauntletState, policy: GauntletPolicy): GauntletState {
  while (state.phase === 'battle' || state.phase === 'between') {
    if (state.phase === 'between') {
      const next = applyGauntletInput(state, policy.recovery);
      state = next === state ? applyGauntletInput(state, 'skip') : next;
      continue;
    }
    if (
      !state.reserveUsed &&
      state.tick === 0 &&
      ((policy.reserve === 'first' && state.stage === 0) ||
        (policy.reserve === 'second' && state.stage === 1))
    )
      state = applyGauntletInput(state, 'reserve');
    if (activeIncidents(state.sprint).length > 0 && isFirefightUrgent(state.sprint))
      state = applyGauntletInput(state, 'firefight');
    else if (tasksInLane(state.sprint, 'review').length >= 4)
      state = applyGauntletInput(state, 'interruptReview');
    state = applyGauntletInput(state, 'tick');
  }
  return state;
}
