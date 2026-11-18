/** RI-260: 2チーム・承認記録の形式差1件。通常sim/保存/rulesetには接続しない。 */
export type IntegrationRoute = 'immediate' | 'pilot' | 'coexist';
export type IntegrationStrategy = IntegrationRoute | 'idle';
export type IntegrationInput =
  | { type: 'integrate'; route: IntegrationRoute }
  | { type: 'train' }
  | { type: 'expand' }
  | { type: 'advance' }
  | { type: 'view' };

export interface IntegrationRules {
  horizon: number;
  betaCapacity: number;
  migrationWork: number;
  mismatchWork: number;
  reworkPerGap: number;
  dualWork: number;
  jointJobs: number;
}

const BASELINE: Readonly<IntegrationRules> = Object.freeze({
  horizon: 6,
  betaCapacity: 6,
  migrationWork: 4,
  mismatchWork: 3,
  reworkPerGap: 2,
  dualWork: 2,
  jointJobs: 6,
});

export interface IntegrationTeam {
  id: 'alpha' | 'beta';
  specialty: 'implementation' | 'operations';
  capacity: number;
  localValuePerWork: number;
  convention: 'written' | 'oral';
  writtenFluency: number;
  localWork: number;
  localValue: number;
}

export interface IntegrationJob {
  id: number;
  releaseAt: number;
  preparationLeft: number;
  preparedAt: number | null;
  translationLeft: number;
  approvalLeft: number;
  approvalConvention: 'written' | 'oral' | null;
  reworkLeft: number;
  reworkCreated: number;
  completedAt: number | null;
  unfinishedPeriods: number;
  handoffWaitPeriods: number;
  capacityWaitPeriods: number;
}

export interface IntegrationWork {
  migration: number;
  training: number;
  dual: number;
  preparation: number;
  translation: number;
  approval: number;
  rework: number;
  local: number;
  unused: number;
}

export interface IntegrationPeriod {
  tick: number;
  compatible: boolean;
  convention: IntegrationTeam['convention'];
  fluency: number;
  completed: number;
  waiting: number;
  alpha: IntegrationWork;
  beta: IntegrationWork;
}

export interface IntegrationState {
  version: 1;
  seed: string;
  tick: number;
  rules: IntegrationRules;
  route: IntegrationRoute | null;
  setupLeft: number;
  expanding: boolean;
  expansionLeft: number;
  trainingPending: boolean;
  teams: [IntegrationTeam, IntegrationTeam];
  jobs: IntegrationJob[];
  periods: IntegrationPeriod[];
  inputs: IntegrationInput[];
}

export function createTeamIntegrationBoss(
  seed = 'RI-260',
  patch: Partial<IntegrationRules> = {},
): IntegrationState {
  const rules = { ...BASELINE, ...patch };
  for (const [key, value] of Object.entries(rules)) {
    const minimum = key === 'migrationWork' ? 2 : ['horizon', 'betaCapacity'].includes(key) ? 1 : 0;
    if (!Number.isInteger(value) || value < minimum || value > 20) throw new RangeError(key);
  }
  return {
    version: 1,
    seed,
    tick: 0,
    rules,
    route: null,
    setupLeft: 0,
    expanding: false,
    expansionLeft: 0,
    trainingPending: false,
    teams: [
      {
        id: 'alpha',
        specialty: 'implementation',
        capacity: 6,
        localValuePerWork: 2,
        convention: 'written',
        writtenFluency: 2,
        localWork: 0,
        localValue: 0,
      },
      {
        id: 'beta',
        specialty: 'operations',
        capacity: rules.betaCapacity,
        localValuePerWork: 3,
        convention: 'oral',
        writtenFluency: 0,
        localWork: 0,
        localValue: 0,
      },
    ],
    jobs: Array.from({ length: rules.jointJobs }, (_, id) => ({
      id,
      releaseAt: id + 1,
      preparationLeft: 2,
      preparedAt: null,
      translationLeft: rules.mismatchWork,
      approvalLeft: 2,
      approvalConvention: null,
      reworkLeft: 0,
      reworkCreated: 0,
      completedAt: null,
      unfinishedPeriods: 0,
      handoffWaitPeriods: 0,
      capacityWaitPeriods: 0,
    })),
    periods: [],
    inputs: [],
  };
}

