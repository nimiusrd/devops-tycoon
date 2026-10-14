import { describe, expect, it } from 'vitest';
import { createAgentWorkflow } from './agentWorkflowDat';
import {
  AI_TRIAGE_SETUP_MINUTES,
  configureReviewTriage,
} from './agentReviewTriage';

describe('AIレビュー事前トリアージ（人間最終確認を維持）', () => {
  it('humanでは元の係数・状態を維持する', () => {
    const original = createAgentWorkflow('review', 'routine', 'asynchronous', 'preauthorized');
    const before = structuredClone(original);
    const result = configureReviewTriage(original, 'human', 3);
    expect(result).toEqual({
      job: original,
      falsePositive: false,
      eligible: false,
    });
    expect(original).toEqual(before);
    expect(AI_TRIAGE_SETUP_MINUTES).toBe(6);
  });

  it('定型仕事のReviewer DATを削減するが4件に1件の誤検知を追加する', () => {
    const original = createAgentWorkflow('review', 'routine', 'asynchronous', 'preauthorized');
    for (const index of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const result = configureReviewTriage(original, 'ai-precheck', index);
      expect(result.eligible).toBe(true);
      expect(result.falsePositive).toBe(index % 4 === 3);
      expect(result.job.coefficients.baseReviewMinutes).toBe(index % 4 === 3 ? 14 : 6);
      expect(result.job.coefficients.asynchronousReviewContextMinutes).toBe(2);
    }
    expect(original.coefficients.baseReviewMinutes).toBe(12);
    expect(original.coefficients.asynchronousReviewContextMinutes).toBe(4);
  });

  it('密結合仕事は削減せず確認の負担だけ増加し、無効な順序を拒否する', () => {
    const original = createAgentWorkflow('review', 'coupled', 'asynchronous', 'preauthorized');
    const result = configureReviewTriage(original, 'ai-precheck', 3);
    expect(result.eligible).toBe(false);
    expect(result.falsePositive).toBe(false);
    expect(result.job.coefficients.baseReviewMinutes).toBe(28);
    expect(result.job.coefficients.asynchronousReviewContextMinutes).toBe(8);
    expect(original.coefficients.baseReviewMinutes).toBe(24);
    expect(() => configureReviewTriage(original, 'ai-precheck', -1)).toThrow();
    expect(() => configureReviewTriage(original, 'ai-precheck', 1.2)).toThrow();
  });
});
