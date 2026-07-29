import { describe, expect, it } from 'vitest';
import type { BossDef } from '../../src/data/bosses';
import {
  AI_DEPENDENCY_CAP,
  AI_LITERACY_UNSAFE_CAP,
  BUDGET_EXHAUSTED_CAP,
  CONSECUTIVE_INCIDENT_SPRINT_CAP,
  REVIEW_FREEZE_PEAK,
  TECH_DEBT_CAP,
  evaluateBoss,
  evaluateLose,
  evaluateWinType,
  winView,
} from '../../src/sim/outcome';
import type { RunTotals, WinType } from '../../src/sim/run/types';
import type { OrgState, SprintResult } from '../../src/sim/types';

const org = (overrides: Partial<OrgState> = {}): OrgState => ({
  aiEnabled: true,
  aiDependency: AI_DEPENDENCY_CAP - 1,
  aiLiteracy: AI_LITERACY_UNSAFE_CAP,
  testCoverage: 50,
  documentation: 50,
  quality: 50,
  morale: 2,
  seniorHp: 2,
  techDebt: TECH_DEBT_CAP - 1,
  deliveryScore: 0,
  ...overrides,
});

const totals = (overrides: Partial<RunTotals> = {}): RunTotals => ({
  delivered: 0,
  done: 0,
  rework: 0,
  incidents: 0,
  contained: 0,
  spread: 0,
  aiAssisted: 0,
  completed: 0,
  reviewQueuePeak: REVIEW_FREEZE_PEAK - 1,
  maxCombo: 0,
  consecutiveIncidentSprints: CONSECUTIVE_INCIDENT_SPRINT_CAP - 1,
  ...overrides,
});

const sprintResult = (overrides: Partial<SprintResult> = {}): SprintResult => ({
  done: 0,
  delivered: 120,
  maxCombo: 0,
  aiAssistedPct: 50,
  reviewQueueMax: 0,
  rework: 0,
  incidents: 0,
  contained: 0,
  spread: 2,
  seniorHpDelta: 0,
  actionCounts: {},
  grade: 'A',
  title: 'ok',
  diagnosis: 'ok',
  timeline: [],
  events: [],
  fireEvents: [],
  focusRemaining: 0,
  focusMax: 0,
  autoContainCount: 0,
  ...overrides,
});

describe('evaluateLose', () => {
  it('全敗北条件の直前値はラン継続として扱う', () => {
    expect(evaluateLose(org(), totals(), BUDGET_EXHAUSTED_CAP + 1)).toBeNull();
    expect(
      evaluateLose(
        org({ aiDependency: AI_DEPENDENCY_CAP, aiLiteracy: AI_LITERACY_UNSAFE_CAP + 1 }),
        totals({ consecutiveIncidentSprints: undefined }),
        BUDGET_EXHAUSTED_CAP + 1,
      ),
    ).toBeNull();
  });

  it.each([
    ['seniorBurnout', org({ seniorHp: 1 }), totals(), BUDGET_EXHAUSTED_CAP + 1],
    ['moraleCollapse', org({ morale: 1 }), totals(), BUDGET_EXHAUSTED_CAP + 1],
    ['techDebt', org({ techDebt: TECH_DEBT_CAP }), totals(), BUDGET_EXHAUSTED_CAP + 1],
    [
      'reviewFreeze',
      org(),
      totals({ reviewQueuePeak: REVIEW_FREEZE_PEAK }),
      BUDGET_EXHAUSTED_CAP + 1,
    ],
    [
      'incidentCascade',
      org(),
      totals({ consecutiveIncidentSprints: CONSECUTIVE_INCIDENT_SPRINT_CAP }),
      BUDGET_EXHAUSTED_CAP + 1,
    ],
    [
      'aiDependency',
      org({ aiDependency: AI_DEPENDENCY_CAP, aiLiteracy: AI_LITERACY_UNSAFE_CAP }),
      totals(),
      BUDGET_EXHAUSTED_CAP + 1,
    ],
    ['budgetExhausted', org(), totals(), BUDGET_EXHAUSTED_CAP],
  ] as const)('%s は境界値ちょうどで敗北する', (reason, state, runTotals, budget) => {
    expect(evaluateLose(state, runTotals, budget)).toBe(reason);
  });

  it('AI 依存敗北は依存度上限以上かつリテラシー危険域以下の場合だけ成立する', () => {
    expect(
      evaluateLose(
        org({ aiDependency: AI_DEPENDENCY_CAP - 1, aiLiteracy: AI_LITERACY_UNSAFE_CAP }),
        totals(),
        BUDGET_EXHAUSTED_CAP + 1,
      ),
    ).toBeNull();
    expect(
      evaluateLose(
        org({ aiDependency: AI_DEPENDENCY_CAP, aiLiteracy: AI_LITERACY_UNSAFE_CAP + 1 }),
        totals(),
        BUDGET_EXHAUSTED_CAP + 1,
      ),
    ).toBeNull();
    expect(
      evaluateLose(
        org({ aiDependency: AI_DEPENDENCY_CAP, aiLiteracy: AI_LITERACY_UNSAFE_CAP }),
        totals(),
        BUDGET_EXHAUSTED_CAP + 1,
      ),
    ).toBe('aiDependency');
  });
});

