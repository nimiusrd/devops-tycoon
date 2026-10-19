import { describe, expect, it } from 'vitest';
import { simulateAgentDatPipeline, type AgentDatCapacity } from './agentDatPipeline';

const ROUTINE: AgentDatCapacity = {
  workload: 'routine',
  mode: 'companion',
  approvalPolicy: 'each-step',
  taskCount: 12,
  authorBudgetMinutes: 120,
  reviewerBudgetMinutes: 60,
  seed: 'capacity-fixture',
};

describe('DATとレビュー処理能力の期間試作', () => {
  it('同じ人間予算では非同期PR作成が増えても、完了件数が増えるとは限らない', () => {
    const before = structuredClone(ROUTINE);
    const companion = simulateAgentDatPipeline(ROUTINE);
    const async = simulateAgentDatPipeline({
      ...ROUTINE,
      mode: 'asynchronous',
      approvalPolicy: 'preauthorized',
    });
    expect(ROUTINE).toEqual(before);
    expect(simulateAgentDatPipeline(ROUTINE)).toEqual(companion);
    expect(companion).toMatchObject({
      createdPrs: 6,
      completedTasks: 5,
      waitingReview: 1,
      codingInProgress: 1,
      unstartedTasks: 5,
      authorMinutesSpent: 118,
      reviewerMinutesSpent: 60,
    });
    expect(async).toMatchObject({
      createdPrs: 12,
      completedTasks: 3,
      waitingReview: 9,
      codingInProgress: 0,
      authorMinutesSpent: 72,
      reviewerMinutesSpent: 48,
    });
    expect(async.createdPrs).toBeGreaterThan(companion.createdPrs);
    expect(async.completedTasks).toBeLessThan(companion.completedTasks);
  });

  it('Reviewerの予算を増やせば、非同期で作成したPRの完了が増える', () => {
    const async = simulateAgentDatPipeline({
      ...ROUTINE,
      mode: 'asynchronous',
      approvalPolicy: 'preauthorized',
      reviewerBudgetMinutes: 240,
    });
    expect(async).toMatchObject({
      createdPrs: 12,
      completedTasks: 12,
      waitingReview: 0,
      waitingRework: 0,
      authorMinutesSpent: 72,
      reviewerMinutesSpent: 192,
      totalHumanMinutesSpent: 264,
    });
  });

  it('複雑な仕事はレビュー後の修正と再レビュー予算が必要である', () => {
    const coupled = {
      ...ROUTINE,
      workload: 'coupled' as const,
      mode: 'asynchronous' as const,
      approvalPolicy: 'preauthorized' as const,
      taskCount: 1,
    };
    const waitingFix = simulateAgentDatPipeline({
      ...coupled,
      authorBudgetMinutes: 6,
      reviewerBudgetMinutes: 46,
    });
    expect(waitingFix).toMatchObject({
      createdPrs: 1,
      completedTasks: 0,
      waitingReview: 0,
      waitingRework: 1,
      authorMinutesSpent: 6,
      reviewerMinutesSpent: 32,
    });
    const waitingRereview = simulateAgentDatPipeline({
      ...coupled,
      authorBudgetMinutes: 41,
      reviewerBudgetMinutes: 32,
    });
    expect(waitingRereview).toMatchObject({
      createdPrs: 1,
      completedTasks: 0,
      waitingReview: 1,
      waitingRework: 0,
      authorMinutesSpent: 41,
      reviewerMinutesSpent: 32,
    });
    expect(
      simulateAgentDatPipeline({
        ...coupled,
        authorBudgetMinutes: 41,
        reviewerBudgetMinutes: 46,
      }),
    ).toMatchObject({
      createdPrs: 1,
      completedTasks: 1,
      waitingReview: 0,
      waitingRework: 0,
      authorMinutesSpent: 41,
      reviewerMinutesSpent: 46,
    });
  });

  it('再レビューはキュー末尾に戻し、後続PRの初回レビューを追い越さない', () => {
    const coupled = {
      ...ROUTINE,
      workload: 'coupled' as const,
      mode: 'asynchronous' as const,
      approvalPolicy: 'preauthorized' as const,
      taskCount: 2,
      authorBudgetMinutes: 82,
      reviewerBudgetMinutes: 64,
    };
    const result = simulateAgentDatPipeline(coupled);
    expect(result).toMatchObject({
      createdPrs: 2,
      completedTasks: 0,
      waitingReview: 2,
      waitingRework: 0,
      authorMinutesSpent: 82,
      reviewerMinutesSpent: 64,
    });
    // 双方の初回レビューを先に処理し、余った14分で先着の再レビューのみ通す。
    const extra = simulateAgentDatPipeline({ ...coupled, reviewerBudgetMinutes: 78 });
    expect(extra).toMatchObject({
      createdPrs: 2,
      completedTasks: 1,
      waitingReview: 1,
      reviewerMinutesSpent: 78,
    });
    expect(simulateAgentDatPipeline(coupled)).toEqual(result);
  });

  it('密結合12件はReviewer 396分では未完了、408分なら再レビューに到達する', () => {
    const workload = {
      ...ROUTINE,
      workload: 'coupled' as const,
      mode: 'asynchronous' as const,
      approvalPolicy: 'preauthorized' as const,
      authorBudgetMinutes: 120,
      taskCount: 12,
    };
    const blocked = simulateAgentDatPipeline({ ...workload, reviewerBudgetMinutes: 396 });
    expect(blocked).toMatchObject({
      createdPrs: 12,
      completedTasks: 0,
      reviewerMinutesSpent: 384,
    });
    const released = simulateAgentDatPipeline({ ...workload, reviewerBudgetMinutes: 408 });
    expect(released).toMatchObject({
      createdPrs: 12,
      completedTasks: 1,
      reviewerMinutesSpent: 398,
    });
    expect(released.completedTasks).toBeGreaterThan(blocked.completedTasks);
  });

  it('未完成案件は完了に計上せず、PR数とレビュー/手戻りが保存則を満たす', () => {
    for (const workload of ['routine', 'coupled'] as const) {
      for (const mode of ['companion', 'asynchronous'] as const) {
        for (const policy of ['each-step', 'preauthorized'] as const) {
          for (const author of [0, 6, 41, 120, 250]) {
            for (const reviewer of [0, 12, 32, 60, 240]) {
              const result = simulateAgentDatPipeline({
                ...ROUTINE,
                workload,
                mode,
                approvalPolicy: policy,
                authorBudgetMinutes: author,
                reviewerBudgetMinutes: reviewer,
              });
              expect(result.createdPrs).toBe(
                result.completedTasks + result.waitingReview + result.waitingRework,
              );
              expect(result.taskCount).toBe(result.startedTasks + result.unstartedTasks);
              expect(result.authorMinutesSpent).toBeLessThanOrEqual(author);
              expect(result.reviewerMinutesSpent).toBeLessThanOrEqual(reviewer);
              expect(result.completedTasks).toBeLessThanOrEqual(result.createdPrs);
            }
          }
        }
      }
    }
  });

  it('投入件数が少ない密結合タスクではAI事前レビューの導入が逆効果になる', () => {
    const scenario = {
      ...ROUTINE,
      workload: 'coupled' as const,
      mode: 'asynchronous' as const,
      approvalPolicy: 'preauthorized' as const,
      taskCount: 1,
      authorBudgetMinutes: 120,
      reviewerBudgetMinutes: 48,
    };
    const human = simulateAgentDatPipeline({ ...scenario, reviewAssistance: 'human' });
    const ai = simulateAgentDatPipeline({ ...scenario, reviewAssistance: 'ai-precheck' });
    expect(human).toMatchObject({
      createdPrs: 1,
      completedTasks: 1,
      reviewerMinutesSpent: 46,
    });
    expect(ai).toMatchObject({
      createdPrs: 1,
      completedTasks: 0,
      waitingReview: 1,
      reviewerMinutesSpent: 42,
      reviewSetupMinutesSpent: 6,
    });
    const crowded = {
      ...scenario,
      taskCount: 12,
    };
    const crowdedHuman = simulateAgentDatPipeline({ ...crowded, reviewAssistance: 'human' });
    const crowdedAi = simulateAgentDatPipeline({ ...crowded, reviewAssistance: 'ai-precheck' });
    expect(crowdedHuman.completedTasks).toBe(0);
    expect(crowdedAi.completedTasks).toBe(0);
  });

  it('無効な予算/件数を拒否し、ゼロ件・ゼロ予算も安全に扱う', () => {
    const empty = simulateAgentDatPipeline({ ...ROUTINE, taskCount: 0 });
    expect(empty).toMatchObject({
      taskCount: 0,
      startedTasks: 0,
      createdPrs: 0,
      completedTasks: 0,
      totalHumanMinutesSpent: 0,
    });
    expect(simulateAgentDatPipeline({ ...ROUTINE, authorBudgetMinutes: 0 })).toMatchObject({
      createdPrs: 0,
      startedTasks: 0,
      unstartedTasks: 12,
    });
    for (const override of [
      { taskCount: -1 },
      { taskCount: 501 },
      { taskCount: 1.5 },
      { reviewerBudgetMinutes: -1 },
      { authorBudgetMinutes: Number.NaN },
      { reviewerBudgetMinutes: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => simulateAgentDatPipeline({ ...ROUTINE, ...override })).toThrow();
    }
  });

  it('AIレビューでroutineのReviewer DATが減り、Review渋滞が縮む', () => {
    const fixed = {
      ...ROUTINE,
      mode: 'asynchronous' as const,
      approvalPolicy: 'preauthorized' as const,
    };
    const human = simulateAgentDatPipeline({ ...fixed, reviewAssistance: 'human' });
    const assisted = simulateAgentDatPipeline({ ...fixed, reviewAssistance: 'ai-precheck' });
    expect(human).toMatchObject({
      createdPrs: 12,
      completedTasks: 3,
      waitingReview: 9,
      reviewerMinutesSpent: 48,
      aiReviewedPrs: 0,
      reviewSetupMinutesSpent: 0,
    });
    expect(assisted).toMatchObject({
      createdPrs: 12,
      completedTasks: 5,
      waitingReview: 7,
      authorMinutesSpent: 72,
      reviewerMinutesSpent: 54,
      reviewSetupMinutesSpent: 6,
      aiReviewedPrs: 5,
      aiFalsePositiveChecks: 1,
    });
    expect(assisted.completedTasks).toBeGreaterThan(human.completedTasks);
    expect(assisted.createdPrs).toBe(human.createdPrs);
    expect(simulateAgentDatPipeline({ ...fixed, reviewAssistance: 'ai-precheck' })).toEqual(
      assisted,
    );
  });

  it('Review容量が十分なら全12件を通し、誤検知3件と初期工数を計上する', () => {
    const assisted = simulateAgentDatPipeline({
      ...ROUTINE,
      mode: 'asynchronous',
      approvalPolicy: 'preauthorized',
      reviewAssistance: 'ai-precheck',
      reviewerBudgetMinutes: 240,
    });
    expect(assisted).toMatchObject({
      createdPrs: 12,
      completedTasks: 12,
      waitingReview: 0,
      reviewerMinutesSpent: 126,
      reviewSetupMinutesSpent: 6,
      aiReviewedPrs: 12,
      aiFalsePositiveChecks: 3,
    });
  });

  it('密結合仕事ではAIレビュー導入で追加負荷が生じ、逆に完了を阻害しうる', () => {
    const scenario = {
      ...ROUTINE,
      workload: 'coupled' as const,
      mode: 'asynchronous' as const,
      approvalPolicy: 'preauthorized' as const,
      taskCount: 1,
      authorBudgetMinutes: 41,
      reviewerBudgetMinutes: 48,
    };
    expect(simulateAgentDatPipeline({ ...scenario, reviewAssistance: 'human' })).toMatchObject({
      createdPrs: 1,
      completedTasks: 1,
      reviewerMinutesSpent: 46,
      reviewSetupMinutesSpent: 0,
    });
    expect(
      simulateAgentDatPipeline({ ...scenario, reviewAssistance: 'ai-precheck' }),
    ).toMatchObject({
      createdPrs: 1,
      completedTasks: 0,
      waitingReview: 1,
      authorMinutesSpent: 41,
      reviewerMinutesSpent: 42,
      reviewSetupMinutesSpent: 6,
      aiReviewedPrs: 1,
      aiFalsePositiveChecks: 0,
    });
  });

  it('PRがなければ準備工数は発生せず、準備の予算不足を無料扱いにしない', () => {
    expect(
      simulateAgentDatPipeline({
        ...ROUTINE,
        taskCount: 0,
        reviewAssistance: 'ai-precheck',
      }),
    ).toMatchObject({
      completedTasks: 0,
      createdPrs: 0,
      reviewSetupMinutesSpent: 0,
      aiReviewedPrs: 0,
    });
    expect(
      simulateAgentDatPipeline({
        ...ROUTINE,
        mode: 'asynchronous',
        approvalPolicy: 'preauthorized',
        reviewerBudgetMinutes: 0,
        reviewAssistance: 'ai-precheck',
      }),
    ).toMatchObject({
      createdPrs: 12,
      completedTasks: 0,
      waitingReview: 12,
      reviewerMinutesSpent: 0,
      reviewSetupMinutesSpent: 0,
      aiReviewedPrs: 0,
    });
  });
});
