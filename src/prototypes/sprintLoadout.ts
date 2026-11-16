import { getBoss } from '../data/bossDisplay';
import { applyAction } from '../sim/actions';
import { dealHand } from '../sim/cards';
import { createRng, createRngFromState, getRngState } from '../sim/rng';
import { igniteTask } from '../sim/sprint';
import type { CardInstance, TaskKind } from '../sim/types';
import {
  createHandExchangePrototype,
  exchangeHandCard,
  playHandExchangeCard,
  tickHandExchangePrototype,
  type HandExchangeState,
} from './handExchange';

export const SPRINT_LOADOUT_LIMITS = { min: 3, max: 6 } as const;
export type LoadoutBoss = 'big-release' | 'security-audit';

/** RI-187: 所持インスタンスの位置、持ち込み候補、実手札を分ける。 */
export interface SprintLoadoutState {
  version: 1;
  seed: string | number;
  collection: CardInstance[];
  selected: number[];
  sprintNumber: number;
  current: HandExchangeState | null;
}

export function createSprintLoadoutPrototype(seed: string | number): SprintLoadoutState {
  const base = createHandExchangePrototype(seed);
  return {
    version: 1,
    seed,
    collection: base.deck,
    selected: base.deck.map((_, i) => i),
    sprintNumber: 0,
    current: null,
  };
}

/** 期首・完了後に変更する。選択順では抽選を操作できないよう所持位置で正規化する。 */
export function selectSprintLoadout(
  state: SprintLoadoutState,
  indices: readonly number[],
): SprintLoadoutState {
  if (state.current && !state.current.sprint.complete) return state;
  if (
    indices.length < SPRINT_LOADOUT_LIMITS.min ||
    indices.length > SPRINT_LOADOUT_LIMITS.max ||
    new Set(indices).size !== indices.length ||
    indices.some(
      (index) => !Number.isInteger(index) || index < 0 || index >= state.collection.length,
    )
  )
    return state;
  return { ...state, selected: [...indices].sort((a, b) => a - b) };
}

/**
 * 抽選は候補位置で行い、カードの恒久的な所持位置へ写す。未選択は保持するが配らない。
 * `shopPriority` はショップ購入カードの所持位置。候補に入っているものだけを手札の先頭へ優先する。
 */
export function beginSprintLoadout(
  state: SprintLoadoutState,
  boss: LoadoutBoss,
  shopPriority: readonly number[] = [],
): SprintLoadoutState {
  if (state.current && !state.current.sprint.complete) return state;
  const sprintNumber = state.sprintNumber + 1;
  const current = createHandExchangePrototype(
    `${state.seed}:sprint:${sprintNumber}`,
    boss === 'big-release' ? 'coding' : 'review',
  );
  current.deck = structuredClone(state.current?.deck ?? state.collection);
  current.sprintDeckIndices = [...state.selected];
  if (state.current) current.org = structuredClone(state.current.org);
  else current.org.quality = 45; // 品質50が問われる監査へ準備する固定比較条件。
  current.sprint.metrics.seniorHpStart = current.org.seniorHp;
  const prefer = shopPriority.flatMap((index) => {
    const local = state.selected.indexOf(index);
    return local >= 0 ? [local] : [];
  });
  const piles = dealHand(
    state.selected.length,
    createRng(`${state.seed}:loadout:${sprintNumber}`),
    undefined,
    prefer,
  );
  current.sprint.cardPiles = {
    hand: piles.hand.map((index) => state.selected[index]),
    drawOrder: piles.drawOrder.map((index) => state.selected[index]),
    discard: [],
    played: [],
  };
  return { ...state, sprintNumber, collection: structuredClone(current.deck), current };
}

export function playSprintLoadoutCard(
  state: SprintLoadoutState,
  index: number,
): SprintLoadoutState {
  if (!state.current) return state;
  const current = playHandExchangeCard(state.current, index);
  return current === state.current
    ? state
    : { ...state, current, collection: structuredClone(current.deck) };
}

