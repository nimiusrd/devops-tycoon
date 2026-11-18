import { describe, expect, it } from 'vitest';
import { IDENTITY_CARD_EFFECTS } from '../sim/model';
import {
  AUDITOR_RULES,
  applyAuditorPlan,
  auditorFeedback,
  createAuditorSession,
  createAuditorSimulation,
  createAuditorSpec,
  restoreAuditorSession,
  runAuditorSimulation,
  submitAuditorAnswer,
  summarizeAuditorSimulation,
  tickAuditorSimulation,
  viewAuditorCase,
  type AuditorAnswer,
  type AuditorCause,
} from './auditorMode';

const evidenceIds = ['observation:result', 'trial:review', 'trial:contain'];
const answer = (cause: AuditorCause, plan: AuditorAnswer['plan']): AuditorAnswer => ({
  cause,
  plan,
  evidenceIds,
});

describe('RI-265 架空の監査ケース', () => {
  it('通常ランの共有係数を変更しない', () => {
    const before = structuredClone(IDENTITY_CARD_EFFECTS);
    runAuditorSimulation(createAuditorSpec('RI-265:1', 'review-capacity'), 'broad');
    expect(IDENTITY_CARD_EFFECTS).toEqual(before);
  });

  it('同じ期限超過でも、対照介入が主因ごとに異なる', () => {
    for (const cause of ['review-capacity', 'uncontained-fire'] as const) {
      const spec = createAuditorSpec('RI-265:1', cause);
      const session = createAuditorSession(spec);
      expect(runAuditorSimulation(spec).outcome).toBe('deadline-missed');
      const plan = cause === 'review-capacity' ? 'review' : 'contain';
      const feedback = auditorFeedback(submitAuditorAnswer(session, answer(cause, plan)))!;
      expect(feedback.supportedCause).toBe(cause);
      expect(feedback.answerSupported).toBe(true);
      expect(feedback.selected.result.outcome).toBe('cleared');
      expect(feedback.minimumEffectivePlans).toEqual([plan]);
      expect(feedback.budgetRemaining).toBe(2);
    }
  });

  it('生成事実、未公開trial、答え合わせを回答前のviewに出さない', () => {
    const session = createAuditorSession(
      createAuditorSpec('RI-265:1', 'uncontained-fire', 'observational'),
    );
    const before = JSON.stringify(session);
    const view = viewAuditorCase(session);
    expect(auditorFeedback(session)).toBeNull();
    expect(view.controlledTrials).toEqual([]);
    expect(view).not.toHaveProperty('generatedCause');
    expect(JSON.stringify(view)).not.toContain('rngState');
    expect(JSON.stringify(view)).not.toContain('generatedCause');
    view.rules.costs.review = 999;
    view.logs.length = 0;
    expect(JSON.stringify(session)).toBe(before);
  });

  it('正しいラベルでも観察ログだけでは原因を断定しない', () => {
    const spec = createAuditorSpec('RI-265:1', 'review-capacity', 'observational');
    const session = createAuditorSession(spec);
    const submitted = submitAuditorAnswer(session, {
      cause: 'review-capacity',
      plan: 'review',
      evidenceIds: ['observation:result'],
    });
    const feedback = auditorFeedback(submitted)!;
    expect(feedback.generatedCause).toBe('review-capacity');
    expect(feedback.causalClaim).toBe('insufficient-evidence');
    expect(feedback.answerSupported).toBe(false);
    expect(feedback.missingEvidence).toEqual(['trial:review', 'trial:contain']);
    expect(submitAuditorAnswer(session, answer('review-capacity', 'review'))).toBe(session);
    expect(
      auditorFeedback(
        submitAuditorAnswer(session, {
          cause: 'insufficient',
          plan: 'review',
          evidenceIds: ['observation:result'],
        }),
      )!.answerSupported,
    ).toBe(true);
  });

  it('対照がどれも成功しない条件では生成原因を確認済みにしない', () => {
    const spec = createAuditorSpec('RI-265:1', 'uncontained-fire', 'controlled', {
      ...AUDITOR_RULES,
      healthyCapacity: 0.2,
    });
    const feedback = auditorFeedback(
      submitAuditorAnswer(createAuditorSession(spec), answer('uncontained-fire', 'contain')),
    )!;
    expect(feedback.supportedCause).toBeNull();
    expect(feedback.inconclusiveInterventions).toBe(true);
    expect(feedback.minimumEffectivePlans).toEqual([]);
    expect(feedback.avoidableSpend).toBeNull();
  });

  it('追加の自然炎上が起きたseedでは単独原因と断定しない', () => {
    const spec = createAuditorSpec('RI-265:0', 'review-capacity');
    const feedback = auditorFeedback(
      submitAuditorAnswer(createAuditorSession(spec), answer('review-capacity', 'review')),
    )!;
    expect(feedback.generatedCause).toBe('review-capacity');
    expect(feedback.selected.result.incidents).toBeGreaterThan(0);
    expect(feedback.supportedCause).toBeNull();
    expect(feedback.answerSupported).toBe(false);
  });

  it('両方対策の余計な費用と、誤った対策で失う選択肢を示す', () => {
    const session = createAuditorSession(createAuditorSpec('RI-265:1', 'review-capacity'));
    const broad = auditorFeedback(
      submitAuditorAnswer(session, answer('review-capacity', 'broad')),
    )!;
    expect(broad.budgetSpent).toBe(4);
    expect(broad.budgetRemaining).toBe(0);
    expect(broad.avoidableSpend).toBe(2);
    expect(
      auditorFeedback(
        submitAuditorAnswer(session, { cause: 'insufficient', plan: 'review', evidenceIds: [] }),
      )!.answerSupported,
    ).toBe(false);
    expect(broad.foregonePlans.map((plan) => plan.plan)).toEqual(['review', 'contain']);
    const wrong = auditorFeedback(
      submitAuditorAnswer(session, answer('uncontained-fire', 'contain')),
    )!;
    expect(wrong.answerSupported).toBe(false);
    expect(wrong.selected.result.outcome).toBe('deadline-missed');
    expect(wrong.avoidableSpend).toBeNull();
    const tight = createAuditorSession(
      createAuditorSpec('RI-265:1', 'review-capacity', 'controlled', {
        ...AUDITOR_RULES,
        budget: 2,
      }),
    );
    const wasted = auditorFeedback(
      submitAuditorAnswer(tight, answer('uncontained-fire', 'contain')),
    )!;
    expect(wasted.budgetRemaining).toBe(0);
    expect(wasted.foregonePlans.map((plan) => plan.plan)).toContain('review');
  });

  it('予算超過・無効回答・重複証拠・二重提出は状態を変えない', () => {
    const spec = createAuditorSpec('RI-265:1', 'review-capacity', 'controlled', {
      ...AUDITOR_RULES,
      budget: 1,
    });
    const poor = createAuditorSession(spec);
    expect(submitAuditorAnswer(poor, answer('review-capacity', 'review'))).toBe(poor);
    const session = createAuditorSession(createAuditorSpec('RI-265:1', 'review-capacity'));
    for (const invalid of [
      { ...answer('review-capacity', 'review'), plan: 'unknown' },
      { ...answer('review-capacity', 'review'), cause: 'unknown' },
      { ...answer('review-capacity', 'review'), evidenceIds: ['trial:unknown'] },
      { ...answer('review-capacity', 'review'), evidenceIds: ['trial:review', 'trial:review'] },
    ])
      expect(submitAuditorAnswer(session, invalid as AuditorAnswer)).toBe(session);
    const submitted = submitAuditorAnswer(session, answer('review-capacity', 'review'));
    expect(submitAuditorAnswer(submitted, answer('uncontained-fire', 'contain'))).toBe(submitted);
  });

  it('実simとRNG位置をJSON保存して同一入力で再開する', () => {
    const spec = createAuditorSpec('RI-265:1', 'uncontained-fire');
    const initial = createAuditorSimulation(spec);
    const snapshot = JSON.stringify(initial);
    let state = applyAuditorPlan(initial, spec, 'contain');
    expect(JSON.stringify(initial)).toBe(snapshot);
    expect(applyAuditorPlan(state, spec, 'broad')).toBe(state);
    state = tickAuditorSimulation(state);
    let resumed = JSON.parse(JSON.stringify(state));
    while (!state.sprint.complete) {
      state = tickAuditorSimulation(state);
      resumed = tickAuditorSimulation(resumed);
    }
    expect(resumed).toEqual(state);
    expect(summarizeAuditorSimulation(state)).toEqual(runAuditorSimulation(spec, 'contain'));
    expect(tickAuditorSimulation(state)).toBe(state);
    expect(applyAuditorPlan(state, spec, 'review')).toBe(state);
  });

  it('回答前後の保存復元、条件の不正値、通常セーブ混入を検証する', () => {
    const session = createAuditorSession(createAuditorSpec('RI-265:1', 'review-capacity'));
    const restored = restoreAuditorSession(JSON.stringify(session));
    expect(viewAuditorCase(restored)).toEqual(viewAuditorCase(session));
    const submitted = submitAuditorAnswer(session, answer('review-capacity', 'review'));
    expect(auditorFeedback(restoreAuditorSession(JSON.stringify(submitted)))).toEqual(
      auditorFeedback(submitted),
    );
    for (const rules of [
      { ...AUDITOR_RULES, budget: -1 },
      { ...AUDITOR_RULES, deadline: 0 },
      { ...AUDITOR_RULES, taskCount: 0 },
      { ...AUDITOR_RULES, healthyCapacity: NaN },
      { ...AUDITOR_RULES, impairedCapacity: Infinity },
      { ...AUDITOR_RULES, costs: { ...AUDITOR_RULES.costs, review: 0 } },
    ])
      expect(() => createAuditorSpec('RI-265:1', 'review-capacity', 'controlled', rules)).toThrow();
    expect(() => restoreAuditorSession(JSON.stringify({ ...session, version: 2 }))).toThrow();
    expect(() =>
      restoreAuditorSession(JSON.stringify({ ...session, kind: 'normal-run' })),
    ).toThrow();
    expect(() =>
      restoreAuditorSession(
        JSON.stringify({ ...submitted, answer: { ...submitted.answer, plan: 'unknown' } }),
      ),
    ).toThrow();
  });
});