describe('evaluateBoss', () => {
  const boss: BossDef = {
    id: 'boundary-boss',
    name: '境界ボス',
    description: 'threshold test',
    taskCountMul: 1,
    incidentMul: 1,
    clear: {
      minSprintDelivered: 60,
      maxSpread: 2,
      maxTechDebt: 40,
      minAiPct: 50,
      minMorale: 45,
      minQuality: 55,
    },
  };

  it('全 clear 条件は閾値ちょうどなら突破できる', () => {
    expect(
      evaluateBoss({
        boss,
        result: sprintResult({ delivered: 90, spread: 2, aiAssistedPct: 50 }),
        org: org({ techDebt: 40, morale: 45, quality: 55 }),
        bossTargetMul: 1.5,
      }),
    ).toBe(true);
  });

  it.each([
    ['delivered', sprintResult({ delivered: 89 }), org({ techDebt: 40, morale: 45, quality: 55 })],
    ['spread', sprintResult({ spread: 3 }), org({ techDebt: 40, morale: 45, quality: 55 })],
    ['techDebt', sprintResult(), org({ techDebt: 41, morale: 45, quality: 55 })],
    [
      'aiAssistedPct',
      sprintResult({ aiAssistedPct: 49 }),
      org({ techDebt: 40, morale: 45, quality: 55 }),
    ],
    ['morale', sprintResult(), org({ techDebt: 40, morale: 44, quality: 55 })],
    ['quality', sprintResult(), org({ techDebt: 40, morale: 45, quality: 54 })],
  ] as const)('%s が閾値を1だけ外れると突破失敗になる', (_field, result, state) => {
    expect(evaluateBoss({ boss, result, org: state, bossTargetMul: 1.5 })).toBe(false);
  });

  it('clear 条件が空のボスは常に突破できる', () => {
    expect(
      evaluateBoss({
        boss: { ...boss, clear: {} },
        result: sprintResult({ delivered: 0, spread: 99, aiAssistedPct: 0 }),
        org: org({ techDebt: 99, morale: 0, quality: 0 }),
        bossTargetMul: 10,
      }),
    ).toBe(true);
  });

  it.each([
    [
      'minSprintDelivered',
      { clear: { minSprintDelivered: 60 }, bossTargetMul: 1.5 },
      sprintResult({ delivered: 89 }),
      org(),
    ],
    [
      'maxSpread',
      { clear: { maxSpread: 2 }, bossTargetMul: 1 },
      sprintResult({ spread: 3 }),
      org(),
    ],
    [
      'maxTechDebt',
      { clear: { maxTechDebt: 40 }, bossTargetMul: 1 },
      sprintResult(),
      org({ techDebt: 41 }),
    ],
    [
      'minAiPct',
      { clear: { minAiPct: 50 }, bossTargetMul: 1 },
      sprintResult({ aiAssistedPct: 49 }),
      org(),
    ],
    [
      'minMorale',
      { clear: { minMorale: 45 }, bossTargetMul: 1 },
      sprintResult(),
      org({ morale: 44 }),
    ],
    [
      'minQuality',
      { clear: { minQuality: 55 }, bossTargetMul: 1 },
      sprintResult(),
      org({ quality: 54 }),
    ],
  ] as const)('%s 単独条件でも閾値未満なら突破失敗になる', (_field, config, result, state) => {
    expect(
      evaluateBoss({
        boss: { ...boss, clear: config.clear },
        result,
        org: state,
        bossTargetMul: config.bossTargetMul,
      }),
    ).toBe(false);
  });
});