export function exchangeSprintLoadoutCard(
  state: SprintLoadoutState,
  index: number,
): SprintLoadoutState {
  if (!state.current) return state;
  const result = exchangeHandCard(state.current, index);
  return result.ok ? { ...state, current: result.state } : state;
}

export function tickSprintLoadout(
  state: SprintLoadoutState,
  interrupt = false,
): SprintLoadoutState {
  if (!state.current) return state;
  const current = tickHandExchangePrototype(state.current, interrupt);
  return current === state.current ? state : { ...state, current };
}

/** 手札内に目的カードが無ければ1回だけ交換し、発動1枚＋残集中力を介入へ回す。 */
export function compareSprintLoadouts(seed: string | number, boss: LoadoutBoss) {
  const choices = { speed: [0, 1, 2], quality: [3, 4, 5], broad: [0, 1, 2, 3, 4, 5] } as const;
  const desired = boss === 'big-release' ? 'copilot' : 'auto-test';
  return (Object.keys(choices) as (keyof typeof choices)[]).map((strategy) => {
    let state = beginSprintLoadout(
      selectSprintLoadout(createSprintLoadoutPrototype(seed), choices[strategy]),
      boss,
    );
    const initialHand = [...state.current!.sprint.cardPiles.hand];
    const findDesired = () =>
      state.current!.sprint.cardPiles.hand.find(
        (index) => state.collection[index].defId === desired,
      );
    if (findDesired() === undefined)
      state = exchangeSprintLoadoutCard(state, state.current!.sprint.cardPiles.hand[0]);
    const index = findDesired() ?? state.current!.sprint.cardPiles.hand[0];
    state = playSprintLoadoutCard(state, index);
    while (!state.current!.sprint.complete) state = tickSprintLoadout(state, true);
    const current = state.current!;
    return {
      strategy,
      boss,
      candidates: [...state.selected],
      initialHand,
      selected: state.collection[index].defId,
      desiredInInitialHand: initialHand.some((i) => state.collection[i].defId === desired),
      delivered: current.sprint.metrics.delivered,
      completed: current.sprint.metrics.completedCount,
      quality: current.org.quality,
      auditQualityRequirement: getBoss('security-audit')!.clear.minQuality!,
      auditQualityMet: current.org.quality >= getBoss('security-audit')!.clear.minQuality!,
      focusSpent: current.sprint.metrics.focusSpent,
      focusRemaining: current.sprint.focus,
      exchanges: current.exchanges,
      interventions: current.sprint.metrics.interventionsUsed,
    };
  });
}

/** 初回比較と同じ seed。資源は createSprintLoadoutPrototype の所持6枚・集中力8・定型16・期限8。 */
export const SPRINT_LOADOUT_FACTOR_SEEDS = ['RI-187', 'RI-187:1', 'RI-187:2'] as const;

const LOADOUT_COLLECTION = [
  'copilot',
  'feature-flags',
  'docs',
  'review-bot',
  'auto-test',
  'pr-size-limit',
] as const;

export type LoadoutFactorName = 'control' | 'plays' | 'burning' | 'surprise' | 'level' | 'shop';

/** 初回の単一工程・1枚発動から、一つだけ動かした規則。 */
export interface SprintLoadoutFactorRules {
  plays: number;
  surpriseInterrupts: number;
  shopPriority: number[];
  levels: Record<number, number>;
  definitions: Record<number, string>;
  forecast: LoadoutBoss;
  actual: LoadoutBoss;
  board: 'forecast' | 'both';
  burning: number;
  taskKind: TaskKind;
}

export interface SprintLoadoutFactorOutcome {
  candidates: number[];
  initialHand: number[];
  inputs: string[];
  played: string[];
  playedLevels: number[];
  delivered: number;
  quality: number;
  auditQualityMet: boolean;
  focusSpent: number;
  focusRemaining: number;
  exchanges: number;
  interventions: number;
  timedOut: boolean;
}

