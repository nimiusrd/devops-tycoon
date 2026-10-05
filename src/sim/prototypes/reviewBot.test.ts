import { describe, expect, it } from 'vitest';
import comparison from '../../../docs/prototypes/review-bot-comparison.json';
import {
  compareReviewBotStrategies,
  createReviewBotPrototype,
  summarizeReviewBot,
  tickReviewBotPrototype,
} from './reviewBot';

describe('レビューBot専用経路の試作', () => {
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