function emptyWork(): IntegrationWork {
  return {
    migration: 0,
    training: 0,
    dual: 0,
    preparation: 0,
    translation: 0,
    approval: 0,
    rework: 0,
    local: 0,
    unused: 0,
  };
}

function advance(state: IntegrationState): void {
  const [alpha, beta] = state.teams;
  const a = emptyWork();
  const b = emptyWork();
  let alphaLeft = alpha.capacity;
  let betaLeft = beta.capacity;
  const spendBeta = (key: keyof IntegrationWork, required: number) => {
    const paid = Math.min(betaLeft, required);
    b[key] += paid;
    betaLeft -= paid;
    return paid;
  };
  state.tick += 1;

  // 規約変更は移行工数を払い終えた時点。片方の能力・実績はコピーしない。
  state.setupLeft -= spendBeta('migration', state.setupLeft);
  if (state.route === 'immediate' && state.setupLeft === 0) beta.convention = 'written';
  state.expansionLeft -= spendBeta('migration', state.expansionLeft);
  if (state.expanding && state.expansionLeft === 0) beta.convention = 'written';

  // 習熟は共通記録の演習（alphaの指導1、betaの練習2）か実案件完了で増える。
  if (state.trainingPending && alphaLeft >= 1 && betaLeft >= 2) {
    a.training = 1;
    alphaLeft -= 1;
    spendBeta('training', 2);
    beta.writtenFluency = Math.min(2, beta.writtenFluency + 1);
    state.trainingPending = false;
  }

  const dualNeeded = beta.convention === 'oral' && state.route !== null && state.setupLeft === 0;
  const dualReady = dualNeeded && alphaLeft >= 1 && betaLeft >= state.rules.dualWork;
  if (dualReady) {
    a.dual = 1;
    alphaLeft -= 1;
    spendBeta('dual', state.rules.dualWork);
  }
  // pilotは共同案件の入口だけ共通形式。coexistは口頭記録を照合する二重台帳。
  const compatible = beta.convention === 'written' || dualReady;
  const reviewConvention =
    beta.convention === 'written' || (dualReady && state.route === 'pilot') ? 'written' : 'oral';

  for (const job of state.jobs) {
    if (job.releaseAt > state.tick || job.completedAt !== null) continue;
    const prep = Math.min(alphaLeft, job.preparationLeft);
    job.preparationLeft -= prep;
    alphaLeft -= prep;
    a.preparation += prep;
    if (job.preparationLeft === 0 && job.preparedAt === null) job.preparedAt = state.tick;
    if (job.preparedAt === null) continue;

    // 未着手の異形式の受け渡しは翌期まで待つ。閲覧・方針選択自体に罰はない。
    const handoffReady =
      job.approvalConvention !== null || compatible || job.preparedAt < state.tick;
    const betaBefore = betaLeft;
    if (handoffReady) {
      if (!compatible && job.approvalConvention === null)
        job.translationLeft -= spendBeta('translation', job.translationLeft);
      if (compatible || job.translationLeft === 0 || job.approvalConvention !== null) {
        if (job.approvalConvention === null && betaLeft > 0) {
          job.approvalConvention = reviewConvention;
          job.reworkCreated =
            reviewConvention === 'written'
              ? (2 - beta.writtenFluency) * state.rules.reworkPerGap
              : 0;
          job.reworkLeft = job.reworkCreated;
        }
        if (job.approvalConvention !== null) {
          job.approvalLeft -= spendBeta('approval', job.approvalLeft);
          if (job.approvalLeft === 0) job.reworkLeft -= spendBeta('rework', job.reworkLeft);
          if (job.approvalLeft + job.reworkLeft === 0) {
            job.completedAt = state.tick;
            if (job.approvalConvention === 'written')
              beta.writtenFluency = Math.min(2, beta.writtenFluency + 1);
          }
        }
      }
    }
    if (job.completedAt === null) {
      job.unfinishedPeriods += 1;
      if (!handoffReady) job.handoffWaitPeriods += 1;
      else if (betaBefore === betaLeft) job.capacityWaitPeriods += 1;
    }
  }

  // 共同作業と統合作業に使わなかった時間は各チーム固有の仕事に戻す。
  a.local = alphaLeft;
  b.local = betaLeft;
  for (const [team, work] of [
    [alpha, a],
    [beta, b],
  ] as const) {
    team.localWork += work.local;
    team.localValue += work.local * team.localValuePerWork;
  }
  state.periods.push({
    tick: state.tick,
    compatible,
    convention: beta.convention,
    fluency: beta.writtenFluency,
    completed: state.jobs.filter((job) => job.completedAt === state.tick).length,
    waiting: state.jobs.filter((job) => job.preparedAt !== null && job.completedAt === null).length,
    alpha: a,
    beta: b,
  });
}

