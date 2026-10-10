/** RI-185: 新しいレビュー完了だけで成熟する。カードlevelとは別の段階。 */
export type MatureCard = 'none' | 'steady' | 'growing';
export type MatureStrategy = MatureCard;
export type MatureInput =
  { type: 'adopt'; card: 'steady' | 'growing' } | { type: 'rework' | 'tick' };
export interface MatureState {
  version: 1;
  seed: number;
  tick: number;
  horizon: number;
  focus: number;
  focusSpent: number;
  card: MatureCard;
  cardLevel: number;
  stage: 0 | 1;
  progress: number;
  nextId: number;
  completedIds: string[];
  earnedValue: number;
  reworks: number;
  inputs: MatureInput[];
}
const MATURE_AT = 3;

export function throughputFor(state: MatureState): number {
  if (state.card === 'steady') return 2;
  if (state.card === 'growing' && state.stage === 1) return 3;
  return 1;
}
export function createMaturePrototype(seed: number, horizon: number): MatureState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    focus: 1,
    focusSpent: 0,
    card: 'none',
    cardLevel: 0,
    stage: 0,
    progress: 0,
    nextId: 1,
    completedIds: [],
    earnedValue: 0,
    reworks: 0,
    inputs: [],
  };
}
export function viewMature(state: MatureState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    focus: state.focus,
    card: state.card,
    cardLevel: state.cardLevel,
    stage: state.stage,
    progress: state.progress,
    nextAt: state.card === 'growing' && state.stage === 0 ? MATURE_AT : null,
    throughput: throughputFor(state),
    completed: state.completedIds.length,
    reworks: state.reworks,
  };
}
export function applyMatureInput(state: MatureState, input: MatureInput): MatureState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'adopt' && (state.card !== 'none' || state.focus < 1)) return state;
  if (input.type === 'rework' && state.completedIds.length === 0) return state;
  const next = structuredClone(state);
  if (input.type === 'adopt') {
    next.focus -= 1;
    next.focusSpent += 1;
    next.card = input.card;
  } else if (input.type === 'rework') {
    next.tick += 1;
    next.reworks += 1;
  } else {
    next.tick += 1;
    const amount = throughputFor(next);
    for (let i = 0; i < amount; i++) {
      const id = `r${next.nextId}`;
      next.nextId += 1;
      if (next.completedIds.includes(id)) continue;
      next.completedIds.push(id);
      next.earnedValue += 1;
      if (next.card === 'growing' && next.stage === 0) next.progress += 1;
    }
    if (next.card === 'growing' && next.progress >= MATURE_AT) next.stage = 1;
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeMature(state: MatureState) {
  return {
    card: state.card,
    cardLevel: state.cardLevel,
    stage: state.stage,
    progress: state.progress,
    completed: state.completedIds.length,
    reworks: state.reworks,
    earnedValue: state.earnedValue,
    focusSpent: state.focusSpent,
    netValue: state.earnedValue - state.focusSpent,
  };
}
export function compareMatureStrategies() {
  const plans: { horizon: number; strategy: MatureStrategy }[] = [
    { horizon: 4, strategy: 'none' },
    { horizon: 4, strategy: 'steady' },
    { horizon: 4, strategy: 'growing' },
    { horizon: 10, strategy: 'none' },
    { horizon: 10, strategy: 'steady' },
    { horizon: 10, strategy: 'growing' },
  ];
  return plans.map(({ horizon, strategy }) => {
    const initial = createMaturePrototype(1, horizon);
    let state = initial;
    if (strategy !== 'none') state = applyMatureInput(state, { type: 'adopt', card: strategy });
    while (state.tick < state.horizon) state = applyMatureInput(state, { type: 'tick' });
    return {
      horizon,
      seed: 1,
      strategy,
      initial,
      inputs: state.inputs,
      result: summarizeMature(state),
    };
  });
}
