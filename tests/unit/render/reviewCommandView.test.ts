import { describe, expect, it } from 'vitest';
import { planReviewCommand } from '../../../src/render/reviewCommandView';
import { ANDON_STABILITY_REVIEW_MIN } from '../../../src/sim/actions';
import { createOrgState } from '../../../src/sim/org';
import { makeSprint, makeTask } from '../helpers/sprintFixtures';

describe('レビュー工程の介入プレビュー', () => {
  it('集中力不足とCDを固定介入と同じ理由で表示する', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0)]);
    sprint.focus = 0;
    const preview = () => planReviewCommand(sprint, org, 0, 'interruptReview');

    expect(preview().availability).toMatchObject({
      canActivate: false,
      blockReason: 'no-focus',
      blockMessage: '集中力不足',
    });
    sprint.cooldowns.interruptReview = 10;
    expect(preview()).toMatchObject({
      availability: { canActivate: false, blockReason: 'cooldown' },
      cooldownRemaining: 10,
    });
  });

  it('アンドンの追加負担はsimと同じ閾値で切り替わり、再確認が必要になる', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(
      org,
      Array.from({ length: ANDON_STABILITY_REVIEW_MIN - 1 }, (_, index) => makeTask(index)),
    );
    const before = planReviewCommand(sprint, org, 0, 'andon');
    expect(before.tradeoff).toContain('シニアHP');

    sprint.tasks.push(makeTask(sprint.tasks.length));
    const after = planReviewCommand(sprint, org, 0, 'andon');
    expect(after.tradeoff).not.toContain('シニアHP');
    expect(after.confirmationKey).not.toBe(before.confirmationKey);
  });

  it('割り込みは工程の先頭を対象にし、処理上限を超える後続の増減は再確認に含めない', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(
      org,
      Array.from({ length: 6 }, (_, index) => makeTask(index)),
    );
    const before = planReviewCommand(sprint, org, 0, 'interruptReview');

    sprint.tasks.shift();
    const after = planReviewCommand(sprint, org, 0, 'interruptReview');
    expect(after.targetLabel).not.toBe(before.targetLabel);
    expect(after.confirmationKey).toBe(before.confirmationKey);
    expect(after.availability.targetCount).toBe(before.availability.targetCount);
  });
});
