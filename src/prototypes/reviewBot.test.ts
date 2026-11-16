import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/review-bot-comparison.json';
import factors from '../../docs/prototypes/review-bot-factor-comparison.json';
import {
  compareReviewBotFactorReversals,
  compareReviewBotStrategies,
  createReviewBotPrototype,
  reviewBotBoardKinds,
  reviewBotFactorBaseline,
  reviewBotLatentMisses,
  scoreReviewBotFactor,
  summarizeReviewBot,
  tickReviewBotPrototype,
  type ReviewBoard,
} from './reviewBot';

describe('レビューBot専用経路の試作', () => {
  it('後から差し戻された低いIDの案件も、既存の人間FIFOの末尾に入る', () => {
    const initial = createReviewBotPrototype(1, ['routine', 'complex'], 'dedicated');
    initial.jobs[0].falsePositive = true;
    let state = tickReviewBotPrototype(initial);
    expect(state.jobs[0].humanQueuedAt).toBe(1);
    state = tickReviewBotPrototype(state);
    expect(state.jobs[1].humanLeft).toBe(4);
    expect(state.jobs[0].humanLeft).toBe(4);
    state = tickReviewBotPrototype(tickReviewBotPrototype(state));
    expect(state.jobs[1].stage).toBe('verification');
    expect(state.jobs[0].humanLeft).toBe(4);
  });
  it('記録した固定盤面の比較を再現する', () => {
    for (const scenario of comparison) {
      const kinds = scenario.kinds.map((kind) => {
        if (kind !== 'routine' && kind !== 'complex') throw new Error('未知のPR種別');
        return kind;
      });
      expect(compareReviewBotStrategies(scenario.seed, kinds)).toEqual(scenario.results);
    }
  });
  it('routineだけBotへ送り、複雑PRは人間Reviewへ送る', () => {
    const state = createReviewBotPrototype(1, ['routine', 'complex'], 'dedicated');
    expect(state.jobs.map((job) => job.stage)).toEqual(['bot', 'human']);
    expect(state.coefficient).toBe(1.2);
    expect(createReviewBotPrototype(1, ['routine'], 'coefficient').jobs[0].stage).toBe('human');
  });

  it('誤検知は人間Reviewへ戻り、追加の仕分け工数と通常レビューを払う', () => {
    const initial = createReviewBotPrototype(1, ['routine'], 'dedicated');
    initial.jobs[0].falsePositive = true;
    const detected = tickReviewBotPrototype(initial);
    expect(initial.jobs[0].stage).toBe('bot');
    expect(detected.jobs[0]).toMatchObject({ stage: 'human', humanLeft: 4, route: 'fallback' });
    expect(summarizeReviewBot(detected).completed).toBe(0);
    let state = detected;
    while (state.tick < state.deadline) state = tickReviewBotPrototype(state);
    expect(summarizeReviewBot(state)).toMatchObject({
      delivered: 2,
      completed: 1,
      botCompleted: 0,
      fallbackCompleted: 1,
      falsePositives: 1,
      triageSpent: 1,
      humanSpent: 6,
    });
    expect(tickReviewBotPrototype(state)).toEqual(state);
  });

  it('Bot通過も最終検証を待ち、同じPRを二重出荷しない', () => {
    const state = createReviewBotPrototype(1, ['routine'], 'dedicated');
    state.jobs[0].falsePositive = false;
    const reviewed = tickReviewBotPrototype(state);
    expect(summarizeReviewBot(reviewed).completed).toBe(0);
    expect(summarizeReviewBot(tickReviewBotPrototype(reviewed))).toMatchObject({
      completed: 1,
      botCompleted: 1,
      delivered: 2,
    });
  });

  it('同じseedで誤検知が再現し、JSON保存再開でも経路が変わらない', () => {
    let state = createReviewBotPrototype('RI-177', Array(12).fill('routine'), 'dedicated');
    expect(state).toEqual(
      createReviewBotPrototype('RI-177', Array(12).fill('routine'), 'dedicated'),
    );
    for (let tick = 0; tick < 4; tick += 1) state = tickReviewBotPrototype(state);
    let restored = JSON.parse(JSON.stringify(state));
    while (state.tick < state.deadline) {
      state = tickReviewBotPrototype(state);
      restored = tickReviewBotPrototype(restored);
    }
    expect(restored).toEqual(state);
  });

  it('小PR中心と複雑PR中心で専用経路と係数版の優劣が変わる', () => {
    const [, coefficientSmall, dedicatedSmall] = compareReviewBotStrategies(
      'RI-177',
      Array(20).fill('routine'),
    );
    const [, coefficientComplex, dedicatedComplex] = compareReviewBotStrategies(
      'RI-177',
      Array(20).fill('complex'),
    );
    expect(dedicatedSmall.delivered).toBeGreaterThan(coefficientSmall.delivered);
    expect(dedicatedComplex.delivered).toBeLessThan(coefficientComplex.delivered);
    expect(dedicatedComplex.botSpent).toBe(0);
  });
});

