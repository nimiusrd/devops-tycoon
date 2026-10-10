/** RI-201: 階級・レベルとは別に、最初の期だけ専門家か育成役を選ぶ。 */

export type Career = 'specialist' | 'coach';
export type CareerScenario = 'short' | 'long';
export type CareerStrategy = Career;
export interface CareerMember {
  id: string;
  role: 'candidate' | 'junior';
  rank: 'senior' | 'junior';
  level: 1;
  career: Career | null;
  review: number;
  fatigue: number;
}
export type CareerInput = { type: 'choose'; career: string } | { type: 'period' };
export interface CareerState {
  version: 1;
  seed: string;
  scenario: CareerScenario;
  period: number;
  horizon: number;
  deadline: number | null;
  penalty: number;
  value: number;
  growth: number;
  penalties: number;
  members: CareerMember[];
  inputs: CareerInput[];
}

const SPECIALIST_OUTPUT = 8;
const COACH_OUTPUT = 3;
const JUNIOR_OUTPUT = 1;
const SKILLED_OUTPUT = 6;
const SKILL_THRESHOLD = 4;
const SKILL_CAP = 6;
const GROWTH = 2;

const SCENARIOS: Record<
  CareerScenario,
  { horizon: number; deadline: number | null; penalty: number }
> = {
  short: { horizon: 1, deadline: 8, penalty: 6 },
  long: { horizon: 3, deadline: null, penalty: 0 },
};

export function createCareerPrototype(seed: string, scenario: CareerScenario): CareerState {
  const preset = SCENARIOS[scenario];
  return {
    version: 1,
    seed,
    scenario,
    period: 0,
    horizon: preset.horizon,
    deadline: preset.deadline,
    penalty: preset.penalty,
    value: 0,
    growth: 0,
    penalties: 0,
    members: [
      {
        id: 'aoi',
        role: 'candidate',
        rank: 'senior',
        level: 1,
        career: null,
        review: 8,
        fatigue: 0,
      },
      { id: 'jun', role: 'junior', rank: 'junior', level: 1, career: null, review: 2, fatigue: 0 },
      { id: 'mei', role: 'junior', rank: 'junior', level: 1, career: null, review: 2, fatigue: 0 },
    ],
    inputs: [],
  };
}

function candidate(state: CareerState): CareerMember | undefined {
  return state.members.find((member) => member.role === 'candidate');
}

export function viewCareer(state: CareerState) {
  const person = candidate(state);
  return {
    period: state.period,
    horizon: state.horizon,
    deadline: state.deadline,
    penalty: state.penalty,
    choiceOpen: state.period === 0 && person?.career === null,
    canChange: false,
    paths: ['specialist', 'coach'],
    candidate: person
      ? {
          id: person.id,
          rank: person.rank,
          level: person.level,
          career: person.career,
          review: person.review,
          fatigue: person.fatigue,
        }
      : null,
    juniors: state.members
      .filter((member) => member.role === 'junior')
      .map((member) => ({
        id: member.id,
        rank: member.rank,
        level: member.level,
        review: member.review,
        output: member.review >= SKILL_THRESHOLD ? SKILLED_OUTPUT : JUNIOR_OUTPUT,
      })),
  };
}

export function applyCareerInput(state: CareerState, input: CareerInput): CareerState {
  if (state.period >= state.horizon) return state;
  if (input.type === 'choose') return chooseCareer(state, input.career);
  return advance(state);
}

function chooseCareer(state: CareerState, career: string): CareerState {
  const person = candidate(state);
  if (state.period !== 0 || !person || person.career !== null) return state;
  if (career !== 'specialist' && career !== 'coach') return state;
  const next = structuredClone(state);
  const chosen = candidate(next);
  if (!chosen) return state;
  chosen.career = career;
  next.inputs.push({ type: 'choose', career });
  return next;
}

function advance(state: CareerState): CareerState {
  const person = candidate(state);
  if (!person?.career) return state;
  const next = structuredClone(state);
  const chosen = candidate(next);
  if (!chosen?.career) return state;
  let produced = chosen.career === 'specialist' ? SPECIALIST_OUTPUT : COACH_OUTPUT;
  chosen.fatigue += chosen.career === 'specialist' ? 1 : 2;
  for (const junior of next.members) {
    if (junior.role !== 'junior') continue;
    produced += junior.review >= SKILL_THRESHOLD ? SKILLED_OUTPUT : JUNIOR_OUTPUT;
    if (chosen.career === 'coach' && junior.review < SKILL_CAP) {
      junior.review += GROWTH;
      next.growth += GROWTH;
    }
  }
  next.value += produced;
  next.period += 1;
  if (next.period === next.horizon && next.deadline !== null && next.value < next.deadline) {
    next.penalties += next.penalty;
  }
  next.inputs.push({ type: 'period' });
  return next;
}

export function summarizeCareer(state: CareerState) {
  const person = candidate(state);
  return {
    career: person?.career ?? null,
    rank: person?.rank ?? null,
    level: person?.level ?? null,
    value: state.value,
    growth: state.growth,
    fatigue: person?.fatigue ?? 0,
    penalties: state.penalties,
    score: state.value - state.penalties,
    juniors: state.members
      .filter((member) => member.role === 'junior')
      .map((member) => ({
        id: member.id,
        rank: member.rank,
        level: member.level,
        review: member.review,
      })),
  };
}

export function chooseCareerAction(state: CareerState, strategy: CareerStrategy): CareerInput {
  if (candidate(state)?.career === null) return { type: 'choose', career: strategy };
  return { type: 'period' };
}

export function compareCareers(seed = 'RI-201') {
  return (['short', 'long'] as const).flatMap((scenario) =>
    (['specialist', 'coach'] as const).map((strategy) => {
      const initial = createCareerPrototype(seed, scenario);
      let state = initial;
      let guard = 0;
      while (state.period < state.horizon) {
        if (++guard > 10) throw new Error(`${scenario}:${strategy}`);
        const next = applyCareerInput(state, chooseCareerAction(state, strategy));
        if (next === state) throw new Error(`${scenario}:${strategy}@${state.period}`);
        state = next;
      }
      return {
        scenario,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeCareer(state),
      };
    }),
  );
}
