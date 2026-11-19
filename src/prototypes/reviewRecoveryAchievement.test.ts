import { describe, expect, it } from 'vitest';
import { createGame } from '../game';
import { ANDON_TICKS } from '../sim/actions';
import { defaultMeta } from '../state/meta';
import { MemoryMetaStorage } from '../state/metaPersistence';
import { MemoryRunStorage } from '../state/runPersistence';
import { assessReviewRecovery, simulateReviewRecovery } from './reviewRecoveryAchievement';

describe('RI-282 アンドン後のレビュー滞留回復', () => {
  it('同じ初期条件で流入停止と出荷を実測し、待機で回復しても介入の証跡は作らない', () => {
    const action = simulateReviewRecovery('RI-282:1', 'andon');
    const wait = simulateReviewRecovery('RI-282:1', 'wait');
    expect(action.initial).toEqual(wait.initial);
    expect(action.trace.observations[0]).toEqual(wait.trace.observations[0]);
    expect(action.trace.observations[ANDON_TICKS]!.backlog).toBe(12);
    expect(wait.trace.observations[1]!.backlog).toBeLessThan(12);
    expect(action.trace.observations[ANDON_TICKS + 1]!.backlog).toBeLessThan(12);
    expect(action.outcome).toMatchObject({ delivered: 186, focusSpent: 5, moraleCost: 4 });
    expect(wait.outcome).toMatchObject({ delivered: 192, focusSpent: 0, moraleCost: 0 });
    expect(action.result).toEqual({
      status: 'recorded',
      recovered: true,
      pausedIntakeTicks: Array.from({ length: ANDON_TICKS }, (_, tick) => tick),
    });
    expect(wait.result).toEqual({ status: 'not-recorded', recovered: true, pausedIntakeTicks: [] });
    expect(assessReviewRecovery(JSON.parse(JSON.stringify(action.trace)))).toEqual(action.result);
    expect(simulateReviewRecovery('RI-282:1', 'andon')).toEqual(action);
  });

  it.each([
    ['RI-282', false, false],
    ['RI-282:3', false, true],
    ['RI-282:6', true, false],
  ])('アンドンと待機の回復条件を独立に判定する（%s）', (seed, actionRecovers, waitRecovers) => {
    const action = simulateReviewRecovery(seed, 'andon');
    const wait = simulateReviewRecovery(seed, 'wait');
    expect(action.result).toMatchObject({
      status: actionRecovers ? 'recorded' : 'not-recorded',
      recovered: actionRecovers,
    });
    expect(wait.result).toMatchObject({ status: 'not-recorded', recovered: waitRecovers });
  });

  it('渋滞・投入機会・元のレビューの出荷・継続した回復をすべて求める', () => {
    const { trace } = simulateReviewRecovery('RI-282:1', 'andon');
    const setSamples = (
      set: (
        sample: (typeof trace.observations)[number],
        tick: number,
      ) => (typeof trace.observations)[number],
    ) => ({ ...trace, observations: trace.observations.map(set) });

    const withoutCrisis = setSamples((sample, tick) => ({
      ...sample,
      reviewQueue: tick === 0 ? 9 : sample.reviewQueue,
      originalReviewDone: Math.min(sample.originalReviewDone, 9),
    }));
    const withoutIntake = setSamples((sample) => ({ ...sample, openCodingSlot: false }));
    const withoutDelivery = setSamples((sample) => ({
      ...sample,
      originalReviewDone: Math.min(sample.originalReviewDone, 5),
    }));
    const transient = setSamples((sample, tick) => ({
      ...sample,
      reviewQueue: tick === 38 ? 6 : sample.reviewQueue,
    }));
    for (const insufficient of [withoutCrisis, withoutDelivery, transient]) {
      expect(assessReviewRecovery(insufficient)).toMatchObject({
        status: 'not-recorded',
        recovered: false,
      });
    }
    expect(assessReviewRecovery(withoutIntake)).toEqual({
      status: 'not-recorded',
      recovered: true,
      pausedIntakeTicks: [],
    });
  });

  it('旧・未知版、異なるルールセット、欠損、矛盾する観測は未判定にする', () => {
    const { trace } = simulateReviewRecovery('RI-282:1', 'andon');
    const observations = [...trace.observations];
    delete observations[3];
    const wait = simulateReviewRecovery('RI-282:1', 'wait');
    for (const invalid of [
      undefined,
      { sprint: { timeline: trace.observations } },
      { ...trace, version: 2 },
      { ...trace, ruleset: { ...trace.ruleset, fingerprint: 'unknown' } },
      { ...trace, decision: { action: 'andon' } },
      { ...trace, observations: trace.observations.slice(0, -1) },
      { ...trace, observations },
      { ...wait.trace, decision: trace.decision },
    ]) {
      expect(assessReviewRecovery(invalid)).toEqual({ status: 'unassessed' });
    }
  });

  it('同じ危機を試し直しても通常ランの保存とメタ報酬は変化しない', async () => {
    const runStorage = new MemoryRunStorage();
    const metaStorage = new MemoryMetaStorage();
    const meta = { ...defaultMeta(), points: 15 };
    await metaStorage.save(meta);
    const game = createGame({ initialMeta: meta, metaStorage, metaReady: true });
    game.attachRunPersistence(runStorage, null);
    game.startRun('normal', [], 'existing-run');
    const savedRun = await runStorage.load();
    expect(savedRun?.summary).toMatchObject({ phase: 'setup', seed: 'existing-run' });
    const engine = game.engine.exportPersistState();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(simulateReviewRecovery('RI-282:1', 'andon').result.status).toBe('recorded');
    }

    expect(game.engine.exportPersistState()).toEqual(engine);
    expect(game.getMeta()).toEqual(meta);
    expect(await metaStorage.load()).toEqual(meta);
    expect(await runStorage.load()).toEqual(savedRun);
  });
});