describe('winView', () => {
  it.each([
    ['normal', '通常勝利', 'ボスを突破し、四半期を完遂した。'],
    ['healthy', '健全勝利', '出荷・品質・士気をすべて高く保って突破した。'],
    ['aiSuccess', 'AI 導入成功勝利', '高い AI 利用率を、手戻りとレビュー渋滞を抑えて両立した。'],
    ['management', '経営勝利', '予算に余裕を残しながら成果を最大化した。'],
    ['happiness', '現場幸福勝利', 'Morale とシニア体力を高く保ち続けた。'],
    ['chaos', 'カオス勝利', '障害を連発しながら、なぜか出荷だけは最大化した。'],
    ['noDamage', 'ノーダメージ勝利', '残業・アンドンを使わず、延焼を一度も許さずに突破した。'],
  ] as const)('%s の表示情報を返す', (type, label, description) => {
    expect(winView(type)).toEqual({ type, label, description });
  });
});

describe('evaluateWinType', () => {
  const runTotals = (overrides: Partial<RunTotals> = {}): RunTotals =>
    totals({
      delivered: 100,
      rework: 3,
      spread: 1,
      aiAssisted: 0,
      completed: 10,
      reviewQueuePeak: 20,
      consecutiveIncidentSprints: 0,
      ...overrides,
    });

  const win = (
    expected: WinType,
    options: {
      org?: Partial<OrgState>;
      totals?: Partial<RunTotals>;
      budget?: number;
      usedHeavyActions?: boolean;
    },
  ) => {
    expect(
      evaluateWinType({
        org: org({ seniorHp: 30, morale: 50, quality: 50, ...(options.org ?? {}) }),
        totals: runTotals(options.totals),
        budget: options.budget ?? 10,
        usedHeavyActions: options.usedHeavyActions ?? true,
      }),
    ).toBe(expected);
  };

  it('ノーダメージは重い介入なし、かつ延焼0のとき最優先になる', () => {
    win('noDamage', { totals: { spread: 0 }, usedHeavyActions: false });
    win('normal', { totals: { spread: 1 }, usedHeavyActions: false });
    win('normal', { totals: { spread: 0 }, usedHeavyActions: true });
  });

  it('健全勝利は品質・士気60以上、かつ手戻り率25%未満で成立する', () => {
    win('healthy', { org: { quality: 60, morale: 60 }, totals: { completed: 4, rework: 0 } });
    win('normal', { org: { quality: 60, morale: 59 }, totals: { completed: 4, rework: 0 } });
    win('normal', { org: { quality: 59, morale: 60 }, totals: { completed: 4, rework: 0 } });
    win('normal', { org: { quality: 60, morale: 60 }, totals: { completed: 4, rework: 1 } });
  });

  it('AI導入成功はAI比率50%以上、手戻り率20%未満、レビュー待ちピーク16未満で成立する', () => {
    win('aiSuccess', {
      totals: { completed: 10, aiAssisted: 5, rework: 1, reviewQueuePeak: 15 },
    });
    win('normal', { totals: { completed: 10, aiAssisted: 4, rework: 1, reviewQueuePeak: 15 } });
    win('normal', { totals: { completed: 10, aiAssisted: 5, rework: 2, reviewQueuePeak: 15 } });
    win('normal', { totals: { completed: 10, aiAssisted: 5, rework: 1, reviewQueuePeak: 16 } });
  });

  it('幸福・経営・カオス勝利はそれぞれの境界値ちょうどで成立する', () => {
    win('happiness', { org: { morale: 65, seniorHp: 50 } });
    win('normal', { org: { morale: 65, seniorHp: 49 } });
    win('normal', { org: { morale: 64, seniorHp: 50 } });
    win('management', { budget: 40 });
    win('chaos', { totals: { incidents: 8, delivered: 300 } });
    win('normal', { totals: { incidents: 8, delivered: 299 } });
    win('normal', { totals: { incidents: 7, delivered: 300 } });
  });
});
