/** RI-201: 階級・レベルとは別に、最初の期だけ専門家か育成役を選ぶ。チームリードは要因比較でだけ許可する。 */

export type Career = 'specialist' | 'coach' | 'lead';
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
const SPECIALIST_FATIGUE = 1;
const COACH_FATIGUE = 2;
/** リードの本人成果は育成役と同じ。新しい成果係数は足さない。 */
const LEAD_OUTPUT = COACH_OUTPUT;
const LEAD_FATIGUE = SPECIALIST_FATIGUE;
/** 支援は初回の成長幅と同じ量を当期の出荷だけに足す。レビューは上げない。 */
const LEAD_SUPPORT = GROWTH;

export interface CareerApplyRules {
  specialistOutput?: number;
  growth?: number;
  allowLead?: boolean;
}

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

export function viewCareer(state: CareerState, rules?: CareerApplyRules) {
  const person = candidate(state);
  return {
    period: state.period,
    horizon: state.horizon,
    deadline: state.deadline,
    penalty: state.penalty,
    choiceOpen: state.period === 0 && person?.career === null,
    canChange: false,
    paths: rules?.allowLead ? ['specialist', 'coach', 'lead'] : ['specialist', 'coach'],
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

export function applyCareerInput(
  state: CareerState,
  input: CareerInput,
  rules?: CareerApplyRules,
): CareerState {
  if (state.period >= state.horizon) return state;
  if (input.type === 'choose') return chooseCareer(state, input.career, rules);
  return advance(state, rules);
}

function chooseCareer(state: CareerState, career: string, rules?: CareerApplyRules): CareerState {
  const person = candidate(state);
  if (state.period !== 0 || !person || person.career !== null) return state;
  const leadAllowed = career === 'lead' && rules?.allowLead === true;
  if (career !== 'specialist' && career !== 'coach' && !leadAllowed) return state;
  const next = structuredClone(state);
  const chosen = candidate(next);
  if (!chosen) return state;
  chosen.career = leadAllowed ? 'lead' : career === 'coach' ? 'coach' : 'specialist';
  next.inputs.push({ type: 'choose', career: chosen.career });
  return next;
}

function advance(state: CareerState, rules?: CareerApplyRules): CareerState {
  const person = candidate(state);
  if (!person?.career) return state;
  const next = structuredClone(state);
  const chosen = candidate(next);
  if (!chosen?.career) return state;
  const specialistOutput = rules?.specialistOutput ?? SPECIALIST_OUTPUT;
  const growth = rules?.growth ?? GROWTH;
  let produced =
    chosen.career === 'specialist'
      ? specialistOutput
      : chosen.career === 'lead'
        ? LEAD_OUTPUT
        : COACH_OUTPUT;
  chosen.fatigue +=
    chosen.career === 'coach'
      ? COACH_FATIGUE
      : chosen.career === 'lead'
        ? LEAD_FATIGUE
        : SPECIALIST_FATIGUE;
  for (const junior of next.members) {
    if (junior.role !== 'junior') continue;
    const base = junior.review >= SKILL_THRESHOLD ? SKILLED_OUTPUT : JUNIOR_OUTPUT;
    produced += chosen.career === 'lead' ? base + LEAD_SUPPORT : base;
    if (chosen.career !== 'coach' || junior.review >= SKILL_CAP) continue;
    const gain = Math.min(Math.max(growth, 0), SKILL_CAP - junior.review);
    if (gain <= 0) continue;
    junior.review += gain;
    next.growth += gain;
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

const FACTOR_SEED = 'RI-201';
const OUTPUTS = [2, 3, 4, 6, 8, 9, 10] as const;
const GROWTHS = [0, 1, 2, 3, 4] as const;
const PENALTIES = [-6, -5, -4, 0, 6, 12] as const;
type CareerFactorAxis = 'output' | 'growth' | 'penalty';
type CareerPreference = 'specialist' | 'coach' | 'tie';
interface CareerFactorRules {
  specialistOutput: number;
  growth: number;
  penalty: number;
  allowLead?: boolean;
}
interface CareerFactorRun {
  inputs: CareerInput[];
  result: ReturnType<typeof summarizeCareer>;
}
interface CareerFactorPoint {
  axis: CareerFactorAxis;
  parameter: string;
  scenario: CareerScenario;
  rules: {
    specialistOutput: number;
    coachOutput: number;
    growth: number;
    penalty: number | null;
    juniorOutput: number;
    skilledOutput: number;
    skillThreshold: number;
    skillCap: number;
  };
  preference: CareerPreference;
  margin: number;
  sameAsFirstComparison: boolean;
  specialist: CareerFactorRun;
  coach: CareerFactorRun;
}
interface CareerFactorReversal {
  axis: CareerFactorAxis;
  scenario: CareerScenario;
  before: { parameter: string; preference: CareerPreference; specialist: number; coach: number };
  after: { parameter: string; preference: CareerPreference; specialist: number; coach: number };
}

function preferenceOf(specialistScore: number, coachScore: number): CareerPreference {
  if (specialistScore > coachScore) return 'specialist';
  if (coachScore > specialistScore) return 'coach';
  return 'tie';
}

function runCareer(scenario: CareerScenario, strategy: Career, rules: CareerFactorRules) {
  const state = createCareerPrototype(FACTOR_SEED, scenario);
  if (state.deadline !== null) state.penalty = rules.penalty;
  const applyRules: CareerApplyRules = {
    specialistOutput: rules.specialistOutput,
    growth: rules.growth,
    allowLead: rules.allowLead,
  };
  let current = state;
  let guard = 0;
  while (current.period < current.horizon) {
    if (++guard > 10) throw new Error(`${scenario}:${strategy}`);
    const next = applyCareerInput(current, chooseCareerAction(current, strategy), applyRules);
    if (next === current) throw new Error(`${scenario}:${strategy}@${current.period}`);
    current = next;
  }
  return { inputs: current.inputs, result: summarizeCareer(current) };
}

function factorPoint(
  axis: CareerFactorAxis,
  parameter: string,
  scenario: CareerScenario,
  rules: CareerFactorRules,
): CareerFactorPoint {
  const specialist = runCareer(scenario, 'specialist', rules);
  const coach = runCareer(scenario, 'coach', rules);
  return {
    axis,
    parameter,
    scenario,
    rules: {
      specialistOutput: rules.specialistOutput,
      coachOutput: COACH_OUTPUT,
      growth: rules.growth,
      penalty: scenario === 'short' ? rules.penalty : null,
      juniorOutput: JUNIOR_OUTPUT,
      skilledOutput: SKILLED_OUTPUT,
      skillThreshold: SKILL_THRESHOLD,
      skillCap: SKILL_CAP,
    },
    preference: preferenceOf(specialist.result.score, coach.result.score),
    margin: specialist.result.score - coach.result.score,
    sameAsFirstComparison:
      rules.specialistOutput === SPECIALIST_OUTPUT &&
      rules.growth === GROWTH &&
      (scenario === 'long' || rules.penalty === SCENARIOS.short.penalty),
    specialist,
    coach,
  };
}

function reversalsOf(rows: CareerFactorPoint[]): CareerFactorReversal[] {
  const found: CareerFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after || before.preference === after.preference) continue;
    found.push({
      axis: before.axis,
      scenario: before.scenario,
      before: {
        parameter: before.parameter,
        preference: before.preference,
        specialist: before.specialist.result.score,
        coach: before.coach.result.score,
      },
      after: {
        parameter: after.parameter,
        preference: after.preference,
        specialist: after.specialist.result.score,
        coach: after.coach.result.score,
      },
    });
  }
  return found;
}

function sweep(
  axis: CareerFactorAxis,
  scenario: CareerScenario,
  values: readonly number[],
  rulesFor: (value: number) => CareerFactorRules,
) {
  return values.map((value) => factorPoint(axis, String(value), scenario, rulesFor(value)));
}

/** 初回と同じ資源で、成果・成長幅・納期の罰を一つずつ動かす。チームリードは別に残す。固定戦略。 */
export function compareCareerFactorReversals() {
  const outputRules = (specialistOutput: number): CareerFactorRules => ({
    specialistOutput,
    growth: GROWTH,
    penalty: SCENARIOS.short.penalty,
  });
  const growthRules = (growth: number): CareerFactorRules => ({
    specialistOutput: SPECIALIST_OUTPUT,
    growth,
    penalty: SCENARIOS.short.penalty,
  });
  const penaltyRules = (penalty: number): CareerFactorRules => ({
    specialistOutput: SPECIALIST_OUTPUT,
    growth: GROWTH,
    penalty,
  });
  const sweeps = {
    output: {
      short: sweep('output', 'short', OUTPUTS, outputRules),
      long: sweep('output', 'long', OUTPUTS, outputRules),
    },
    growth: {
      short: sweep('growth', 'short', GROWTHS, growthRules),
      long: sweep('growth', 'long', GROWTHS, growthRules),
    },
    penalty: {
      short: sweep('penalty', 'short', PENALTIES, penaltyRules),
    },
  };
  const baseline = compareCareers(FACTOR_SEED);
  const baselineScore = (scenario: CareerScenario, strategy: 'specialist' | 'coach') => {
    const row = baseline.find((item) => item.scenario === scenario && item.strategy === strategy);
    if (!row) throw new Error(`${scenario}:${strategy}`);
    return row.result.score;
  };
  const leadRows = (['short', 'long'] as const).map((scenario) => {
    const run = runCareer(scenario, 'lead', {
      specialistOutput: SPECIALIST_OUTPUT,
      growth: GROWTH,
      penalty: scenario === 'short' ? SCENARIOS.short.penalty : 0,
      allowLead: true,
    });
    const specialist = baselineScore(scenario, 'specialist');
    const coach = baselineScore(scenario, 'coach');
    const lead = run.result.score;
    const above = (['specialist', 'coach'] as const).filter((path) =>
      path === 'specialist' ? lead > specialist : lead > coach,
    );
    return {
      scenario,
      inputs: run.inputs,
      result: run.result,
      scores: { lead, specialist, coach },
      beats: { specialist: lead > specialist, coach: lead > coach },
      above,
    };
  });
  const probe = createCareerPrototype(FACTOR_SEED, 'short');
  return {
    conditions: {
      seed: FACTOR_SEED,
      roster: probe.members.map((member) => ({
        id: member.id,
        role: member.role,
        rank: member.rank,
        level: member.level,
        review: member.review,
      })),
      scenarios: {
        short: { horizon: SCENARIOS.short.horizon, deadline: SCENARIOS.short.deadline },
        long: { horizon: SCENARIOS.long.horizon, deadline: SCENARIOS.long.deadline },
      },
      decision: {
        existingPaths: ['specialist', 'coach'] as const,
        score: 'value - penalties',
      },
      baseline: {
        specialistOutput: SPECIALIST_OUTPUT,
        coachOutput: COACH_OUTPUT,
        growth: GROWTH,
        penalty: SCENARIOS.short.penalty,
        juniorOutput: JUNIOR_OUTPUT,
        skilledOutput: SKILLED_OUTPUT,
        skillThreshold: SKILL_THRESHOLD,
        skillCap: SKILL_CAP,
      },
      held: {
        output:
          '専門家の成果だけを動かす。育成役の成果3、成長幅2、未熟1、熟練6、閾値4、上限6、短い納期の罰6。長い盤面に罰は無い',
        growth:
          '成長幅だけを動かす。1期に後進へ足せるのは上限6までの残り。専門家の成果8、育成役3、短い納期の罰6。長い盤面に罰は無い',
        penalty:
          '短い納期の罰だけを動かす。専門家の成果8、成長幅2。長い盤面は納期が無いので再出力しない',
      },
      omitted: '初回の4行は再出力しない。チームリードは要因の表に入れない',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
      leadSeparate: true,
    },
    sweeps,
    reversals: [
      ...reversalsOf(sweeps.output.short),
      ...reversalsOf(sweeps.output.long),
      ...reversalsOf(sweeps.growth.short),
      ...reversalsOf(sweeps.growth.long),
      ...reversalsOf(sweeps.penalty.short),
    ],
    lead: {
      separateFromSweeps: true,
      fixedStrategy: true,
      humanPlaytest: false,
      rule: {
        output: LEAD_OUTPUT,
        fatigue: LEAD_FATIGUE,
        support: LEAD_SUPPORT,
        raisesReview: false,
        rankUnchanged: true,
        levelUnchanged: true,
      },
      rows: leadRows,
    },
  };
}
