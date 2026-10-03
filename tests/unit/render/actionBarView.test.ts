import { describe, expect, it } from 'vitest';
import { ACTION_DEFS } from '../../../src/data/actions';
import { INTERRUPT_REVIEW_COUNT, PAIR_REVIEW_COUNT } from '../../../src/sim/actions';
import { STABILITY_TICKS } from '../../../src/sim/model';
import { createOrgState } from '../../../src/sim/org';
import type { ActionId, OrgState, SprintState, Task } from '../../../src/sim/types';
import {
  countActionTargets,
  deriveActionAvailability,
  deriveModifierRing,
  formatInterventionFailure,
  planActionBarView,
  planActionPresentation,
  planActionPresentations,
} from '../../../src/render/actionBarView';
import { burningTask, makeSprint as makeSprintWith, makeTask } from '../helpers/sprintFixtures';

const rng = () => 0.99;

/** このファイルの固定 rng を束ねた共通フィクスチャの別名。 */
const makeSprint = (org: OrgState, tasks: Task[]): SprintState => makeSprintWith(org, tasks, rng);

/** actions.test.ts の NO_TARGET_CASES と整合する fixture。 */
const NO_TARGET_CASES: { id: ActionId; tasks: Task[]; message: string }[] = [
  { id: 'interruptReview', tasks: [], message: 'Review が空' },
  {
    id: 'splitPr',
    tasks: [makeTask(0, { split: true, lane: 'coding' })],
    message: '分割対象なし',
  },
  { id: 'firefight', tasks: [makeTask(0, { lane: 'review' })], message: '炎上なし' },
  { id: 'assignTask', tasks: [makeTask(0, { lane: 'review' })], message: '差配対象なし' },
];

describe('countActionTargets（RI-51）', () => {
  it('interruptReview は Review 件数を上限 4 でカウントする', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(
      org,
      Array.from({ length: 6 }, (_, i) => makeTask(i)),
    );
    expect(countActionTargets(sprint, 'interruptReview')).toBe(4);
  });

  it('firefight は炎上件数を返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [burningTask(0), burningTask(1), makeTask(2)]);
    expect(countActionTargets(sprint, 'firefight')).toBe(2);
  });

  it('splitPr は未 split 候補数を返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [
      makeTask(0, { lane: 'coding', split: true }),
      makeTask(1, { lane: 'review' }),
      makeTask(2, { lane: 'coding' }),
    ]);
    expect(countActionTargets(sprint, 'splitPr')).toBe(2);
  });

  it('assignTask は backlog/coding の件数を返し、それ以外は 0', () => {
    const org = createOrgState('default', true);
    expect(
      countActionTargets(makeSprint(org, [makeTask(0, { lane: 'coding' })]), 'assignTask'),
    ).toBe(1);
    expect(
      countActionTargets(
        makeSprint(org, [makeTask(0, { lane: 'backlog' }), makeTask(1, { lane: 'coding' })]),
        'assignTask',
      ),
    ).toBe(2);
    expect(
      countActionTargets(makeSprint(org, [makeTask(0, { lane: 'review' })]), 'assignTask'),
    ).toBe(0);
  });

  it('pairReview は Review 件数を上限 2 でカウントする', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0), makeTask(1), makeTask(2)]);
    expect(countActionTargets(sprint, 'pairReview')).toBe(2);
  });

  it('常時発動系は 0 を返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, []);
    for (const id of ['aiThrottle', 'overtime', 'andon'] as const) {
      expect(countActionTargets(sprint, id)).toBe(0);
    }
  });
});

