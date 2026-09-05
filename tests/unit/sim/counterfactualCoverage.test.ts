import { describe, expect, it } from 'vitest';
import { evaluateCounterfactual, listStrategicChoices } from '../../../src/sim/run/counterfactual';
import { RunEngine } from '../../../src/sim/run/engine';
import { assignableTasks } from '../../../src/sim/assignTask';
import type { CounterfactualFrame } from '../../../src/sim/run/persist';

function phaseFrame(phase: 'rest' | 'beat' | 'shop', budget: number): CounterfactualFrame {
  const engine = new RunEngine({ seed: 'counterfactual-coverage', difficulty: 'normal' });
  engine.startRun();
  const frame = engine.exportCounterfactualFrame()!;
  frame.persist.phase = phase;
  frame.persist.budget = budget;
  frame.persist.deck = [];
  return frame;
}

function sprintFrame(): CounterfactualFrame {
  const engine = new RunEngine({ seed: 'counterfactual-hand-coverage', difficulty: 'normal' });
  engine.startRun();
  engine.beginSetupSprint();
  return engine.exportCounterfactualFrame()!;
}

describe('反実仮想の現在手札と発動不能な介入', () => {
  it('手札カードは必要集中力に達したときだけ分岐し、AI依存の危険域離脱を記録する', () => {
    const frame = sprintFrame();
    frame.persist.deck = [{ defId: 'ai-guideline', level: 1 }];
    frame.persist.org.aiDependency = 60;
    frame.persist.org.aiLiteracy = 10;
    frame.persist.budget = 1;
    frame.sprint!.cardPiles = { drawOrder: [], hand: [0], discard: [], played: [] };
    frame.sprint!.focus = 2;
    const options = {
      includeStrategic: false,
      maxSprints: 0,
      maxActionBranches: 32,
      maxComboBranches: 0,
      focusReason: 'aiDependency' as const,
    };
    const belowCost = evaluateCounterfactual(frame, options);
    expect(belowCost.originDangers).toContain('aiDependency');
    expect(belowCost.branches.some((branch) => branch.actionId?.startsWith('card:'))).toBe(false);

    frame.sprint!.focus = 3;
    const before = structuredClone(frame);
    const atCost = evaluateCounterfactual(frame, options);
    expect(
      atCost.branches.find((branch) => branch.actionId === 'card:ai-guideline:0'),
    ).toMatchObject({ leftDanger: true });
    expect(frame).toEqual(before);
  });

  it('集中力がない場合、指定されたタスク差配は対象が存在しても無介入と同じ結果になる', () => {
    const frame = sprintFrame();
    frame.sprint!.focus = 0;
    expect(assignableTasks(frame.sprint!).length).toBeGreaterThan(0);
    const before = structuredClone(frame);
    const evaluation = evaluateCounterfactual(frame, { actions: ['assignTask'], maxSprints: 0 });
    expect(evaluation.branches).toEqual([{ ...evaluation.baseline, actionId: 'assignTask' }]);
    expect(frame).toEqual(before);
  });

  it('スプリント外で指定した介入は戦略フェーズの無介入結果を変えない', () => {
    const frame = phaseFrame('rest', 26);
    const evaluation = evaluateCounterfactual(frame, {
      actions: ['assignTask', 'overtime'],
      maxSprints: 0,
    });
    expect(evaluation.branches).toEqual([
      { ...evaluation.baseline, actionId: 'assignTask' },
      { ...evaluation.baseline, actionId: 'overtime' },
    ]);
    expect(evaluation.idlePinnedIds).toEqual(['rest:repay']);
  });
});