describe('RI-177 要因を一つずつ動かした再計算', () => {
  const report = compareReviewBotFactorReversals();
  const row = (axis: keyof typeof factors.sweeps, board: string, parameter: string) => {
    const found = report.sweeps[axis].rows.find(
      (item) => item.board === board && item.parameter === parameter,
    );
    if (!found) throw new Error(`${axis} ${board} ${parameter}`);
    return found;
  };
  const edges = (axis: keyof typeof factors.sweeps) =>
    report.sweeps[axis].reversals.map((item) => ({
      board: item.board,
      from: [
        item.before.parameter,
        item.before.preference,
        item.before.coefficient,
        item.before.dedicated,
      ],
      to: [
        item.after.parameter,
        item.after.preference,
        item.after.coefficient,
        item.after.dedicated,
      ],
    }));

  it('条件・入力列・結果を再計算し、固定戦略であることを残す', () => {
    expect(report).toEqual(factors);
    expect(report.conditions.fixedStrategies).toBe(true);
    expect(report.conditions.humanPlaytest).toBe(false);
    expect(report.conditions.singleSeedProductionCoefficients).toBe(false);
    expect(report.conditions.repeatedFirstComparison).toBe(false);
    expect(report.conditions.normalRun).toBe(false);
    expect(report.conditions.coefficient).toBe(1.2);
    expect(report.conditions.missRate).toBe(0.25);
    for (const scenario of comparison) {
      const board = scenario.scenario as ReviewBoard;
      expect(report.conditions.boards[board]).toEqual(scenario.kinds);
      expect(reviewBotBoardKinds(board)).toEqual(scenario.kinds);
    }
  });

  it('基準行は初回の係数版と専用経路に一致する', () => {
    const parameters = {
      seed: 'RI-177',
      placement: 'seed',
      deadline: '12',
      fallbackPriority: 'fifo',
    } as const;
    for (const scenario of comparison) {
      const original = Object.fromEntries(scenario.results.map((item) => [item.mode, item]));
      for (const [axis, parameter] of Object.entries(parameters)) {
        const found = row(axis as keyof typeof parameters, scenario.scenario, parameter);
        for (const mode of ['coefficient', 'dedicated'] as const) {
          expect(found[mode]).toMatchObject({
            delivered: original[mode].delivered,
            botCompleted: original[mode].botCompleted,
            fallbackCompleted: original[mode].fallbackCompleted,
            falsePositives: original[mode].falsePositives,
            triageSpent: original[mode].triageSpent,
            missed: 0,
            quality: original[mode].delivered,
          });
        }
      }
    }
  });

  it('seed列では混合だけ優劣が反転し、routineの最少でも専用が上', () => {
    expect(edges('seed')).toEqual([
      { board: 'mixed', from: ['RI-177', 'dedicated', 27, 39], to: ['RI-177-1', 'tie', 27, 27] },
      { board: 'mixed', from: ['RI-177-1', 'tie', 27, 27], to: ['RI-177-2', 'dedicated', 27, 37] },
      {
        board: 'mixed',
        from: ['RI-177-30', 'dedicated', 27, 33],
        to: ['RI-177-31', 'coefficient', 27, 25],
      },
    ]);
    const routine = report.sweeps.seed.rows.filter((item) => item.board === 'routine');
    expect(routine.every((item) => item.preference === 'dedicated')).toBe(true);
    expect(Math.min(...routine.map((item) => item.dedicated.delivered))).toBe(28);
    const complex = report.sweeps.seed.rows.filter((item) => item.board === 'complex');
    expect(
      complex.every(
        (item) =>
          item.preference === 'coefficient' &&
          item.coefficient.delivered === 30 &&
          item.dedicated.delivered === 15,
      ),
    ).toBe(true);
  });

  it('誤検知の位置と差戻し優先度では優劣が反転しない', () => {
    expect(report.sweeps.placement.reversals).toEqual([]);
    expect(report.sweeps.fallbackPriority.reversals).toEqual([]);
    expect(row('placement', 'routine', 'seed').dedicated.delivered).toBe(38);
    expect(row('placement', 'routine', 'back').dedicated.delivered).toBe(36);
    expect(row('placement', 'routine', 'front').dedicated.delivered).toBe(40);
    expect(row('placement', 'routine', 'burst').dedicated.scheduledFalsePositives).toBe(2);
    expect(row('placement', 'routine', 'front').dedicated.scheduledFalsePositives).toBe(2);
    expect(row('fallbackPriority', 'mixed', 'fifo').dedicated.delivered).toBe(39);
    expect(row('fallbackPriority', 'mixed', 'fallbackFirst').dedicated.delivered).toBe(36);
    expect(row('fallbackPriority', 'mixed', 'fallbackFirst').dedicated.triageSpent).toBe(1);
  });

  it('期限の隣接点だけで優劣が変わる', () => {
    expect(edges('deadline')).toEqual([
      { board: 'routine', from: ['1', 'tie', 0, 0], to: ['2', 'dedicated', 2, 4] },
      { board: 'routine', from: ['17', 'dedicated', 38, 40], to: ['18', 'tie', 40, 40] },
      { board: 'complex', from: ['2', 'tie', 0, 0], to: ['3', 'coefficient', 5, 0] },
      { board: 'complex', from: ['61', 'coefficient', 100, 95], to: ['62', 'tie', 100, 100] },
      { board: 'mixed', from: ['1', 'tie', 0, 0], to: ['2', 'dedicated', 0, 4] },
      { board: 'mixed', from: ['20', 'dedicated', 50, 54], to: ['21', 'tie', 54, 54] },
      { board: 'mixed', from: ['23', 'tie', 59, 59], to: ['24', 'coefficient', 61, 59] },
      { board: 'mixed', from: ['24', 'coefficient', 61, 59], to: ['25', 'tie', 61, 61] },
    ]);
  });

  it('見逃し罰は出荷を変えず、品質の優劣だけを反転させる', () => {
    expect(edges('missPenalty')).toEqual([
      { board: 'routine', from: ['2', 'dedicated', 26, 30], to: ['3', 'tie', 26, 26] },
      { board: 'routine', from: ['3', 'tie', 26, 26], to: ['4', 'coefficient', 26, 22] },
      { board: 'mixed', from: ['11', 'dedicated', 27, 28], to: ['12', 'tie', 27, 27] },
      { board: 'mixed', from: ['12', 'tie', 27, 27], to: ['13', 'coefficient', 27, 26] },
    ]);
    for (const item of report.sweeps.missPenalty.rows) {
      const baseline = row('deadline', item.board, '12');
      expect(item.dedicated.delivered).toBe(baseline.dedicated.delivered);
      expect(item.coefficient.delivered).toBe(baseline.coefficient.delivered);
      expect(item.coefficient.missed).toBe(0);
    }
    expect(row('missPenalty', 'routine', '0').dedicated.missed).toBe(4);
    expect(row('missPenalty', 'mixed', '0').dedicated.missed).toBe(1);
    expect(row('missPenalty', 'complex', '13').preference).toBe('coefficient');
    expect(row('missPenalty', 'complex', '13').dedicated.missed).toBe(0);
    const kinds = reviewBotBoardKinds('routine');
    const shipped = scoreReviewBotFactor(
      'RI-177',
      kinds,
      'dedicated',
      reviewBotFactorBaseline,
      true,
    );
    expect(shipped.delivered).toBe(38);
    expect(shipped.quality).toBe(38);
    expect(
      scoreReviewBotFactor(
        'RI-177',
        kinds,
        'dedicated',
        { ...reviewBotFactorBaseline, missPenalty: 4 },
        true,
      ).quality,
    ).toBe(22);
    expect(reviewBotLatentMisses('RI-177', 20)).toEqual(reviewBotLatentMisses('RI-177', 20));
  });

  it('先頭へ寄せた誤検知と、差戻し優先の保存再開が再現する', () => {
    const routine = reviewBotBoardKinds('routine');
    const seeded = createReviewBotPrototype('RI-177', routine, 'dedicated');
    const front = createReviewBotPrototype('RI-177', routine, 'dedicated', {
      falsePositivePlacement: 'front',
    });
    expect(seeded.jobs.filter((job) => job.falsePositive).map((job) => job.id)).toEqual([15, 17]);
    expect(front.jobs.filter((job) => job.falsePositive).map((job) => job.id)).toEqual([0, 1]);
    const fifo = createReviewBotPrototype(1, ['routine', 'complex'], 'dedicated');
    const first = createReviewBotPrototype(1, ['routine', 'complex'], 'dedicated', {
      fallbackPriority: 'fallbackFirst',
    });
    fifo.jobs[0].falsePositive = true;
    first.jobs[0].falsePositive = true;
    const fifoTick = tickReviewBotPrototype(tickReviewBotPrototype(fifo));
    const firstTick = tickReviewBotPrototype(tickReviewBotPrototype(first));
    expect(fifoTick.jobs[1].humanLeft).toBe(4);
    expect(fifoTick.jobs[0].humanLeft).toBe(4);
    expect(firstTick.jobs[0].humanLeft).toBe(2);
    expect(firstTick.jobs[1].humanLeft).toBe(6);
    let state = createReviewBotPrototype('RI-177', reviewBotBoardKinds('mixed'), 'dedicated', {
      deadline: 8,
      fallbackPriority: 'fallbackFirst',
      falsePositivePlacement: 'front',
    });
    let restored = JSON.parse(JSON.stringify(state));
    while (state.tick < state.deadline) {
      state = tickReviewBotPrototype(state);
      restored = tickReviewBotPrototype(JSON.parse(JSON.stringify(restored)));
    }
    expect(restored).toEqual(state);
    expect(state.fallbackPriority).toBe('fallbackFirst');
  });
});