describe('deriveActionAvailability（RI-51）', () => {
  it.each(NO_TARGET_CASES)(
    '$id は対象なしで no-target かつ理由を返す',
    ({ id, tasks, message }) => {
      const org = createOrgState('default', true);
      const sprint = makeSprint(org, tasks);
      const availability = deriveActionAvailability(sprint, id);
      expect(availability.canActivate).toBe(false);
      expect(availability.blockReason).toBe('no-target');
      expect(availability.blockMessage).toBe(message);
    },
  );

  it('pairReview は Review 0 件でも発動可能', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, []);
    const availability = deriveActionAvailability(sprint, 'pairReview');
    expect(availability.canActivate).toBe(true);
    expect(availability.targetBadge).toBe('PR 0');
  });

  it('常時発動系は対象不要で発動可能', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, []);
    for (const id of ['aiThrottle', 'overtime', 'andon'] as const) {
      const availability = deriveActionAvailability(sprint, id);
      expect(availability.canActivate).toBe(true);
      expect(availability.targetBadge).toBeUndefined();
    }
  });

  it('クールダウン中は cooldown で無効', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0)]);
    sprint.cooldowns.interruptReview = 10;
    const availability = deriveActionAvailability(sprint, 'interruptReview');
    expect(availability.canActivate).toBe(false);
    expect(availability.blockReason).toBe('cooldown');
  });

  it('集中力不足は no-focus で無効', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0)]);
    sprint.focus = 1;
    const availability = deriveActionAvailability(sprint, 'interruptReview');
    expect(availability.canActivate).toBe(false);
    expect(availability.blockReason).toBe('no-focus');
  });

  it('対象ありの interruptReview はバッジと canActivate を返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0), makeTask(1), makeTask(2)]);
    const availability = deriveActionAvailability(sprint, 'interruptReview');
    expect(availability.canActivate).toBe(true);
    expect(availability.targetBadge).toBe('PR 3');
  });

  it('firefight は炎上バッジを返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [burningTask(0), burningTask(1)]);
    const availability = deriveActionAvailability(sprint, 'firefight');
    expect(availability.canActivate).toBe(true);
    expect(availability.targetBadge).toBe('2');
    expect(availability.targetBadgeIcon).toBe('fire');
  });

  it('complete 指定時は完了理由で無効', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0)]);
    const availability = deriveActionAvailability(sprint, 'interruptReview', 'complete');
    expect(availability.canActivate).toBe(false);
    expect(availability.blockReason).toBe('complete');
  });

  it('paused 指定時は一時停止理由で無効', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0)]);
    const availability = deriveActionAvailability(sprint, 'pairReview', 'paused');
    expect(availability).toMatchObject({
      canActivate: false,
      blockReason: 'paused',
      blockMessage: '一時停止中',
    });
  });
});

describe('planActionBarView（RI-51）', () => {
  it('8 アクション分の利用可否を返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0)]);
    const plan = planActionBarView(sprint);
    expect(plan).toHaveLength(8);
    expect(plan.map((p) => p.actionId)).toEqual([
      'interruptReview',
      'splitPr',
      'firefight',
      'assignTask',
      'aiThrottle',
      'pairReview',
      'overtime',
      'andon',
    ]);
  });
});