describe('反実仮想の採用費用境界', () => {
  it.each([
    [24, []],
    [25, ['rest:recruit']],
    [26, ['rest:recruit:bench', 'rest:recruit:coding', 'rest:recruit:review']],
  ] as const)(
    '休息の残予算 %i では生存できる場合だけ採用後の配置を分岐する',
    (budget, expected) => {
      const frame = phaseFrame('rest', budget);
      const choices = listStrategicChoices(frame, 0);
      expect(
        choices.filter((choice) => choice.id.startsWith('rest:recruit')).map(({ id }) => id),
      ).toEqual(expected);
    },
  );

  it.each([
    ['rest', 'rest:recruit', 70_000],
    ['beat', 'beat:urgent-hire:0', 50_000],
  ] as const)(
    '%s の採用費用で予算が尽きた分岐は即時敗北として返す',
    (phase, actionId, loseTick) => {
      const frame = phaseFrame(phase, 25);
      if (phase === 'beat') frame.persist.beat = { kind: 'decision', eventId: 'urgent-hire' };
      const before = structuredClone(frame);
      const evaluation = evaluateCounterfactual(frame, {
        actions: [],
        includeStrategic: true,
        maxSprints: 0,
        maxStrategicBranches: 4,
      });

      expect(evaluation.branches.find((branch) => branch.actionId === actionId)).toMatchObject({
        status: 'lost',
        loseReason: 'budgetExhausted',
        sprintsToLose: 0,
        loseTick,
        truncated: false,
      });
      expect(
        evaluation.branches.some((branch) => branch.actionId?.startsWith(`${actionId}:`)),
      ).toBe(false);
      expect(evaluation.baseline).toMatchObject({ status: 'playing', truncated: true });
      expect(frame).toEqual(before);
    },
  );
});

describe('反実仮想のショップ購入列', () => {
  it('レリックと採用の購入順ごとに残予算と採用後の配置可否を反映する', () => {
    const frame = phaseFrame('shop', 31);
    frame.persist.shop = {
      cards: [{ defId: 'copilot', cost: 5, bought: false }],
      relic: { id: 'postmortem', cost: 6, bought: false },
      recruit: { cost: 25, bought: false },
    };
    const before = structuredClone(frame);
    const ids = listStrategicChoices(frame, 0)
      .filter((choice) => choice.kind === 'shop')
      .map(({ id }) => id);

    expect(ids).toEqual(
      expect.arrayContaining([
        'shop:relic:postmortem',
        'shop:relic:postmortem+card:copilot',
        'shop:card:copilot+relic:postmortem',
        'shop:relic:postmortem+recruit',
        'shop:recruit:bench+relic:postmortem',
        'shop:recruit:coding+relic:postmortem',
        'shop:recruit:review+relic:postmortem',
        'shop:card:copilot+recruit:review',
      ]),
    );
    expect(ids.some((id) => id.startsWith('shop:relic:postmortem+recruit:'))).toBe(false);
    expect(ids.some((id) => id.split('+').length > 2)).toBe(false);
    expect(
      ids
        .filter((id) => id.includes('relic:postmortem'))
        .every((id) => id.split('relic:postmortem').length === 2),
    ).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(frame).toEqual(before);
  });

  it('レリック購入で予算が尽きた場合はショップ内の敗北を記録する', () => {
    const frame = phaseFrame('shop', 6);
    frame.persist.shop = {
      cards: [],
      relic: { id: 'postmortem', cost: 6, bought: false },
    };
    const evaluation = evaluateCounterfactual(frame, {
      actions: [],
      includeStrategic: true,
      maxSprints: 0,
      maxStrategicBranches: 2,
    });
    expect(evaluation.branches).toEqual([
      expect.objectContaining({
        actionId: 'shop:relic:postmortem',
        status: 'lost',
        loseReason: 'budgetExhausted',
        sprintsToLose: 0,
        loseTick: 60_000,
        truncated: false,
      }),
      { ...evaluation.baseline, actionId: 'shop:skip' },
    ]);
    expect(evaluation.baseline.status).toBe('playing');
    expect(evaluation.idlePinnedIds).toEqual(['shop:skip']);
  });

  it.each([
    ['購入済み', [], true],
    ['所持済み', ['postmortem'], false],
    [
      '所持枠が満杯',
      ['psych-safety', 'doc-driven', 'small-pr', 'strong-ci', 'flow-first', 'primary-source'],
      false,
    ],
  ] as const)('%s のレリックは購入候補に含めない', (_label, relics, bought) => {
    const frame = phaseFrame('shop', 10);
    frame.persist.relics = [...relics];
    frame.persist.shop = {
      cards: [],
      relic: { id: 'postmortem', cost: 6, bought },
    };
    const shop = listStrategicChoices(frame, 0).filter((choice) => choice.kind === 'shop');
    expect(shop.map(({ id }) => id)).toEqual(['shop:skip']);
  });
});
