import { describe, expect, it, vi } from 'vitest';
import { createGame } from '../game';
import { defaultMeta } from '../state/meta';
import { MemoryMetaStorage } from '../state/metaPersistence';
import { MemoryReplayStorage } from '../state/replayPersistence';
import { MemoryRunStorage } from '../state/runPersistence';
import {
  BURNOUT_PRACTICE,
  BurnoutPractice,
  lossPracticeForResult,
  type BurnoutPracticeAction,
} from './lossPractice';

function observe(practice: BurnoutPractice) {
  const view = practice.view();
  if (view.phase === 'closed') throw new Error('練習は終了しました');
  return view;
}

function trial(seed: string, action: BurnoutPracticeAction) {
  const practice = new BurnoutPractice(seed);
  const start = observe(practice);
  expect(practice.choose(action)).toBe(true);
  const afterChoice = observe(practice);
  for (let tick = 0; tick < 12; tick += 1) expect(practice.step()).toBe(true);
  const early = observe(practice);
  while (practice.step()) {
    // 選択時点から練習が終了するまで通常の固定ステップで進める。
  }
  const finish = observe(practice);
  expect(finish.phase).toBe('complete');
  expect(finish.tick).toBeLessThanOrEqual(BURNOUT_PRACTICE.endTick);
  practice.close();
  return { start, afterChoice, early, finish };
}