export interface SprintLoadoutFactorRow {
  factor: LoadoutFactorName;
  value: string | number;
  seed: string;
  forecast: LoadoutBoss;
  actual: LoadoutBoss;
  board: 'forecast' | 'both';
  plays: number;
  surpriseInterrupts: number;
  shopPriority: number[];
  levels: Record<number, number>;
  definitions: Record<number, string>;
  burning: number;
  taskKind: TaskKind;
  lanes: { coding: number; review: number; burning: number };
  narrow: SprintLoadoutFactorOutcome;
  broad: SprintLoadoutFactorOutcome;
  /**
   * 監査だけの盤面は、先に品質要件を満たす方。それ以外は出荷が多い方。
   * 同点なら品質、それも同点なら消費集中力が少ない方。
   */
  verdict: 'narrow' | 'broad' | 'tie';
}

function factorBaseline(forecast: LoadoutBoss): SprintLoadoutFactorRules {
  return {
    plays: 1,
    surpriseInterrupts: 0,
    shopPriority: [],
    levels: {},
    definitions: {},
    forecast,
    actual: forecast,
    board: 'forecast',
    burning: 0,
    taskKind: 'routine',
  };
}

/** レベルが同じときは手札の並び順。初回の find と同じカードになる。 */
function findLoadoutCard(state: SprintLoadoutState, defId: string): number | undefined {
  let best: number | undefined;
  let bestLevel = -1;
  for (const index of state.current!.sprint.cardPiles.hand) {
    const card = state.collection[index];
    if (!card || card.defId !== defId || card.level <= bestLevel) continue;
    best = index;
    bestLevel = card.level;
  }
  return best;
}

function withLoadoutLevels(seed: string, rules: SprintLoadoutFactorRules): SprintLoadoutState {
  const state = createSprintLoadoutPrototype(seed);
  if (Object.keys(rules.definitions).length === 0 && Object.keys(rules.levels).length === 0) {
    return state;
  }
  return {
    ...state,
    collection: state.collection.map((card, index) => ({
      ...card,
      defId: rules.definitions[index] ?? card.defId,
      level: rules.levels[index] ?? card.level,
    })),
  };
}

/** 両工程は残りを前半 Coding・後半 Review に分け、若いタスクから炎上にする。 */
function applyLoadoutBoard(
  state: SprintLoadoutState,
  rules: SprintLoadoutFactorRules,
): SprintLoadoutState {
  if (rules.board === 'forecast' && rules.taskKind === 'routine') return state;
  const next = structuredClone(state);
  const sprint = next.current!.sprint;
  for (const task of sprint.tasks) task.kind = rules.taskKind;
  if (rules.board !== 'both') return next;
  const burnCount = Math.min(Math.max(rules.burning, 0), sprint.tasks.length);
  for (let i = 0; i < burnCount; i += 1) {
    const task = sprint.tasks[i];
    if (task) igniteTask(task, sprint);
  }
  const rest = sprint.tasks.slice(burnCount);
  const codingCount = Math.ceil(rest.length / 2);
  for (let i = 0; i < rest.length; i += 1) {
    const task = rest[i];
    if (!task) continue;
    task.lane = i < codingCount ? 'coding' : 'review';
    task.progress = 0;
    task.incident = false;
    delete task.burnTicksLeft;
  }
  return next;
}

function laneCounts(state: SprintLoadoutState): SprintLoadoutFactorRow['lanes'] {
  const lanes = { coding: 0, review: 0, burning: 0 };
  for (const task of state.current!.sprint.tasks) {
    if (task.incident && task.lane === 'rework') lanes.burning += 1;
    else if (task.lane === 'coding') lanes.coding += 1;
    else if (task.lane === 'review') lanes.review += 1;
  }
  return lanes;
}

/** カード選択の前に割り込みを試みる。対象が無いときは集中力も乱数も動かさない。 */
function surpriseInterrupt(state: SprintLoadoutState): SprintLoadoutState {
  if (!state.current) return state;
  const next = structuredClone(state);
  const current = next.current!;
  const rng = createRngFromState(current.rngState);
  const result = applyAction('interruptReview', current.sprint, current.org, rng, 0);
  if (!result.ok) return state;
  current.rngState = getRngState(rng);
  return next;
}