describe('planActionPresentation（RI-149）', () => {
  it('現在のレビュー待ち全数と一回の処理上限を区別する', () => {
    const org = createOrgState('default', true);
    const reviewCount = INTERRUPT_REVIEW_COUNT + PAIR_REVIEW_COUNT + 1;
    const sprint = makeSprint(
      org,
      Array.from({ length: reviewCount }, (_, i) => makeTask(i)),
    );
    const interrupt = planActionPresentation(sprint, 'interruptReview');
    const pair = planActionPresentation(sprint, 'pairReview');

    expect(interrupt).toMatchObject({
      candidateCount: reviewCount,
      maxAffectedCount: INTERRUPT_REVIEW_COUNT,
      targetLabel: `レビュー待ち ${reviewCount}件`,
      targetLanes: ['review'],
    });
    expect(pair).toMatchObject({
      candidateCount: reviewCount,
      maxAffectedCount: PAIR_REVIEW_COUNT,
    });
    expect(interrupt.effect).toContain(`最大${INTERRUPT_REVIEW_COUNT}件`);
    expect(pair.effect).toContain(`最大${PAIR_REVIEW_COUNT}件`);
    // レビュー処理は出荷や成功の保証ではない。
    expect(interrupt.effect).not.toContain('出荷');
    expect(pair.effect).not.toContain('完了');
  });

  it('分割・鎮火・差配は候補を複数示しても一度の対象は1件', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [
      makeTask(0, { lane: 'coding' }),
      makeTask(1, { lane: 'coding', split: true }),
      makeTask(2, { lane: 'review' }),
      makeTask(3, { lane: 'backlog' }),
      burningTask(4),
      burningTask(5),
    ]);
    sprint.config.codingSlots = 2;
    expect(planActionPresentation(sprint, 'splitPr')).toMatchObject({
      candidateCount: 2,
      maxAffectedCount: 1,
      targetLabel: '分割候補 2件',
      targetLanes: ['coding', 'review'],
    });
    expect(planActionPresentation(sprint, 'firefight')).toMatchObject({
      candidateCount: 2,
      maxAffectedCount: 1,
      targetLanes: ['rework'],
    });
    expect(planActionPresentation(sprint, 'assignTask')).toMatchObject({
      candidateCount: 2,
      maxAffectedCount: 1,
      targetLabel: '差配候補 2件',
      targetLanes: ['backlog', 'coding'],
    });
  });

  it('0件のペアレビューでもAI習熟効果と代償を隠さない', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, []);
    const presentation = planActionPresentation(sprint, 'pairReview');
    expect(presentation.candidateCount).toBe(0);
    expect(presentation.targetLabel).toBe('レビュー待ち 0件');
    expect(presentation.effect).toContain('AI習熟');
    expect(presentation.tradeoff).toContain('再使用');
    expect(deriveActionAvailability(sprint, 'pairReview').canActivate).toBe(true);
  });

  it('対象不要の操作を0件の対象操作と混同せず、作用する工程を示す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, []);
    for (const id of ['aiThrottle', 'overtime', 'andon'] as const) {
      const presentation = planActionPresentation(sprint, id);
      expect(presentation.candidateCount).toBeUndefined();
      expect(presentation.maxAffectedCount).toBeUndefined();
      expect(presentation.targetLabel).not.toContain('0件');
    }
    expect(planActionPresentation(sprint, 'aiThrottle').targetLanes).toEqual(['backlog', 'coding']);
    expect(planActionPresentation(sprint, 'overtime').targetLanes).toEqual(['coding', 'review']);
    expect(planActionPresentation(sprint, 'andon').targetLanes).toEqual(['backlog']);
  });

  it('運用安定の説明はsim判定に合わせ、分割・アンドンには付けない', () => {
    const org = createOrgState('default', true);
    const light = makeSprint(org, [burningTask(0, 999)]);
    const urgent = makeSprint(org, [burningTask(0), burningTask(1)]);
    expect(planActionPresentation(light, 'firefight').effect).not.toContain('運用安定');
    expect(planActionPresentation(urgent, 'firefight').effect).toContain('運用安定');
    for (const id of ['splitPr', 'andon', 'overtime'] as const) {
      expect(planActionPresentation(urgent, id).effect).not.toContain('運用安定');
    }
    expect(planActionPresentation(urgent, 'interruptReview').effect).toContain('運用安定');
  });

  it('全8介入の順序と詳細の正本を状態変化後も維持し、入力状態を変えない', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0), burningTask(1)]);
    const before = structuredClone(sprint);
    const plan = planActionPresentations(sprint);
    expect(sprint).toEqual(before);
    expect(plan.map((item) => item.actionId)).toEqual(ACTION_DEFS.map((def) => def.id));
    for (const def of ACTION_DEFS) {
      const presentation = plan.find((item) => item.actionId === def.id)!;
      expect(presentation.description).toBe(def.description);
      expect(presentation.sideEffect).toBe(def.sideEffect);
      expect(presentation.roleLabel).not.toBe('');
      expect(presentation.targetLabel).not.toBe('');
      expect(presentation.effect).not.toBe('');
      expect(presentation.tradeoff).not.toBe('');
      expect(presentation.targetLanes.length).toBeGreaterThan(0);
    }
    sprint.tasks = [];
    sprint.focus = 0;
    expect(planActionPresentations(sprint).map((item) => item.actionId)).toEqual(
      plan.map((item) => item.actionId),
    );
  });
});

describe('deriveModifierRing（RI-84）', () => {
  it('運用安定の残り tick と進捗母数を返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, []);
    sprint.modifiers.stabilityUntilTick = 132;

    expect(deriveModifierRing(sprint, 42, 'stability')).toEqual({
      active: true,
      remaining: 90,
      total: STABILITY_TICKS,
    });
  });

  it('期限を過ぎた運用安定は非表示にする', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, []);
    sprint.modifiers.stabilityUntilTick = 42;

    expect(deriveModifierRing(sprint, 42, 'stability')).toEqual({
      active: false,
      remaining: 0,
      total: STABILITY_TICKS,
    });
  });
});

describe('formatInterventionFailure（RI-51）', () => {
  it('no-target はアクション別の短文を返す', () => {
    expect(formatInterventionFailure('no-target', 'firefight')).toBe('炎上なし');
  });

  it('その他の理由は汎用文言を返す', () => {
    expect(formatInterventionFailure('cooldown')).toBe('クールダウン中');
    expect(formatInterventionFailure('paused')).toBe('一時停止中');
  });
});