/** 信頼済み内部入力用。無効・重複・終了後の入力は、課金/時間/履歴を変えない。 */
export function applyTeamIntegrationBoss(
  state: IntegrationState,
  input: IntegrationInput,
): IntegrationState {
  if (input.type === 'view' || state.tick >= state.rules.horizon) return state;
  if (input.type === 'integrate') {
    if (state.route !== null || !['immediate', 'pilot', 'coexist'].includes(input.route))
      return state;
  } else if (input.type === 'expand') {
    if (state.route !== 'pilot' || state.setupLeft > 0 || state.expanding) return state;
  } else if (input.type === 'train') {
    if (
      !['pilot', 'immediate'].includes(state.route ?? '') ||
      state.trainingPending ||
      state.teams[1].writtenFluency >= 2
    )
      return state;
  } else if (input.type !== 'advance') return state;
  const next = structuredClone(state);
  if (input.type === 'integrate') {
    next.route = input.route;
    next.setupLeft =
      input.route === 'immediate' ? next.rules.migrationWork : input.route === 'pilot' ? 1 : 2;
  } else if (input.type === 'expand') {
    next.expanding = true;
    next.expansionLeft = next.rules.migrationWork - 1;
  } else if (input.type === 'train') next.trainingPending = true;
  else advance(next);
  next.inputs.push(structuredClone(input));
  return next;
}

export function summarizeTeamIntegrationBoss(state: IntegrationState) {
  const spent = (key: keyof IntegrationWork) =>
    state.periods.reduce((sum, p) => sum + p.alpha[key] + p.beta[key], 0);
  const completed = state.jobs.filter((job) => job.completedAt !== null).length;
  const localValue = state.teams.reduce((sum, team) => sum + team.localValue, 0);
  return {
    completed,
    jointValue: completed * 12,
    localValue,
    deliveredValue: completed * 12 + localValue,
    pendingJobs: state.jobs.length - completed,
    unfinishedPeriods: state.jobs.reduce((sum, job) => sum + job.unfinishedPeriods, 0),
    handoffWaitPeriods: state.jobs.reduce((sum, job) => sum + job.handoffWaitPeriods, 0),
    capacityWaitPeriods: state.jobs.reduce((sum, job) => sum + job.capacityWaitPeriods, 0),
    migrationWork: spent('migration'),
    migrationLeft: state.setupLeft + state.expansionLeft,
    trainingWork: spent('training'),
    trainingPending: state.trainingPending,
    dualWork: spent('dual'),
    translationWork: spent('translation'),
    rework: spent('rework'),
    reworkLeft: state.jobs.reduce((sum, job) => sum + job.reworkLeft, 0),
    teams: structuredClone(state.teams),
    lost: false,
  };
}