function playLoadout(
  state: SprintLoadoutState,
  index: number,
  inputs: string[],
): SprintLoadoutState {
  const next = playSprintLoadoutCard(state, index);
  inputs.push(next === state ? `play-rejected:${index}` : `play:${index}`);
  return next;
}

/**
 * 固定戦略。目的カードが手札に無ければ先頭を1回だけ交換し、あればそれを、無ければ先頭を発動する。
 * 2枚目は相手側の目的カード（リリースなら自動テスト、監査なら Copilot）を優先し、無ければ所持位置の若い残札。
 * 3枚目以降は残札の若い順。その後の毎tickは初回と同じ割り込みレビュー。
 */
function runLoadoutFactor(
  seed: string,
  indices: readonly number[],
  rules: SprintLoadoutFactorRules,
): { outcome: SprintLoadoutFactorOutcome; lanes: SprintLoadoutFactorRow['lanes'] } {
  const desired = rules.forecast === 'big-release' ? 'copilot' : 'auto-test';
  const complement = rules.forecast === 'big-release' ? 'auto-test' : 'copilot';
  let state = applyLoadoutBoard(
    beginSprintLoadout(
      selectSprintLoadout(withLoadoutLevels(seed, rules), indices),
      rules.board === 'both' ? 'big-release' : rules.actual,
      rules.shopPriority,
    ),
    rules,
  );
  const lanes = laneCounts(state);
  const initialHand = [...state.current!.sprint.cardPiles.hand];
  const inputs: string[] = [];
  for (let i = 0; i < rules.surpriseInterrupts; i += 1) {
    const next = surpriseInterrupt(state);
    inputs.push(next === state ? 'surprise-rejected' : 'surprise-interrupt');
    state = next;
  }
  if (
    findLoadoutCard(state, desired) === undefined &&
    state.current!.sprint.cardPiles.drawOrder.length > 0
  ) {
    const discarded = state.current!.sprint.cardPiles.hand[0];
    const exchanged = exchangeSprintLoadoutCard(state, discarded);
    if (exchanged !== state) {
      state = exchanged;
      inputs.push(`exchange:${discarded}`);
    }
  }
  const first = findLoadoutCard(state, desired) ?? state.current!.sprint.cardPiles.hand[0];
  state = playLoadout(state, first, inputs);
  for (let n = 1; n < rules.plays; n += 1) {
    const hand = state.current!.sprint.cardPiles.hand;
    if (hand.length === 0) break;
    const preferred = n === 1 ? findLoadoutCard(state, complement) : undefined;
    const index = preferred ?? [...hand].sort((a, b) => a - b)[0];
    const next = playLoadout(state, index, inputs);
    if (next === state) break;
    state = next;
  }
  let tickInterrupts = 0;
  while (!state.current!.sprint.complete) {
    const before = state.current!.sprint.metrics.interventionsUsed;
    state = tickSprintLoadout(state, true);
    if (state.current!.sprint.metrics.interventionsUsed > before) tickInterrupts += 1;
  }
  inputs.push(`tick-interrupt:${tickInterrupts}`);
  const current = state.current!;
  const played = current.sprint.cardPiles.played;
  return {
    lanes,
    outcome: {
      candidates: [...state.selected],
      initialHand,
      inputs,
      played: played.map((index) => state.collection[index]?.defId ?? 'missing'),
      playedLevels: played.map((index) => state.collection[index]?.level ?? 0),
      delivered: current.sprint.metrics.delivered,
      quality: current.org.quality,
      auditQualityMet: current.org.quality >= getBoss('security-audit')!.clear.minQuality!,
      focusSpent: current.sprint.metrics.focusSpent,
      focusRemaining: current.sprint.focus,
      exchanges: current.exchanges,
      interventions: current.sprint.metrics.interventionsUsed,
      timedOut: current.sprint.metrics.timedOut ?? false,
    },
  };
}

