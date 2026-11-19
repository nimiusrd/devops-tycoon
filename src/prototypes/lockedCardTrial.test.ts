import { describe, expect, it } from 'vitest';
import { getCardUnlockByContentId } from '../data/unlocks';
import { createGame } from '../game';
import { defaultMeta, purchaseUnlock, unlockedContent } from '../state/meta';
import { MemoryMetaStorage } from '../state/metaPersistence';
import { MemoryRunStorage } from '../state/runPersistence';
import { LockedCardTrial } from './lockedCardTrial';

function startTrial(meta = defaultMeta(), seed?: string): LockedCardTrial {
  const trial = LockedCardTrial.start(meta, seed);
  if (!trial) throw new Error('貸与対象の試用を開始できません');
  return trial;
}

function observe(trial: LockedCardTrial) {
  const view = trial.view();
  if (view.phase === 'closed') throw new Error('試用は終了しました');
  return view;
}

function resultOf(trial: LockedCardTrial) {
  while (trial.step()) {
    // 現在の選択で終了まで進める。
  }
  return observe(trial);
}

function codingPassed({ tasks }: ReturnType<typeof observe>): number {
  return tasks.filter(({ lane }) => lane !== 'backlog' && lane !== 'coding').length;
}

describe('RI-281 未解放カードの試用', () => {
  it('貸与カードと解放済みカードを区別し、所有済みなら試用対象から外す', () => {
    const meta = defaultMeta();
    const trial = startTrial(meta);
    const ready = observe(trial);
    expect(ready).toMatchObject({
      phase: 'ready',
      choice: null,
      cards: [
        { cardId: 'auto-test', access: 'unlocked' },
        { cardId: 'devin', access: 'loaned' },
      ],
    });
    expect(unlockedContent(meta).cards.has('devin')).toBe(false);
    expect(LockedCardTrial.start({ ...meta, unlockedCards: ['devin'] })).toBeNull();

    ready.cards.pop();
    ready.tasks[0]!.progress = 100;
    expect(observe(trial)).toEqual(startTrial().view());
  });

  it.each(['RI-281', 'RI-281:1', 'RI-281:2'])('%s で同じ盤面から両方針を再現する', (seed) => {
    const comparison = startTrial(defaultMeta(), seed);
    const loan = startTrial(defaultMeta(), seed);
    const before = observe(loan);
    expect(before).toEqual(comparison.view());
    expect(before.tasks).toEqual(observe(startTrial()).tasks);
    expect(before).toMatchObject({ tick: 0, focus: 4, securityLevel: 60, aiDependency: 35 });
    expect(comparison.choose('auto-test')).toBe(true);
    expect(loan.choose('devin')).toBe(true);
    expect(comparison.view()).toMatchObject({ tick: 0, focus: 1, securityLevel: 68 });
    expect(loan.view()).toMatchObject({ tick: 0, focus: 0, securityLevel: 52, aiDependency: 43 });

    for (let i = 0; i < 6; i += 1) {
      expect(comparison.step()).toBe(true);
      expect(loan.step()).toBe(true);
    }
    expect(codingPassed(observe(loan))).toBeGreaterThan(codingPassed(observe(comparison)));
    const baseline = resultOf(comparison);
    const borrowed = resultOf(loan);
    expect(borrowed.reworkCount).toBeGreaterThan(baseline.reworkCount);
    expect(borrowed.delivered).toBeLessThan(baseline.delivered);

    for (const [result, cardId] of [
      [baseline, 'auto-test'],
      [borrowed, 'devin'],
    ] as const) {
      expect(result).toMatchObject({ phase: 'complete', tick: 32, timedOut: true });
      const repeated = startTrial(defaultMeta(), seed);
      expect(repeated.choose(cardId)).toBe(true);
      expect(resultOf(repeated)).toEqual(result);
    }
  });

  it('選択前の進行、不明なカード、二重選択、退出後の操作を受け付けない', () => {
    const trial = startTrial();
    expect(trial.step()).toBe(false);
    expect(trial.choose('unknown' as 'devin')).toBe(false);
    expect(trial.view()).toEqual(startTrial().view());
    expect(trial.choose('auto-test')).toBe(true);
    const chosen = trial.view();
    expect(trial.choose('devin')).toBe(false);
    expect(trial.view()).toEqual(chosen);
    expect(trial.close()).toEqual({ screen: 'card-collection', cardId: 'devin' });
    expect(trial.view()).toEqual({ phase: 'closed' });
    expect(trial.step()).toBe(false);
    expect(trial.choose('devin')).toBe(false);
  });

  it('中断と終了のどちらも通常ランの保存・メタ・解放プールに影響しない', async () => {
    const seed = 'existing-run';
    const runStorage = new MemoryRunStorage();
    const metaStorage = new MemoryMetaStorage();
    const meta = { ...defaultMeta(), points: 65, unlockedCards: ['review-bot'] };
    await metaStorage.save(meta);
    const game = createGame({ seed, runStorage, initialMeta: meta, metaStorage, metaReady: true });
    game.attachRunPersistence(runStorage, null);
    game.startRun('easy', [], seed);
    const savedRun = await runStorage.load();
    expect(savedRun?.summary.seed).toBe(seed);
    const before = game.engine.exportPersistState();

    const beforeMeta = structuredClone(meta);
    for (const exit of ['skip', 'interrupt', 'finish']) {
      const trial = startTrial(game.getMeta());
      if (exit !== 'skip') {
        expect(trial.choose('devin')).toBe(true);
        expect(trial.step()).toBe(true);
      }
      if (exit === 'finish') expect(resultOf(trial).phase).toBe('complete');
      expect(trial.close()).toEqual({ screen: 'card-collection', cardId: 'devin' });
      expect(trial.view()).toEqual({ phase: 'closed' });
      expect(game.getMeta()).toEqual(beforeMeta);
      expect(unlockedContent(game.getMeta()).cards.has('devin')).toBe(false);
      expect(await metaStorage.load()).toEqual(game.getMeta());
      expect(await runStorage.load()).toEqual(savedRun);
      expect(game.engine.exportPersistState()).toEqual(before);
    }

    const resumed = createGame({ runStorage, initialMeta: meta, metaStorage, metaReady: true });
    resumed.attachRunPersistence(runStorage, savedRun);
    expect(resumed.resumeRun()).toMatchObject({ phase: 'setup', seed });
  });

  it('購入せずコレクションへ戻り、購入する場合は既存の実績とポイント条件を使う', () => {
    const meta = { ...defaultMeta(), points: 65 };
    const trial = startTrial(meta);
    expect(trial.choose('devin')).toBe(true);
    resultOf(trial);
    const { cardId } = trial.close();
    const unlock = getCardUnlockByContentId(cardId);
    expect(unlock).toMatchObject({ cost: 50, requires: 'review-exceeded' });
    if (!unlock?.requires) throw new Error('コレクションの取得条件がありません');
    expect(meta).toEqual({ ...defaultMeta(), points: 65 });
    expect(purchaseUnlock(meta, unlock.id)).toMatchObject({ ok: false, reason: 'requires' });
    const eligible = { ...meta, achievements: [unlock.requires] };
    expect(purchaseUnlock({ ...eligible, points: 49 }, unlock.id)).toMatchObject({
      ok: false,
      reason: 'insufficient_points',
    });
    expect(startTrial(eligible).view()).toMatchObject({ phase: 'ready' });
    expect(eligible.points).toBe(65);
    expect(eligible.unlockedCards).toEqual([]);
    const purchased = purchaseUnlock(eligible, unlock.id);
    expect(purchased).toMatchObject({ ok: true, meta: { points: 15, unlockedCards: ['devin'] } });
    expect(LockedCardTrial.start(purchased.meta)).toBeNull();
  });
});