/** 閲覧結果の編集も本体に影響しない。prototype内部JSON v1のみ。 */
export function viewTeamIntegrationBoss(state: IntegrationState) {
  return {
    ...structuredClone(state),
    phase:
      state.tick === 0 ? 'prepare' : state.tick === state.rules.horizon ? 'result' : 'integration',
    result: summarizeTeamIntegrationBoss(state),
  };
}

export function runTeamIntegrationComparison(
  patch: Partial<IntegrationRules> = {},
  startAt = 0,
  expandAt = 2,
) {
  const initial = createTeamIntegrationBoss('RI-260', patch);
  const strategies: IntegrationStrategy[] = ['immediate', 'pilot', 'coexist', 'idle'];
  return {
    initial,
    startAt,
    expandAt,
    strategies: strategies.map((strategy) => {
      let state = initial;
      while (state.tick < state.rules.horizon) {
        if (strategy !== 'idle' && state.tick === startAt)
          state = applyTeamIntegrationBoss(state, { type: 'integrate', route: strategy });
        if (strategy === 'pilot' && state.route === 'pilot' && state.tick < expandAt)
          state = applyTeamIntegrationBoss(state, { type: 'train' });
        if (strategy === 'pilot' && state.tick === expandAt)
          state = applyTeamIntegrationBoss(state, { type: 'expand' });
        state = applyTeamIntegrationBoss(state, { type: 'advance' });
      }
      return {
        strategy,
        inputs: state.inputs,
        timeline: state.periods.map((p) => ({
          tick: p.tick,
          compatible: p.compatible,
          convention: p.convention,
          fluency: p.fluency,
          completed: p.completed,
          waiting: p.waiting,
        })),
        result: summarizeTeamIntegrationBoss(state),
      };
    }),
  };
}

export function compareTeamIntegrationBoss() {
  const cases: [string, Partial<IntegrationRules>, number?, number?][] = [
    ['baseline', {}],
    ['short-horizon', { horizon: 3 }],
    ['long-horizon', { horizon: 10 }],
    ['cheap-migration', { migrationWork: 2 }],
    ['costly-migration', { migrationWork: 8 }],
    ['no-unfamiliar-rework', { reworkPerGap: 0 }],
    ['costly-unfamiliar-rework', { reworkPerGap: 5 }],
    ['cheap-dual-operation', { dualWork: 0 }],
    ['costly-dual-operation', { dualWork: 4 }],
    ['no-translation-work', { mismatchWork: 0 }],
    ['busy-beta', { betaCapacity: 4 }],
    ['late-start', {}, 3, 5],
    ['late-expansion', {}, 0, 4],
    ['no-joint-work', { jointJobs: 0 }],
  ];
  return {
    conditions: {
      seedIsLabel: true,
      randomness: false,
      fixedStrategies: true,
      humanPlaytest: false,
      productionAdoption: false,
      jointValue: 12,
      preparationWork: 2,
      approvalWork: 2,
      pilotSetupWork: 1,
      coexistSetupWork: 2,
      dualAlphaWork: 1,
      trainingAlphaWork: 1,
      trainingBetaWork: 2,
      maxFluency: 2,
      accounting:
        '各期のチーム工数を保存。成果は共同案件価値と固有仕事価値。費用は時間として既に支払うため再減算しない。',
      unpaidControl:
        'idleは移行・演習・二重運用を払わず、異形式受け渡しは翌期以降に案件ごとの記録変換を払う。',
      noTranslationControl: '変換工数0でも異形式の翌期待ちは残す。',
    },
    cases: cases.map(([name, patch, startAt, expandAt]) => ({
      name,
      ...runTeamIntegrationComparison(patch, startAt, expandAt),
    })),
  };
}