describe('RI-278 シニア燃え尽きの練習', () => {
  it('既存の燃え尽きの助言が出る敗北で練習を提案する', () => {
    const loss = { status: 'lost', loseReason: 'seniorBurnout' } as const;
    expect(lossPracticeForResult(loss, false)).toBe(BURNOUT_PRACTICE.id);
    expect(
      lossPracticeForResult({ ...loss, quarterReview: { outcome: 'missed_crisis' } }, false),
    ).toBe(BURNOUT_PRACTICE.id);
    expect(lossPracticeForResult(loss, true)).toBeNull();
    expect(lossPracticeForResult({ ...loss, status: 'won' }, false)).toBeNull();
    expect(lossPracticeForResult({ status: 'lost' }, false)).toBeNull();
    expect(lossPracticeForResult({ ...loss, loseReason: 'unknown' }, false)).toBeNull();
    expect(lossPracticeForResult({ ...loss, loseReason: 'reviewFreeze' }, false)).toBeNull();
    expect(
      lossPracticeForResult({ ...loss, quarterReview: { outcome: 'shutdown' } }, false),
    ).toBeNull();
    expect(
      lossPracticeForResult({ ...loss, quarterReview: { outcome: 'reorg_required' } }, false),
    ).toBeNull();
  });

  it.each([
    {
      seed: BURNOUT_PRACTICE.seed,
      andon: {
        early: { delivered: 29, reviewQueue: 5 },
        finish: { delivered: 197, reviewQueue: 8, seniorHp: 26, incidentCount: 0 },
      },
      interrupt: {
        afterChoice: { delivered: 21 },
        early: { delivered: 37, reviewQueue: 20 },
        finish: { delivered: 122, reviewQueue: 13, seniorHp: 1.9, incidentCount: 2 },
      },
    },
    {
      seed: `${BURNOUT_PRACTICE.seed}:1`,
      andon: {
        early: { delivered: 56, reviewQueue: 5 },
        finish: { delivered: 177, reviewQueue: 9, seniorHp: 21.9, incidentCount: 1 },
      },
      interrupt: {
        afterChoice: { delivered: 33 },
        early: { delivered: 83, reviewQueue: 19 },
        finish: { delivered: 259, reviewQueue: 6, seniorHp: 4.9, incidentCount: 1 },
      },
    },
    {
      seed: `${BURNOUT_PRACTICE.seed}:2`,
      andon: {
        early: { delivered: 25, reviewQueue: 5 },
        finish: { delivered: 151, reviewQueue: 9, seniorHp: 23.65, incidentCount: 1 },
      },
      interrupt: {
        afterChoice: { delivered: 20 },
        early: { delivered: 61, reviewQueue: 19 },
        finish: { delivered: 212, reviewQueue: 6, seniorHp: 17.6, incidentCount: 3 },
      },
    },
  ])('$seed の共通開始盤面で流入停止と即時処理の代償を再現する', (expected) => {
    // 出荷を急ぐ方針を先に選べる。
    const interrupt = trial(expected.seed, 'interruptReview');
    const andon = trial(expected.seed, 'andon');
    expect(andon.start).toEqual(interrupt.start);
    expect(andon.start).toMatchObject({ phase: 'ready', tick: 0, reviewQueue: 10, seniorHp: 24 });
    expect(andon.afterChoice).toMatchObject({
      tick: 0,
      delivered: 0,
      seniorHp: 24,
      morale: 66,
      focus: 0,
    });
    expect(interrupt.afterChoice).toMatchObject({ tick: 0, reviewQueue: 6, focus: 2 });
    expect(interrupt.afterChoice.seniorHp).toBeCloseTo(15.6);

    for (const [trial, target] of [
      [andon, expected.andon],
      [interrupt, expected.interrupt],
    ] as const) {
      expect(trial.early).toMatchObject(target.early);
      expect(trial.finish).toMatchObject({
        ...target.finish,
        tick: 60,
        seniorHp: expect.closeTo(target.finish.seniorHp),
      });
    }
    expect(interrupt.afterChoice).toMatchObject(expected.interrupt.afterChoice);
    expect(trial(expected.seed, 'andon')).toEqual(andon);
    expect(trial(expected.seed, 'interruptReview')).toEqual(interrupt);
  });

  it('選択前の時間経過・無効な介入・二重選択を防ぎ、退出後は新規盤面を使う', () => {
    const practice = new BurnoutPractice();
    const start = practice.view();
    expect(practice.step()).toBe(false);
    expect(practice.choose('overtime' as BurnoutPracticeAction)).toBe(false);
    expect(practice.view()).toEqual(start);
    expect(practice.choose('interruptReview')).toBe(true);
    const chosen = practice.view();
    expect(practice.choose('andon')).toBe(false);
    expect(practice.view()).toEqual(chosen);
    expect(practice.step()).toBe(true);
    practice.close();
    expect(practice.view()).toEqual({ phase: 'closed' });
    expect(practice.choose('andon')).toBe(false);
    expect(practice.step()).toBe(false);
    expect(new BurnoutPractice().view()).toEqual(start);
  });

  it('練習を閉じても敗北ランのリプレイと報酬を保持する', async () => {
    const runStorage = new MemoryRunStorage();
    const metaStorage = new MemoryMetaStorage();
    const replayStorage = new MemoryReplayStorage();
    const meta = { ...defaultMeta(), points: 15 };
    await metaStorage.save(meta);
    const game = createGame({ runStorage, metaStorage, initialMeta: meta, metaReady: true });
    game.attachRunPersistence(runStorage, null);
    await game.attachReplay(replayStorage);
    game.startRun('easy', [], 'original-loss');
    const frame = game.engine.exportReplayFrame();
    if (!frame) throw new Error('元ランの開始フレームがありません');
    // 燃え尽きの終端状態を用意し、通常の完了保存と報酬の経路を通す。
    game.engine.hydrateReplayFrame({
      ...frame,
      phase: 'lost',
      status: 'lost',
      loseReason: 'seniorBurnout',
    });
    const original = game.step(0);
    expect(lossPracticeForResult(original, false)).toBe(BURNOUT_PRACTICE.id);
    await vi.waitFor(async () => {
      expect(await runStorage.load()).toBeNull();
      expect((await replayStorage.list())[0]?.outcome.loseReason).toBe('seniorBurnout');
      expect(await metaStorage.load()).toEqual(game.getMeta());
    });
    const savedReplays = await replayStorage.list();
    const savedMeta = await metaStorage.load();
    const reward = game.getLastRunReward();
    expect(reward).not.toBeNull();
    expect(savedMeta?.points).toBeGreaterThan(meta.points);

    new BurnoutPractice().close();
    trial(BURNOUT_PRACTICE.seed, 'andon');

    expect(game.getState()).toEqual(original);
    expect(game.getLastRunReward()).toEqual(reward);
    expect(game.getMeta()).toEqual(savedMeta);
    expect(await runStorage.load()).toBeNull();
    expect(await replayStorage.list()).toEqual(savedReplays);
    expect(await metaStorage.load()).toEqual(savedMeta);
  });
});
