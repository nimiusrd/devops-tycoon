import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { runMachine, type RunEvent } from '../../src/state/runMachine';

/** マシンを初期状態から一連のイベントで駆動し、最終状態値を返す。 */
function drive(events: RunEvent['type'][]): string {
  const actor = createActor(runMachine).start();
  for (const type of events) actor.send({ type } as RunEvent);
  return actor.getSnapshot().value as string;
}

describe('ランフェーズマシン（XState / 第3章）', () => {
  it('タイトル → 編成 → スプリント → リザルト → ドラフト → 進化 → ビート の周回', () => {
    expect(drive(['START'])).toBe('setup');
    expect(drive(['START', 'BEGIN'])).toBe('sprint');
    expect(drive(['START', 'BEGIN', 'SPRINT_DONE'])).toBe('result');
    expect(drive(['START', 'BEGIN', 'SPRINT_DONE', 'ACK'])).toBe('draft');
    expect(drive(['START', 'BEGIN', 'SPRINT_DONE', 'ACK', 'NEXT'])).toBe('evolution');
    expect(drive(['START', 'BEGIN', 'SPRINT_DONE', 'ACK', 'NEXT', 'FINISH'])).toBe('beat');
  });

  it('ビートから通常スプリント／ショップ／休息／採用／編成へ分岐できる', () => {
    const toBeat: RunEvent['type'][] = ['START', 'BEGIN', 'SPRINT_DONE', 'ACK', 'NEXT', 'FINISH'];
    expect(drive([...toBeat, 'ENTER_SPRINT'])).toBe('sprint');
    expect(drive([...toBeat, 'ENTER_SHOP', 'RESOLVE'])).toBe('setup');
    expect(drive([...toBeat, 'ENTER_REST', 'RESOLVE'])).toBe('setup');
    expect(drive([...toBeat, 'ENTER_RECRUIT', 'RESOLVE'])).toBe('setup');
    // 即時採用成功など、ビートから直接編成へ戻れる。
    expect(drive([...toBeat, 'RESOLVE'])).toBe('setup');
    // ショップ・休息後の編成（setup-pre）から次スプリントを開始できる。
    expect(drive([...toBeat, 'ENTER_SHOP', 'RESOLVE', 'BEGIN'])).toBe('sprint');
  });

  it('判定イベントのハード敗北はビートから lost へ遷移する', () => {
    const toBeat: RunEvent['type'][] = ['START', 'BEGIN', 'SPRINT_DONE', 'ACK', 'NEXT', 'FINISH'];
    expect(drive([...toBeat, 'LOST'])).toBe('lost');
  });

  it('即時敗北は setup / shop / rest / recruit からも lost へ遷移できる', () => {
    expect(drive(['START', 'LOST'])).toBe('lost');
    const toBeat: RunEvent['type'][] = ['START', 'BEGIN', 'SPRINT_DONE', 'ACK', 'NEXT', 'FINISH'];
    expect(drive([...toBeat, 'ENTER_SHOP', 'LOST'])).toBe('lost');
    expect(drive([...toBeat, 'ENTER_REST', 'LOST'])).toBe('lost');
    expect(drive([...toBeat, 'ENTER_RECRUIT', 'LOST'])).toBe('lost');
  });

  it('即時敗北はリザルト / ドラフト / 進化 / 四半期レビューからも lost へ遷移できる（レバー等のガード無し経路）', () => {
    const toResult: RunEvent['type'][] = ['START', 'BEGIN', 'SPRINT_DONE'];
    expect(drive([...toResult, 'LOST'])).toBe('lost');
    expect(drive([...toResult, 'ACK', 'LOST'])).toBe('lost');
    expect(drive([...toResult, 'ACK', 'NEXT', 'LOST'])).toBe('lost');
    expect(drive(['START', 'BEGIN', 'BOSS_REVIEW', 'LOST'])).toBe('lost');
  });

  it('ボス完了で四半期レビューへ、承認で won / 継続で setup / 終了で lost', () => {
    expect(drive(['START', 'BEGIN', 'BOSS_REVIEW'])).toBe('quarterReview');
    expect(drive(['START', 'BEGIN', 'BOSS_REVIEW', 'REVIEW_WON'])).toBe('won');
    expect(drive(['START', 'BEGIN', 'BOSS_REVIEW', 'REVIEW_CONTINUE'])).toBe('setup');
    expect(drive(['START', 'BEGIN', 'BOSS_REVIEW', 'REVIEW_LOST'])).toBe('lost');
    expect(drive(['START', 'BEGIN', 'LOST'])).toBe('lost');
  });

  it('不正なイベントでは状態が変わらない', () => {
    expect(drive(['BEGIN'])).toBe('title');
  });
});