export function sprintLoadoutVerdict(
  rules: Pick<SprintLoadoutFactorRules, 'actual' | 'board'>,
  narrow: Pick<
    SprintLoadoutFactorOutcome,
    'delivered' | 'quality' | 'focusSpent' | 'auditQualityMet'
  >,
  broad: Pick<
    SprintLoadoutFactorOutcome,
    'delivered' | 'quality' | 'focusSpent' | 'auditQualityMet'
  >,
): SprintLoadoutFactorRow['verdict'] {
  const auditOnly = rules.board === 'forecast' && rules.actual === 'security-audit';
  if (auditOnly && narrow.auditQualityMet !== broad.auditQualityMet) {
    return narrow.auditQualityMet ? 'narrow' : 'broad';
  }
  if (narrow.delivered !== broad.delivered) {
    return narrow.delivered > broad.delivered ? 'narrow' : 'broad';
  }
  if (narrow.quality !== broad.quality) return narrow.quality > broad.quality ? 'narrow' : 'broad';
  if (narrow.focusSpent !== broad.focusSpent) {
    return narrow.focusSpent < broad.focusSpent ? 'narrow' : 'broad';
  }
  return 'tie';
}

function factorRow(
  factor: LoadoutFactorName,
  value: string | number,
  seed: string,
  rules: SprintLoadoutFactorRules,
): SprintLoadoutFactorRow {
  const narrowIndices = rules.forecast === 'big-release' ? [0, 1, 2] : [3, 4, 5];
  const narrow = runLoadoutFactor(seed, narrowIndices, rules);
  const broad = runLoadoutFactor(seed, [0, 1, 2, 3, 4, 5], rules);
  return {
    factor,
    value,
    seed,
    forecast: rules.forecast,
    actual: rules.actual,
    board: rules.board,
    plays: rules.plays,
    surpriseInterrupts: rules.surpriseInterrupts,
    shopPriority: [...rules.shopPriority],
    levels: { ...rules.levels },
    definitions: { ...rules.definitions },
    burning: rules.burning,
    taskKind: rules.taskKind,
    lanes: narrow.lanes,
    narrow: narrow.outcome,
    broad: broad.outcome,
    verdict: sprintLoadoutVerdict(rules, narrow.outcome, broad.outcome),
  };
}

/**
 * 初回と同じ資源で要因を一つずつ動かす。固定戦略の再計算であり、人間のプレイ評価ではない。
 * 仕事の種類は定型、予告は実際の単一工程と一致したままにする。この5要因で狭い方が常に強いわけではない。
 */
export function compareSprintLoadoutFactors(): SprintLoadoutFactorRow[] {
  const rows: SprintLoadoutFactorRow[] = [];
  const add = (
    factor: LoadoutFactorName,
    value: string | number,
    rules: SprintLoadoutFactorRules,
  ) => {
    for (const seed of SPRINT_LOADOUT_FACTOR_SEEDS)
      rows.push(factorRow(factor, value, seed, rules));
  };
  for (const forecast of ['big-release', 'security-audit'] as const) {
    const base = () => factorBaseline(forecast);
    add('control', forecast, base());
    for (const plays of [2, 3]) add('plays', plays, { ...base(), plays });
    for (const surprise of [1, 2]) {
      add('surprise', surprise, { ...base(), surpriseInterrupts: surprise });
    }
    for (const index of [0, 1, 2, 3, 4, 5]) {
      add('shop', LOADOUT_COLLECTION[index], { ...base(), shopPriority: [index] });
    }
    for (const level of [1, 2, 3, 4]) {
      add('level', level, {
        ...base(),
        definitions: { 2: 'copilot', 5: 'auto-test' },
        levels: { 0: level, 4: level },
      });
    }
    for (let burning = 0; burning <= 8; burning += 1) {
      add('burning', burning, { ...base(), board: 'both', burning });
    }
  }
  return rows;
}
